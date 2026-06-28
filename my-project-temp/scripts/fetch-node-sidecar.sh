#!/usr/bin/env bash
# Download Node.js binary for Tauri sidecar (bundled with the desktop app).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
NODE_VERSION="20.19.0"
mkdir -p "$BIN_DIR"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS-$ARCH" in
  darwin-arm64)
    TRIPLE="aarch64-apple-darwin"
    TARBALL="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
    ;;
  darwin-x86_64)
    TRIPLE="x86_64-apple-darwin"
    TARBALL="node-v${NODE_VERSION}-darwin-x64.tar.gz"
    ;;
  linux-x86_64)
    TRIPLE="x86_64-unknown-linux-gnu"
    TARBALL="node-v${NODE_VERSION}-linux-x64.tar.gz"
    ;;
  mingw*|msys*|cygwin*|windows*)
    TRIPLE="x86_64-pc-windows-msvc"
    TARBALL="node-v${NODE_VERSION}-win-x64.zip"
    ;;
  *)
    echo "Unsupported platform: $OS $ARCH" >&2
    exit 1
    ;;
esac

DEST="$BIN_DIR/node-${TRIPLE}"
[[ "$TRIPLE" == *windows* ]] && DEST="${DEST}.exe"

if [[ -f "$DEST" ]]; then
  echo "[fetch-node-sidecar] Already present: $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BASE="https://nodejs.org/dist/v${NODE_VERSION}"

if [[ "$TRIPLE" == *windows* ]]; then
  curl -fsSL "$BASE/$TARBALL" -o "$TMP/node.zip"
  unzip -q "$TMP/node.zip" -d "$TMP"
  cp "$TMP/node-v${NODE_VERSION}-win-x64/node.exe" "$DEST"
else
  curl -fsSL "$BASE/$TARBALL" | tar -xz -C "$TMP"
  case "$TRIPLE" in
    aarch64-apple-darwin) NODE_BIN="$TMP/node-v${NODE_VERSION}-darwin-arm64/bin/node" ;;
    x86_64-apple-darwin) NODE_BIN="$TMP/node-v${NODE_VERSION}-darwin-x64/bin/node" ;;
    x86_64-unknown-linux-gnu) NODE_BIN="$TMP/node-v${NODE_VERSION}-linux-x64/bin/node" ;;
    *) echo "No node bin path for $TRIPLE" >&2; exit 1 ;;
  esac
  cp "$NODE_BIN" "$DEST"
fi

chmod +x "$DEST"
echo "[fetch-node-sidecar] Installed $DEST"
