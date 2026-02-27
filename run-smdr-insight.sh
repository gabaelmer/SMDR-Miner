#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${CACHE_DIR:-/tmp/smdr-insight-npm-cache}"
INSTALL_TIMEOUT_SECS="${INSTALL_TIMEOUT_SECS:-600}"
MODE="${1:-dev}"

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  LOCAL_NODE_DIR="${ROOT_DIR}/../.local_node_env/node-v20.10.0-linux-x64/bin"
  if [[ -x "${LOCAL_NODE_DIR}/node" && -x "${LOCAL_NODE_DIR}/npm" ]]; then
    export PATH="${LOCAL_NODE_DIR}:${PATH}"
    return 0
  fi

  echo "Error: node/npm not found. Install Node.js 20+ or provide .local_node_env." >&2
  exit 1
}

ensure_deps() {
  if [[ -d "${ROOT_DIR}/node_modules" ]]; then
    return 0
  fi

  echo "Installing dependencies (timeout: ${INSTALL_TIMEOUT_SECS}s)..."
  mkdir -p "${CACHE_DIR}"
  (
    cd "${ROOT_DIR}"
    timeout "${INSTALL_TIMEOUT_SECS}s" npm install --cache "${CACHE_DIR}" --fetch-retries=2 --fetch-timeout=120000
  ) || {
    echo "Dependency installation failed or timed out." >&2
    echo "You can retry with: INSTALL_TIMEOUT_SECS=1200 ./run-smdr-insight.sh setup" >&2
    exit 1
  }
}

run_tests() {
  (
    cd "${ROOT_DIR}"
    ./scripts/debug-and-test.sh
  )
}

run_build() {
  (
    cd "${ROOT_DIR}"
    npm run build
  )
}

run_dev() {
  (
    cd "${ROOT_DIR}"
    npm run dev
  )
}

run_dist() {
  (
    cd "${ROOT_DIR}"
    npm run dist
  )
}

usage() {
  cat <<USAGE
Usage: ./run-smdr-insight.sh [mode]

Modes:
  setup   Install dependencies only
  test    Install dependencies and run test/debug suite
  build   Install dependencies and compile app
  dev     Install dependencies and run app in development mode (default)
  dist    Install dependencies, build, and package Linux artifacts

Environment variables:
  CACHE_DIR             npm cache directory (default: /tmp/smdr-insight-npm-cache)
  INSTALL_TIMEOUT_SECS  install timeout seconds (default: 600)
USAGE
}

ensure_node

case "${MODE}" in
  setup)
    ensure_deps
    ;;
  test)
    ensure_deps
    run_tests
    ;;
  build)
    ensure_deps
    run_build
    ;;
  dev)
    ensure_deps
    run_dev
    ;;
  dist)
    ensure_deps
    run_dist
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    usage
    exit 1
    ;;
esac
