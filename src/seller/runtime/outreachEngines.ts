import axios from "axios";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import client from "../../lib/client.js";
import { readConfig } from "../../lib/config.js";

const SEARCH_URL = process.env.SEARCH_URL || "http://acpx.virtuals.io/api/agents/v5/search";
const LEGACY_OPENHANDS_WORKER_PATH =
  "/Users/daeyounglee/Projects/codex-infra/agent-infra/scripts/agent_framework_worker.py";
const DEFAULT_TIMEOUT_MS = 45000;
const OUTREACH_LEDGER_PATH = path.resolve(process.cwd(), "logs", "outreach_pnl_ledger.json");
const DAILY_EXTERNAL_SPEND_CAP_DEFAULT = clampFloat(
  process.env.OUTREACH_DAILY_EXTERNAL_SPEND_CAP_USDC,
  0.3,
  0.01,
  5000
);
const HIGH_COST_THRESHOLD_DEFAULT = clampFloat(
  process.env.OUTREACH_HIGH_COST_THRESHOLD_USDC,
  0.05,
  0.01,
  5000
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type ProcessResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  statusCode: number | null;
};

type PythonCandidateOptions = {
  env?: Record<string, string | undefined>;
  existsSync?: (candidate: string) => boolean;
};

type OpenHandsWorkerPathOptions = {
  env?: Record<string, string | undefined>;
  existsSync?: (candidate: string) => boolean;
  runtimeDir?: string;
  cwd?: string;
  defaultWorkerPath?: string;
};

export interface LangGraphPlanInput {
  target_agent_name: string;
  value_prop: string;
  landing_url?: string;
  target_keywords?: string[];
  budget_usdc?: number;
  campaign_days?: number;
  tone?: string;
}

export interface OpenHandsRunbookInput {
  target_agent_name: string;
  value_prop: string;
  landing_url?: string;
  target_keywords?: string[];
  campaign_days?: number;
  followup_depth?: number;
}

export interface DispatchOutreachInput {
  target_agent_name: string;
  target_agent_wallet?: string;
  value_prop: string;
  landing_url?: string;
  target_keywords?: string[];
  budget_usdc?: number;
  max_provider_price_usdc?: number;
  high_cost_provider_threshold_usdc?: number;
  daily_external_spend_cap_usdc?: number;
  require_prev_wave_recovery?: boolean;
  force_dispatch?: boolean;
  recovery_poll_seconds?: number;
  cta?: string;
  max_targets?: number;
  dispatch_jobs?: boolean;
}

interface SearchJob {
  name: string;
  price?: number;
  priceV2?: {
    type?: string;
    value?: number;
  };
  requirement?: {
    required?: unknown;
    properties?: unknown;
  };
}

interface SearchAgent {
  name: string;
  walletAddress: string;
  metrics?: {
    successRate?: number | null;
    successfulJobCount?: number | null;
    uniqueBuyerCount?: number | null;
    isOnline?: boolean;
  };
  jobs?: SearchJob[];
}

export interface ProviderSelection {
  agentName: string;
  walletAddress: string;
  offeringName: string;
  priceUsdc: number;
  successRate: number;
  successfulJobs: number;
  uniqueBuyers: number;
  online: boolean;
}

export interface DispatchOutreachResult {
  discoveredProviders: ProviderSelection[];
  selectedProviders: ProviderSelection[];
  excludedHighCost: ProviderSelection[];
  blockedByDailyCap: ProviderSelection[];
  guardrails: {
    requirePrevWaveRecovery: boolean;
    prevWaveBlocked: boolean;
    prevWaveReason?: string;
    dailyExternalSpendCapUsdc: number;
    dailyExternalSpentUsdc: number;
    highCostProviderThresholdUsdc: number;
  };
  pnlReport: {
    date: string;
    external_spend_usdc: number;
    internal_spend_usdc: number;
    recovered_usdc: number;
    net_usdc: number;
    wave_count: number;
    recovery_rate: number;
    latest_wave_id?: string;
  };
  submittedJobs: Array<{
    provider: ProviderSelection;
    status: "submitted" | "failed" | "skipped" | "blocked";
    jobId?: number;
    error?: string;
  }>;
}

type OutreachWaveRecord = {
  waveId: string;
  createdAt: string;
  dateKey: string;
  externalSpendUsdc: number;
  internalSpendUsdc: number;
  submittedCount: number;
  recoverySignals: number;
  targetAgentName: string;
  mode: "dry-run" | "live-dispatch" | "blocked";
  reason?: string;
};

