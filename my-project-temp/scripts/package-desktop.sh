#!/usr/bin/env bash
# Package Tauri bundle outputs into the filenames the landing page expects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/downloads"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$OUT"

find_bundle_dir() {
  local marker="$1"
  local candidates=(
    "$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
    "$ROOT/src-tauri/target/release/bundle"
    "$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle"
    "$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -d "$c/$marker" ]]; then
      echo "$c"
      return 0
    fi
    if [[ "$marker" == "windows" && ( -d "$c/nsis" || -d "$c/msi" ) ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

pack_mac() {
  local bundle app
  bundle="$(find_bundle_dir macos)"
  app="$(find "$bundle/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
  if [[ -z "$app" ]]; then
    echo "No macOS .app found under $bundle/macos" >&2
    exit 1
  fi
  rm -f "$OUT/apical-mac.dmg"
  bash "$SCRIPT_DIR/create-mac-dmg.sh" "$app" "$OUT/apical-mac.dmg"
  echo "Wrote $OUT/apical-mac.dmg ($(du -h "$OUT/apical-mac.dmg" | cut -f1))"
}

pack_windows() {
  local bundle exe
  bundle="$(find_bundle_dir windows)"
  exe="$(find "$bundle/nsis" -name '*-setup.exe' -print -quit 2>/dev/null || true)"
  if [[ -z "$exe" ]]; then
    exe="$(find "$bundle/msi" -name '*.msi' -print -quit 2>/dev/null || true)"
  fi
  if [[ -z "$exe" ]]; then
    echo "No Windows installer found under $bundle" >&2
    exit 1
  fi
  cp "$exe" "$OUT/apical-windows.exe"
  echo "Wrote $OUT/apical-windows.exe ($(du -h "$OUT/apical-windows.exe" | cut -f1))"
}

pack_linux() {
  local bundle appimage
  bundle="$(find_bundle_dir appimage)"
  appimage="$(find "$bundle/appimage" -name '*.AppImage' -print -quit 2>/dev/null || true)"
  if [[ -z "$appimage" ]]; then
    echo "No AppImage found under $bundle/appimage" >&2
    exit 1
  fi
  cp "$appimage" "$OUT/apical-linux.AppImage"
  chmod +x "$OUT/apical-linux.AppImage"
  echo "Wrote $OUT/apical-linux.AppImage ($(du -h "$OUT/apical-linux.AppImage" | cut -f1))"
}

case "${1:-all}" in
  mac) pack_mac ;;
  windows) pack_windows ;;
  linux) pack_linux ;;
  all)
    find_bundle_dir macos >/dev/null 2>&1 && pack_mac || true
    find_bundle_dir windows >/dev/null 2>&1 && pack_windows || true
    find_bundle_dir appimage >/dev/null 2>&1 && pack_linux || true
    ;;
  *) echo "Usage: $0 [mac|windows|linux|all]" >&2; exit 1 ;;
esac
