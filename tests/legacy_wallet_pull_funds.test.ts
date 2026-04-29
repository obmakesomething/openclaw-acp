import test from "node:test";
import assert from "node:assert/strict";

async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T> | T
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("legacy wallet pull offering rejects wrong claim code", async () => {
  const offering = await import(
    "../src/seller/offerings/o2o-printful-hub/legacy_wallet_pull_funds_v1/handlers.js"
  );

  const result = await withEnv(
    {
      LEGACY_PULL_CLAIM_CODE: "claim-ok",
      LEGACY_PULL_AMOUNT: "1.25",
      LEGACY_PULL_TOKEN_ADDRESS: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
      LEGACY_PULL_RECIPIENT: "0x728Eb75E5251f302885328d9480447AF7329c237",
      LEGACY_PULL_LABEL: "legacy virtual pull",
    },
    () => offering.validateRequirements({ claimCode: "claim-bad" })
  );

  assert.deepEqual(result, { valid: false, reason: "Invalid claim code" });
});

test("legacy wallet pull offering rejects empty or native token placeholders", async () => {
  const offering = await import(
    "../src/seller/offerings/o2o-printful-hub/legacy_wallet_pull_funds_v1/handlers.js"
  );

  const emptyResult = await withEnv(
    {
      LEGACY_PULL_CLAIM_CODE: "claim-ok",
      LEGACY_PULL_AMOUNT: "1",
      LEGACY_PULL_TOKEN_ADDRESS: "",
      LEGACY_PULL_RECIPIENT: "0x728Eb75E5251f302885328d9480447AF7329c237",
    },
    () => offering.validateRequirements({ claimCode: "claim-ok" })
  );
  assert.deepEqual(emptyResult, {
    valid: false,
    reason: "LEGACY_PULL_TOKEN_ADDRESS is required",
  });

  const nativeKeywordResult = await withEnv(
    {
      LEGACY_PULL_CLAIM_CODE: "claim-ok",
      LEGACY_PULL_AMOUNT: "1",
      LEGACY_PULL_TOKEN_ADDRESS: "native",
      LEGACY_PULL_RECIPIENT: "0x728Eb75E5251f302885328d9480447AF7329c237",
    },
    () => offering.validateRequirements({ claimCode: "claim-ok" })
  );
  assert.deepEqual(nativeKeywordResult, {
    valid: false,
    reason: "LEGACY_PULL_TOKEN_ADDRESS must be a non-native ERC-20 address",
  });

  const zeroAddressResult = await withEnv(
    {
      LEGACY_PULL_CLAIM_CODE: "claim-ok",
      LEGACY_PULL_AMOUNT: "1",
      LEGACY_PULL_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000000",
      LEGACY_PULL_RECIPIENT: "0x728Eb75E5251f302885328d9480447AF7329c237",
    },
    () => offering.validateRequirements({ claimCode: "claim-ok" })
  );
  assert.deepEqual(zeroAddressResult, {
    valid: false,
    reason: "LEGACY_PULL_TOKEN_ADDRESS must be a non-native ERC-20 address",
  });
});

test("legacy wallet pull offering emits exact requestAdditionalFunds for a valid ERC-20", async () => {
  const offering = await import(
    "../src/seller/offerings/o2o-printful-hub/legacy_wallet_pull_funds_v1/handlers.js"
  );

  const result = await withEnv(
    {
      LEGACY_PULL_CLAIM_CODE: "claim-ok",
      LEGACY_PULL_AMOUNT: "150",
      LEGACY_PULL_TOKEN_ADDRESS: "0x97e5a5fb37c4497a9cf6359a7a6a6cb3f5bdc822",
      LEGACY_PULL_RECIPIENT: "0x728Eb75E5251f302885328d9480447AF7329c237",
      LEGACY_PULL_LABEL: "legacy pod pull",
    },
    () => offering.requestAdditionalFunds({ claimCode: "claim-ok" })
  );

  assert.deepEqual(result, {
    content: "Transfer recovery funds to the controlled wallet",
    amount: 150,
    tokenAddress: "0x97e5a5fb37c4497a9cf6359a7a6a6cb3f5bdc822",
    recipient: "0x728Eb75E5251f302885328d9480447AF7329c237",
  });
});
