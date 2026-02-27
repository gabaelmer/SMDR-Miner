#!/bin/bash
#
# SMDR Insight - Production Installer for Ubuntu/Debian
# Version: 2.1.0-web
# 
# Supports headless server installation with systemd service
# Compatible with Ubuntu 20.04+ and Debian 11+
#

set -e

# Configuration
REPO_URL="https://github.com/gabaelmer/SMDR-Insight.git"
INSTALL_DIR="/opt/smdr-insight"
SERVICE_NAME="smdr-insight"
BACKUP_DIR="/var/backups/smdr-insight"
CONFIG_DIR="/etc/smdr-insight"
LOG_DIR="/var/log/smdr-insight"
DEFAULT_PORT=61593

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Parse command line arguments
PORT=$DEFAULT_PORT
while [[ $# -gt 0 ]]; do
    case $1 in
        --port)
            PORT="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root or with sudo"
        echo "Usage: sudo $0 [--port PORT]"
        echo "Options:"
        echo "  --port PORT     Set web interface port (default: $DEFAULT_PORT)"
        exit 1
    fi
}

# Detect user
detect_user() {
    if [ -n "$SUDO_USER" ]; then
        SERVICE_USER="$SUDO_USER"
        log_info "Detected sudo user: $SERVICE_USER"
    else
        SERVICE_USER="root"
        log_info "Running as root user"
    fi
}

# System requirements check
check_system() {
    log_step "Checking system requirements..."
    
    # Check OS
    if [ ! -f /etc/os-release ]; then
        log_error "Cannot detect OS. This script supports Ubuntu/Debian only."
        exit 1
    fi
    
    source /etc/os-release
    if [[ ! "$ID" =~ ^(ubuntu|debian)$ ]]; then
        log_warn "Unsupported OS: $ID. This script is tested on Ubuntu/Debian."
        echo "Continuing anyway..."
    fi
    
    # Check architecture
    ARCH=$(uname -m)
    if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "aarch64" ]; then
        log_warn "Unsupported architecture: $ARCH. Expected x86_64 or aarch64."
    fi
    
    log_info "OS: $PRETTY_NAME"
    log_info "Architecture: $ARCH"
}

# Install system dependencies
install_dependencies() {
    log_step "Installing system dependencies..."
    
    apt-get update -qq
    
    # Install required packages for headless build
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        curl \
        gnupg \
        ca-certificates \
        git \
        build-essential \
        ufw \
        jq \
        fontconfig \
        libfontconfig1 \
        || {
            log_error "Failed to install dependencies"
            exit 1
        }
    
    # Install Node.js 24.x (Latest LTS)
    log_info "Installing Node.js 24.x (Latest LTS)..."
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    
    apt-get update -qq
    apt-get install -y -qq nodejs
    
    # Verify installations
    log_info "Node.js version: $(node -v)"
    log_info "npm version: $(npm -v)"
}

# Configure firewall
configure_firewall() {
    log_step "Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        if ufw status | grep -q "Status: active"; then
            if ! ufw status | grep -q "$PORT/tcp"; then
                ufw allow "$PORT/tcp" comment "SMDR Insight Web Interface"
                log_info "Opened port $PORT in firewall"
            else
                log_info "Port $PORT already allowed in firewall"
            fi
        else
            log_warn "UFW is not active. Consider enabling it: ufw enable"
        fi
    else
        log_warn "UFW not installed. Skipping firewall configuration."
    fi
}

# Stop existing service
stop_existing_service() {
    log_step "Stopping existing service (if running)..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    pkill -f "node.*node-server" 2>/dev/null || true
    sleep 2
}

# Prepare installation directory
prepare_directory() {
    log_step "Preparing installation directory..."
    
    if [ -d "$INSTALL_DIR" ]; then
        log_info "Updating existing installation..."
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
        cd "$INSTALL_DIR"

        # Backup current config before update
        if [ -d "$INSTALL_DIR/config" ]; then
            mkdir -p "$BACKUP_DIR"
            BACKUP_NAME="smdr-backup-$(date +%Y%m%d-%H%M%S)"
            cp -r "$INSTALL_DIR/config" "$BACKUP_DIR/$BACKUP_NAME"
            log_info "Configuration backed up to: $BACKUP_DIR/$BACKUP_NAME"
        fi
    else
        log_info "Creating new installation..."
        mkdir -p "$INSTALL_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
        
        # Clone repository
        log_info "Cloning repository..."
        sudo -u "$SERVICE_USER" git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    
    # Create directories
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$BACKUP_DIR"
    
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$BACKUP_DIR"
}

