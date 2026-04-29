import test from "node:test";
import assert from "node:assert/strict";

type WalletRow = {
  id: string;
  status: string;
  enabled?: boolean;
  linked?: boolean;
  eligibleForLiveOps?: boolean;
  blockingReasons?: string[];
  requiresHealthyIds?: string[];
};

function buildRow(partial: Partial<WalletRow> & Pick<WalletRow, "id">): WalletRow {
  return {
    status: "ok",
    enabled: true,
    linked: true,
    eligibleForLiveOps: false,
    blockingReasons: [],
    requiresHealthyIds: [],
    ...partial,
  };
}

test("rapid autopilot blocks live mode when Telegram target file is empty", async () => {
  const mod = await import("../src/seller/runtime/rapidRecoveryAutopilot.js");
  const decision = mod.evaluateRapidRecoveryAutopilot({
    walletReport: {
      rows: [
        buildRow({
          id: "virtual-root-market",
          eligibleForLiveOps: true,
          requiresHealthyIds: ["rapid-recovery-router"],
        }),
        buildRow({
          id: "rapid-recovery-router",
          status: "needs_topup",
        }),
      ],
    },
    telegramTargetCount: 0,
  });

  assert.equal(decision.mode, "dry-run");
  assert.equal(decision.buyerId, "virtual-root-market");
  assert.match(decision.blockingReasons.join(","), /telegram_targets_empty/);
});

test("rapid autopilot allows live mode only when buyer is healthy and required seller is reachable", async () => {
  const mod = await import("../src/seller/runtime/rapidRecoveryAutopilot.js");
  const decision = mod.evaluateRapidRecoveryAutopilot({
    walletReport: {
      rows: [
        buildRow({
          id: "virtual-root-market",
          eligibleForLiveOps: true,
          requiresHealthyIds: ["rapid-recovery-router"],
        }),
        buildRow({
          id: "rapid-recovery-router",
          status: "needs_topup",
          blockingReasons: ["below_min_usdc"],
        }),
      ],
    },
    telegramTargetCount: 2,
  });

  assert.equal(decision.mode, "live");
  assert.equal(decision.buyerId, "virtual-root-market");
  assert.equal(decision.liveModes.telegramLive, true);
  assert.equal(decision.liveModes.leadBountyLive, true);
  assert.deepEqual(decision.blockingReasons, []);
});

test("rapid autopilot blocks live mode when buyer wallet is below threshold", async () => {
  const mod = await import("../src/seller/runtime/rapidRecoveryAutopilot.js");
  const decision = mod.evaluateRapidRecoveryAutopilot({
    walletReport: {
      rows: [
        buildRow({
          id: "virtual-root-market",
          status: "needs_topup",
          eligibleForLiveOps: false,
          blockingReasons: ["below_min_usdc"],
          requiresHealthyIds: ["rapid-recovery-router"],
        }),
        buildRow({
          id: "rapid-recovery-router",
          status: "ok",
        }),
      ],
    },
    telegramTargetCount: 2,
  });

  assert.equal(decision.mode, "dry-run");
  assert.match(decision.blockingReasons.join(","), /buyer:below_min_usdc/);
});

test("rapid autopilot blocks live mode when required seller wallet is unreachable", async () => {
  const mod = await import("../src/seller/runtime/rapidRecoveryAutopilot.js");
  const decision = mod.evaluateRapidRecoveryAutopilot({
    walletReport: {
      rows: [
        buildRow({
          id: "virtual-root-market",
          eligibleForLiveOps: true,
          requiresHealthyIds: ["rapid-recovery-router"],
        }),
        buildRow({
          id: "rapid-recovery-router",
          status: "fetch_error",
          linked: false,
          blockingReasons: ["fetch_error"],
        }),
      ],
    },
    telegramTargetCount: 2,
  });

  assert.equal(decision.mode, "dry-run");
  assert.match(decision.blockingReasons.join(","), /dependency:rapid-recovery-router:fetch_error/);
});
