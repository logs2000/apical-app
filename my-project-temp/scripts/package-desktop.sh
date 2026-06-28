#!/usr/bin/env bash
# Package Tauri bundle outputs into the filenames the landing page expects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/downloads"
BUNDLE="$ROOT/src-tauri/target/release/bundle"

mkdir -p "$OUT"

pack_mac() {
  local app
  app="$(find "$BUNDLE/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
  if [[ -z "$app" ]]; then
    echo "No macOS .app found under $BUNDLE/macos" >&2
    exit 1
  fi
  rm -f "$OUT/apical-mac.tar.gz"
  tar -czf "$OUT/apical-mac.tar.gz" -C "$(dirname "$app")" "$(basename "$app")"
  echo "Wrote $OUT/apical-mac.tar.gz ($(du -h "$OUT/apical-mac.tar.gz" | cut -f1))"
}

pack_windows() {
  local exe
  exe="$(find "$BUNDLE/nsis" -name '*-setup.exe' -print -quit 2>/dev/null || true)"
  if [[ -z "$exe" ]]; then
    exe="$(find "$BUNDLE/msi" -name '*.msi' -print -quit 2>/dev/null || true)"
  fi
  if [[ -z "$exe" ]]; then
    echo "No Windows installer found under $BUNDLE" >&2
    exit 1
  fi
  cp "$exe" "$OUT/apical-windows.exe"
  echo "Wrote $OUT/apical-windows.exe ($(du -h "$OUT/apical-windows.exe" | cut -f1))"
}

pack_linux() {
  local appimage
  appimage="$(find "$BUNDLE/appimage" -name '*.AppImage' -print -quit 2>/dev/null || true)"
  if [[ -z "$appimage" ]]; then
    echo "No AppImage found under $BUNDLE/appimage" >&2
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
    [[ -d "$BUNDLE/macos" ]] && pack_mac || true
    [[ -d "$BUNDLE/nsis" || -d "$BUNDLE/msi" ]] && pack_windows || true
    [[ -d "$BUNDLE/appimage" ]] && pack_linux || true
    ;;
  *) echo "Usage: $0 [mac|windows|linux|all]" >&2; exit 1 ;;
esac
