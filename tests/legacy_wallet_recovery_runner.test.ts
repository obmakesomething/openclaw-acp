import test from "node:test";
import assert from "node:assert/strict";

test("legacy recovery runner builds a manifest for the four recoverable ERC-20 assets in recovery order", async () => {
  const runner = await import("../scripts/legacy_wallet_recovery_runner.js").catch(() => null);
  assert.ok(runner, "legacy recovery runner module should exist");

  const manifest = runner.buildLegacyRecoveryManifest([
    {
      tokenAddress: null,
      tokenBalance: "0x1",
      tokenMetadata: { symbol: null, name: null, decimals: null },
    },
    {
      tokenAddress: "0x97e5a5fb37c4497a9cf6359a7a6a6cb3f5bdc822",
      tokenBalance: "0x00000000000000000000000000000000000000000000000821ab0d4414980000",
      tokenMetadata: { symbol: "POD", name: "Dolphin", decimals: 18 },
    },
    {
      tokenAddress: "0xe036476ba1f23e072176a40f6340a1b22162cd40",
      tokenBalance: "0x00000000000000000000000000000000000000000000000821ab0d4414980000",
      tokenMetadata: { symbol: "", name: "", decimals: 18 },
    },
    {
      tokenAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
      tokenBalance: "0x0000000000000000000000000000000000000000000000001588cd099ea383eb",
      tokenMetadata: { symbol: "VIRTUAL", name: "Virtual Protocol", decimals: 18 },
    },
    {
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      tokenBalance: "0x000000000000000000000000000000000000000000000000000000000000083a",
      tokenMetadata: { symbol: "USDC", name: "USD Coin", decimals: 6 },
    },
  ]);

  assert.deepEqual(
    manifest.assets.map((asset: any) => ({
      symbol: asset.symbol,
      tokenAddress: asset.tokenAddress,
      amount: asset.amount,
    })),
    [
      {
        symbol: "USDC",
        tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        amount: "0.002106",
      },
      {
        symbol: "VIRTUAL",
        tokenAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
        amount: "1.551715512829051883",
      },
      {
        symbol: "POD",
        tokenAddress: "0x97e5a5fb37c4497a9cf6359a7a6a6cb3f5bdc822",
        amount: "150",
      },
      {
        symbol: "UNKNOWN_4",
        tokenAddress: "0xe036476ba1f23e072176a40f6340a1b22162cd40",
        amount: "150",
      },
    ]
  );
});

test("legacy recovery runner renders a native ETH support brief with required proofs", async () => {
  const runner = await import("../scripts/legacy_wallet_recovery_runner.js").catch(() => null);
  assert.ok(runner, "legacy recovery runner module should exist");

  const brief = runner.renderSupportBrief({
    currentUserId: "217506",
    legacyUserId: "204595",
    legacyAgentName: "buyer-20260225",
    legacyWalletAddress: "0xA0bef3670ABfEFA95FfDA0C9c193b4648a0F8DdB",
    nativeEthAmount: "0.003120440867455339",
    recoverableAssets: [
      { symbol: "VIRTUAL", amount: "1.551715512829051883" },
      { symbol: "USDC", amount: "0.002106" },
    ],
  });

  assert.match(brief, /buyer-20260225/);
  assert.match(brief, /0xA0bef3670ABfEFA95FfDA0C9c193b4648a0F8DdB/);
  assert.match(brief, /0\.003120440867455339 ETH/);
  assert.match(brief, /current user.*217506/i);
  assert.match(brief, /legacy user.*204595/i);
  assert.match(brief, /restore visibility|transfer the agent|manual withdrawal/i);
});

test("legacy recovery runner excludes sub-precision ERC-20 dust from actionable recovery", async () => {
  const runner = await import("../scripts/legacy_wallet_recovery_runner.js").catch(() => null);
  assert.ok(runner, "legacy recovery runner module should exist");

  const actionable = runner.filterActionableAssets([
    {
      index: 0,
      symbol: "VIRTUAL",
      name: "Virtual Protocol",
      tokenAddress: "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b",
      amount: "0.000000512829051883",
      decimals: 18,
      rawHexBalance: "0x0000000000000000000000000000000000000000000000000000007766fe53eb",
    },
    {
      index: 1,
      symbol: "USDC",
      name: "USD Coin",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      amount: "0.002106",
      decimals: 6,
      rawHexBalance: "0x000000000000000000000000000000000000000000000000000000000000083a",
    },
  ]);

  assert.deepEqual(
    actionable.map((asset: any) => asset.symbol),
    ["USDC"]
  );
});
