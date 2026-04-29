#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: "/Users/daeyounglee/Projects/acp-agents/virtual/.env" });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const LOGS_DIR = path.resolve(ROOT, "logs");
const OFFERING_NAME = "legacy_wallet_pull_funds_v1";
const RECOVERY_SELLER_NAME = "o2o-printful-hub";
const RECOVERY_SELLER_WALLET = "0x092Bd61Af8EDE22B8291bE9b88259BE8b9845657";
const SHARED_WALLET = "0x728Eb75E5251f302885328d9480447AF7329c237";
const LEGACY_AGENT_NAME = "buyer-20260225";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_BACKUP_CONFIG = path.resolve(ROOT, "config.json.bak.20260305125542");
const CURRENT_CONFIG = path.resolve(ROOT, "config.json");
const CURRENT_ROOT_ENV = "/Users/daeyounglee/Projects/acp-agents/virtual/.env";
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const ACP_TRANSFER_DECIMAL_PRECISION = 6;

type WalletBalanceRow = {
  address: string;
  network: string;
  tokenAddress: string | null;
  tokenBalance: string;
  tokenMetadata?: {
    decimals?: number | null;
    logo?: string | null;
    name?: string | null;
    symbol?: string | null;
  };
  tokenPrices?: Array<{ currency: string; value: string }>;
};

type RecoverableAsset = {
  index: number;
  symbol: string;
  name: string;
  tokenAddress: string;
  amount: string;
  decimals: number;
  rawHexBalance: string;
};

type RecoveryManifest = {
  generatedAt: string;
  legacyAgentName: string;
  legacyWalletAddress: string | null;
  sharedWalletAddress: string;
  nativeEthAmount: string;
  assets: RecoverableAsset[];
};

type SupportBriefInput = {
  currentUserId: string;
  legacyUserId: string;
  legacyAgentName: string;
  legacyWalletAddress: string;
  nativeEthAmount: string;
  recoverableAssets: Array<{ symbol: string; amount: string }>;
  residualAssets?: Array<{ symbol: string; amount: string; tokenAddress: string }>;
};

type RecoverySummaryAsset = RecoverableAsset & {
  beforeRecipientAmount: string;
  afterRecipientAmount: string;
  claimCode: string;
  jobId: number;
  phase: string;
};

type RecoverySummary = {
  startedAt: string;
  completedAt?: string;
  manifestPath: string;
  supportBriefPath: string;
  legacyBeforeSnapshotPath?: string;
  legacyAfterSnapshotPath?: string;
  recipientBeforeSnapshotPath?: string;
  recipientAfterSnapshotPath?: string;
  summaryPath?: string;
  legacyWalletAddress: string | null;
  recipientWalletAddress: string;
  assetsRecovered: RecoverySummaryAsset[];
  nativeEthRemaining: string;
  residualLegacyAssets?: Array<{ symbol: string; amount: string; tokenAddress: string }>;
  stoppedReason?: string;
};

