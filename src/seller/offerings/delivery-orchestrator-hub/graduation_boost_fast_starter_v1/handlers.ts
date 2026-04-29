import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import client from "../../../../lib/client.js";

const OFFERING_NAME = "graduation_boost_fast_starter_v1";

type JobPhase =
  | "REQUEST"
  | "NEGOTIATION"
  | "TRANSACTION"
  | "EVALUATION"
  | "COMPLETED"
  | "REJECTED"
  | "EXPIRED"
  | "TIMEOUT"
  | "ERROR"
  | "UNKNOWN";

interface FastRequest {
  targetAgentWallet: string;
  targetAgentName: string;
  targetOfferingName?: string;
  maxWaitSeconds: number;
}

interface ProviderPlan {
  providerName: string;
  providerWallet: string;
  offeringName: string;
  unitPriceUsdc: number;
  buildRequirement: (request: FastRequest) => Record<string, unknown>;
}

interface RunResult {
  providerName: string;
  offeringName: string;
  unitPriceUsdc: number;
  jobId?: number;
  phase: JobPhase;
  startedAt: string;
  endedAt: string;
  deliverable?: unknown;
  error?: string;
}

const PHASE_BY_NUMBER: Record<number, JobPhase> = {
  0: "REQUEST",
  1: "NEGOTIATION",
  2: "TRANSACTION",
  3: "EVALUATION",
  4: "COMPLETED",
  5: "REJECTED",
  6: "EXPIRED",
};

function normalizeObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErr(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizePhase(raw: unknown): JobPhase {
  if (typeof raw === "string") {
    const up = raw.toUpperCase();
    if (
      up === "REQUEST" ||
      up === "NEGOTIATION" ||
      up === "TRANSACTION" ||
      up === "EVALUATION" ||
      up === "COMPLETED" ||
      up === "REJECTED" ||
      up === "EXPIRED"
    ) {
      return up;
    }
    return "UNKNOWN";
  }
  if (typeof raw === "number") return PHASE_BY_NUMBER[raw] ?? "UNKNOWN";
  return "UNKNOWN";
}

function terminal(phase: JobPhase): boolean {
  return phase === "COMPLETED" || phase === "REJECTED" || phase === "EXPIRED";
}

function normalizeRequest(input: unknown): FastRequest {
  const req = normalizeObject(input);
  const targetAgentWallet = String(req.target_agent_wallet ?? "").trim();
  const targetAgentName = String(req.target_agent_name ?? "unknown-agent").trim();
  const targetOfferingNameRaw = String(req.target_offering_name ?? "").trim();
  const targetOfferingName = targetOfferingNameRaw.length > 0 ? targetOfferingNameRaw : undefined;
  const maxWaitSeconds = clampInt(req.max_wait_seconds, 90, 60, 180);

  return {
    targetAgentWallet,
    targetAgentName,
    targetOfferingName,
    maxWaitSeconds,
  };
}

function primaryPlans(): ProviderPlan[] {
  return [
    {
      providerName: "GrowthForge",
      providerWallet: "0xB3be81fB1DaE557A65dfF57F3cCCCc9Cc05842eF",
      offeringName: "mutual_boost_micro",
      unitPriceUsdc: 0.01,
      buildRequirement: (r) => ({
        input: JSON.stringify({
          agent_wallet: r.targetAgentWallet,
          offering_name: r.targetOfferingName ?? "boost_onboarding_micro_v1",
          mode: "fast-starter",
        }),
      }),
    },
    {
      providerName: "DataPulse 📊",
      providerWallet: "0xd141F90B5C2E8076A97C7cDf5fD9678B0179FEd4",
      offeringName: "mutual_boost_micro",
      unitPriceUsdc: 0.01,
      buildRequirement: (r) => ({
        agent_wallet: r.targetAgentWallet,
        ...(r.targetOfferingName ? { offering_name: r.targetOfferingName } : {}),
      }),
    },
  ];
}

function fallbackPlans(): ProviderPlan[] {
  return [
    {
      providerName: "AgentHub",
      providerWallet: "0x803F95cC43e940548b55846BCBbAe5476d8cD8c7",
      offeringName: "mutual_boost",
      unitPriceUsdc: 0.01,
      buildRequirement: (r) => ({
        message: `fast starter boost for ${r.targetAgentName} (${r.targetAgentWallet})`,
      }),
    },
  ];
}

function stringifyDeliverable(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.toLowerCase();
  try {
    return JSON.stringify(input).toLowerCase();
  } catch {
    return String(input).toLowerCase();
  }
}

function hasErrorMarker(deliverable: unknown): boolean {
  const text = stringifyDeliverable(deliverable);
  if (!text) return false;
  return (
    text.includes("error:") ||
    text.includes("error_code") ||
    text.includes("no_partner_services") ||
    text.includes("no partner services") ||
    text.includes("could not identify client wallet")
  );
}

function isQualifiedCompletion(run: RunResult): boolean {
  return run.phase === "COMPLETED" && !hasErrorMarker(run.deliverable);
}

async function createJob(provider: ProviderPlan, serviceRequirements: Record<string, unknown>): Promise<number> {
  const response = await client.post<{ data?: { jobId?: number }; jobId?: number }>("/acp/jobs", {
    providerWalletAddress: provider.providerWallet,
    jobOfferingName: provider.offeringName,
    serviceRequirements,
  });
  const jobIdRaw = response.data?.data?.jobId ?? response.data?.jobId;
  const jobId = Number(jobIdRaw);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    throw new Error(`Invalid jobId from ${provider.providerName}/${provider.offeringName}`);
  }
  return jobId;
}

