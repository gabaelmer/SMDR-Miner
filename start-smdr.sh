#!/bin/bash
# SMDR Insight - Web Server Start Script
# Usage: ./start-smdr.sh [port]

PORT=${1:-61593}
LOCK_PATH="${SMDR_PROCESS_LOCK_PATH:-$HOME/.smdr-insight/node-server.lock}"

echo "=========================================="
echo "  SMDR Insight - Web Server"
echo "=========================================="
echo ""

# Check build freshness
BUILD_STAMP="dist/.build-stamp"
NEEDS_BUILD=0

if [ ! -d "dist" ] || [ ! -f "dist/main/main/node-server.js" ] || [ ! -f "dist/renderer/index.html" ] || [ ! -f "$BUILD_STAMP" ]; then
    NEEDS_BUILD=1
else
    CHANGED_SOURCE="$(find backend main shared renderer \
        -type f \
        \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.json" -o -name "*.cjs" \) \
        -newer "$BUILD_STAMP" \
        -print -quit)"
    if [ -n "$CHANGED_SOURCE" ] || [ "package.json" -nt "$BUILD_STAMP" ] || [ "package-lock.json" -nt "$BUILD_STAMP" ]; then
        NEEDS_BUILD=1
    fi
fi

if [ "$NEEDS_BUILD" -eq 1 ]; then
    echo "Building SMDR Insight (fresh build required)..."
    npm run build || exit 1
    touch "$BUILD_STAMP"
fi

# Prevent duplicate server instances.
mkdir -p "$(dirname "$LOCK_PATH")"
if [ -f "$LOCK_PATH" ]; then
    LOCK_PID="$(tr -d '[:space:]' < "$LOCK_PATH" 2>/dev/null || true)"
    if [[ "$LOCK_PID" =~ ^[0-9]+$ ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
        echo "ERROR: SMDR Insight is already running (PID: $LOCK_PID)."
        echo "Lock file: $LOCK_PATH"
        echo "Stop the existing instance first, then retry."
        exit 1
    fi
    echo "Removing stale lock file: $LOCK_PATH"
    rm -f "$LOCK_PATH"
fi

# Start the server
echo "Starting SMDR Insight on port $PORT..."
echo ""
echo "Access the web interface at:"
echo "  Local:   https://localhost:$PORT"
echo "  Network: https://$(hostname -I | awk '{print $1}'):${PORT}"
echo ""
echo "TLS cert/key: config/tls/server.crt + config/tls/server.key (auto-generated if missing)"
echo "Bootstrap admin: set SMDR_BOOTSTRAP_ADMIN_PASSWORD before first start"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=========================================="
echo ""

SMDR_PORT=$PORT node dist/main/main/node-server.js
