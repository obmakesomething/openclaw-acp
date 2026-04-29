import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  buildOpenHandsOutreachRunbook,
  type OpenHandsRunbookInput,
} from "../../../runtime/outreachEngines.js";

const OFFERING_NAME = "virtual_outreach_automation_openhands_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, any>)
    : {};
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((value) => String(value).trim()).filter(Boolean);
}

function toRunbookInput(request: Record<string, any>): OpenHandsRunbookInput {
  return {
    target_agent_name: String(request.target_agent_name || "").trim(),
    value_prop: String(request.value_prop || "").trim(),
    landing_url: String(request.landing_url || "").trim() || undefined,
    target_keywords: normalizeStringArray(request.target_keywords),
    campaign_days: Number(request.campaign_days),
    followup_depth: Number(request.followup_depth),
  };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const normalized = normalizeObject(request);
  const runbookInput = toRunbookInput(normalized);
  const runbook = await buildOpenHandsOutreachRunbook(runbookInput);

  return {
    deliverable: {
      type: "json",
      value: {
        service: "virtual-outreach-automation",
        offering: OFFERING_NAME,
        framework: "openhands",
        input: runbookInput,
        runbook,
        notes: [
          "If OpenHands runtime is unavailable, fallback SOP is returned automatically.",
          "Use this runbook as the operating guardrail for outbound dispatch jobs.",
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

  if (normalized.followup_depth !== undefined) {
    const depth = Number(normalized.followup_depth);
    if (!Number.isFinite(depth) || depth < 1 || depth > 5) {
      return { valid: false, reason: "followup_depth must be between 1 and 5" };
    }
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "OpenHands outreach automation request accepted. Building execution runbook and retry policy.";
}