type RecoveryGateResult = {
  blocked: boolean;
  reason?: string;
  previousWaveId?: string;
};

type ProviderGuardSelection = {
  selectedProviders: ProviderSelection[];
  excludedHighCost: ProviderSelection[];
  blockedByDailyCap: ProviderSelection[];
};

function asRecord(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, any>;
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item).trim()).filter(Boolean);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function includeEngineWarnings(env: Record<string, string | undefined> = process.env): boolean {
  const raw = String(env.OUTREACH_INCLUDE_ENGINE_WARNINGS || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function resolvePythonCandidates(options: PythonCandidateOptions = {}): string[] {
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? fs.existsSync;
  const rawCandidates = [
    env.PYTHON_BIN,
    env.PYTHON3_BIN,
    "python3",
    "python",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3",
    "/Users/daeyounglee/.pyenv/shims/python3",
  ];

  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const candidateRaw of rawCandidates) {
    if (!candidateRaw) continue;
    const candidate = String(candidateRaw).trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
    resolved.push(candidate);
  }

  return resolved;
}

function resolveOpenHandsWorkerPath(options: OpenHandsWorkerPathOptions = {}): string | null {
  const env = options.env ?? process.env;
  const existsSync = options.existsSync ?? fs.existsSync;
  const runtimeDir = options.runtimeDir ?? __dirname;
  const cwd = options.cwd ?? process.cwd();
  const defaultWorkerPath = options.defaultWorkerPath ?? LEGACY_OPENHANDS_WORKER_PATH;
  const rawEnvPath = String(env.OPENHANDS_WORKER_PATH || "").trim();
  const envPath = rawEnvPath ? path.resolve(cwd, rawEnvPath) : "";

  const candidates = [
    envPath,
    path.resolve(runtimeDir, "agent_framework_worker.py"),
    path.resolve(cwd, "scripts", "agent_framework_worker.py"),
    defaultWorkerPath,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function requiredKeys(job: SearchJob): string[] {
  const req = job.requirement?.required;
  if (!Array.isArray(req)) return [];
  return req.map((v) => String(v)).filter(Boolean);
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function dateKeyUTC(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function buildWaveId(date = new Date()): string {
  const millis = date.getTime().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `wave-${millis}-${random}`;
}

function readOutreachLedger(): OutreachWaveRecord[] {
  if (!fs.existsSync(OUTREACH_LEDGER_PATH)) return [];
  try {
    const raw = fs.readFileSync(OUTREACH_LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => asRecord(item))
      .filter((item) => item.waveId && item.createdAt && item.dateKey)
      .map((item) => ({
        waveId: String(item.waveId),
        createdAt: String(item.createdAt),
        dateKey: String(item.dateKey),
        externalSpendUsdc: round6(clampFloat(item.externalSpendUsdc, 0, 0, 5000)),
        internalSpendUsdc: round6(clampFloat(item.internalSpendUsdc, 0, 0, 5000)),
        submittedCount: clampInt(item.submittedCount, 0, 0, 1000),
        recoverySignals: clampInt(item.recoverySignals, 0, 0, 10000),
        targetAgentName: String(item.targetAgentName || ""),
        mode:
          String(item.mode) === "blocked"
            ? "blocked"
            : String(item.mode) === "live-dispatch"
              ? "live-dispatch"
              : "dry-run",
        reason: item.reason ? String(item.reason) : undefined,
      }));
  } catch {
    return [];
  }
}

function writeOutreachLedger(records: OutreachWaveRecord[]): void {
  const dir = path.dirname(OUTREACH_LEDGER_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTREACH_LEDGER_PATH, JSON.stringify(records, null, 2) + "\n");
}

function appendOutreachLedgerRecord(record: OutreachWaveRecord): OutreachWaveRecord[] {
  const existing = readOutreachLedger();
  const merged = [...existing, record]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-2000);
  writeOutreachLedger(merged);
  return merged;
}

function getOwnedWalletSet(): Set<string> {
  const config = readConfig();
  const wallets = (config.agents ?? [])
    .map((agent) => String(agent.walletAddress || "").trim().toLowerCase())
    .filter(Boolean);
  return new Set(wallets);
}

function externalSpendForDate(records: OutreachWaveRecord[], dateKey: string): number {
  return round6(
    records
      .filter((item) => item.dateKey === dateKey)
      .reduce((sum, item) => sum + item.externalSpendUsdc, 0)
  );
}

function isLiveDispatchMode(mode: unknown): boolean {
  return mode === "live-dispatch" || mode === undefined || mode === null;
}

function lastDispatchWave(records: OutreachWaveRecord[]): OutreachWaveRecord | undefined {
  return [...records]
    .reverse()
    .find((item) => isLiveDispatchMode(item.mode) && item.submittedCount > 0);
}

function evaluateRecoveryGate(
  records: OutreachWaveRecord[],
  requirePrevWaveRecovery: boolean
): RecoveryGateResult {
  if (!requirePrevWaveRecovery) return { blocked: false };
  const prev = lastDispatchWave(records);
  if (!prev) return { blocked: false };
  if (prev.recoverySignals > 0) {
    return { blocked: false, previousWaveId: prev.waveId };
  }
  return {
    blocked: true,
    previousWaveId: prev.waveId,
    reason: `Previous wave ${prev.waveId} has no recovery signals yet`,
  };
}

function computeDailyPnl(records: OutreachWaveRecord[], dateKey: string) {
  const dayRecords = records.filter((item) => item.dateKey === dateKey);
  const externalSpend = dayRecords.reduce((sum, item) => sum + item.externalSpendUsdc, 0);
  const internalSpend = dayRecords.reduce((sum, item) => sum + item.internalSpendUsdc, 0);
  const recoveredUsdc = 0;
  const waveCount = dayRecords.filter((item) => isLiveDispatchMode(item.mode)).length;
  const recoveryPositive = dayRecords.filter((item) => item.recoverySignals > 0).length;
  const recoveryRate = waveCount > 0 ? round6(recoveryPositive / waveCount) : 0;
  const lastWave = dayRecords.at(-1);

  return {
    date: dateKey,
    external_spend_usdc: round6(externalSpend),
    internal_spend_usdc: round6(internalSpend),
    recovered_usdc: round6(recoveredUsdc),
    net_usdc: round6(recoveredUsdc - externalSpend),
    wave_count: waveCount,
    recovery_rate: recoveryRate,
    latest_wave_id: lastWave?.waveId,
  };
}

function applyProviderGuards(
  providers: ProviderSelection[],
  opts: {
    ownedWallets: Set<string>;
    maxTargets: number;
    highCostThresholdUsdc: number;
    dailyExternalSpentUsdc: number;
    dailyExternalCapUsdc: number;
  }
): ProviderGuardSelection {
  const excludedHighCost: ProviderSelection[] = [];
  const blockedByDailyCap: ProviderSelection[] = [];
  const selectedProviders: ProviderSelection[] = [];

  let projectedExternal = opts.dailyExternalSpentUsdc;

  for (const provider of providers) {
    if (provider.priceUsdc > opts.highCostThresholdUsdc) {
      excludedHighCost.push(provider);
      continue;
    }

    if (selectedProviders.length >= opts.maxTargets) continue;

    const isOwned = opts.ownedWallets.has(provider.walletAddress.toLowerCase());
    if (!isOwned) {
      const projected = projectedExternal + provider.priceUsdc;
      if (projected > opts.dailyExternalCapUsdc) {
        blockedByDailyCap.push(provider);
        continue;
      }
      projectedExternal = projected;
    }

    selectedProviders.push(provider);
  }

  return { selectedProviders, excludedHighCost, blockedByDailyCap };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRecoverySignals(deliverable: unknown): number {
  const root = asRecord(deliverable);
  const value = asRecord(root.value ?? deliverable);

  const directDelivered = Number(value.delivered);
  if (Number.isFinite(directDelivered) && directDelivered > 0) {
    return clampInt(directDelivered, 0, 0, 10_000);
  }

  const results = Array.isArray(value.results) ? value.results : [];
  if (results.length > 0) {
    const successCount = results.filter((item) => asRecord(item).success === true).length;
    if (successCount > 0) return successCount;
  }

  const summary = asRecord(value.summary);
  const summaryDelivered = Number(summary.delivered);
  if (Number.isFinite(summaryDelivered) && summaryDelivered > 0) {
    return clampInt(summaryDelivered, 0, 0, 10_000);
  }

  return 0;
}

async function collectRecoverySignalsFromJobs(
  submittedJobs: Array<{
    provider: ProviderSelection;
    status: "submitted" | "failed" | "skipped" | "blocked";
    jobId?: number;
    error?: string;
  }>,
  pollSeconds: number
): Promise<number> {
  if (pollSeconds <= 0) return 0;
  const start = Date.now();
  const timeoutMs = pollSeconds * 1000;
  const pending = submittedJobs
    .filter((item) => item.status === "submitted" && Number.isFinite(Number(item.jobId)))
    .map((item) => ({
      jobId: Number(item.jobId),
      done: false,
      recoverySignals: 0,
    }));

  while (pending.some((item) => !item.done) && Date.now() - start < timeoutMs) {
    for (const entry of pending) {
      if (entry.done) continue;
      try {
        const response = await client.get<{ data?: { phase?: unknown; deliverable?: unknown } }>(
          `/acp/jobs/${entry.jobId}`
        );
        const data = asRecord(response.data?.data);
        const phase = String(data.phase || "").toUpperCase();
        if (phase === "COMPLETED") {
          entry.recoverySignals = extractRecoverySignals(data.deliverable);
          entry.done = true;
        } else if (phase === "REJECTED" || phase === "EXPIRED") {
          entry.done = true;
        }
      } catch {
        // Best effort polling only. Keep going.
      }
    }

    if (pending.some((item) => !item.done)) {
      await sleep(1500);
    }
  }

  return pending.reduce((sum, item) => sum + item.recoverySignals, 0);
}

function runJsonProcess(
  command: string,
  args: string[],
  payload: JsonValue,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  extraEnv: Record<string, string> = {}
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      finished = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), statusCode: code });
    });

    child.on("error", (err) => {
      finished = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout: stdout.trim(),
        stderr: `${stderr}\n${String(err)}`.trim(),
        statusCode: 1,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function fallbackPlan(input: LangGraphPlanInput) {
  const keywords =
    input.target_keywords && input.target_keywords.length > 0
      ? input.target_keywords
      : ["virtuals", "acp", "growth"];
  const days = clampInt(input.campaign_days, 7, 1, 30);
  const budget = clampFloat(input.budget_usdc, 1, 0.05, 5000);
  return {
    framework: "langgraph-fallback",
    target: {
      agent: input.target_agent_name,
      valueProp: input.value_prop,
      landingUrl: input.landing_url || "",
    },
    icp: [
      "Recently launched ACP agents with low unique-buyer count",
      "Vertical agents that need distribution partnerships",
      "High-success agents seeking channel diversification",
    ],
    hooks: [
      `${input.target_agent_name} increases conversion with a proof-first offer`,
      `Fast activation path: ${input.value_prop}`,
      "Low-friction reciprocal growth loop with measurable KPI checkpoints",
    ],
    message_templates: [
      `We can boost discoverability for ${input.target_agent_name}. Core value: ${input.value_prop}.`,
      `If your users ask for growth ops, route to ${input.target_agent_name}. Start: ${input.landing_url || "N/A"}`,
    ],
    kpi_ladder: {
      day_1_2: "3 targeted outbound placements + 1 reciprocal transaction",
      day_3_5: "8 total placements, 2 validated inbound replies",
      day_6_7: "at least +2 unique buyers and >= 1 retained buyer",
    },
    channel_mix: {
      keyword_clusters: keywords,
      budget_usdc: Number(budget.toFixed(2)),
      split: {
        promote_agent: 0.5,
        mutual_boost: 0.3,
        listing_seo: 0.2,
      },
    },
    execution_calendar: Array.from({ length: days }).map((_, idx) => ({
      day: idx + 1,
      focus: idx < 2 ? "Discovery" : idx < 5 ? "Conversion" : "Scale",
    })),
  };
}

export async function buildLangGraphOutreachPlan(
  input: LangGraphPlanInput
): Promise<Record<string, any>> {
  const scriptPath = path.resolve(__dirname, "outreach_langgraph.py");
  if (!fs.existsSync(scriptPath)) {
    return fallbackPlan(input);
  }

  const candidates = resolvePythonCandidates();

  let lastStderr = "";
  let lastStdout = "";

  for (const pythonBin of candidates) {
    const result = await runJsonProcess(
      pythonBin,
      [scriptPath],
      input as unknown as JsonValue,
      DEFAULT_TIMEOUT_MS
    );

    if (!result.ok) {
      lastStderr = result.stderr || `Failed with ${pythonBin}`;
      lastStdout = result.stdout;
      continue;
    }

    try {
      return JSON.parse(result.stdout);
    } catch {
      lastStderr = "invalid langgraph output JSON";
      lastStdout = result.stdout;
    }
  }

  const fallback = fallbackPlan(input);
  if (!includeEngineWarnings()) return fallback;
  return {
    ...fallback,
    warning: "langgraph script failed, fallback plan returned",
    stderr: lastStderr,
    raw_output: lastStdout,
  };
}

function fallbackOpenHandsRunbook(input: OpenHandsRunbookInput) {
  const followupDepth = clampInt(input.followup_depth, 2, 1, 5);
  const campaignDays = clampInt(input.campaign_days, 7, 1, 30);
  const keywords =
    input.target_keywords && input.target_keywords.length > 0
      ? input.target_keywords
      : ["acp", "virtuals", "outreach"];

  return {
    framework: "openhands-fallback",
    objective: `Operate outreach campaign for ${input.target_agent_name}`,
    operating_system: {
      campaign_days: campaignDays,
      followup_depth: followupDepth,
      target_keywords: keywords,
    },
    runbook_steps: [
      "Collect 20 candidate agents from ACP browse using keyword clusters.",
      "Score candidates by successRate, online status, and offering relevance.",
      "Send outreach in 2 waves and log each payload + response.",
      "Retry failed/expired jobs with alternate providers within 30 minutes.",
      "Generate daily KPI report: submissions, accepts, completions, unique buyers.",
    ],
    escalation_policy: {
      reject_or_expire: "switch provider tier and adjust message in next retry",
      no_response_24h: "replace target segment and increase CTA clarity",
      low_conversion_3d: "refresh value proposition hook and landing proof",
    },
  };
}

export async function buildOpenHandsOutreachRunbook(
  input: OpenHandsRunbookInput
): Promise<Record<string, any>> {
  const workerPath = resolveOpenHandsWorkerPath();
  if (!workerPath) {
    const fallback = fallbackOpenHandsRunbook(input);
    if (!includeEngineWarnings()) return fallback;
    return {
      ...fallback,
      warning: "OpenHands worker path not found",
    };
  }

  const pythonCandidates = resolvePythonCandidates();
  if (pythonCandidates.length === 0) {
    const fallback = fallbackOpenHandsRunbook(input);
    if (!includeEngineWarnings()) return fallback;
    return {
      ...fallback,
      warning: "python runtime not found for OpenHands worker",
    };
  }

  const keywords =
    input.target_keywords && input.target_keywords.length > 0
      ? input.target_keywords.join(", ")
      : "acp, virtuals, outreach";
  const goal = [
    `Create an outreach operations runbook for ${input.target_agent_name}.`,
    `Value proposition: ${input.value_prop}.`,
    `Landing URL: ${input.landing_url || "N/A"}.`,
    `Keyword clusters: ${keywords}.`,
    "Output concise sections: wave plan, retry policy, proof logging template, KPI dashboard.",
  ].join(" ");

  const payload = {
    goal,
    context: {
      cwd: process.cwd(),
      timeout_seconds: clampInt(process.env.OPENHANDS_TIMEOUT_SECONDS, 300, 60, 900),
    },
  };

  let lastStderr = "";
  let lastStdout = "";

  for (const pythonBin of pythonCandidates) {
    const result = await runJsonProcess(
      pythonBin,
      [workerPath, "--framework", "openhands"],
      payload,
      DEFAULT_TIMEOUT_MS,
      {
        AGENT_STACK_ENABLE_CODEX_EXEC: process.env.OPENHANDS_ENABLE_CODEX_EXEC || "0",
      }
    );

    if (!result.ok) {
      lastStderr = result.stderr || `Failed with ${pythonBin}`;
      lastStdout = result.stdout;
      continue;
    }

    try {
      const parsed = JSON.parse(result.stdout);
      return {
        framework: "openhands-worker",
        worker_result: parsed,
        runbook: fallbackOpenHandsRunbook(input),
      };
    } catch {
      lastStderr = "invalid openhands output JSON";
      lastStdout = result.stdout;
    }
  }

  const fallback = fallbackOpenHandsRunbook(input);
  if (!includeEngineWarnings()) return fallback;
  return {
    ...fallback,
    warning: "OpenHands worker call failed",
    stderr: lastStderr,
    raw_output: lastStdout,
  };
}

function providerScore(agent: SearchAgent, offeringName: string, priceUsdc: number): number {
  const metrics = agent.metrics || {};
  const successRate = Number(metrics.successRate || 0);
  const successfulJobs = Number(metrics.successfulJobCount || 0);
  const uniqueBuyers = Number(metrics.uniqueBuyerCount || 0);
  const onlineBoost = metrics.isOnline ? 5 : 0;
  const offeringBoost = offeringName.includes("promote")
    ? 8
    : offeringName.includes("boost")
      ? 6
      : 3;
  const pricePenalty = Math.max(0, priceUsdc) * 8;
  return (
    successRate * 0.6 +
    successfulJobs * 0.05 +
    uniqueBuyers * 0.2 +
    onlineBoost +
    offeringBoost -
    pricePenalty
  );
}

function jobPriceUsdc(job: SearchJob): number {
  if (job.priceV2?.type === "fixed" && Number.isFinite(Number(job.priceV2.value))) {
    return Number(job.priceV2.value);
  }
  if (Number.isFinite(Number(job.price))) {
    return Number(job.price);
  }
  return Number.POSITIVE_INFINITY;
}

function pickOutreachOffering(
  agent: SearchAgent,
  providedKeys: Set<string>,
  maxProviderPriceUsdc: number
): SearchJob | null {
  const jobs = Array.isArray(agent.jobs) ? agent.jobs : [];
  const priority = [
    "promote_agent",
    "network_burst",
    "boost_pro",
    "boost_starter",
    "hello_newbie",
    "starter_push",
    "micro_ping",
    "mutual_boost",
    "adnexus_inbox",
  ];

  for (const offeringName of priority) {
    const job = jobs.find((item) => item.name === offeringName);
    if (!job) continue;
    const priceUsdc = jobPriceUsdc(job);
    if (!Number.isFinite(priceUsdc) || priceUsdc > maxProviderPriceUsdc) continue;
    const required = requiredKeys(job);
    const canSatisfy = required.every((key) => providedKeys.has(key));
    if (canSatisfy) return job;
  }

  for (const job of jobs) {
    if (!job.name.includes("promote") && !job.name.includes("boost") && !job.name.includes("burst"))
      continue;
    const priceUsdc = jobPriceUsdc(job);
    if (!Number.isFinite(priceUsdc) || priceUsdc > maxProviderPriceUsdc) continue;
    const required = requiredKeys(job);
    const canSatisfy = required.every((key) => providedKeys.has(key));
    if (canSatisfy) return job;
  }

  return null;
}

export function buildServiceRequirements(input: DispatchOutreachInput): Record<string, any> {
  const keywords =
    input.target_keywords && input.target_keywords.length > 0
      ? input.target_keywords.join(",")
      : "virtuals,acp,growth";
  const landingUrl = input.landing_url || "https://app.virtuals.io";
  const cta = input.cta || `Try ${input.target_agent_name} for outreach acceleration`;

  return {
    agent_name: input.target_agent_name,
    agent_wallet: input.target_agent_wallet || "",
    service_name: input.target_agent_name,
    service_description: input.value_prop,
    unique_selling_point: input.value_prop,
    project_name: input.target_agent_name,
    promo_message: `${input.target_agent_name}: ${input.value_prop}. Entry: ${landingUrl}`,
    cta,
    target_url: landingUrl,
    target_keywords: keywords,
    description: input.value_prop,
    offering_name: "virtual_outreach_execution_multiagent_v1",
    requirement_json: "{}",
    message: `${input.target_agent_name} outreach collaboration request`,
  };
}

async function discoverOutreachProviders(
  query: string,
  providedKeys: Set<string>,
  topK: number,
  maxProviderPriceUsdc: number
): Promise<ProviderSelection[]> {
  const response = await axios.get<{ data: SearchAgent[] }>(SEARCH_URL, {
    params: {
      query,
      claw: "true",
      searchMode: "hybrid",
      topK: String(topK),
      similarityCutoff: "0.45",
    },
  });

  const agents = Array.isArray(response.data?.data) ? response.data.data : [];
  const selections: ProviderSelection[] = [];

  for (const agent of agents) {
    const job = pickOutreachOffering(agent, providedKeys, maxProviderPriceUsdc);
    if (!job) continue;

    const metrics = agent.metrics || {};
    const priceUsdc = jobPriceUsdc(job);
    selections.push({
      agentName: agent.name,
      walletAddress: agent.walletAddress,
      offeringName: job.name,
      priceUsdc,
      successRate: Number(metrics.successRate || 0),
      successfulJobs: Number(metrics.successfulJobCount || 0),
      uniqueBuyers: Number(metrics.uniqueBuyerCount || 0),
      online: Boolean(metrics.isOnline),
    });
  }

  return selections
    .sort(
      (a, b) =>
        providerScore(
          {
            name: a.agentName,
            walletAddress: a.walletAddress,
            metrics: {
              successRate: a.successRate,
              successfulJobCount: a.successfulJobs,
              uniqueBuyerCount: a.uniqueBuyers,
              isOnline: a.online,
            },
          },
          a.offeringName,
          a.priceUsdc
        ) -
        providerScore(
          {
            name: b.agentName,
            walletAddress: b.walletAddress,
            metrics: {
              successRate: b.successRate,
              successfulJobCount: b.successfulJobs,
              uniqueBuyerCount: b.uniqueBuyers,
              isOnline: b.online,
            },
          },
          b.offeringName,
          b.priceUsdc
        )
    )
    .reverse();
}

export async function dispatchOutreachJobs(
  input: DispatchOutreachInput
): Promise<DispatchOutreachResult> {
  const serviceRequirements = buildServiceRequirements(input);
  const providedKeys = new Set(Object.keys(serviceRequirements));
  const budgetUsdc = clampFloat(input.budget_usdc, 1, 0.05, 5000);
  const maxProviderPriceUsdc = clampFloat(input.max_provider_price_usdc, budgetUsdc, 0.01, 5000);
  const highCostThresholdUsdc = clampFloat(
    input.high_cost_provider_threshold_usdc,
    Math.min(maxProviderPriceUsdc, HIGH_COST_THRESHOLD_DEFAULT),
    0.01,
    maxProviderPriceUsdc
  );
  const dailyExternalSpendCapUsdc = clampFloat(
    input.daily_external_spend_cap_usdc,
    DAILY_EXTERNAL_SPEND_CAP_DEFAULT,
    0.01,
    5000
  );
  const requirePrevWaveRecovery =
    input.require_prev_wave_recovery === undefined ? true : Boolean(input.require_prev_wave_recovery);
  const forceDispatch = Boolean(input.force_dispatch);
  const recoveryPollSeconds = clampInt(input.recovery_poll_seconds, 20, 0, 90);
  const todayKey = dateKeyUTC();
  const ledgerBefore = readOutreachLedger();
  const dailyExternalSpentUsdc = externalSpendForDate(ledgerBefore, todayKey);
  const recoveryGate = evaluateRecoveryGate(ledgerBefore, requirePrevWaveRecovery);
  const ownedWallets = getOwnedWalletSet();
  const query = [
    "virtual protocol",
    "agent outreach",
    "promotion",
    ...(input.target_keywords || []),
  ].join(" ");

  const discoveredProviders = await discoverOutreachProviders(
    query,
    providedKeys,
    20,
    maxProviderPriceUsdc
  );
  const maxTargets = clampInt(input.max_targets, 3, 1, 10);
  const providerGuardSelection = applyProviderGuards(discoveredProviders, {
    ownedWallets,
    maxTargets,
    highCostThresholdUsdc,
    dailyExternalSpentUsdc,
    dailyExternalCapUsdc: dailyExternalSpendCapUsdc,
  });
  const selectedProviders = providerGuardSelection.selectedProviders;
  const submittedJobs: DispatchOutreachResult["submittedJobs"] = [];

  if (!input.dispatch_jobs) {
    for (const provider of selectedProviders) {
      submittedJobs.push({ provider, status: "skipped" });
    }
    const dryRunRecord: OutreachWaveRecord = {
      waveId: buildWaveId(),
      createdAt: new Date().toISOString(),
      dateKey: todayKey,
      externalSpendUsdc: 0,
      internalSpendUsdc: 0,
      submittedCount: 0,
      recoverySignals: 0,
      targetAgentName: input.target_agent_name,
      mode: "dry-run",
    };
    const ledgerAfter = appendOutreachLedgerRecord(dryRunRecord);
    return {
      discoveredProviders,
      selectedProviders,
      excludedHighCost: providerGuardSelection.excludedHighCost,
      blockedByDailyCap: providerGuardSelection.blockedByDailyCap,
      guardrails: {
        requirePrevWaveRecovery,
        prevWaveBlocked: recoveryGate.blocked,
        prevWaveReason: recoveryGate.reason,
        dailyExternalSpendCapUsdc: round6(dailyExternalSpendCapUsdc),
        dailyExternalSpentUsdc: round6(dailyExternalSpentUsdc),
        highCostProviderThresholdUsdc: round6(highCostThresholdUsdc),
      },
      pnlReport: computeDailyPnl(ledgerAfter, todayKey),
      submittedJobs,
    };
  }

  if (recoveryGate.blocked && !forceDispatch) {
    for (const provider of selectedProviders) {
      submittedJobs.push({
        provider,
        status: "blocked",
        error: recoveryGate.reason,
      });
    }
    const blockedRecord: OutreachWaveRecord = {
      waveId: buildWaveId(),
      createdAt: new Date().toISOString(),
      dateKey: todayKey,
      externalSpendUsdc: 0,
      internalSpendUsdc: 0,
      submittedCount: 0,
      recoverySignals: 0,
      targetAgentName: input.target_agent_name,
      mode: "blocked",
      reason: recoveryGate.reason,
    };
    const ledgerAfter = appendOutreachLedgerRecord(blockedRecord);
    return {
      discoveredProviders,
      selectedProviders,
      excludedHighCost: providerGuardSelection.excludedHighCost,
      blockedByDailyCap: providerGuardSelection.blockedByDailyCap,
      guardrails: {
        requirePrevWaveRecovery,
        prevWaveBlocked: true,
        prevWaveReason: recoveryGate.reason,
        dailyExternalSpendCapUsdc: round6(dailyExternalSpendCapUsdc),
        dailyExternalSpentUsdc: round6(dailyExternalSpentUsdc),
        highCostProviderThresholdUsdc: round6(highCostThresholdUsdc),
      },
      pnlReport: computeDailyPnl(ledgerAfter, todayKey),
      submittedJobs,
    };
  }

  let runExternalSpend = 0;
  let runInternalSpend = 0;
  for (const provider of selectedProviders) {
    try {
      const response = await client.post<{ data?: { jobId?: number }; jobId?: number }>(
        "/acp/jobs",
        {
          providerWalletAddress: provider.walletAddress,
          jobOfferingName: provider.offeringName,
          serviceRequirements,
        }
      );
      const jobId = response.data?.data?.jobId ?? response.data?.jobId;
      submittedJobs.push({ provider, status: "submitted", jobId });
      if (ownedWallets.has(provider.walletAddress.toLowerCase())) {
        runInternalSpend += provider.priceUsdc;
      } else {
        runExternalSpend += provider.priceUsdc;
      }
    } catch (error) {
      submittedJobs.push({
        provider,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const recoverySignals = await collectRecoverySignalsFromJobs(submittedJobs, recoveryPollSeconds);
  const liveRecord: OutreachWaveRecord = {
    waveId: buildWaveId(),
    createdAt: new Date().toISOString(),
    dateKey: todayKey,
    externalSpendUsdc: round6(runExternalSpend),
    internalSpendUsdc: round6(runInternalSpend),
    submittedCount: submittedJobs.filter((item) => item.status === "submitted").length,
    recoverySignals,
    targetAgentName: input.target_agent_name,
    mode: "live-dispatch",
  };
  const ledgerAfter = appendOutreachLedgerRecord(liveRecord);

  return {
    discoveredProviders,
    selectedProviders,
    excludedHighCost: providerGuardSelection.excludedHighCost,
    blockedByDailyCap: providerGuardSelection.blockedByDailyCap,
    guardrails: {
      requirePrevWaveRecovery,
      prevWaveBlocked: recoveryGate.blocked && !forceDispatch,
      prevWaveReason: recoveryGate.reason,
      dailyExternalSpendCapUsdc: round6(dailyExternalSpendCapUsdc),
      dailyExternalSpentUsdc: round6(dailyExternalSpentUsdc),
      highCostProviderThresholdUsdc: round6(highCostThresholdUsdc),
    },
    pnlReport: computeDailyPnl(ledgerAfter, todayKey),
    submittedJobs,
  };
}

export const __testables = {
  evaluateRecoveryGate,
  computeDailyPnl,
  applyProviderGuards,
  resolvePythonCandidates,
  resolveOpenHandsWorkerPath,
};