function hexToBigInt(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function formatUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function minimumTransferRaw(decimals: number): bigint {
  if (decimals <= ACP_TRANSFER_DECIMAL_PRECISION) {
    return 1n;
  }
  return 10n ** BigInt(decimals - ACP_TRANSFER_DECIMAL_PRECISION);
}

function normalizeAddress(value: string | null | undefined): string | null {
  if (!value || !String(value).trim()) return null;
  return String(value).trim().toLowerCase();
}

function isPositiveBalance(row: WalletBalanceRow): boolean {
  return hexToBigInt(row.tokenBalance) > 0n;
}

function decodeUserIdFromSessionToken(token: string | undefined): string {
  const raw = String(token || "").trim();
  if (!raw) return "";
  try {
    const payload = raw.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return String(decoded.userId || "");
  } catch {
    return "";
  }
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readEnvValue(filePath: string, key: string): string {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  return String(match?.[1] || "").trim();
}

function findAgentApiKey(configPath: string, agentName: string): string {
  const config = readJsonFile<any>(configPath);
  const match = Array.isArray(config?.agents)
    ? config.agents.find((agent: any) => String(agent?.name || "").toLowerCase() === agentName.toLowerCase())
    : undefined;
  return String(match?.apiKey || "").trim();
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(text || response.statusText);
  }
  return payload as T;
}

async function fetchWalletBalances(apiKey: string): Promise<WalletBalanceRow[]> {
  const payload = await fetchJson<{ data: WalletBalanceRow[] }>("https://claw-api.virtuals.io/acp/wallet-balances", {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

function writeSnapshot(filePath: string, rows: WalletBalanceRow[]): void {
  fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

function persistSummary(summary: RecoverySummary): RecoverySummary {
  const summaryPath = path.resolve(LOGS_DIR, `legacy_wallet_recovery_summary_${Date.now()}.json`);
  summary.summaryPath = summaryPath;
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

function getAssetPriority(symbol: string, tokenAddress: string): number {
  const normalizedSymbol = symbol.toUpperCase();
  const normalizedAddress = tokenAddress.toLowerCase();
  if (normalizedSymbol === "USDC") return 0;
  if (normalizedSymbol === "VIRTUAL") return 1;
  if (normalizedSymbol === "POD") return 2;
  if (normalizedAddress === "0xe036476ba1f23e072176a40f6340a1b22162cd40") return 3;
  return 10;
}

function isActionableAsset(asset: RecoverableAsset): boolean {
  return hexToBigInt(asset.rawHexBalance) >= minimumTransferRaw(asset.decimals);
}

export function filterActionableAssets(assets: RecoverableAsset[]): RecoverableAsset[] {
  return assets.filter((asset) => isActionableAsset(asset));
}

export function buildLegacyRecoveryManifest(rows: WalletBalanceRow[]): RecoveryManifest {
  const native = rows.find((row) => row.tokenAddress == null);
  const assets = rows
    .filter((row) => isPositiveBalance(row))
    .map((row, index) => {
      const isNative = row.tokenAddress == null;
      const decimals = isNative ? 18 : Number(row.tokenMetadata?.decimals ?? 18);
      const symbolRaw = isNative ? "ETH" : String(row.tokenMetadata?.symbol || "").trim();
      const nameRaw = isNative ? "Ether" : String(row.tokenMetadata?.name || "").trim();
      return {
        index,
        symbol: symbolRaw || `UNKNOWN_${index + 1}`,
        name: nameRaw || symbolRaw || `Unknown Token ${index + 1}`,
        tokenAddress: isNative ? "native" : normalizeAddress(row.tokenAddress)!,
        amount: formatUnits(hexToBigInt(row.tokenBalance), decimals),
        decimals,
        rawHexBalance: row.tokenBalance,
      };
    })
    .sort((left, right) => {
      const priorityDelta =
        getAssetPriority(left.symbol, left.tokenAddress) -
        getAssetPriority(right.symbol, right.tokenAddress);
      if (priorityDelta !== 0) return priorityDelta;
      return left.tokenAddress.localeCompare(right.tokenAddress);
    })
    .map((asset, index) => ({
      ...asset,
      index,
      symbol: asset.symbol || `UNKNOWN_${index + 1}`,
    }));

  const normalizedAssets = assets.map((asset, index) => ({
    ...asset,
    symbol: asset.symbol.startsWith("UNKNOWN_") ? `UNKNOWN_${index + 1}` : asset.symbol,
    name:
      asset.name || (asset.symbol.startsWith("UNKNOWN_") ? `Unknown Token ${index + 1}` : asset.symbol),
  }));

  return {
    generatedAt: new Date().toISOString(),
    legacyAgentName: LEGACY_AGENT_NAME,
    legacyWalletAddress: normalizeAddress(native?.address || rows[0]?.address || null),
    sharedWalletAddress: SHARED_WALLET,
    nativeEthAmount: native ? formatUnits(hexToBigInt(native.tokenBalance), 18) : "0",
    assets: normalizedAssets,
  };
}

export function renderSupportBrief(input: SupportBriefInput): string {
  const residualSection =
    input.residualAssets && input.residualAssets.length > 0
      ? [
          "",
          "Residual assets still stranded after ACP recovery:",
          ...input.residualAssets.map(
            (asset) => `- ${asset.symbol}: ${asset.amount} (${asset.tokenAddress})`
          ),
          "",
          "These appear to be below ACP transfer precision and require wallet-level withdrawal or support-side assistance.",
        ]
      : [];

  return [
    `Legacy agent: ${input.legacyAgentName}`,
    `Legacy wallet: ${input.legacyWalletAddress}`,
    `Current user ID: ${input.currentUserId || "(unknown)"}`,
    `Legacy user ID: ${input.legacyUserId || "(unknown)"}`,
    `Remaining native balance: ${input.nativeEthAmount} ETH`,
    "",
    "Recovered ERC-20 assets so far:",
    ...input.recoverableAssets.map((asset) => `- ${asset.symbol}: ${asset.amount}`),
    ...residualSection,
    "",
    "Request:",
    "Please restore visibility for the legacy agent, transfer the agent to a fresh owner wallet, or assist with manual withdrawal of the remaining native ETH.",
    "",
    "Proof included:",
    "- still-valid legacy API key can read /acp/me and /acp/wallet-balances",
    "- legacy wallet balance snapshot",
    "- current and legacy session user IDs differ",
  ].join("\n");
}

function buildResidualAssetList(rows: WalletBalanceRow[]): Array<{ symbol: string; amount: string; tokenAddress: string }> {
  return rows
    .filter((row) => row.tokenAddress != null)
    .filter((row) => isPositiveBalance(row))
    .map((row, index) => {
      const decimals = Number(row.tokenMetadata?.decimals ?? 18);
      const symbol = String(row.tokenMetadata?.symbol || "").trim() || `UNKNOWN_${index + 1}`;
      return {
        symbol,
        amount: formatUnits(hexToBigInt(row.tokenBalance), decimals),
        tokenAddress: normalizeAddress(row.tokenAddress)!,
      };
    });
}

async function waitForTerminalJobPhase(
  apiKey: string,
  jobId: number,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS
): Promise<string> {
  const terminalPhases = new Set(["COMPLETED", "REJECTED", "EXPIRED"]);
  const started = Date.now();
  let lastPhase = "unknown";
  while (Date.now() - started < timeoutMs) {
    const job = await getJob(apiKey, jobId);
    lastPhase = String(job?.phase || "unknown");
    if (terminalPhases.has(lastPhase)) {
      return lastPhase;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  return lastPhase;
}

async function upsertRecoveryOffering(apiKey: string): Promise<void> {
  const payload = {
    data: {
      name: OFFERING_NAME,
      description: "One-time legacy wallet pull to a controlled seller wallet for authenticated recovery.",
      priceV2: { type: "percentage", value: 0.001 },
      slaMinutes: 5,
      requiredFunds: true,
      requirement: {
        type: "object",
        properties: {
          claimCode: { type: "string", minLength: 16 },
          memo: { type: "string" },
        },
        required: ["claimCode"],
        additionalProperties: false,
      },
      deliverable: "string",
    },
  };

  await fetchJson("https://claw-api.virtuals.io/acp/job-offerings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
}

async function deleteRecoveryOffering(apiKey: string): Promise<void> {
  await fetchJson(`https://claw-api.virtuals.io/acp/job-offerings/${encodeURIComponent(OFFERING_NAME)}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
}

async function createJob(
  apiKey: string,
  providerWalletAddress: string,
  offeringName: string,
  requirements: Record<string, unknown>
): Promise<number> {
  const payload = await fetchJson<{ data?: { jobId?: number }; jobId?: number }>(
    "https://claw-api.virtuals.io/acp/jobs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        providerWalletAddress,
        jobOfferingName: offeringName,
        serviceRequirements: requirements,
      }),
    }
  );
  const jobId = Number(payload?.data?.jobId ?? payload?.jobId);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    throw new Error("job create did not return a valid jobId");
  }
  return jobId;
}

async function getJob(apiKey: string, jobId: number): Promise<any> {
  const payload = await fetchJson<any>(`https://claw-api.virtuals.io/acp/jobs/${jobId}`, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
  });
  return payload?.data || payload;
}

async function waitForSellerReady(
  child: ReturnType<typeof spawn>,
  logStream: fs.WriteStream,
  timeoutMs = 20_000
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("seller runtime did not become ready"));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      logStream.write(text);
      if (text.includes("Joined ACP room") || text.includes("Seller runtime is running")) {
        clearTimeout(timeout);
        resolve();
      }
    };

    const onError = (chunk: Buffer) => {
      logStream.write(chunk.toString("utf8"));
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onError);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`seller runtime exited before ready (${code ?? "unknown"})`));
    });
  });
}

