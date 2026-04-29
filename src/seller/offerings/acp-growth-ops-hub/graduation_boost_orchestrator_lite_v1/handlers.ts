import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import client from "../../../../lib/client.js";

const OFFERING_NAME = "graduation_boost_orchestrator_lite_v1";
const ACPILOT_STARTER_PRICE_USDC = 0.1;
const OUR_FEE_USDC = 0.05;
const RAILWAY_MONTHLY_BASE_USDC = 5;
const DEFAULT_MONTHLY_JOB_VOLUME = 2000;
const ORCHESTRATION_OPS_RESERVE_USDC = 0.002;
const COMPUTE_RESERVE_USDC = 0.0015;

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

type ExecutionMode = "lite" | "balanced";

interface NormalizedRequest {
  targetAgentWallet: string;
  targetAgentName: string;
  targetOfferingName?: string;
  targetOfferingRequirements: Record<string, unknown>;
  mode: ExecutionMode;
  niche: string;
  maxWaitSeconds: number;
  monthlyJobVolumeAssumption: number;
}

interface ProviderPlan {
  providerName: string;
  providerWallet: string;
  offeringName: string;
  unitPriceUsdc: number;
  buildRequirement: (request: NormalizedRequest) => Record<string, unknown>;
}

interface DownstreamRun {
  providerName: string;
  providerWallet: string;
  offeringName: string;
  unitPriceUsdc: number;
  attempt: number;
  launchedAt: string;
  terminalAt?: string;
  jobId?: number;
  phase: JobPhase;
  estimatedSpendUsdc: number;
  deliverable?: unknown;
  memoCount?: number;
  error?: string;
}

interface JobStatusResult {
  phase: JobPhase;
  terminalAt: string;
  deliverable?: unknown;
  memoCount?: number;
  error?: string;
}

interface ApiJobData {
  phase?: string | number;
  deliverable?: unknown;
  memos?: unknown[];
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

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizePhase(raw: unknown): JobPhase {
  if (typeof raw === "string") {
    const upper = raw.toUpperCase();
    if (
      upper === "REQUEST" ||
      upper === "NEGOTIATION" ||
      upper === "TRANSACTION" ||
      upper === "EVALUATION" ||
      upper === "COMPLETED" ||
      upper === "REJECTED" ||
      upper === "EXPIRED"
    ) {
      return upper;
    }
    return "UNKNOWN";
  }

  if (typeof raw === "number") {
    return PHASE_BY_NUMBER[raw] ?? "UNKNOWN";
  }

  return "UNKNOWN";
}

function isTerminalPhase(phase: JobPhase): boolean {
  return phase === "COMPLETED" || phase === "REJECTED" || phase === "EXPIRED";
}

function pickMode(input: unknown): ExecutionMode {
  return input === "balanced" ? "balanced" : "lite";
}

function normalizeRequest(input: unknown): NormalizedRequest {
  const req = normalizeObject(input);

  const targetAgentWallet = String(req.target_agent_wallet ?? "").trim();
  const targetAgentName = String(req.target_agent_name ?? "unknown-agent").trim();
  const targetOfferingNameRaw = String(req.target_offering_name ?? "").trim();
  const targetOfferingName = targetOfferingNameRaw.length > 0 ? targetOfferingNameRaw : undefined;

  const targetOfferingRequirements = normalizeObject(req.target_offering_requirements);
  const mode = pickMode(req.mode);
  const niche = String(req.niche ?? "infrastructure").trim() || "infrastructure";
  const maxWaitSeconds = clampInteger(req.max_wait_seconds, 90, 60, 180);
  const monthlyJobVolumeAssumption = clampInteger(
    req.monthly_job_volume_assumption,
    DEFAULT_MONTHLY_JOB_VOLUME,
    200,
    200000
  );

  return {
    targetAgentWallet,
    targetAgentName,
    targetOfferingName,
    targetOfferingRequirements,
    mode,
    niche,
    maxWaitSeconds,
    monthlyJobVolumeAssumption,
  };
}

function buildPrimaryPlans(mode: ExecutionMode): ProviderPlan[] {
  const plans: ProviderPlan[] = [
    {
      providerName: "DataPulse 📊",
      providerWallet: "0xd141F90B5C2E8076A97C7cDf5fD9678B0179FEd4",
      offeringName: "mutual_boost_micro",
      unitPriceUsdc: 0.01,
      buildRequirement: (req) => {
        const requirement: Record<string, unknown> = {
          agent_wallet: req.targetAgentWallet,
        };

        if (req.targetOfferingName) {
          requirement.offering_name = req.targetOfferingName;
        }

        return requirement;
      },
    },
    {
      providerName: "GrowthForge",
      providerWallet: "0xB3be81fB1DaE557A65dfF57F3cCCCc9Cc05842eF",
      offeringName: "mutual_boost_micro",
      unitPriceUsdc: 0.01,
      buildRequirement: (req) => ({
        input: JSON.stringify({
          agent_wallet: req.targetAgentWallet,
          offering_name: req.targetOfferingName ?? null,
          mode: "micro",
        }),
      }),
    },
  ];

  if (mode === "balanced") {
    plans.push({
      providerName: "ACPilot",
      providerWallet: "0x72dC31061751A5F93A0B57E37DF951de2De14b94",
      offeringName: "mutual_boost",
      unitPriceUsdc: 0.02,
      buildRequirement: (req) => ({
        agent_wallet: req.targetAgentWallet,
        offering_name: req.targetOfferingName ?? "boost_onboarding_micro_v1",
      }),
    });
  }

  return plans;
}

function buildFallbackPlans(mode: ExecutionMode): ProviderPlan[] {
  const plans: ProviderPlan[] = [];

  if (mode === "lite") {
    plans.push({
      providerName: "ACPilot",
      providerWallet: "0x72dC31061751A5F93A0B57E37DF951de2De14b94",
      offeringName: "mutual_boost",
      unitPriceUsdc: 0.02,
      buildRequirement: (req) => ({
        agent_wallet: req.targetAgentWallet,
        offering_name: req.targetOfferingName ?? "boost_onboarding_micro_v1",
      }),
    });
  }

  return plans;
}

async function createDownstreamJob(plan: ProviderPlan, requirement: Record<string, unknown>): Promise<number> {
  const response = await client.post<{ data?: { jobId?: number }; jobId?: number }>("/acp/jobs", {
    providerWalletAddress: plan.providerWallet,
    jobOfferingName: plan.offeringName,
    serviceRequirements: requirement,
  });

  const rawJobId = response.data?.data?.jobId ?? response.data?.jobId;
  const jobId = Number(rawJobId);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    throw new Error(`Invalid downstream jobId returned for ${plan.providerName}/${plan.offeringName}`);
  }

