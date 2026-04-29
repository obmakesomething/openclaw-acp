#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const USDC_DECIMALS = 6n;

function defaultConfigPaths() {
  const cwdConfig = path.resolve(process.cwd(), "config.json");
  const externalConfig = path.resolve(process.cwd(), "../virtuals-protocol-acp-external-buyer/config.json");
  return [cwdConfig, externalConfig];
}

function readAgentsFromConfig(configPath) {
  if (!fs.existsSync(configPath)) return [];

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];

  return agents
    .filter((agent) => typeof agent?.walletAddress === "string" && agent.walletAddress.startsWith("0x"))
    .map((agent) => ({
      name: String(agent.name || "(unnamed)"),
      walletAddress: String(agent.walletAddress),
      source: configPath,
    }));
}

function formatUnits(raw, decimals) {
  if (raw === 0n) return "0.000000";
  const divisor = 10n ** decimals;
  const whole = raw / divisor;
  const remainder = raw % divisor;
  const fraction = remainder.toString().padStart(Number(decimals), "0").slice(0, Number(decimals));
  return `${whole.toString()}.${fraction}`;
}

function hexToBigInt(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

async function rpc(method, params) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(BASE_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    const body = await response.json();
    if (!body?.error) return body?.result;

    const code = body.error.code ?? "RPC_ERROR";
    const message = body.error.message ?? "Unknown RPC error";
    const isRateLimited = Number(code) === -32016 || /rate limit/i.test(String(message));

    if (!isRateLimited || attempt === maxAttempts) {
      throw new Error(`${code} ${message}`);
    }

    const backoffMs = 200 * 2 ** (attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
  throw new Error("RPC request failed");
}

async function getUsdcBalance(walletAddress) {
  const address = walletAddress.toLowerCase().replace(/^0x/, "").padStart(40, "0");
  const data = `0x70a08231000000000000000000000000${address}`;
  const result = await rpc("eth_call", [{ to: USDC_ADDRESS, data }, "latest"]);
  return hexToBigInt(result);
}

function dedupeAgents(agents) {
  const byWallet = new Map();

  for (const agent of agents) {
    const walletKey = agent.walletAddress.toLowerCase();
    const current = byWallet.get(walletKey);
    if (!current) {
      byWallet.set(walletKey, {
        walletAddress: agent.walletAddress,
        names: [agent.name],
        sources: [agent.source],
      });
      continue;
    }

    if (!current.names.includes(agent.name)) current.names.push(agent.name);
    if (!current.sources.includes(agent.source)) current.sources.push(agent.source);
  }

  return [...byWallet.values()];
}

function pad(value, width) {
  const text = String(value);
  if (text.length >= width) return text;
  return `${text}${" ".repeat(width - text.length)}`;
}

async function main() {
  const inputPaths = process.argv.slice(2);
  const configPaths = inputPaths.length > 0 ? inputPaths.map((p) => path.resolve(process.cwd(), p)) : defaultConfigPaths();

  const agents = configPaths.flatMap((configPath) => readAgentsFromConfig(configPath));
  if (agents.length === 0) {
    console.error("No agents found in provided config files.");
    process.exit(1);
  }

  const uniqueAgents = dedupeAgents(agents);
  const rows = [];
  let totalUsdcRaw = 0n;

  for (const agent of uniqueAgents) {
    const usdcRaw = await getUsdcBalance(agent.walletAddress);
    totalUsdcRaw += usdcRaw;
    rows.push({
      name: agent.names.join(" | "),
      walletAddress: agent.walletAddress,
      usdcRaw,
      sources: agent.sources.length,
    });
  }

  rows.sort((a, b) => {
    if (a.usdcRaw === b.usdcRaw) return a.name.localeCompare(b.name);
    return a.usdcRaw > b.usdcRaw ? -1 : 1;
  });

  console.log(`RPC: ${BASE_RPC_URL}`);
  console.log(`USDC: ${USDC_ADDRESS}`);
  console.log(`Checked at: ${new Date().toISOString()}`);
  console.log("");
  console.log(
    `${pad("Agent", 38)} ${pad("Wallet", 44)} ${pad("USDC", 14)} Sources`
  );
  console.log("-".repeat(106));
  for (const row of rows) {
    console.log(
      `${pad(row.name, 38)} ${pad(row.walletAddress, 44)} ${pad(formatUnits(row.usdcRaw, USDC_DECIMALS), 14)} ${row.sources}`
    );
  }
  console.log("-".repeat(106));
  console.log(`TOTAL_USDC: ${formatUnits(totalUsdcRaw, USDC_DECIMALS)}`);
  console.log(`UNIQUE_WALLETS: ${rows.length}`);
}

main().catch((error) => {
  console.error(`aggregate_agent_usdc failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
