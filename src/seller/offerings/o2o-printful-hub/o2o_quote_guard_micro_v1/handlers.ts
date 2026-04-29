import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "o2o_quote_guard_micro_v1";
const PLAN = "micro";
const PRINTFUL_API_BASE = (process.env.PRINTFUL_API_BASE || "https://api.printful.com").replace(
  /\/+$/,
  ""
);
const PRINTFUL_TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || "";

type PrintfulCallResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
};

async function callPrintful(path: string, method: "GET" | "POST" = "GET", body?: unknown) {
  if (!PRINTFUL_TOKEN) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Missing PRINTFUL_API_TOKEN or PRINTFUL_API_KEY",
    } satisfies PrintfulCallResult;
  }

  const fetchFn: any = (globalThis as any).fetch;
  if (!fetchFn) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "fetch is not available in this runtime",
    } satisfies PrintfulCallResult;
  }

  try {
    const response = await fetchFn(`${PRINTFUL_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${PRINTFUL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const rawText = await response.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = { raw: rawText };
    }

    const parsedAny = parsed as any;
    const errorMessage =
      parsedAny?.error?.message ||
      parsedAny?.error ||
      parsedAny?.message ||
      (response.ok ? undefined : `HTTP ${response.status}`);

    return {
      ok: response.ok,
      status: response.status,
      data: parsed,
      error: errorMessage,
    } satisfies PrintfulCallResult;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    } satisfies PrintfulCallResult;
  }
}

function toRatePayload(request: any): Record<string, unknown> | null {
  const countryCode = typeof request?.countryCode === "string" ? request.countryCode : "";
  const postalCode = typeof request?.postalCode === "string" ? request.postalCode : "";
  const stateCode =
    typeof request?.stateCode === "string"
      ? request.stateCode
      : countryCode.toUpperCase() === "US"
        ? "NY"
        : "";

  const items = Array.isArray(request?.items) ? request.items : [];
  const normalizedItems = items
    .map((item: any) => ({
      variant_id: Number(item?.variant_id ?? item?.variantId),
      quantity: Number(item?.quantity ?? 1),
    }))
    .filter((item: any) => Number.isFinite(item.variant_id) && item.quantity > 0);

  if (!countryCode || !postalCode || normalizedItems.length === 0) {
    return null;
  }

  return {
    recipient: {
      country_code: countryCode,
      zip: postalCode,
      ...(stateCode ? { state_code: stateCode } : {}),
    },
    items: normalizedItems,
    currency: "USD",
    locale: "en_US",
  };
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const ratePayload = toRatePayload(request);
  const ratesPreview = ratePayload
    ? await callPrintful("/shipping/rates", "POST", ratePayload)
    : null;

  const inputReadiness = {
    hasCountryCode: typeof request?.countryCode === "string" && request.countryCode.length > 0,
    hasPostalCode: typeof request?.postalCode === "string" && request.postalCode.length > 0,
    hasItems: Array.isArray(request?.items) && request.items.length > 0,
  };

  const deliverable = {
    service: "virtuals-o2o-delivery-printful",
    offering: OFFERING_NAME,
    plan: PLAN,
    timestamp: new Date().toISOString(),
    checks: {
      credentialReady: Boolean(PRINTFUL_TOKEN),
      rateInputReady: Boolean(ratePayload),
      ratePreview: ratesPreview
        ? {
            ok: ratesPreview.ok,
            status: ratesPreview.status,
            error: ratesPreview.error || null,
          }
        : {
            skipped: true,
            reason: "countryCode/postalCode/items(variant_id,quantity) not fully provided",
          },
    },
    inputReadiness,
    recommendedNextOffering: ratesPreview?.ok
      ? "o2o_delivery_quick_live_v1"
      : "o2o_delivery_quick_live_v1 (submit full shipping payload)",
    nextStepTemplate: {
      countryCode: request?.countryCode || "US",
      stateCode: request?.stateCode || "NY",
      postalCode: request?.postalCode || "10001",
      items:
        Array.isArray(request?.items) && request.items.length > 0
          ? request.items
          : [{ variant_id: 4011, quantity: 1 }],
    },
    status: ratesPreview?.ok ? "ready_for_quick" : "needs_input",
  };

  return { deliverable: { type: "json", value: deliverable } };
}

export function validateRequirements(_request: any): ValidationResult {
  return { valid: true };
}

export function requestPayment(): string {
  return `Request accepted for ${OFFERING_NAME} (${PLAN})`;
}