function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGINT");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      resolve();
    }, 5_000);
  });
}

function buildChildEnv(baseEnv: NodeJS.ProcessEnv, asset: RecoverableAsset, claimCode: string) {
  return {
    ...baseEnv,
    LITE_AGENT_API_KEY: findAgentApiKey(DEFAULT_BACKUP_CONFIG, RECOVERY_SELLER_NAME),
    LEGACY_PULL_CLAIM_CODE: claimCode,
    LEGACY_PULL_AMOUNT: asset.amount,
    LEGACY_PULL_TOKEN_ADDRESS: asset.tokenAddress,
    LEGACY_PULL_RECIPIENT: SHARED_WALLET,
    LEGACY_PULL_LABEL: `legacy_${asset.symbol.toLowerCase()}_pull`,
  };
}

async function waitForBalanceIncrease(
  sharedKey: string,
  asset: RecoverableAsset,
  beforeRaw: bigint
): Promise<{ afterAmount: string; afterRaw: bigint }> {
  const started = Date.now();
  while (Date.now() - started < DEFAULT_POLL_TIMEOUT_MS) {
    const balances = await fetchWalletBalances(sharedKey);
    const row = balances.find(
      (candidate) => normalizeAddress(candidate.tokenAddress) === normalizeAddress(asset.tokenAddress)
    );
    const afterRaw = row ? hexToBigInt(row.tokenBalance) : 0n;
    if (afterRaw > beforeRaw) {
      return {
        afterAmount: formatUnits(afterRaw, asset.decimals),
        afterRaw,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }
  throw new Error(`shared wallet balance did not increase for ${asset.symbol}`);
}

function ensureLogsDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

async function recoverErc20Assets(apply = false): Promise<RecoverySummary> {
  ensureLogsDir();

  const legacyKey = findAgentApiKey(DEFAULT_BACKUP_CONFIG, LEGACY_AGENT_NAME);
  const sellerKey = findAgentApiKey(DEFAULT_BACKUP_CONFIG, RECOVERY_SELLER_NAME);
  const sharedKey = readEnvValue(CURRENT_ROOT_ENV, "OPS_BUYER_HUB_API_KEY");
  if (!legacyKey || !sellerKey || !sharedKey) {
    throw new Error("missing required API keys for recovery");
  }

  const currentConfig = readJsonFile<any>(CURRENT_CONFIG);
  const legacyConfig = readJsonFile<any>(DEFAULT_BACKUP_CONFIG);
  const legacyBalances = await fetchWalletBalances(legacyKey);
  const sharedBalances = await fetchWalletBalances(sharedKey);
  const manifest = buildLegacyRecoveryManifest(legacyBalances);
  const actionableAssets = filterActionableAssets(manifest.assets);

  const manifestPath = path.resolve(LOGS_DIR, `legacy_wallet_recovery_manifest_${Date.now()}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const legacyBeforeSnapshotPath = path.resolve(LOGS_DIR, `legacy_wallet_before_${Date.now()}.json`);
  const recipientBeforeSnapshotPath = path.resolve(LOGS_DIR, `shared_wallet_before_${Date.now()}.json`);
  writeSnapshot(legacyBeforeSnapshotPath, legacyBalances);
  writeSnapshot(recipientBeforeSnapshotPath, sharedBalances);

  const supportBrief = renderSupportBrief({
    currentUserId: decodeUserIdFromSessionToken(currentConfig?.SESSION_TOKEN?.token),
    legacyUserId: decodeUserIdFromSessionToken(legacyConfig?.SESSION_TOKEN?.token),
    legacyAgentName: LEGACY_AGENT_NAME,
    legacyWalletAddress: manifest.legacyWalletAddress || "unknown",
      nativeEthAmount: manifest.nativeEthAmount,
      recoverableAssets: actionableAssets.map((asset) => ({
        symbol: asset.symbol,
        amount: asset.amount,
      })),
      residualAssets: manifest.assets
        .filter((asset) => !isActionableAsset(asset))
        .map((asset) => ({
          symbol: asset.symbol,
          amount: asset.amount,
          tokenAddress: asset.tokenAddress,
        })),
    });
  const supportBriefPath = path.resolve(LOGS_DIR, `legacy_wallet_support_brief_${Date.now()}.md`);
  fs.writeFileSync(supportBriefPath, `${supportBrief}\n`, "utf8");

  const summary: RecoverySummary = {
    startedAt: new Date().toISOString(),
    manifestPath,
    supportBriefPath,
    legacyBeforeSnapshotPath,
    recipientBeforeSnapshotPath,
    legacyWalletAddress: manifest.legacyWalletAddress,
    recipientWalletAddress: SHARED_WALLET,
    assetsRecovered: [],
    nativeEthRemaining: manifest.nativeEthAmount,
  };

  if (!apply) {
    summary.stoppedReason = actionableAssets.length > 0 ? "dry_run" : "no_actionable_erc20_assets";
    summary.completedAt = new Date().toISOString();
    return persistSummary(summary);
  }

  if (actionableAssets.length === 0) {
    summary.stoppedReason = "no_actionable_erc20_assets";
    summary.completedAt = new Date().toISOString();
    return persistSummary(summary);
  }

  await upsertRecoveryOffering(sellerKey);

  try {
    for (const asset of actionableAssets) {
      const claimCode = randomBytes(24).toString("hex");
      const runtimeLogPath = path.resolve(
        LOGS_DIR,
        `legacy_wallet_recovery_${asset.symbol.toLowerCase()}_${Date.now()}.log`
      );
      const runtimeLog = fs.createWriteStream(runtimeLogPath, { flags: "a" });
      const sellerProcess = spawn("npx", ["tsx", "src/seller/runtime/seller.ts"], {
        cwd: ROOT,
        env: buildChildEnv(process.env, asset, claimCode),
        stdio: ["ignore", "pipe", "pipe"],
      });

      try {
        await waitForSellerReady(sellerProcess, runtimeLog);

        const sharedBalancesBeforeAsset = await fetchWalletBalances(sharedKey);
        const beforeRow = sharedBalancesBeforeAsset.find(
          (row) => normalizeAddress(row.tokenAddress) === normalizeAddress(asset.tokenAddress)
        );
        const beforeRaw = beforeRow ? hexToBigInt(beforeRow.tokenBalance) : 0n;

        const jobId = await createJob(legacyKey, RECOVERY_SELLER_WALLET, OFFERING_NAME, {
          claimCode,
          memo: `recover ${asset.symbol} to shared wallet`,
        });

        const balanceDelta = await waitForBalanceIncrease(sharedKey, asset, beforeRaw);
        const phase = await waitForTerminalJobPhase(legacyKey, jobId).catch(() => "unknown");

        summary.assetsRecovered.push({
          ...asset,
          beforeRecipientAmount: formatUnits(beforeRaw, asset.decimals),
          afterRecipientAmount: balanceDelta.afterAmount,
          claimCode,
          jobId,
          phase,
        });
      } finally {
        await stopChild(sellerProcess);
        runtimeLog.end();
      }
    }
  } catch (error) {
    summary.stoppedReason = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await deleteRecoveryOffering(sellerKey).catch(() => undefined);
    const legacyAfterBalances = await fetchWalletBalances(legacyKey).catch(() => []);
    const recipientAfterBalances = await fetchWalletBalances(sharedKey).catch(() => []);
    summary.residualLegacyAssets = buildResidualAssetList(legacyAfterBalances);
    summary.legacyAfterSnapshotPath = path.resolve(LOGS_DIR, `legacy_wallet_after_${Date.now()}.json`);
    summary.recipientAfterSnapshotPath = path.resolve(LOGS_DIR, `shared_wallet_after_${Date.now()}.json`);
    writeSnapshot(summary.legacyAfterSnapshotPath, legacyAfterBalances);
    writeSnapshot(summary.recipientAfterSnapshotPath, recipientAfterBalances);
    const finalSupportBrief = renderSupportBrief({
      currentUserId: decodeUserIdFromSessionToken(currentConfig?.SESSION_TOKEN?.token),
      legacyUserId: decodeUserIdFromSessionToken(legacyConfig?.SESSION_TOKEN?.token),
      legacyAgentName: LEGACY_AGENT_NAME,
      legacyWalletAddress: manifest.legacyWalletAddress || "unknown",
      nativeEthAmount: manifest.nativeEthAmount,
      recoverableAssets: summary.assetsRecovered.map((asset) => ({
        symbol: asset.symbol,
        amount: asset.afterRecipientAmount,
      })),
      residualAssets: summary.residualLegacyAssets,
    });
    fs.writeFileSync(supportBriefPath, `${finalSupportBrief}\n`, "utf8");
    summary.completedAt = new Date().toISOString();
    persistSummary(summary);
  }

  return summary;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const summary = await recoverErc20Assets(apply);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
}

export { recoverErc20Assets };
