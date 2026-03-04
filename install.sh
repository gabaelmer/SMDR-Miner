#!/usr/bin/env bash
#
# SMDR Insight installer for Ubuntu/Debian servers
# Supports one-line install:
# curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash
#

set -euo pipefail

APP_NAME="SMDR Insight"
SERVICE_NAME="smdr-insight"
INSTALL_DIR="${SMDR_INSTALL_DIR:-/opt/smdr-insight}"
REPO_URL="${SMDR_REPO_URL:-https://github.com/gabaelmer/SMDR-Miner.git}"
REPO_REF="${SMDR_REPO_REF:-main}"
SERVICE_USER="${SMDR_SERVICE_USER:-smdr}"
SERVICE_GROUP=""
BACKUP_DIR="${SMDR_BACKUP_DIR:-/var/backups/smdr-insight}"
ENV_FILE="${SMDR_ENV_FILE:-/etc/default/smdr-insight}"
DEFAULT_PORT="${SMDR_DEFAULT_PORT:-61593}"
PORT="$DEFAULT_PORT"
ENABLE_FIREWALL=1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

usage() {
  cat <<EOF
Usage: bash install.sh [options]
Run as root directly, or run via sudo from any user account.

Options:
  --port <number>           HTTPS listen port (default: ${DEFAULT_PORT})
  --install-dir <path>      Install directory (default: ${INSTALL_DIR})
  --repo-url <url>          Git repository URL (default: ${REPO_URL})
  --repo-ref <ref>          Git branch/tag/sha to install (default: ${REPO_REF})
  --service-user <user>     Linux user to run service. Use "root", "current", or any username (default: ${SERVICE_USER})
  --no-firewall             Skip ufw configuration
  -h, --help                Show this help

Environment overrides:
  SMDR_INSTALL_DIR          Default install directory
  SMDR_REPO_URL             Default git repository URL
  SMDR_REPO_REF             Default git ref (branch/tag/sha)
  SMDR_SERVICE_USER         Default Linux service user
  SMDR_BACKUP_DIR           Default backup directory
  SMDR_ENV_FILE             Default runtime env file path
  SMDR_DEFAULT_PORT         Default HTTPS port
EOF
}

resolve_service_user() {
  if [[ -z "$SERVICE_USER" ]]; then
    log_error "--service-user cannot be empty."
    exit 1
  fi

  if [[ "$SERVICE_USER" == "current" ]]; then
    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
      SERVICE_USER="${SUDO_USER}"
    else
      SERVICE_USER="$(id -un)"
    fi
  fi

  if [[ "$SERVICE_USER" == "root" ]]; then
    SERVICE_GROUP="root"
    return
  fi

  if [[ ! "$SERVICE_USER" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
    log_error "Invalid --service-user value: ${SERVICE_USER}"
    exit 1
  fi

  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --repo-ref)
      REPO_REF="${2:-}"
      shift 2
      ;;
    --service-user)
      SERVICE_USER="${2:-}"
      shift 2
      ;;
    --no-firewall)
      ENABLE_FIREWALL=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  log_error "Invalid --port value: ${PORT}"
  exit 1
fi

require_root() {
  if [[ "$EUID" -ne 0 ]]; then
    log_error "Run as root (or with sudo). This installer supports any user account when launched with sudo."
    exit 1
  fi
}

check_systemd() {
  log_step "Checking systemd integration..."
  if ! command -v systemctl >/dev/null 2>&1; then
    log_error "systemctl not found. A systemd-based Ubuntu/Debian host is required."
    exit 1
  fi
  if [[ ! -d /run/systemd/system ]]; then
    log_error "Systemd does not appear to be PID 1 on this host. Full systemd integration cannot be completed."
    exit 1
  fi
  log_info "Systemd detected and available."
}

run_as_service_user() {
  local cmd="$1"
  if [[ "$SERVICE_USER" == "root" ]]; then
    bash -lc "$cmd"
    return
  fi
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- bash -lc "$cmd"
  else
    su -s /bin/bash "$SERVICE_USER" -c "$cmd"
  fi
}

check_os() {
  log_step "Checking OS compatibility..."
  if [[ ! -f /etc/os-release ]]; then
    log_error "/etc/os-release not found. Ubuntu/Debian is required."
    exit 1
  fi
  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ ! "${ID:-}" =~ ^(ubuntu|debian)$ ]]; then
    log_warn "Detected OS '${ID:-unknown}'. This installer is intended for Ubuntu/Debian."
  fi
  log_info "Detected: ${PRETTY_NAME:-unknown}"
}

