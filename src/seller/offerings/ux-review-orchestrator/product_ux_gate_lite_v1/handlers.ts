import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  buildUxReviewAnalysis,
  buildUxReviewDeliverable,
  normalizeUxReviewRequest,
  validateUxReviewRequest,
} from "../../../runtime/uxReviewOrchestrator.js";

const OFFERING_NAME = "product_ux_gate_lite_v1";

export async function executeJob(request: unknown): Promise<ExecuteJobResult> {
  const normalized = normalizeUxReviewRequest(request, "lite");
  const analysis = await buildUxReviewAnalysis(normalized, "lite");
  return {
    deliverable: buildUxReviewDeliverable({
      offering: OFFERING_NAME,
      tier: "lite",
      request: normalized,
      analysis,
    }),
  };
}

export function validateRequirements(request: unknown): ValidationResult {
  return validateUxReviewRequest(request, "lite");
}

export function requestPayment(): string {
  return "UX gate accepted. Returning a single-decision hierarchy and flow gate package now.";
}