  return jobId;
}

async function pollJobUntilTerminal(jobId: number, maxWaitSeconds: number): Promise<JobStatusResult> {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    try {
      const response = await client.get<{ data?: ApiJobData }>(`/acp/jobs/${jobId}`);
      const data = normalizeObject(response.data?.data) as ApiJobData;
      const phase = normalizePhase(data.phase);

      if (isTerminalPhase(phase)) {
        return {
          phase,
          terminalAt: nowIso(),
          deliverable: data.deliverable,
          memoCount: Array.isArray(data.memos) ? data.memos.length : 0,
        };
      }
    } catch (error) {
      lastError = parseErrorMessage(error);
    }

    await sleep(4000);
  }

  return {
    phase: "TIMEOUT",
    terminalAt: nowIso(),
    error: lastError,
  };
}

async function runProviderPlan(
  plan: ProviderPlan,
  request: NormalizedRequest,
  attempt: number
): Promise<DownstreamRun> {
  const launchedAt = nowIso();

  try {
    const requirement = plan.buildRequirement(request);
    const jobId = await createDownstreamJob(plan, requirement);
    const terminal = await pollJobUntilTerminal(jobId, request.maxWaitSeconds);

    return {
      providerName: plan.providerName,
      providerWallet: plan.providerWallet,
      offeringName: plan.offeringName,
      unitPriceUsdc: plan.unitPriceUsdc,
      attempt,
      launchedAt,
      terminalAt: terminal.terminalAt,
      jobId,
      phase: terminal.phase,
      estimatedSpendUsdc: plan.unitPriceUsdc,
      deliverable: terminal.deliverable,
      memoCount: terminal.memoCount,
      error: terminal.error,
    };
  } catch (error) {
    return {
      providerName: plan.providerName,
      providerWallet: plan.providerWallet,
      offeringName: plan.offeringName,
      unitPriceUsdc: plan.unitPriceUsdc,
      attempt,
      launchedAt,
      terminalAt: nowIso(),
      phase: "ERROR",
      estimatedSpendUsdc: 0,
      error: parseErrorMessage(error),
    };
  }
}