# Build application (headless mode)
build_application() {
    log_step "Building application (headless mode)..."
    
    cd "$INSTALL_DIR"
    
    # Set environment variables for headless build
    export QT_QPA_PLATFORM=offscreen
    export DISPLAY=:99
    export FONTCONFIG_PATH=/etc/fonts
    export NODE_OPTIONS="--max-old-space-size=2048"
    export XDG_RUNTIME_DIR=/tmp/runtime-$SERVICE_USER
    
    # Create runtime directory
    mkdir -p "$XDG_RUNTIME_DIR"
    chmod 700 "$XDG_RUNTIME_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$XDG_RUNTIME_DIR"
    
    # Install npm dependencies (including dev dependencies for build)
    log_info "Installing npm dependencies..."
    sudo -u "$SERVICE_USER" npm install --loglevel=error
    
    # Rebuild native modules
    log_info "Rebuilding native modules..."
    sudo -u "$SERVICE_USER" npm rebuild better-sqlite3
    
    # Build the application (headless mode)
    log_info "Building application..."
    sudo -u "$SERVICE_USER" env \
        QT_QPA_PLATFORM=offscreen \
        DISPLAY=:99 \
        FONTCONFIG_PATH=/etc/fonts \
        XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
        npx vite build --config renderer/vite.config.ts
    
    # Build backend
    log_info "Building backend..."
    sudo -u "$SERVICE_USER" npx tsc -p main/tsconfig.json
    
    # Fix permissions
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    
    log_info "Build completed successfully"
}

# Configure application
configure_application() {
    log_step "Configuring application..."
    
    # Create config directory in install dir
    mkdir -p "$INSTALL_DIR/config"
    
    # Create default settings if not exists
    if [ ! -f "$INSTALL_DIR/config/settings.json" ]; then
        cat > "$INSTALL_DIR/config/settings.json" << EOF
{
  "connection": {
    "controllerIps": ["192.168.0.10"],
    "port": 1752,
    "concurrentConnections": 1,
    "autoReconnect": true,
    "reconnectDelayMs": 5000,
    "autoReconnectPrimary": true,
    "primaryRecheckDelayMs": 60000,
    "ipWhitelist": []
  },
  "storage": {
    "dbPath": "$INSTALL_DIR/config/smdr-insight.sqlite",
    "retentionDays": 60,
    "archiveDirectory": "$INSTALL_DIR/config/archive"
  },
  "alerts": {
    "longCallMinutes": 30,
    "watchNumbers": [],
    "repeatedBusyThreshold": 3,
    "repeatedBusyWindowMinutes": 30,
    "detectTagCalls": true,
    "detectTollDenied": true
  },
  "maxInMemoryRecords": 2000
}
EOF
        log_info "Created default configuration"
    fi
    
    # Create archive directory
    mkdir -p "$INSTALL_DIR/config/archive"
    
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/config"
}

# Create systemd service
create_systemd_service() {
    log_step "Creating systemd service..."
    
    NODE_PATH=$(which node)
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=SMDR Insight - Web-Based SMDR Analytics
Documentation=https://github.com/gabaelmer/SMDR-Insight
After=network.target syslog.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH dist/main/main/node-server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SMDR_PORT=$PORT
Environment=SMDR_CONFIG_DIR=$INSTALL_DIR/config
Environment=SMDR_DB_PATH=$INSTALL_DIR/config/smdr-insight.sqlite

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/config
PrivateTmp=true

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

    log_info "Created systemd service file"
}