install_system_dependencies() {
  log_step "Installing system dependencies and tools..."
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    ca-certificates \
    curl \
    git \
    gnupg \
    build-essential \
    fontconfig \
    libfontconfig1 \
    python3 \
    make \
    g++ \
    pkg-config \
    openssl \
    ufw \
    jq
}

ensure_node_24() {
  local current_major=0
  if command -v node >/dev/null 2>&1; then
    current_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  fi

  if (( current_major >= 24 )); then
    log_info "Node.js $(node -v) already satisfies requirement (>=24)."
    return
  fi

  log_step "Installing Node.js 24.x..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs

  if ! command -v node >/dev/null 2>&1; then
    log_error "Node.js installation failed."
    exit 1
  fi

  log_info "Node.js version: $(node -v)"
  log_info "npm version: $(npm -v)"
}

ensure_service_user() {
  log_step "Preparing service user..."
  if [[ "$SERVICE_USER" == "root" ]]; then
    log_warn "Service user is root. For better security, use a dedicated user (default: smdr)."
    SERVICE_GROUP="root"
    return
  fi

  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
    log_info "Using existing user: $SERVICE_USER"
    log_info "Using existing group: $SERVICE_GROUP"
    return
  fi

  useradd --system --user-group --home-dir "$INSTALL_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
  log_info "Created service user: $SERVICE_USER"
  log_info "Created service group: $SERVICE_GROUP"
}

