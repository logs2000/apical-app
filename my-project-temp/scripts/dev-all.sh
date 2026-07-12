#!/usr/bin/env bash
# Local dev: boot Next + all bundled mini-services together with ONE command.
#
# Previously `bun run dev` started only Next, so a developer got a broken app —
# no chat answers (agent-worker down), no live streaming (relay down), no
# schedules (scheduler down). This starts the full stack. Each mini-service
# loads the root .env explicitly via `bun --env-file`; Next auto-loads it.
#
# apical-mcp is intentionally NOT started here — it's a stdio MCP server that
# runs inside the developer's editor (Cursor/Claude Desktop), not a network
# service in the app stack.
#
# Ctrl-C stops everything.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"

pids=()
cleanup() {
  echo
  echo "[dev:all] stopping…"
  kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

start_service() {
  local name="$1" dir="$2"
  echo "[dev:all] starting $name"
  (
    cd "$dir" && exec bun --env-file="$ENV_FILE" --hot index.ts 2>&1 | sed "s/^/[$name] /"
  ) &
  pids+=($!)
}

start_service run-relay      "$ROOT/mini-services/run-relay"
start_service scheduler      "$ROOT/mini-services/scheduler"
start_service desktop-bridge "$ROOT/mini-services/desktop-bridge"
start_service agent-worker   "$ROOT/mini-services/agent-worker"

echo "[dev:all] starting next (foreground) on http://127.0.0.1:3000"
exec next dev --webpack -p 3000 -H 127.0.0.1
