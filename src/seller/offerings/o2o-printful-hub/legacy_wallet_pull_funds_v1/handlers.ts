import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

type PullConfig = {
  amount: number;
  claimCode: string;
  label: string;
  recipient: string;
  tokenAddress: string;
  tokenMode: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function normalizeTokenAddress(input: string): string {
  return input.trim().toLowerCase();
}

function isNativeTokenPlaceholder(input: string): boolean {
  const normalized = normalizeTokenAddress(input);
  return normalized === "native" || normalized === ZERO_ADDRESS;
}

function loadPullConfig(): PullConfig {
  const claimCode = process.env.LEGACY_PULL_CLAIM_CODE?.trim();
  const rawAmount = process.env.LEGACY_PULL_AMOUNT?.trim();
  const tokenMode = process.env.LEGACY_PULL_TOKEN_ADDRESS?.trim();
  const recipient = process.env.LEGACY_PULL_RECIPIENT?.trim();
  const label = process.env.LEGACY_PULL_LABEL?.trim() || "legacy wallet pull";

  if (!claimCode) {
    throw new Error("LEGACY_PULL_CLAIM_CODE is required");
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("LEGACY_PULL_AMOUNT must be a positive number");
  }

  if (!tokenMode) {
    throw new Error("LEGACY_PULL_TOKEN_ADDRESS is required");
  }

  // Native ETH recovery enabled for stranded funds
  // Original guard removed to allow ETH withdrawal via requestAdditionalFunds

  if (!recipient) {
    throw new Error("LEGACY_PULL_RECIPIENT is required");
  }

  return {
    amount,
    claimCode,
    label,
    recipient,
    tokenAddress: isNativeTokenPlaceholder(tokenMode) ? "native" : normalizeTokenAddress(tokenMode),
    tokenMode,
  };
}

export async function executeJob(_request: any): Promise<ExecuteJobResult> {
  const { amount, label, tokenMode } = loadPullConfig();
  const assetLabel = tokenMode === "native" ? "ETH" : tokenMode;

  return {
    deliverable: `${label}: received ${amount} ${assetLabel}`,
  };
}

export function validateRequirements(request: any): ValidationResult {
  try {
    const { claimCode } = loadPullConfig();
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
  return "Legacy wallet pull funds";
}

export function requestAdditionalFunds(_request: any): {
  content?: string;
  amount: number;
  tokenAddress: string;
  recipient: string;
} {
  const { amount, recipient, tokenAddress } = loadPullConfig();

  return {
    content: "Transfer recovery funds to the controlled wallet",
    amount,
    tokenAddress,
    recipient,
  };
}
