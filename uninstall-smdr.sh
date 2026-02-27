#!/bin/bash
# SMDR Insight - Uninstall Script
# Removes the production installation from /opt/smdr-insight

set -e

INSTALL_DIR="/opt/smdr-insight"
SERVICE_NAME="smdr-insight"
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"
CRON_FILE="/etc/cron.d/$SERVICE_NAME-backup"

echo "=========================================="
echo "  SMDR Insight - Uninstall"
echo "=========================================="
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run with sudo"
    echo "Usage: sudo ./uninstall-smdr.sh"
    exit 1
fi

# Stop the service
echo "[1/6] Stopping SMDR Insight service..."
systemctl stop $SERVICE_NAME 2>/dev/null || echo "  Service not running"
systemctl disable $SERVICE_NAME 2>/dev/null || echo "  Service not enabled"

# Remove systemd service file
echo "[2/6] Removing systemd service..."
if [ -f "$SERVICE_FILE" ]; then
    rm -f "$SERVICE_FILE"
    echo "  Removed: $SERVICE_FILE"
else
    echo "  Service file not found"
fi

# Remove cron backup job
echo "[3/6] Removing backup cron job..."
if [ -f "$CRON_FILE" ]; then
    rm -f "$CRON_FILE"
    echo "  Removed: $CRON_FILE"
else
    echo "  Cron file not found"
fi

# Kill any running processes
echo "[4/6] Stopping running processes..."
pkill -f "node.*node-server" 2>/dev/null || echo "  No processes running"

# Remove installation directory
echo "[5/6] Removing installation directory..."
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "  Removed: $INSTALL_DIR"
else
    echo "  Installation directory not found"
fi

# Reload systemd
echo "[6/6] Reloading systemd..."
systemctl daemon-reload

echo ""
echo "=========================================="
echo "  Uninstall Complete!"
echo "=========================================="
echo ""
echo "SMDR Insight has been removed from your system."
echo ""
echo "To install again, run:"
echo "  curl -fsSL https://raw.githubusercontent.com/gabaelmer/Project-SMDR/main/install.sh | sudo bash"
echo ""
