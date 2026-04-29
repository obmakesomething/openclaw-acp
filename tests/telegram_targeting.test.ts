import test from "node:test";
import assert from "node:assert/strict";

test("collector extracts unique telegram chats from mixed getUpdates payload", async () => {
  const targeting = await import("../src/seller/runtime/telegramTargeting.js").catch(() => null);
  assert.ok(targeting, "telegramTargeting module should exist");

  const rows = targeting.extractTelegramSeedCandidates({
    ok: true,
    result: [
      {
        update_id: 1,
        message: {
          chat: {
            id: 1001,
            type: "private",
            username: "alice_ops",
            first_name: "Alice",
          },
        },
      },
      {
        update_id: 2,
        edited_message: {
          chat: {
            id: 1001,
            type: "private",
            username: "alice_ops",
            first_name: "Alice",
          },
        },
      },
      {
        update_id: 3,
        my_chat_member: {
          chat: {
            id: -1009876543210,
            type: "supergroup",
            title: "ACP Seller Ops",
          },
        },
      },
      {
        update_id: 4,
        inline_query: {
          id: "ignored",
        },
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    chatId: "-1009876543210",
    name: "ACP Seller Ops",
    chatType: "supergroup",
    source: "getUpdates",
    language: "en",
    enabled: false,
    note: "review before adding to rapid_recovery_telegram_targets.json",
  });
  assert.deepEqual(rows[1], {
    chatId: "1001",
    name: "Alice",
    username: "alice_ops",
    chatType: "private",
    source: "getUpdates",
    language: "en",
    enabled: false,
    note: "review before adding to rapid_recovery_telegram_targets.json",
  });
});

test("outbound message defaults to English and supports Korean override", async () => {
  const targeting = await import("../src/seller/runtime/telegramTargeting.js").catch(() => null);
  assert.ok(targeting, "telegramTargeting module should exist");

  const english = targeting.buildRapidRecoveryTelegramMessage({
    chatId: "1001",
    name: "Alice",
  });
  const korean = targeting.buildRapidRecoveryTelegramMessage({
    chatId: "1002",
    name: "민수",
    language: "ko",
  });

  assert.match(english, /Hi Alice,/);
  assert.match(english, /One-line recovery/);
  assert.match(english, /0\.02 Hotfix -> 0\.05 Turbo -> 0\.12 Guardrail/);

  assert.match(korean, /안녕하세요 민수님,/);
  assert.match(korean, /원인 분류/);
  assert.match(korean, /0\.02 진입\(Hotfix\) -> 0\.05 Turbo -> 0\.12 Guardrail/);
});
