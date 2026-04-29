import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "delivery_route_quote_pro_v1";
const PLAN = "pro";
const PRINTFUL_CORE_PROVIDER_WALLET =
  process.env.PRINTFUL_CORE_PROVIDER_WALLET || "0x092Bd61Af8EDE22B8291bE9b88259BE8b9845657";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, any>) : {};
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const req = normalizeObject(request);
  const destination = normalizeObject(req.destination);
  const items = Array.isArray(req.items) ? req.items : [];

  const warnings: string[] = [];
  if (!destination.countryCode) warnings.push("destination.countryCode is missing");
  if (!destination.postalCode) warnings.push("destination.postalCode is missing");
  if (!items.length) warnings.push("items is empty");

  const orchestration = {
    strategy: "balanced",
    slaTargetMinutes: 90,
    requireSignature: true,
    fallbackCarrier: "express",
  };

  return {
    deliverable: {
      type: "json",
      value: {
        service: "virtuals-delivery-orchestrator",
        offering: OFFERING_NAME,
        plan: PLAN,
        status: warnings.length ? "needs_input" : "ready",
        warnings,
        requestEcho: {
          mode: req.mode || "delivery",
          plan: req.plan || PLAN,
          destination,
          itemCount: items.length,
        },
        orchestration,
        nextAction: {
          type: "acp_job",
          providerWalletAddress: PRINTFUL_CORE_PROVIDER_WALLET,
          jobOfferingName: "o2o_address_validation_pro_v1",
          serviceRequirements: {
            mode: "o2o",
            plan: "pro",
            countryCode: destination.countryCode || req.countryCode,
            stateCode: destination.stateCode || req.stateCode,
            postalCode: destination.postalCode || req.postalCode,
            items,
          },
        },
      },
    },
  };
}

export function validateRequirements(request: any): ValidationResult {
  const req = normalizeObject(request);
  if (req.plan && req.plan !== PLAN) {
    return { valid: false, reason: `plan must be ${PLAN}` };
  }
  if (req.mode && !["delivery", "o2o"].includes(String(req.mode))) {
    return { valid: false, reason: "mode must be delivery or o2o" };
  }
  return { valid: true };
}

export function requestPayment(request: any): string {
  return "Delivery routing pro plan accepted. Proceeding to orchestration output.";
}
