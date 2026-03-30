#!/bin/zsh

set -euo pipefail

ROOT="/Users/daeyounglee/Projects/ACP/acp-agents/virtuals-protocol-acp-buyer"
NPX_BIN="/opt/homebrew/bin/npx"
LOG_PATH="$ROOT/logs/seller-keepalive.log"

mkdir -p "$ROOT/logs"
cd "$ROOT"

STATUS_JSON="$($NPX_BIN tsx bin/acp.ts serve status --json 2>/dev/null || true)"

if [[ "$STATUS_JSON" == *"\"running\":true"* ]]; then
  exit 0
fi

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] seller not running, attempting restart"
  $NPX_BIN tsx bin/acp.ts serve start --json
} >>"$LOG_PATH" 2>&1
