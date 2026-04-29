import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "o2o_address_validation_pro_v1";
const PLAN = "pro";
const PRINTFUL_API_BASE = (process.env.PRINTFUL_API_BASE || "https://api.printful.com").replace(
  /\/+$/,
  ""
);
const PRINTFUL_TOKEN = process.env.PRINTFUL_API_TOKEN || process.env.PRINTFUL_API_KEY || "";
const PRINTFUL_STORE_ID = process.env.PRINTFUL_STORE_ID || "";

type PrintfulCallResult = {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
};

async function callPrintful(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<PrintfulCallResult> {
  if (!PRINTFUL_TOKEN) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Missing PRINTFUL_API_TOKEN or PRINTFUL_API_KEY",
    };
  }

  const fetchFn: any = (globalThis as any).fetch;
  if (!fetchFn) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "fetch is not available in this runtime",
    };
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
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
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
  const storeInfo = PRINTFUL_STORE_ID ? await callPrintful(`/stores/${PRINTFUL_STORE_ID}`) : null;
  const productsPreview = await callPrintful("/store/products?limit=15");

  const ratePayload = toRatePayload(request);
  const ratesPreview = ratePayload ? await callPrintful("/shipping/rates", "POST", ratePayload) : null;

  const deliverable = {
    service: "virtuals-o2o-delivery-printful",
    offering: OFFERING_NAME,
    plan: PLAN,
    timestamp: new Date().toISOString(),
    printful: {
      apiBase: PRINTFUL_API_BASE,
      storeId: PRINTFUL_STORE_ID || null,
      credentialReady: Boolean(PRINTFUL_TOKEN),
      checks: {
        storeInfo: storeInfo
          ? {
              ok: storeInfo.ok,
              status: storeInfo.status,
              error: storeInfo.error || null,
            }
          : {
              skipped: true,
              reason: "PRINTFUL_STORE_ID not set; skipped store metadata check",
            },
        productsPreview: {
          ok: productsPreview.ok,
          status: productsPreview.status,
          error: productsPreview.error || null,
        },
        ratesPreview: ratesPreview
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
    },
    requestEcho: {
      mode: request?.mode || "o2o",
      plan: request?.plan || PLAN,
      countryCode: request?.countryCode || null,
      postalCode: request?.postalCode || null,
      itemCount: Array.isArray(request?.items) ? request.items.length : 0,
    },
    guidance: {
      quote: "Provide items with variant_id and quantity plus countryCode/postalCode for live shipping rates.",
      order: "Order creation is intentionally not executed in this handler to avoid unintended fulfillment.",
    },
    status: productsPreview.ok || (ratesPreview ? ratesPreview.ok : false) ? "ready" : "degraded",
  };

  return { deliverable: { type: "json", value: deliverable } };
}

export function validateRequirements(request: any): ValidationResult {
  if (request?.mode && request.mode !== "o2o") {
    return { valid: false, reason: 'mode must be "o2o"' };
  }
  if (request?.plan && request.plan !== PLAN) {
    return { valid: false, reason: `plan must be "${PLAN}"` };
  }
  return { valid: true };
}

export function requestPayment(request: any): string {
  return `Request accepted for ${OFFERING_NAME} (${request?.plan || PLAN})`;
}
