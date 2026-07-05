#!/usr/bin/env bash
# Build Next.js standalone + stage assets for Tauri (frontendDist must not contain node_modules).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

unset VERCEL
export NODE_ENV=production

# Ensure Prisma engines + sharp platform packages match the desktop target.
# CI macOS runners are Apple Silicon; Intel/universal bundles need x86_64 natives too.
ensure_native_deps() {
  echo "[prepare-tauri-bundle] Ensuring native deps for desktop target…"
  bun run db:generate

  if [[ "${APICAL_UNIVERSAL_MAC:-0}" == "1" ]]; then
    bun add --no-save @img/sharp-darwin-x64 @img/sharp-libvips-darwin-x64
  elif [[ "${APICAL_NODE_TRIPLES:-}" == *x86_64-apple-darwin* ]]; then
    bun add --no-save @img/sharp-darwin-x64 @img/sharp-libvips-darwin-x64
  fi
}

stage_native_modules() {
  local stage="$1"
  mkdir -p "$stage/node_modules/.prisma/client" "$stage/node_modules/@img"

  for engine in "$ROOT/node_modules/.prisma/client"/libquery_engine-darwin*.dylib.node; do
    [[ -f "$engine" ]] || continue
    cp "$engine" "$stage/node_modules/.prisma/client/"
  done

  for pkg in sharp-darwin-arm64 sharp-darwin-x64 sharp-libvips-darwin-arm64 sharp-libvips-darwin-x64; do
    local src="$ROOT/node_modules/@img/$pkg"
    [[ -d "$src" ]] || continue
    rm -rf "$stage/node_modules/@img/$pkg"
    cp -R "$src" "$stage/node_modules/@img/$pkg"
  done
}

ensure_native_deps

echo "[prepare-tauri-bundle] Building Next.js standalone…"
bun run build

STAGE="$ROOT/src-tauri/bundle-resources/standalone"
APP_DIST="$ROOT/src-tauri/app-dist"

rm -rf "$STAGE" "$APP_DIST"
mkdir -p "$STAGE" "$APP_DIST"

echo "[prepare-tauri-bundle] Staging standalone server to bundle-resources…"
cp -R .next/standalone/. "$STAGE/"
stage_native_modules "$STAGE"

mkdir -p "$STAGE/prisma"
if [[ -f prisma/schema.prisma ]]; then
  cp prisma/schema.prisma "$STAGE/prisma/"
fi

# Desktop uses a runtime DATABASE_URL (see lib.rs). Skip prisma db push here —
# the bundled schema targets Postgres and CI has no local DB for initialization.

cat > "$APP_DIST/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Apical</title>
    <style>
      body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa; }
    </style>
  </head>
  <body>
    <p>Starting Apical…</p>
    <script>
      const target = 'http://127.0.0.1:3000/api/auth/desktop-ui';
      function go() {
        fetch(target, { mode: 'no-cors' }).then(() => { location.href = target; }).catch(() => setTimeout(go, 500));
      }
      go();
    </script>
  </body>
</html>
EOF

echo "[prepare-tauri-bundle] Done (app-dist + bundle-resources/standalone)."
