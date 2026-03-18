import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  buildUxReviewAnalysis,
  buildUxReviewDeliverable,
  normalizeUxReviewRequest,
  validateUxReviewRequest,
} from "../../../runtime/uxReviewOrchestrator.js";

const OFFERING_NAME = "product_ux_review_deep_v1";

export async function executeJob(request: unknown): Promise<ExecuteJobResult> {
  const normalized = normalizeUxReviewRequest(request, "deep");
  const analysis = await buildUxReviewAnalysis(normalized, "deep");
  return {
    deliverable: buildUxReviewDeliverable({
      offering: OFFERING_NAME,
      tier: "deep",
      request: normalized,
      analysis,
    }),
  };
}

export function validateRequirements(request: unknown): ValidationResult {
  return validateUxReviewRequest(request, "deep");
}

export function requestPayment(): string {
  return "Deep UX review accepted. Returning IA, flow, state-policy, and experiment guidance in structured JSON.";
}
