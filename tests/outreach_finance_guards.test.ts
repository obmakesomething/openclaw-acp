import test from "node:test";
import assert from "node:assert/strict";
import { __testables } from "../src/seller/runtime/outreachEngines.js";

test("recovery gate blocks next wave when previous wave had no recovery signals", () => {
  const blocked = __testables.evaluateRecoveryGate(
    [
      {
        waveId: "wave-1",
        createdAt: "2026-03-02T08:00:00.000Z",
        dateKey: "2026-03-02",
        externalSpendUsdc: 0.2,
        internalSpendUsdc: 0.1,
        submittedCount: 2,
        recoverySignals: 0,
        targetAgentName: "test-agent",
        mode: "live-dispatch",
      },
    ],
    true
  );
  assert.equal(blocked.blocked, true);
  assert.match(blocked.reason ?? "", /previous wave/i);
});

test("recovery gate allows dispatch when previous wave has recovery signals", () => {
  const allowed = __testables.evaluateRecoveryGate(
    [
      {
        waveId: "wave-2",
        createdAt: "2026-03-02T09:00:00.000Z",
        dateKey: "2026-03-02",
        externalSpendUsdc: 0.2,
        internalSpendUsdc: 0.1,
        submittedCount: 2,
        recoverySignals: 3,
        targetAgentName: "test-agent",
        mode: "live-dispatch",
      },
    ],
    true
  );
  assert.equal(allowed.blocked, false);
});

test("daily pnl aggregates spend and computes net", () => {
  const report = __testables.computeDailyPnl(
    [
      {
        waveId: "wave-a",
        createdAt: "2026-03-02T08:00:00.000Z",
        dateKey: "2026-03-02",
        externalSpendUsdc: 0.3,
        internalSpendUsdc: 0.2,
        submittedCount: 3,
        recoverySignals: 1,
        targetAgentName: "test-agent",
        mode: "live-dispatch",
      },
      {
        waveId: "wave-b",
        createdAt: "2026-03-02T10:00:00.000Z",
        dateKey: "2026-03-02",
        externalSpendUsdc: 0.1,
        internalSpendUsdc: 0.05,
        submittedCount: 1,
        recoverySignals: 0,
        targetAgentName: "test-agent",
        mode: "live-dispatch",
      },
    ],
    "2026-03-02"
  );

  assert.equal(report.external_spend_usdc, 0.4);
  assert.equal(report.internal_spend_usdc, 0.25);
  assert.equal(report.recovered_usdc, 0);
  assert.equal(report.net_usdc, -0.4);
  assert.equal(report.wave_count, 2);
});

test("provider guard excludes high-cost providers and enforces daily external cap", () => {
  const providers = [
    {
      agentName: "cheap",
      walletAddress: "0x1111111111111111111111111111111111111111",
      offeringName: "promote_agent",
      priceUsdc: 0.02,
      successRate: 0.5,
      successfulJobs: 5,
      uniqueBuyers: 3,
      online: true,
    },
    {
      agentName: "expensive",
      walletAddress: "0x2222222222222222222222222222222222222222",
      offeringName: "promote_agent",
      priceUsdc: 0.2,
      successRate: 0.8,
      successfulJobs: 20,
      uniqueBuyers: 10,
      online: true,
    },
  ];

  const result = __testables.applyProviderGuards(providers, {
    ownedWallets: new Set<string>(),
    maxTargets: 3,
    highCostThresholdUsdc: 0.05,
    dailyExternalSpentUsdc: 0.29,
    dailyExternalCapUsdc: 0.3,
  });

  assert.equal(result.selectedProviders.length, 0);
  assert.equal(result.excludedHighCost.length, 1);
  assert.equal(result.blockedByDailyCap.length, 1);
});

test("python candidate resolution keeps command names and filters missing absolute paths", () => {
  const candidates = __testables.resolvePythonCandidates({
    env: {
      PYTHON_BIN: "/custom/python3",
    },
    existsSync: (candidate: string) =>
      candidate === "/custom/python3" || candidate === "/usr/bin/python3",
  });

  assert.deepEqual(candidates, ["/custom/python3", "python3", "python", "/usr/bin/python3"]);
});

test("OpenHands worker path resolution falls back to bundled worker", () => {
  const workerPath = __testables.resolveOpenHandsWorkerPath({
    env: {
      OPENHANDS_WORKER_PATH: "",
    },
    runtimeDir: "/repo/src/seller/runtime",
    defaultWorkerPath: "/legacy/agent_framework_worker.py",
    existsSync: (candidate: string) => candidate === "/repo/src/seller/runtime/agent_framework_worker.py",
  });

  assert.equal(workerPath, "/repo/src/seller/runtime/agent_framework_worker.py");
});

test("OpenHands worker path resolution returns null when no candidate exists", () => {
  const workerPath = __testables.resolveOpenHandsWorkerPath({
    env: {},
    runtimeDir: "/repo/src/seller/runtime",
    defaultWorkerPath: "/legacy/agent_framework_worker.py",
    existsSync: () => false,
  });

  assert.equal(workerPath, null);
});
