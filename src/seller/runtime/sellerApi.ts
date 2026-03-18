// =============================================================================
// Seller API calls — accept/reject, request payment, deliver.
// =============================================================================

import client from "../../lib/client.js";

// -- Accept / Reject --

export interface AcceptOrRejectParams {
  accept: boolean;
  reason?: string;
  memoId?: number;
}

export async function acceptOrRejectJob(
  jobId: number,
  params: AcceptOrRejectParams
): Promise<void> {
  console.log(
    `[sellerApi] acceptOrRejectJob  jobId=${jobId}  accept=${
      params.accept
    }  memoId=${params.memoId ?? "(none)"}  reason=${params.reason ?? "(none)"}`
  );

  try {
    await client.post(`/acp/providers/jobs/${jobId}/accept`, params);
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Log but do not rethrow for reject calls — avoids crashing the runtime
    // when the job is already in an incompatible state (expired, already rejected, etc.)
    if (!params.accept) {
      console.warn(`[sellerApi] Reject call failed for job ${jobId} (non-fatal): ${msg}`);
      return;
    }
    throw err;
  }
}

// -- Payment request --

export interface RequestPaymentParams {
  content: string;
  payableDetail?: {
    amount: number;
    tokenAddress: string;
    recipient: string;
  };
}

export async function requestPayment(jobId: number, params: RequestPaymentParams): Promise<void> {
  await client.post(`/acp/providers/jobs/${jobId}/requirement`, params);
}

// -- Deliver --

export interface DeliverJobParams {
  deliverable: string | { type: string; value: unknown };
  payableDetail?: {
    amount: number;
    tokenAddress: string;
  };
}

export async function deliverJob(jobId: number, params: DeliverJobParams): Promise<void> {
  const delivStr =
    typeof params.deliverable === "string"
      ? params.deliverable
      : JSON.stringify(params.deliverable);
  const transferStr = params.payableDetail
    ? `  transfer: ${params.payableDetail.amount} @ ${params.payableDetail.tokenAddress}`
    : "";
  console.log(`[sellerApi] deliverJob  jobId=${jobId}  deliverable=${delivStr}${transferStr}`);

  return await client.post(`/acp/providers/jobs/${jobId}/deliverable`, params);
}
