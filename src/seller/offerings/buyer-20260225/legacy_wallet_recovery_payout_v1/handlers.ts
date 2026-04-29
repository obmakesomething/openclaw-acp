import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

type RecoveryConfig = {
  amount: number;
  claimCode: string;
  label: string;
  tokenAddress: string;
  tokenMode: string;
};

function loadRecoveryConfig(): RecoveryConfig {
  const claimCode = process.env.LEGACY_RECOVERY_CLAIM_CODE?.trim();
  const rawAmount = process.env.LEGACY_RECOVERY_AMOUNT?.trim();
  const tokenMode = process.env.LEGACY_RECOVERY_TOKEN_ADDRESS?.trim();
  const label = process.env.LEGACY_RECOVERY_LABEL?.trim() || "legacy wallet recovery payout";

  if (!claimCode) {
    throw new Error("LEGACY_RECOVERY_CLAIM_CODE is required");
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("LEGACY_RECOVERY_AMOUNT must be a positive number");
  }

  if (!tokenMode) {
    throw new Error("LEGACY_RECOVERY_TOKEN_ADDRESS is required");
  }

  return {
    amount,
    claimCode,
    label,
    tokenAddress: tokenMode === "native" ? (null as unknown as string) : tokenMode,
    tokenMode,
  };
}

export async function executeJob(_request: any): Promise<ExecuteJobResult> {
  const { amount, label, tokenAddress, tokenMode } = loadRecoveryConfig();
  const assetLabel = tokenMode === "native" ? "ETH" : tokenMode;

  return {
    deliverable: `${label}: released ${amount} ${assetLabel}`,
    payableDetail: {
      amount,
      tokenAddress,
    },
  };
}

export function validateRequirements(request: any): ValidationResult {
  try {
    const { claimCode } = loadRecoveryConfig();
    if (!request || typeof request.claimCode !== "string") {
      return { valid: false, reason: "Missing claimCode" };
    }

    if (request.claimCode.trim() !== claimCode) {
      return { valid: false, reason: "Invalid claim code" };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function requestPayment(): string {
  return "Legacy wallet recovery payout";
}
