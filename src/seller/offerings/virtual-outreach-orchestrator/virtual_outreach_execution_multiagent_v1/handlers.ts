import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  buildLangGraphOutreachPlan,
  buildOpenHandsOutreachRunbook,
  dispatchOutreachJobs,
} from "../../../runtime/outreachEngines.js";

const OFFERING_NAME = "virtual_outreach_execution_multiagent_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, any>)
    : {};
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value).trim()).filter(Boolean);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const lowered = String(value).toLowerCase().trim();
  return ["1", "true", "yes", "on"].includes(lowered);
}

function toNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const normalized = normalizeObject(request);

  const baseInput = {
    target_agent_name: String(normalized.target_agent_name || "").trim(),
    target_agent_wallet: String(normalized.target_agent_wallet || "").trim() || undefined,
    value_prop: String(normalized.value_prop || "").trim(),
    landing_url: String(normalized.landing_url || "").trim() || undefined,
    target_keywords: normalizeStringArray(normalized.target_keywords),
    campaign_days: toNumber(normalized.campaign_days, 7),
    budget_usdc: toNumber(normalized.budget_usdc, 1),
    max_provider_price_usdc: toNumber(
      normalized.max_provider_price_usdc,
      toNumber(normalized.budget_usdc, 1)
    ),
    high_cost_provider_threshold_usdc: toNumber(
      normalized.high_cost_provider_threshold_usdc,
      Math.min(
        toNumber(normalized.max_provider_price_usdc, toNumber(normalized.budget_usdc, 1)),
        0.05
      )
    ),
    daily_external_spend_cap_usdc: toNumber(normalized.daily_external_spend_cap_usdc, 0.3),
    require_prev_wave_recovery: toBoolean(normalized.require_prev_wave_recovery, true),
    force_dispatch: toBoolean(normalized.force_dispatch, false),
    recovery_poll_seconds: toNumber(normalized.recovery_poll_seconds, 20),
    followup_depth: toNumber(normalized.followup_depth, 2),
    max_targets: toNumber(normalized.max_targets, 3),
    dispatch_jobs: toBoolean(normalized.dispatch_jobs, false),
    cta: String(normalized.cta || "").trim() || undefined,
  };

  const [strategyPlan, operationsRunbook] = await Promise.all([
    buildLangGraphOutreachPlan(baseInput),
    buildOpenHandsOutreachRunbook(baseInput),
  ]);

  const dispatchResult = await dispatchOutreachJobs(baseInput);

  return {
    deliverable: {
      type: "json",
      value: {
        service: "virtual-outreach-execution",
        offering: OFFERING_NAME,
        frameworks: ["langgraph", "openhands", "acp-multi-agent"],
        mode: baseInput.dispatch_jobs ? "live-dispatch" : "dry-run",
        request: baseInput,
        strategy_plan: strategyPlan,
        operations_runbook: operationsRunbook,
        dispatch: dispatchResult,
        summary: {
          discovered_provider_count: dispatchResult.discoveredProviders.length,
          selected_provider_count: dispatchResult.selectedProviders.length,
          high_cost_excluded_count: dispatchResult.excludedHighCost.length,
          daily_cap_blocked_count: dispatchResult.blockedByDailyCap.length,
          submitted_count: dispatchResult.submittedJobs.filter(
            (item) => item.status === "submitted"
          ).length,
          blocked_count: dispatchResult.submittedJobs.filter((item) => item.status === "blocked")
            .length,
          failed_count: dispatchResult.submittedJobs.filter((item) => item.status === "failed")
            .length,
        },
      },
    },
  };
}

export function validateRequirements(request: any): ValidationResult {
  const normalized = normalizeObject(request);
  const target = String(normalized.target_agent_name || "").trim();
  const valueProp = String(normalized.value_prop || "").trim();

  if (!target) {
    return { valid: false, reason: "target_agent_name is required" };
  }

  if (!valueProp) {
    return { valid: false, reason: "value_prop is required" };
  }

  if (normalized.max_targets !== undefined) {
    const maxTargets = Number(normalized.max_targets);
    if (!Number.isFinite(maxTargets) || maxTargets < 1 || maxTargets > 10) {
      return { valid: false, reason: "max_targets must be between 1 and 10" };
    }
  }

  if (normalized.budget_usdc !== undefined) {
    const budget = Number(normalized.budget_usdc);
    if (!Number.isFinite(budget) || budget < 0.05) {
      return { valid: false, reason: "budget_usdc must be >= 0.05" };
    }
  }

  if (normalized.max_provider_price_usdc !== undefined) {
    const maxProviderPrice = Number(normalized.max_provider_price_usdc);
    if (!Number.isFinite(maxProviderPrice) || maxProviderPrice < 0.01) {
      return { valid: false, reason: "max_provider_price_usdc must be >= 0.01" };
    }
  }

  if (normalized.high_cost_provider_threshold_usdc !== undefined) {
    const threshold = Number(normalized.high_cost_provider_threshold_usdc);
    if (!Number.isFinite(threshold) || threshold < 0.01) {
      return { valid: false, reason: "high_cost_provider_threshold_usdc must be >= 0.01" };
    }
  }

  if (normalized.daily_external_spend_cap_usdc !== undefined) {
    const dailyCap = Number(normalized.daily_external_spend_cap_usdc);
    if (!Number.isFinite(dailyCap) || dailyCap < 0.01) {
      return { valid: false, reason: "daily_external_spend_cap_usdc must be >= 0.01" };
    }
  }

  if (normalized.recovery_poll_seconds !== undefined) {
    const pollSeconds = Number(normalized.recovery_poll_seconds);
    if (!Number.isFinite(pollSeconds) || pollSeconds < 0 || pollSeconds > 90) {
      return { valid: false, reason: "recovery_poll_seconds must be between 0 and 90" };
    }
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Multi-agent outreach execution accepted. Preparing strategy, runbook, and provider dispatch plan.";
}
