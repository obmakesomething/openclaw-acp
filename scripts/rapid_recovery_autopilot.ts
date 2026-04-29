#!/usr/bin/env npx tsx

import dotenv from "dotenv";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  evaluateRapidRecoveryAutopilot,
  type RapidRecoveryAutopilotDecision,
  type WalletOpsReport,
} from "../src/seller/runtime/rapidRecoveryAutopilot.js";
import {
  isTelegramTargetEnabled,
  loadTelegramTargets,
} from "../src/seller/runtime/telegramTargeting.js";

type CliOptions = {
  walletRoot: string;
  walletReportFile: string;
  targetsFile: string;
  summaryPath: string;
  dryRun: boolean;
};

type StepResult = {
  name: string;
  command: string;
  output?: unknown;
  error?: string;
};

const DEFAULT_WALLET_ROOT = path.resolve(process.cwd(), "..", "virtual");
const DEFAULT_TARGETS_FILE = path.resolve(process.cwd(), "data", "rapid_recovery_telegram_targets.json");
const DEFAULT_SUMMARY_PATH = path.resolve(
  process.cwd(),
  "logs",
  "rapid_recovery_autopilot_latest.json"
);

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    walletRoot: DEFAULT_WALLET_ROOT,
    walletReportFile: "",
    targetsFile: DEFAULT_TARGETS_FILE,
    summaryPath: DEFAULT_SUMMARY_PATH,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--wallet-root") {
      out.walletRoot = path.resolve(process.cwd(), argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--wallet-report-file") {
      out.walletReportFile = path.resolve(process.cwd(), argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--targets-file") {
      out.targetsFile = path.resolve(process.cwd(), argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--summary-path") {
      out.summaryPath = path.resolve(process.cwd(), argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return out;
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function runStep(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): StepResult {
  try {
    const output = execFileSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      name,
      command: [command, ...args].join(" "),
      output: output.trim() ? parseMaybeJson(output) : "",
    };
  } catch (error) {
    return {
      name,
      command: [command, ...args].join(" "),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function loadWalletReport(options: CliOptions): WalletOpsReport {
  if (options.walletReportFile) {
    return readJson<WalletOpsReport>(options.walletReportFile, { rows: [] });
  }
  const output = execFileSync(
    "node",
    [path.resolve(options.walletRoot, "scripts", "acp-wallet-report.js"), "--json"],
    {
      cwd: options.walletRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return JSON.parse(output) as WalletOpsReport;
}

function countEnabledTelegramTargets(filePath: string): number {
  const rows = loadTelegramTargets(readJson<unknown>(filePath, []));
  return rows.filter((row) => isTelegramTargetEnabled(row)).length;
}

function writeSummary(filePath: string, summary: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`);
}

function stepSucceeded(step: StepResult): boolean {
  if (step.error) return false;
  if (step.output && typeof step.output === "object" && "ok" in step.output) {
    return (step.output as { ok?: unknown }).ok !== false;
  }
  return true;
}

function runDryRunDailyOps(env: NodeJS.ProcessEnv): StepResult {
  return runStep(
    "rapid_daily_dry_run",
    "npx",
    ["tsx", "scripts/rapid_recovery_daily_ops.ts", "--dry-run"],
    process.cwd(),
    env
  );
}

function liveEnv(baseEnv: NodeJS.ProcessEnv, buyerApiKey: string): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    LITE_AGENT_API_KEY: buyerApiKey,
    RAPID_RECOVERY_TELEGRAM_LIVE: "1",
    RAPID_RECOVERY_LEAD_BOUNTY_LIVE: "1",
  };
}

function rapidSellerEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...baseEnv };
  delete next.LITE_AGENT_API_KEY;
  return next;
}

function buildLiveSteps(baseEnv: NodeJS.ProcessEnv, buyerApiKey: string): StepResult[] {
  const nowKey = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const kpiJson = path.resolve(process.cwd(), "logs", `rapid_recovery_kpi_${nowKey}.json`);
  const kpiCsv = path.resolve(process.cwd(), "logs", `rapid_recovery_kpi_${nowKey}.csv`);
  const buyerEnv = liveEnv(baseEnv, buyerApiKey);
  const steps: StepResult[] = [];

  steps.push(
    runStep(
      "openrouter_free_apply_deploy",
      "node",
      ["scripts/openrouter_free_daily_check.mjs", "--apply", "--deploy"],
      process.cwd(),
      baseEnv
    )
  );

  if (steps.some((step) => step.error)) return steps;

  steps.push(
    runStep(
      "kpi_report",
      "npx",
      [
        "tsx",
        "scripts/rapid_recovery_kpi_report.ts",
        "--window-hours",
        "24",
        "--output-json",
        kpiJson,
        "--output-csv",
        kpiCsv,
      ],
      process.cwd(),
      baseEnv
    )
  );

  if (steps.some((step) => step.error)) return steps;

  steps.push(
    runStep(
      "profile_daily_update",
      "npx",
      ["tsx", "scripts/rapid_recovery_profile_daily_update.ts", "--kpi-json", kpiJson],
      process.cwd(),
      baseEnv
    )
  );

  if (steps.some((step) => step.error)) return steps;

  steps.push(
    runStep(
      "lead_bounty_loop",
      "npx",
      [
        "tsx",
        "scripts/rapid_recovery_lead_bounty_loop.ts",
        "--daily-budget-cap",
        "0.1",
        "--max-daily-bounties",
        "1",
        "--auto-select-price-cap",
        "0.1",
      ],
      process.cwd(),
      buyerEnv
    )
  );

  if (steps.some((step) => step.error)) return steps;

  steps.push(
    runStep(
      "telegram_outbound",
      "npx",
      ["tsx", "scripts/rapid_recovery_telegram_outbound.ts", "--daily-send-cap", "15"],
      process.cwd(),
      buyerEnv
    )
  );

  return steps;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  dotenv.config({ path: path.resolve(options.walletRoot, ".env"), override: false });
  const rapidEnv = rapidSellerEnv(process.env);

  const walletReport = loadWalletReport(options);
  const telegramTargetCount = countEnabledTelegramTargets(options.targetsFile);
  const decision = evaluateRapidRecoveryAutopilot({
    walletReport,
    telegramTargetCount,
  });

  const summary: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    walletRoot: options.walletRoot,
    walletReportFile: options.walletReportFile || null,
    targetsFile: options.targetsFile,
    summaryPath: options.summaryPath,
    forcedDryRun: options.dryRun,
    liveCaps: {
      telegramDailySendCap: 15,
      leadBountyDailyBudgetCapUsdc: 0.1,
      acpJobPriceCapUsdc: 0.1,
    },
    decision,
    steps: [] as StepResult[],
  };

  const buyerApiKey = String(process.env.OPS_BUYER_HUB_API_KEY || "").trim();
  let runMode: RapidRecoveryAutopilotDecision["mode"] = decision.mode;
  let steps: StepResult[] = [];

  if (options.dryRun) {
    runMode = "dry-run";
    steps = [runDryRunDailyOps(rapidEnv)];
  } else if (decision.mode === "live" && !buyerApiKey) {
    const fallbackDecision = {
      ...decision,
      mode: "dry-run" as const,
      blockingReasons: [...decision.blockingReasons, "buyer:secret_missing"],
      liveModes: {
        telegramLive: false,
        leadBountyLive: false,
      },
    };
    summary.decision = fallbackDecision;
    runMode = "dry-run";
    steps = [runDryRunDailyOps(rapidEnv)];
  } else if (decision.mode === "live") {
    steps = buildLiveSteps(rapidEnv, buyerApiKey);
  } else {
    steps = [runDryRunDailyOps(rapidEnv)];
  }

  summary.runMode = runMode;
  summary.steps = steps;
  summary.ok = steps.every((step) => stepSucceeded(step));

  writeSummary(options.summaryPath, summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
