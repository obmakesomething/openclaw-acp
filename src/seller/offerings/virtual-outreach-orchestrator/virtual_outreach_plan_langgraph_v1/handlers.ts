import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  buildLangGraphOutreachPlan,
  type LangGraphPlanInput,
} from "../../../runtime/outreachEngines.js";

const OFFERING_NAME = "virtual_outreach_plan_langgraph_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, any>)
    : {};
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value).trim()).filter(Boolean);
}

function toPlanInput(request: Record<string, any>): LangGraphPlanInput {
  return {
    target_agent_name: String(request.target_agent_name || "").trim(),
    value_prop: String(request.value_prop || "").trim(),
    landing_url: String(request.landing_url || "").trim() || undefined,
    target_keywords: normalizeStringArray(request.target_keywords),
    budget_usdc: Number(request.budget_usdc),
    campaign_days: Number(request.campaign_days),
    tone: String(request.tone || "").trim() || undefined,
  };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const normalized = normalizeObject(request);
  const planInput = toPlanInput(normalized);
  const plan = await buildLangGraphOutreachPlan(planInput);

  return {
    deliverable: {
      type: "json",
      value: {
        service: "virtual-outreach-plan",
        offering: OFFERING_NAME,
        framework: "langgraph",
        input: planInput,
        plan,
        next_actions: [
          "Use the messaging templates in outbound promote_agent jobs.",
          "Track unique buyer delta against KPI ladder each day.",
          "Refresh hooks after day 3 if response rate is below target.",
        ],
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

  if (normalized.campaign_days !== undefined) {
    const days = Number(normalized.campaign_days);
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      return { valid: false, reason: "campaign_days must be between 1 and 30" };
    }
  }

  if (normalized.budget_usdc !== undefined) {
    const budget = Number(normalized.budget_usdc);
    if (!Number.isFinite(budget) || budget < 0.05) {
      return { valid: false, reason: "budget_usdc must be >= 0.05" };
    }
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "LangGraph outreach planning request accepted. Generating campaign blueprint now.";
}
