import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "virtuals_event_raffle_us";
const OFFER_ENDPOINT = "/raffle/offer";
const RAFFLE_BASE_URL =
  "https://virtuals-event-raffle-us-production.up.railway.app";

async function callOfferEndpoint() {
  const fetchFn: any = (globalThis as any).fetch;
  if (!fetchFn) {
    return { ok: false, status: 0, data: null, error: "fetch is not available in runtime" };
  }

  try {
    const response = await fetchFn(`${RAFFLE_BASE_URL}${OFFER_ENDPOINT}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const rawText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = { raw: rawText };
    }

    return { ok: response.ok, status: response.status, data: parsed };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      data: null,
    };
  }
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const upstream = await callOfferEndpoint();
  return {
    deliverable: {
      type: "json",
      value: {
        service: "virtuals-event-raffle-us",
        offering: OFFERING_NAME,
        locale: request?.locale || "en-US",
        country: request?.country || "US",
        upstream,
      },
    },
  };
}

export function validateRequirements(_request: any): ValidationResult {
  return { valid: true };
}

export function requestPayment(): string {
  return `Request accepted for ${OFFERING_NAME}`;
}