# Create backup script
create_backup_script() {
    log_step "Creating backup script..."
    
    cat > "$INSTALL_DIR/scripts/backup.sh" << 'EOF'
#!/bin/bash
# SMDR Insight - Automated Backup Script

INSTALL_DIR="/opt/smdr-insight"
BACKUP_DIR="/var/backups/smdr-insight"
RETENTION_DAYS=30

# Create backup
BACKUP_NAME="smdr-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -f "$INSTALL_DIR/config/smdr-insight.sqlite" ]; then
    cp "$INSTALL_DIR/config/smdr-insight.sqlite" "$BACKUP_DIR/$BACKUP_NAME.sqlite"
    echo "Backup created: $BACKUP_DIR/$BACKUP_NAME.sqlite"
fi

# Cleanup old backups
find "$BACKUP_DIR" -name "*.sqlite" -mtime +$RETENTION_DAYS -delete
echo "Old backups cleaned up (retention: $RETENTION_DAYS days)"
EOF

    chmod +x "$INSTALL_DIR/scripts/backup.sh"
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/scripts/backup.sh"
}

# Create backup cron job
create_backup_cron() {
    log_step "Creating backup cron job..."
    
    cat > "/etc/cron.d/$SERVICE_NAME-backup" << EOF
# SMDR Insight - Daily backup at 3 AM
0 3 * * * $SERVICE_USER $INSTALL_DIR/scripts/backup.sh >/dev/null 2>&1
EOF

    chmod 644 "/etc/cron.d/$SERVICE_NAME-backup"
    log_info "Backup cron job created"
}

# Create logrotate configuration
create_logrotate() {
    log_step "Creating logrotate configuration..."
    
    cat > "/etc/logrotate.d/$SERVICE_NAME" << EOF
/var/log/syslog {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $SERVICE_USER $SERVICE_USER
    postrotate
        systemctl reload $SERVICE_NAME > /dev/null 2>&1 || true
    endscript
}
EOF

    log_info "Logrotate configuration created"
}

# Enable and start service
enable_service() {
    log_step "Enabling and starting service..."
    
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl start "$SERVICE_NAME"
    
    # Wait for service to start
    sleep 3
    
    # Check status
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_info "Service started successfully"
    else
        log_error "Service failed to start"
        systemctl status "$SERVICE_NAME" --no-pager
        exit 1
    fi
}

# Print installation summary
print_summary() {
    echo ""
    echo "========================================================"
    log_info "SMDR Insight installed successfully!"
    echo "========================================================"
    echo ""
    echo "  ✓ Service Status:     Running (auto-start enabled)"
    echo "  ✓ Auto-Start:         Enabled on system boot"
    echo "  Service Name:         $SERVICE_NAME"
    echo "  Web Interface:        http://$(hostname -I | awk '{print $1}'):${PORT}"
    echo "  Installation Dir:     $INSTALL_DIR"
    echo "  Config Dir:           $INSTALL_DIR/config"
    echo "  Backup Dir:           $BACKUP_DIR"
    echo "  Log Dir:              $LOG_DIR"
    echo ""
    echo "  First Login:"
    echo "    Username: admin"
    echo "    Password: admin123!"
    echo ""
    echo "  Service Commands:"
    echo "    sudo systemctl status $SERVICE_NAME"
    echo "    sudo systemctl start $SERVICE_NAME"
    echo "    sudo systemctl stop $SERVICE_NAME"
    echo "    sudo systemctl restart $SERVICE_NAME"
    echo ""
    echo "  View Logs:"
    echo "    sudo journalctl -u $SERVICE_NAME -f"
    echo "    sudo journalctl -u $SERVICE_NAME --since today"
    echo ""
    echo "  Backup Commands:"
    echo "    sudo $INSTALL_DIR/scripts/backup.sh"
    echo "    ls -la $BACKUP_DIR"
    echo ""
    echo "  Security Reminders:"
    echo "    1. Change default admin password immediately"
    echo "    2. Configure MiVB controller IP in Settings"
    echo "    3. Set SMDR_JWT_SECRET for production"
    echo "    4. Regularly update: sudo apt update && sudo apt upgrade"
    echo ""
    echo "  ℹ️  The service will automatically start on system boot!"
    echo "========================================================"
}

# Main installation
main() {
    echo ""
    echo "========================================================"
    echo "  SMDR Insight - Production Installer"
    echo "  Version: 2.1.0-web"
    echo "  Headless Server Edition"
    echo "========================================================"
    echo ""
    
    check_root
    detect_user
    check_system
    install_dependencies
    configure_firewall
    stop_existing_service
    prepare_directory
    build_application
    configure_application
    create_systemd_service
    create_backup_script
    create_backup_cron
    create_logrotate
    enable_service
    print_summary
}

# Run main installation
main