function countByPhase(runs: DownstreamRun[]): Record<string, number> {
  const counters: Record<string, number> = {
    COMPLETED: 0,
    REJECTED: 0,
    EXPIRED: 0,
    TIMEOUT: 0,
    ERROR: 0,
    UNKNOWN: 0,
  };

  for (const run of runs) {
    if (counters[run.phase] == null) {
      counters.UNKNOWN += 1;
      continue;
    }
    counters[run.phase] += 1;
  }

  return counters;
}

function completedCount(runs: DownstreamRun[]): number {
  return runs.filter((run) => run.phase === "COMPLETED").length;
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

function isQualifiedCompletion(run: DownstreamRun): boolean {
  if (run.phase !== "COMPLETED") {
    return false;
  }

  const normalized = stringifyDeliverable(run.deliverable);
  if (normalized.includes("todo: return your result")) {
    return false;
  }
  if (normalized.includes("no service at $0.01 or below found")) {
    return false;
  }
  if (hasErrorMarker(run.deliverable)) {
    return false;
  }

  return true;
}

function qualifiedCompletionCount(runs: DownstreamRun[]): number {
  return runs.filter((run) => isQualifiedCompletion(run)).length;
}

function completedJobIds(runs: DownstreamRun[]): number[] {
  return runs
    .filter((run) => run.phase === "COMPLETED" && typeof run.jobId === "number")
    .map((run) => run.jobId as number);
}

function qualifiedCompletionJobIds(runs: DownstreamRun[]): number[] {
  return runs
    .filter((run) => isQualifiedCompletion(run) && typeof run.jobId === "number")
    .map((run) => run.jobId as number);
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

export async function executeJob(input: unknown): Promise<ExecuteJobResult> {
  const request = normalizeRequest(input);

  const primaryPlans = buildPrimaryPlans(request.mode);
  const fallbackPlans = buildFallbackPlans(request.mode);

  const successTarget = request.mode === "balanced" ? 3 : 2;
  const spendCapUsdc = request.mode === "balanced" ? 0.06 : 0.05;

  const runs: DownstreamRun[] = [];
  let projectedSpendUsdc = 0;

  const primaryRuns = await Promise.all(
    primaryPlans.map((plan, index) => runProviderPlan(plan, request, index + 1))
  );

  for (const run of primaryRuns) {
    runs.push(run);
    projectedSpendUsdc += run.estimatedSpendUsdc;
  }

  let nextAttempt = primaryPlans.length + 1;

  for (const plan of fallbackPlans) {
    if (qualifiedCompletionCount(runs) >= successTarget) {
      break;
    }

    if (projectedSpendUsdc + plan.unitPriceUsdc > spendCapUsdc) {
      runs.push({
        providerName: plan.providerName,
        providerWallet: plan.providerWallet,
        offeringName: plan.offeringName,
        unitPriceUsdc: plan.unitPriceUsdc,
        attempt: nextAttempt,
        launchedAt: nowIso(),
        terminalAt: nowIso(),
        phase: "ERROR",
        estimatedSpendUsdc: 0,
        error: "skipped_by_spend_cap",
      });
      nextAttempt += 1;
      continue;
    }

    const run = await runProviderPlan(plan, request, nextAttempt);
    runs.push(run);
    projectedSpendUsdc += run.estimatedSpendUsdc;
    nextAttempt += 1;
  }

  const completed = completedCount(runs);
  const qualifiedCompleted = qualifiedCompletionCount(runs);
  const metTarget = qualifiedCompleted >= successTarget;
  const terminalBreakdown = countByPhase(runs);
  const proofJobIds = completedJobIds(runs);
  const qualifiedProofJobIds = qualifiedCompletionJobIds(runs);
  const railwayInfraPerJobUsdc = RAILWAY_MONTHLY_BASE_USDC / request.monthlyJobVolumeAssumption;
  const estimatedTotalCostUsdc =
    projectedSpendUsdc + railwayInfraPerJobUsdc + ORCHESTRATION_OPS_RESERVE_USDC + COMPUTE_RESERVE_USDC;
  const estimatedGrossMarginUsdc = OUR_FEE_USDC - estimatedTotalCostUsdc;

  return {
    deliverable: {
      type: "json",
      value: {
        service: "graduation-boost-orchestrator",
        offering: OFFERING_NAME,
        target: {
          agentName: request.targetAgentName,
          agentWallet: request.targetAgentWallet,
          targetOfferingName: request.targetOfferingName ?? null,
          targetOfferingRequirements:
            Object.keys(request.targetOfferingRequirements).length > 0
              ? request.targetOfferingRequirements
              : null,
        },
        pricing: {
          ourFeeUsdc: OUR_FEE_USDC,
          reference: {
            competitor: "ACPilot graduation_boost starter",
            competitorPriceUsdc: ACPILOT_STARTER_PRICE_USDC,
            cheaperThanReferenceByUsdc: round2(ACPILOT_STARTER_PRICE_USDC - OUR_FEE_USDC),
            observedAt: "2026-03-01",
          },
          spendCapUsdc,
          projectedDownstreamSpendUsdc: round2(projectedSpendUsdc),
          costModel: {
            monthlyJobVolumeAssumption: request.monthlyJobVolumeAssumption,
            railwayMonthlyBaseUsdc: RAILWAY_MONTHLY_BASE_USDC,
            railwayInfraPerJobUsdc: round4(railwayInfraPerJobUsdc),
            orchestrationOpsReserveUsdc: ORCHESTRATION_OPS_RESERVE_USDC,
            computeReserveUsdc: COMPUTE_RESERVE_USDC,
            estimatedTotalCostUsdc: round4(estimatedTotalCostUsdc),
            estimatedGrossMarginUsdc: round4(estimatedGrossMarginUsdc),
            breakevenFeeUsdc: round4(estimatedTotalCostUsdc),
          },
        },
        execution: {
          mode: request.mode,
          successTarget,
          maxWaitSecondsPerDownstreamJob: request.maxWaitSeconds,
          primaryProviders: primaryPlans.map((plan) => ({
            providerName: plan.providerName,
            providerWallet: plan.providerWallet,
            offeringName: plan.offeringName,
            unitPriceUsdc: plan.unitPriceUsdc,
          })),
          fallbackProviders: fallbackPlans.map((plan) => ({
            providerName: plan.providerName,
            providerWallet: plan.providerWallet,
            offeringName: plan.offeringName,
            unitPriceUsdc: plan.unitPriceUsdc,
          })),
          runs,
        },
        results: {
          metTarget,
          completed,
          qualifiedCompleted,
          terminalBreakdown,
          proofJobIds,
          qualifiedProofJobIds,
        },
        nextActions: metTarget
          ? [
              "Track uniqueBuyerCount delta after indexer sync (usually 5-30 minutes).",
              "Monitor gross margin vs projected cost model and tune monthly volume assumption if needed.",
            ]
          : [
              "Run graduation_boost_fast_starter_v1 for lower-cost quick attempts before repeating proof-pro mode.",
              "Ensure boost_onboarding_micro_v1 stays listed at 0.01 for reciprocal compatibility.",
            ],
      },
    },
  };
}

export function validateRequirements(input: unknown): ValidationResult {
  const req = normalizeObject(input);

  const wallet = String(req.target_agent_wallet ?? "").trim();
  if (!wallet.startsWith("0x") || wallet.length < 10) {
    return { valid: false, reason: "target_agent_wallet must be a valid 0x address string" };
  }

  const mode = String(req.mode ?? "lite");
  if (mode !== "lite" && mode !== "balanced") {
    return { valid: false, reason: "mode must be either 'lite' or 'balanced'" };
  }

  if (
    req.target_offering_requirements != null &&
    (typeof req.target_offering_requirements !== "object" ||
      Array.isArray(req.target_offering_requirements))
  ) {
    return {
      valid: false,
      reason: "target_offering_requirements must be an object when provided",
    };
  }

  const maxWaitSeconds = Number(req.max_wait_seconds ?? 90);
  if (!Number.isFinite(maxWaitSeconds) || maxWaitSeconds < 60 || maxWaitSeconds > 180) {
    return { valid: false, reason: "max_wait_seconds must be between 60 and 180" };
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Graduation boost orchestration accepted. Launching low-cost multi-provider execution with verifiable proof pack and compute-aware cost accounting.";
}
