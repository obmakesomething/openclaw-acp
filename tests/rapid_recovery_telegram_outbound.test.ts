import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = "/Users/daeyounglee/virtuals-protocol-acp-buyer";
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const OUTBOUND_SCRIPT = path.join(REPO_ROOT, "scripts", "rapid_recovery_telegram_outbound.ts");

test("telegram outbound dry-run skips disabled rows and writes valid state/log files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rapid-telegram-outbound-"));
  const dataDir = path.join(tempDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const targetsFile = path.join(dataDir, "rapid_recovery_telegram_targets.json");
  fs.writeFileSync(
    targetsFile,
    JSON.stringify(
      [
        {
          chatId: "1001",
          name: "Alice",
        },
        {
          chatId: "1002",
          name: "민수",
          language: "ko",
          enabled: false,
        },
      ],
      null,
      2
    )
  );

  const output = execFileSync(
    TSX_BIN,
    [OUTBOUND_SCRIPT, "--dry-run", "--targets-file", targetsFile],
    {
      cwd: tempDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const parsed = JSON.parse(output) as {
    processedTargets: number;
    logs: Array<{ who: string; result: string; reason?: string }>;
  };
  assert.equal(parsed.processedTargets, 2);
  assert.equal(parsed.logs.length, 2);
  assert.equal(parsed.logs[0]?.result, "dry_run_sent");
  assert.equal(parsed.logs[1]?.result, "skipped");

  const statePath = path.join(tempDir, "logs", "rapid_recovery_telegram_state.json");
  const logPath = path.join(tempDir, "logs", "rapid_recovery_telegram_send_log.jsonl");
  assert.equal(fs.existsSync(statePath), true);
  assert.equal(fs.existsSync(logPath), true);

  const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    halted: boolean;
    totalAttempts: number;
  };
  assert.equal(state.halted, false);
  assert.equal(state.totalAttempts, 1);

  const lines = fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { result: string });
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.result, "dry_run_sent");
  assert.equal(lines[1]?.result, "skipped");
});