prepare_source() {
  log_step "Preparing application source..."

  mkdir -p "$(dirname "$INSTALL_DIR")"

  # Prevent 'dubious ownership' errors when root updates a repository owned by the service user
  git config --global --add safe.directory "$INSTALL_DIR" || true

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log_info "Existing git checkout found. Updating to ${REPO_REF}..."
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
    git -C "$INSTALL_DIR" fetch --depth 1 --prune origin "$REPO_REF"
    git -C "$INSTALL_DIR" checkout -B "$REPO_REF" FETCH_HEAD
    git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
    # Remove stale files from previous releases while preserving runtime config/state.
    git -C "$INSTALL_DIR" clean -fd -e config/ -e config/** || true
  else
    if [[ -d "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
      local backup_path="${BACKUP_DIR}/preinstall-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$BACKUP_DIR"
      mv "$INSTALL_DIR" "$backup_path"
      log_warn "Existing non-git directory moved to: $backup_path"
    fi

    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
  fi

  mkdir -p "$BACKUP_DIR"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
}

build_application() {
  log_step "Installing npm dependencies and building app..."

  if [[ -f "$INSTALL_DIR/package-lock.json" ]]; then
    run_as_service_user "cd '$INSTALL_DIR' && npm ci --no-audit --no-fund"
  else
    run_as_service_user "cd '$INSTALL_DIR' && npm install --no-audit --no-fund"
  fi

  run_as_service_user "cd '$INSTALL_DIR' && npm run rebuild:native"
  run_as_service_user "cd '$INSTALL_DIR' && npm run build"
}

ensure_runtime_config() {
  log_step "Ensuring runtime config directories..."
  mkdir -p "$INSTALL_DIR/config" "$INSTALL_DIR/config/archive" "$INSTALL_DIR/config/tls" "$BACKUP_DIR"

  if [[ ! -f "$INSTALL_DIR/config/settings.json" ]] && [[ -f "$INSTALL_DIR/config/settings.json.example" ]]; then
    cp "$INSTALL_DIR/config/settings.json.example" "$INSTALL_DIR/config/settings.json"
  fi

  if [[ -f "$INSTALL_DIR/config/billing.json" ]]; then
    chmod 640 "$INSTALL_DIR/config/billing.json" || true
  fi

  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/config" "$BACKUP_DIR"
}

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

configure_env_file() {
  log_step "Configuring runtime environment file..."
  touch "$ENV_FILE"
  chmod 640 "$ENV_FILE"

  set_env_value "SMDR_PORT" "$PORT"
  set_env_value "SMDR_CONFIG_DIR" "$INSTALL_DIR/config"
  set_env_value "SMDR_DB_PATH" "$INSTALL_DIR/config/smdr-insight.sqlite"
  set_env_value "SMDR_TLS_CN" "$(hostname -f 2>/dev/null || hostname)"

  if ! grep -qE "^SMDR_JWT_SECRET=" "$ENV_FILE" 2>/dev/null; then
    local secret
    secret="$(openssl rand -hex 32)"
    echo "SMDR_JWT_SECRET=${secret}" >> "$ENV_FILE"
    log_info "Generated new SMDR_JWT_SECRET"
  fi

  if ! grep -q "^SMDR_BOOTSTRAP_ADMIN_PASSWORD=" "$ENV_FILE"; then
    local boot_pass
    boot_pass="$(openssl rand -base64 12 | tr -d '=+/' | cut -c1-16)"
    
    # We still allow the user to see this comment for context
    cat >> "$ENV_FILE" <<EOF

# Bootstrap admin credentials (used only when no users exist)
SMDR_BOOTSTRAP_ADMIN_USERNAME=admin
SMDR_BOOTSTRAP_ADMIN_PASSWORD=${boot_pass}
EOF
    # Export it for print_summary
    export GENERATED_ADMIN_PASS="$boot_pass"
  fi
}

create_systemd_service() {
  log_step "Creating systemd service..."

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=${APP_NAME} service
After=network-online.target
Wants=network-online.target
Documentation=${REPO_URL}

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env node dist/main/main/node-server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=${INSTALL_DIR}/config
LimitNOFILE=65535
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF
}

configure_firewall() {
  if (( ENABLE_FIREWALL == 0 )); then
    log_info "Firewall configuration skipped (--no-firewall)."
    return
  fi

  if ! command -v ufw >/dev/null 2>&1; then
    log_warn "ufw not found; skipping firewall configuration."
    return
  fi

  if ufw status | grep -q "Status: active"; then
    if ! ufw status | grep -q "${PORT}/tcp"; then
      ufw allow "${PORT}/tcp" comment "${APP_NAME} HTTPS"
      log_info "Opened firewall port ${PORT}/tcp"
    else
      log_info "Firewall already allows ${PORT}/tcp"
    fi
  else
    log_warn "ufw is not active; skipping port open."
  fi
}

enable_service() {
  log_step "Enabling and starting service..."
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 2

  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    log_error "Service failed to start."
    journalctl -u "$SERVICE_NAME" --no-pager -n 80 || true
    exit 1
  fi
}

print_summary() {
  local host_ip
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -z "$host_ip" ]]; then
    host_ip="SERVER_IP"
  fi

  echo ""
  echo "========================================================"
  log_info "${APP_NAME} installation completed."
  echo "========================================================"
  echo "Service:            ${SERVICE_NAME}"
  echo "Install directory:  ${INSTALL_DIR}"
  echo "Environment file:   ${ENV_FILE}"
  echo "Web URL:            https://${host_ip}:${PORT}"
  echo ""
  
  if [[ -n "${GENERATED_ADMIN_PASS:-}" ]]; then
    echo -e "${YELLOW}IMPORTANT: Initial Admin Credentials${NC}"
    echo "  Username: admin"
    echo "  Password: ${GENERATED_ADMIN_PASS}"
    echo "  (Please log in and change this password immediately!)"
    echo ""
  fi

  echo "Useful commands:"
  echo "  sudo systemctl status ${SERVICE_NAME}"
  echo "  sudo systemctl restart ${SERVICE_NAME}"
  echo "  sudo journalctl -u ${SERVICE_NAME} -f"
  echo "========================================================"
}

main() {
  require_root
  resolve_service_user

  echo ""
  echo "========================================================"
  echo " ${APP_NAME} installer (Ubuntu/Debian)"
  echo "========================================================"
  echo ""
  log_info "Repo URL: ${REPO_URL}"
  log_info "Repo ref: ${REPO_REF}"
  log_info "Install dir: ${INSTALL_DIR}"
  log_info "Service user: ${SERVICE_USER}"
  log_info "Service group: ${SERVICE_GROUP:-<auto>}"
  log_info "HTTPS port: ${PORT}"
  echo ""

  check_os
  check_systemd
  install_system_dependencies
  ensure_node_24
  ensure_service_user
  prepare_source
  build_application
  ensure_runtime_config
  configure_env_file
  create_systemd_service
  configure_firewall
  enable_service
  print_summary
}

main
