#!/usr/bin/env bash
# Build a drag-to-Applications DMG for Apical (.app path, output .dmg path).
set -euo pipefail

APP="${1:?usage: create-mac-dmg.sh /path/Apical.app /path/out.dmg}"
OUT="${2:?usage: create-mac-dmg.sh /path/Apical.app /path/out.dmg}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

APP_NAME="$(basename "$APP")"
cp -R "$APP" "$STAGE/"
rm -f "$OUT"

VOLICON="$ROOT/src-tauri/icons/icon.icns"
ICON_ARGS=()
if [[ -f "$VOLICON" ]]; then
  ICON_ARGS=(--volicon "$VOLICON")
fi

if command -v create-dmg >/dev/null 2>&1; then
  create-dmg \
    --volname "Apical" \
    "${ICON_ARGS[@]}" \
    --window-pos 200 120 \
    --window-size 660 400 \
    --icon-size 128 \
    --icon "$APP_NAME" 180 200 \
    --hide-extension "$APP_NAME" \
    --app-drop-link 480 200 \
    --no-internet-enable \
    "$OUT" \
    "$STAGE"
else
  ln -s /Applications "$STAGE/Applications"
  hdiutil create -volname "Apical" -srcfolder "$STAGE" -ov -format UDZO "$OUT"
fi

echo "Created $OUT"
