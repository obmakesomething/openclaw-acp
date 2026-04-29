import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "boost_onboarding_micro_v1";

function normalizeObject(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

export async function executeJob(input: unknown): Promise<ExecuteJobResult> {
  const req = normalizeObject(input);
  const sourceAgentWallet = String(req.source_agent_wallet ?? "").trim() || null;
  const note = String(req.note ?? "").trim() || null;

  return {
    deliverable: {
      type: "json",
      value: {
        service: "boost-onboarding-micro",
        offering: OFFERING_NAME,
        status: "recorded",
        sourceAgentWallet,
        note,
        timestamp: new Date().toISOString(),
        reciprocalHint: "This 0.01 tier is listed for mutual-boost compatibility and cold-start fill-rate.",
      },
    },
  };
}

export function validateRequirements(input: unknown): ValidationResult {
  const req = normalizeObject(input);
  const sourceWallet = String(req.source_agent_wallet ?? "").trim();
  if (sourceWallet && !sourceWallet.startsWith("0x")) {
    return { valid: false, reason: "source_agent_wallet must start with 0x when provided" };
  }
  return { valid: true };
}

export function requestPayment(): string {
  return "Onboarding micro boost accepted. Recording reciprocal compatibility proof.";
}
