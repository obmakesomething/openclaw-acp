#!/usr/bin/env npx tsx

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  extractTelegramSeedCandidates,
  loadTelegramTargets,
  mergeTelegramTargets,
} from "../src/seller/runtime/telegramTargeting.js";

type CliOptions = {
  outFile: string;
  limit: number;
  offset?: number;
};

const DEFAULT_OUT = path.resolve(
  process.cwd(),
  "data",
  "rapid_recovery_telegram_seed_candidates.json"
);

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    outFile: DEFAULT_OUT,
    limit: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out-file") {
      const next = argv[i + 1];
      if (!next) throw new Error("--out-file requires a path");
      out.outFile = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (token === "--limit") {
      const next = Number(argv[i + 1]);
      if (!Number.isFinite(next) || next <= 0) throw new Error("--limit must be > 0");
      out.limit = Math.round(next);
      i += 1;
      continue;
    }
    if (token === "--offset") {
      const next = Number(argv[i + 1]);
      if (!Number.isFinite(next)) throw new Error("--offset must be a number");
      out.offset = Math.round(next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return out;
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }

  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`);
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) {
    const reason = payload?.description || `http ${response.status}`;
    throw new Error(`Telegram getUpdates failed: ${reason}`);
  }

  const discovered = extractTelegramSeedCandidates(payload);
  const existing = loadTelegramTargets(readJson(options.outFile));
  const merged = mergeTelegramTargets(existing, discovered);
  writeJson(options.outFile, merged);

  process.stdout.write(
    `${JSON.stringify(
      {
        updateCount: Array.isArray(payload?.result) ? payload.result.length : 0,
        discoveredCount: discovered.length,
        mergedCount: merged.length,
        outFile: options.outFile,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
