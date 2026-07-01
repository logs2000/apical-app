#!/usr/bin/env bash
# Download Node.js binaries for Tauri sidecar(s) (bundled with the desktop app).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
NODE_VERSION="20.19.0"
mkdir -p "$BIN_DIR"

fetch_triple() {
  local TRIPLE="$1"
  local DEST="$BIN_DIR/node-${TRIPLE}"
  [[ "$TRIPLE" == *windows* ]] && DEST="${DEST}.exe"

  if [[ -f "$DEST" ]]; then
    echo "[fetch-node-sidecar] Already present: $DEST"
    return 0
  fi

  local TARBALL NODE_BIN TMP BASE
  TMP="$(mktemp -d)"

  case "$TRIPLE" in
    aarch64-apple-darwin)
      TARBALL="node-v${NODE_VERSION}-darwin-arm64.tar.gz"
      ;;
    x86_64-apple-darwin)
      TARBALL="node-v${NODE_VERSION}-darwin-x64.tar.gz"
      ;;
    x86_64-unknown-linux-gnu)
      TARBALL="node-v${NODE_VERSION}-linux-x64.tar.gz"
      ;;
    x86_64-pc-windows-msvc)
      TARBALL="node-v${NODE_VERSION}-win-x64.zip"
      ;;
    *)
      echo "Unsupported triple: $TRIPLE" >&2
      return 1
      ;;
  esac

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
    esac
    cp "$NODE_BIN" "$DEST"
  fi

  chmod +x "$DEST"
  rm -rf "$TMP"
  echo "[fetch-node-sidecar] Installed $DEST"
}

host_triple() {
  local OS ARCH
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m)"
  case "$OS-$ARCH" in
    darwin-arm64) echo "aarch64-apple-darwin" ;;
    darwin-x86_64) echo "x86_64-apple-darwin" ;;
    linux-x86_64) echo "x86_64-unknown-linux-gnu" ;;
    mingw*|msys*|cygwin*|windows*) echo "x86_64-pc-windows-msvc" ;;
    *) echo "Unsupported platform: $OS $ARCH" >&2; return 1 ;;
  esac
}

TRIPLES=()
if [[ -n "${APICAL_NODE_TRIPLES:-}" ]]; then
  IFS=',' read -r -a TRIPLES <<< "${APICAL_NODE_TRIPLES}"
elif [[ "$(uname -s)" == "Darwin" && "${APICAL_UNIVERSAL_MAC:-0}" == "1" ]]; then
  TRIPLES=(aarch64-apple-darwin x86_64-apple-darwin)
else
  TRIPLES=("$(host_triple)")
fi

for triple in "${TRIPLES[@]}"; do
  triple="${triple// /}"
  [[ -z "$triple" ]] && continue
  fetch_triple "$triple"
done
