#!/usr/bin/env bash
# Build (if needed) and start the production Next.js server for Tauri.
# macOS 12 WebView (Safari 15) cannot run Next.js *dev* bundles — production only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

URL="http://127.0.0.1:3000/api/auth/desktop-ui"

# Load optional env first, then pin desktop auth (must win over .env overrides).
if [[ -f "$ROOT/../.env" ]]; then set -a; source "$ROOT/../.env"; set +a; fi
if [[ -f "$ROOT/.env.local" ]]; then set -a; source "$ROOT/.env.local"; set +a; fi

export NODE_ENV=production
export DESKTOP_LOCAL=true
export AUTH_BYPASS_DEV=true
export DATABASE_URL="file:${ROOT}/prisma/dev.db"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-dev-local-secret}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://127.0.0.1:3000}"
export PORT=3000
export HOSTNAME=127.0.0.1

check_auth_page() {
  local body
  body="$(curl -sf "$URL" 2>/dev/null || true)"
  [[ -n "$body" ]] && echo "$body" | grep -q 'method="POST"'
}

check_api_auth() {
  local code
  code="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/api/workflows" 2>/dev/null || echo "000")"
  [[ "$code" == "200" ]]
}

current_build_id() {
  if [[ -f "$ROOT/.next/BUILD_ID" ]]; then
    cat "$ROOT/.next/BUILD_ID"
  else
    echo ""
  fi
}

running_build_id() {
  local stamp="$ROOT/.next/standalone/.next/.running-build-id"
  if [[ -f "$stamp" ]]; then
    cat "$stamp"
  else
    echo ""
  fi
}

source_tree_hash() {
  if command -v shasum >/dev/null 2>&1; then
    find "$ROOT/src" "$ROOT/scripts" "$ROOT/next.config.ts" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.sh' -o -name '*.css' -o -name '*.mjs' -o -name 'next.config.ts' \) -print0 2>/dev/null \
      | sort -z \
      | xargs -0 stat -f '%m %N' 2>/dev/null \
      | shasum \
      | awk '{print $1}'
  else
    date +%s
  fi
}

running_source_hash() {
  local stamp="$ROOT/.next/standalone/.next/.source-tree-hash"
  if [[ -f "$stamp" ]]; then
    cat "$stamp"
  else
    echo ""
  fi
}

needs_rebuild() {
  local built running
  built="$(current_build_id)"
  running="$(running_build_id)"
  [[ -n "$built" && "$built" != "$running" ]]
}

needs_source_rebuild() {
  local current running
  current="$(source_tree_hash)"
  running="$(running_source_hash)"
  [[ -n "$current" && "$current" != "$running" ]]
}

is_webpack_dev() {
  curl -sf --max-time 2 "http://127.0.0.1:3000/_next/static/chunks/webpack.js" >/dev/null 2>&1
}

wait_for_build_lock() {
  local lock="$ROOT/.next/lock"
  local i=0
  while [[ -f "$lock" ]] && [[ $i -lt 40 ]]; do
    echo "[ensure-prod-server] Waiting for in-progress build…"
    sleep 3
    i=$((i + 1))
  done
  if [[ -f "$lock" ]]; then
    echo "[ensure-prod-server] Removing stale build lock"
    rm -f "$lock"
  fi
}

run_build() {
  wait_for_build_lock
  npm run build
}

write_standalone_env() {
  local dest="$ROOT/.next/standalone/.env.local"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<EOF
DESKTOP_LOCAL=true
AUTH_BYPASS_DEV=true
NODE_ENV=production
DATABASE_URL=file:${ROOT}/prisma/dev.db
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXTAUTH_URL=${NEXTAUTH_URL}
EOF
  if [[ -n "${APICAL_PAT:-}" ]]; then
    echo "APICAL_PAT=${APICAL_PAT}" >> "$dest"
  fi
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "OPENAI_API_KEY=${OPENAI_API_KEY}" >> "$dest"
  fi
}

# Webpack dev server breaks the Tauri WebView — always replace it with production.
if is_webpack_dev; then
  echo "[ensure-prod-server] Stopping webpack dev server (required for Tauri on macOS 12)…"
  lsof -ti :3000 | xargs kill -9 2>/dev/null || true
  sleep 2
fi

export NODE_ENV=production

if needs_rebuild || needs_source_rebuild; then
  if needs_source_rebuild; then
    echo "[ensure-prod-server] Source changed since last build — rebuilding…"
    run_build
  elif needs_rebuild; then
    echo "[ensure-prod-server] Stale production server (BUILD_ID mismatch) — restarting…"
  fi
  lsof -ti :3000 | xargs kill -9 2>/dev/null || true
  sleep 2
fi

if check_auth_page && check_api_auth && ! is_webpack_dev && ! needs_rebuild && ! needs_source_rebuild; then
  echo "[ensure-prod-server] Production server already running at $URL"
  exit 0
fi

if [[ ! -f .next/standalone/server.js ]]; then
  echo "[ensure-prod-server] Building production bundle (first run may take ~1 min)…"
  run_build
fi

write_standalone_env

echo "[ensure-prod-server] Starting production server on 127.0.0.1:3000…"
mkdir -p .next/standalone/.next
cp "$ROOT/.next/BUILD_ID" .next/standalone/.next/.running-build-id
source_tree_hash > .next/standalone/.next/.source-tree-hash
cd .next/standalone
exec node server.js
