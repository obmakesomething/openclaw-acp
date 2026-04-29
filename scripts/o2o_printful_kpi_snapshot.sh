#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="${1:-$ROOT_DIR/docs/o2o-printful-hub-daily-kpi.csv}"

if ! command -v acp >/dev/null 2>&1; then
  echo "acp CLI not found in PATH"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found in PATH"
  exit 1
fi

if [[ -z "${LITE_AGENT_API_KEY:-}" ]]; then
  echo "LITE_AGENT_API_KEY is required"
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"

if [[ ! -f "$OUT_FILE" ]]; then
  echo "date,successful_jobs_total,unique_buyers_total,success_rate_pct,wallet_usdc,micro_jobs,quick_jobs,pro_jobs,enterprise_jobs,micro_to_quick_rate,quick_to_pro_rate,pro_to_enterprise_rate,notes" >"$OUT_FILE"
fi

TODAY="$(TZ=Asia/Seoul date +%F)"

BROWSE_JSON="$(cd "$ROOT_DIR" && acp browse "o2o-printful-hub" --top-k 10 --mode hybrid --json)"
METRICS_JSON="$(echo "$BROWSE_JSON" | jq '[.[] | select(.name=="o2o-printful-hub")][0]')"

SUCCESSFUL_JOBS="$(echo "$METRICS_JSON" | jq -r '.metrics.successfulJobCount // 0')"
UNIQUE_BUYERS="$(echo "$METRICS_JSON" | jq -r '.metrics.uniqueBuyerCount // 0')"
SUCCESS_RATE="$(echo "$METRICS_JSON" | jq -r '.metrics.successRate // 0')"

WALLET_JSON="$(cd "$ROOT_DIR" && acp wallet balance --json)"
USDC_HEX="$(echo "$WALLET_JSON" | jq -r '[.[] | select(.tokenMetadata.symbol=="USDC")][0].tokenBalance // "0x0"')"
WALLET_USDC="$(python3 - "$USDC_HEX" <<'PY'
import sys

hex_str = (sys.argv[1] or "0x0").strip().lower()
if hex_str.startswith("0x"):
    raw = int(hex_str, 16)
else:
    raw = int(hex_str or "0")
print(f"{raw / 1_000_000:.6f}")
PY
)"

printf "%s,%s,%s,%s,%s,,,,,,,\n" \
  "$TODAY" \
  "$SUCCESSFUL_JOBS" \
  "$UNIQUE_BUYERS" \
  "$SUCCESS_RATE" \
  "$WALLET_USDC" >>"$OUT_FILE"

echo "Snapshot appended to $OUT_FILE"
