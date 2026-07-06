#!/usr/bin/env bash
# Run every smoke script in order; stop on first failure.
# Usage: bash scripts/smoke/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

for f in scripts/smoke/[0-9]*.ts; do
  echo "--- $f"
  bun "$f"
done
echo "All smoke tests passed."
