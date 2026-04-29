import test from "node:test";
import assert from "node:assert/strict";

test("rapid recovery daily ops defaults Telegram and lead bounty to dry-run mode", async () => {
  const phase = await import("../src/seller/runtime/rapidRecoveryDailyPhase.js").catch(() => null);
  assert.ok(phase, "rapidRecoveryDailyPhase module should exist");

  const modes = phase.resolveRapidRecoveryDailyModes({});
  assert.equal(modes.telegramLive, false);
  assert.equal(modes.leadBountyLive, false);
});

test("rapid recovery daily ops enables live mode only via explicit env flags", async () => {
  const phase = await import("../src/seller/runtime/rapidRecoveryDailyPhase.js").catch(() => null);
  assert.ok(phase, "rapidRecoveryDailyPhase module should exist");

  const modes = phase.resolveRapidRecoveryDailyModes({
    RAPID_RECOVERY_TELEGRAM_LIVE: "true",
    RAPID_RECOVERY_LEAD_BOUNTY_LIVE: "1",
  });
  assert.equal(modes.telegramLive, true);
  assert.equal(modes.leadBountyLive, true);
});
