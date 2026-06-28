#!/usr/bin/env bash
# Start the Next.js dev server unless one is already responding on :3000.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="http://127.0.0.1:3000/api/auth/desktop-ui"

check_server() {
  local body
  body="$(curl -sf "$URL" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    return 1
  fi
  # Auth page must be zero-JS HTML (Safari 15 WebView cannot run Next dev bundles).
  if echo "$body" | grep -q '<script'; then
    echo "[ensure-dev-server] Server at $URL returned JS — wrong page or stale build."
    return 1
  fi
  if ! echo "$body" | grep -q 'method="POST"'; then
    echo "[ensure-dev-server] Server at $URL is not the desktop auth page."
    return 1
  fi
  return 0
}

if check_server; then
  echo "[ensure-dev-server] Dev server already running at $URL"
  exit 0
fi

if curl -sf "http://localhost:3000/" >/dev/null 2>&1; then
  echo "[ensure-dev-server] ERROR: Something is listening on localhost:3000 but not serving desktop auth at 127.0.0.1."
  echo "[ensure-dev-server] Stop it (Ctrl+C in that terminal), then run: npm run tauri:dev"
  echo "[ensure-dev-server] Do NOT use npm run dev:turbo for the desktop app."
  exit 1
fi

echo "[ensure-dev-server] Starting Next.js dev server (webpack on 127.0.0.1:3000)…"
exec npm run dev
