import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function runDryProfileUpdate(kpi: Record<string, unknown>) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rapid-profile-"));
  const kpiPath = path.join(tempDir, "kpi.json");
  fs.writeFileSync(kpiPath, JSON.stringify(kpi), "utf8");
  const output = execFileSync(
    "npx",
    ["tsx", "scripts/rapid_recovery_profile_daily_update.ts", "--kpi-json", kpiPath, "--dry-run"],
    {
      cwd: "/Users/daeyounglee/virtuals-protocol-acp-buyer",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return JSON.parse(output) as { dryRun: true; description: string };
}

test("profile description hides weak zero-proof lines and leads with search keywords", () => {
  const result = runDryProfileUpdate({
    external_jobs_24h: 0,
    avg_processing_seconds_24h: 0,
    representative_success_case_24h: null,
  });

  assert.match(result.description, /Rapid Recovery Router/i);
  assert.match(result.description, /ACP|retry|validation|timeout|rejected/i);
  assert.equal(result.description.includes("최근 24h 외부 유료건수: 0건"), false);
  assert.equal(result.description.includes("평균 처리시간: 0s"), false);
  assert.equal(result.description.includes("대표 성공 케이스: none"), false);
  assert.match(result.description, /0\.02.*0\.05.*0\.12/);
});

test("profile description includes proof only when there is real activity", () => {
  const result = runDryProfileUpdate({
    external_jobs_24h: 3,
    avg_processing_seconds_24h: 42,
    representative_success_case_24h: {
      offering: "ops_recovery_hotfix_openrouter_v1",
      priceUsdc: 0.02,
      recommendedNextTier: "turbo",
    },
  });

  assert.match(result.description, /최근 24h 외부 유료건수: 3건/);
  assert.match(result.description, /평균 처리시간: 42s/);
  assert.match(result.description, /ops_recovery_hotfix_openrouter_v1 0\.02 USDC \/ next=turbo/);
});
