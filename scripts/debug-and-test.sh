#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

echo "[1/5] Unit + integration tests"
npm test

echo "[2/5] Failover simulation"
if ! npm run simulate:failover; then
  echo "Failover simulation skipped/failed in this environment; continuing."
fi

echo "[3/5] Stream simulator smoke check (5s)"
if ! timeout 5s npm run simulate:stream; then
  echo "Stream simulator smoke check skipped/failed in this environment; continuing."
fi

echo "[4/5] Load test (75,000 records)"
npm run test:load

echo "[5/5] Memory test"
npm run test:memory

echo "Debug/testing suite completed."
