#!/usr/bin/env bash
# Build Next.js standalone + stage assets for Tauri (frontendDist must not contain node_modules).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

unset VERCEL
export NODE_ENV=production

echo "[prepare-tauri-bundle] Building Next.js standalone…"
bun run build

STAGE="$ROOT/src-tauri/bundle-resources/standalone"
APP_DIST="$ROOT/src-tauri/app-dist"

rm -rf "$STAGE" "$APP_DIST"
mkdir -p "$STAGE" "$APP_DIST"

echo "[prepare-tauri-bundle] Staging standalone server to bundle-resources…"
cp -R .next/standalone/. "$STAGE/"

mkdir -p "$STAGE/prisma"
if [[ -f prisma/schema.prisma ]]; then
  cp prisma/schema.prisma "$STAGE/prisma/"
fi

# Initialize local SQLite for the bundled desktop app.
(
  cd "$STAGE"
  export DATABASE_URL="file:./prisma/dev.db"
  bunx prisma db push --skip-generate 2>/dev/null || npx prisma db push --skip-generate
)

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