async function waitTerminal(jobId: number, maxWaitSeconds: number): Promise<{ phase: JobPhase; deliverable?: unknown; error?: string }> {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const response = await client.get<{ data?: { phase?: string | number; deliverable?: unknown } }>(`/acp/jobs/${jobId}`);
      const data = normalizeObject(response.data?.data);
      const phase = normalizePhase(data.phase);
      if (terminal(phase)) {
        return { phase, deliverable: data.deliverable };
      }
    } catch (error) {
      lastError = parseErr(error);
    }
    await sleep(4000);
  }

  return { phase: "TIMEOUT", error: lastError };
}

export async function executeJob(input: unknown): Promise<ExecuteJobResult> {
  const req = normalizeRequest(input);
  const primary = primaryPlans();
  const fallback = fallbackPlans();
  const runResults: RunResult[] = [];

  for (const provider of primary) {
    const startedAt = nowIso();
    try {
      const jobId = await createJob(provider, provider.buildRequirement(req));
      const result = await waitTerminal(jobId, req.maxWaitSeconds);
      runResults.push({
        providerName: provider.providerName,
        offeringName: provider.offeringName,
        unitPriceUsdc: provider.unitPriceUsdc,
        jobId,
        phase: result.phase,
        startedAt,
        endedAt: nowIso(),
        deliverable: result.deliverable,
        error: result.error,
      });
    } catch (error) {
      runResults.push({
        providerName: provider.providerName,
        offeringName: provider.offeringName,
        unitPriceUsdc: provider.unitPriceUsdc,
        phase: "ERROR",
        startedAt,
        endedAt: nowIso(),
        error: parseErr(error),
      });
    }
  }

  if (!runResults.some((r) => isQualifiedCompletion(r))) {
    for (const provider of fallback) {
      const startedAt = nowIso();
      try {
        const jobId = await createJob(provider, provider.buildRequirement(req));
        const result = await waitTerminal(jobId, req.maxWaitSeconds);
        runResults.push({
          providerName: provider.providerName,
          offeringName: provider.offeringName,
          unitPriceUsdc: provider.unitPriceUsdc,
          jobId,
          phase: result.phase,
          startedAt,
          endedAt: nowIso(),
          deliverable: result.deliverable,
          error: result.error,
        });
      } catch (error) {
        runResults.push({
          providerName: provider.providerName,
          offeringName: provider.offeringName,
          unitPriceUsdc: provider.unitPriceUsdc,
          phase: "ERROR",
          startedAt,
          endedAt: nowIso(),
          error: parseErr(error),
        });
      }
    }
  }

  const completed = runResults.filter((r) => r.phase === "COMPLETED");
  const qualifiedCompleted = runResults.filter((r) => isQualifiedCompletion(r));
  const proofJobIds = completed.map((r) => r.jobId).filter((x): x is number => typeof x === "number");
  const qualifiedProofJobIds = qualifiedCompleted
    .map((r) => r.jobId)
    .filter((x): x is number => typeof x === "number");

  return {
    deliverable: {
      type: "json",
      value: {
        service: "graduation-boost-fast-starter",
        offering: OFFERING_NAME,
        target: {
          agentName: req.targetAgentName,
          agentWallet: req.targetAgentWallet,
        },
        pricing: {
          ourFeeUsdc: 0.03,
          downstreamBudgetCapUsdc: 0.03,
        },
        execution: {
          maxWaitSecondsPerJob: req.maxWaitSeconds,
          primaryProviders: primary.map((w) => ({
            providerName: w.providerName,
            offeringName: w.offeringName,
            unitPriceUsdc: w.unitPriceUsdc,
          })),
          fallbackProviders: fallback.map((w) => ({
            providerName: w.providerName,
            offeringName: w.offeringName,
            unitPriceUsdc: w.unitPriceUsdc,
          })),
          runs: runResults,
        },
        results: {
          completedCount: completed.length,
          qualifiedCompletedCount: qualifiedCompleted.length,
          proofJobIds,
          qualifiedProofJobIds,
          status: qualifiedCompleted.length >= 1 ? "partial_or_better" : "no_qualified_completion",
        },
      },
    },
  };
}

export function validateRequirements(input: unknown): ValidationResult {
  const req = normalizeObject(input);
  const wallet = String(req.target_agent_wallet ?? "").trim();
  if (!wallet.startsWith("0x")) {
    return { valid: false, reason: "target_agent_wallet must be a 0x wallet string" };
  }

  const maxWaitSeconds = Number(req.max_wait_seconds ?? 60);
  if (!Number.isFinite(maxWaitSeconds) || maxWaitSeconds < 30 || maxWaitSeconds > 120) {
    return { valid: false, reason: "max_wait_seconds must be between 30 and 120" };
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Fast starter accepted. Dispatching short-path whitelist outreach for immediate proof jobIds.";
}
