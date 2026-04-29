export interface WalletOpsReportRow {
  id: string;
  status?: string;
  enabled?: boolean;
  linked?: boolean;
  eligibleForLiveOps?: boolean;
  blockingReasons?: string[];
  requiresHealthyIds?: string[];
}

export interface WalletOpsReport {
  rows?: WalletOpsReportRow[];
}

export interface RapidRecoveryAutopilotDecision {
  mode: "live" | "dry-run";
  buyerId: string;
  rapidId: string;
  telegramTargetCount: number;
  requiredHealthyIds: string[];
  buyerStatus: string | null;
  rapidStatus: string | null;
  blockingReasons: string[];
  liveModes: {
    telegramLive: boolean;
    leadBountyLive: boolean;
  };
}

const HARD_BLOCK_STATUSES = new Set(["disabled", "fetch_error", "missing_api_key", "unlinked_agent"]);

function asRows(report: WalletOpsReport): WalletOpsReportRow[] {
  return Array.isArray(report.rows) ? report.rows : [];
}

function findRow(report: WalletOpsReport, id: string): WalletOpsReportRow | undefined {
  return asRows(report).find((row) => row.id === id);
}

function normalizeBlockingReasons(prefix: string, row: WalletOpsReportRow | undefined): string[] {
  if (!row) return [`${prefix}:missing`];
  const reasons =
    Array.isArray(row.blockingReasons) && row.blockingReasons.length > 0
      ? row.blockingReasons
      : [row.status || "unknown"];
  return reasons.map((reason) => `${prefix}:${reason}`);
}

function isDependencyHealthy(row: WalletOpsReportRow | undefined): boolean {
  if (!row || row.enabled === false) return false;
  const status = String(row.status || "");
  return !HARD_BLOCK_STATUSES.has(status);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((value) => value.trim()))];
}

export function evaluateRapidRecoveryAutopilot(input: {
  walletReport: WalletOpsReport;
  telegramTargetCount: number;
  buyerId?: string;
  rapidId?: string;
}): RapidRecoveryAutopilotDecision {
  const buyerId =
    input.buyerId ||
    (findRow(input.walletReport, "virtual-root-market") ? "virtual-root-market" : "ops-buyer-hub");
  const rapidId = input.rapidId || "rapid-recovery-router";
  const buyer = findRow(input.walletReport, buyerId);
  const rapid = findRow(input.walletReport, rapidId);
  const requiredHealthyIds = uniqueIds([
    rapidId,
    ...(Array.isArray(buyer?.requiresHealthyIds) ? buyer.requiresHealthyIds : []),
  ]);

  const blockingReasons: string[] = [];

  if (!buyer) {
    blockingReasons.push(`buyer:missing`);
  } else if (buyer.enabled === false) {
    blockingReasons.push(`buyer:disabled`);
  } else if (!buyer.eligibleForLiveOps) {
    blockingReasons.push(...normalizeBlockingReasons("buyer", buyer));
  }

  for (const dependencyId of requiredHealthyIds) {
    const row = findRow(input.walletReport, dependencyId);
    if (!isDependencyHealthy(row)) {
      const reason = row?.status || "missing";
      blockingReasons.push(`dependency:${dependencyId}:${reason}`);
    }
  }

  if (input.telegramTargetCount <= 0) {
    blockingReasons.push("telegram_targets_empty");
  }

  const mode: "live" | "dry-run" = blockingReasons.length === 0 ? "live" : "dry-run";
  return {
    mode,
    buyerId,
    rapidId,
    telegramTargetCount: input.telegramTargetCount,
    requiredHealthyIds,
    buyerStatus: buyer?.status || null,
    rapidStatus: rapid?.status || null,
    blockingReasons,
    liveModes: {
      telegramLive: mode === "live",
      leadBountyLive: mode === "live",
    },
  };
}
