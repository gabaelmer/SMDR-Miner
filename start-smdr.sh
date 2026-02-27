#!/bin/bash
# SMDR Insight - Web Server Start Script
# Usage: ./start-smdr.sh [port]

PORT=${1:-61593}

echo "=========================================="
echo "  SMDR Insight - Web Server"
echo "=========================================="
echo ""

# Check if built
if [ ! -d "dist" ]; then
    echo "Building SMDR Insight..."
    npm run build
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
