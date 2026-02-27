# SMDR Insight - Headless Server Installation Guide

Complete guide for installing SMDR Insight on headless Ubuntu/Debian servers.

---

## 🎯 Quick Install (One Command)

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/Project-SMDR/main/install.sh | sudo bash
```

### Custom Port Installation

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/Project-SMDR/main/install.sh | sudo bash -s -- --port 61593
```

---

## 📋 System Requirements

### Minimum Requirements
- **OS**: Ubuntu 20.04+ or Debian 11+
- **CPU**: 2 cores
- **RAM**: 2 GB
- **Storage**: 10 GB
- **Node.js**: 24.x (installed automatically)

### Recommended Requirements
- **OS**: Ubuntu 22.04 LTS or newer
- **CPU**: 4 cores
- **RAM**: 4 GB
- **Storage**: 50 GB SSD
- **Network**: Static IP address

---

## 🔧 Manual Installation

### Step 1: Download Installer

```bash
# Download
curl -fsSL https://raw.githubusercontent.com/gabaelmer/Project-SMDR/main/install.sh -o install.sh

# Make executable
chmod +x install.sh

# Run installer
sudo ./install.sh
```

### Step 2: Verify Installation

```bash
# Check service status
sudo systemctl status smdr-insight

# View logs
sudo journalctl -u smdr-insight -f
```

### Step 3: Access Web Interface

```
https://your-server-ip:61593
```

**Bootstrap Login:**
- Set `SMDR_BOOTSTRAP_ADMIN_PASSWORD` before first start
- Optional: set `SMDR_BOOTSTRAP_ADMIN_USERNAME` (defaults to `admin`)

---

## 🎯 Headless Installation Features

### ✅ Fully Automated
- No user interaction required
- All dependencies installed automatically
- Systemd service configured and enabled

### ✅ Headless Build Support
- Uses `QT_QPA_PLATFORM=offscreen` for headless builds
- Virtual display (`DISPLAY=:99`) for Vite compilation
- Font configuration for proper rendering

### ✅ Auto-Start on Boot
- Systemd service enabled
- Starts automatically after reboot
- Restarts on failure

### ✅ Automated Backups
- Daily database backups at 3 AM
- 30-day retention policy
- Automatic cleanup of old backups

### ✅ Security Hardening
- Firewall rules configured (UFW)
- Systemd security restrictions
- Non-root service user
- Private temporary directory

---

## 📁 Installation Layout

```
/opt/smdr-insight/              # Installation directory
├── config/                     # Configuration & database
│   ├── settings.json           # Main configuration
│   ├── billing.json            # Billing rules
│   ├── smdr-insight.sqlite     # SQLite database
│   └── archive/                # Daily CSV exports
├── dist/                       # Compiled application
├── scripts/
│   └── backup.sh               # Backup script
└── node_modules/               # Dependencies

/var/backups/smdr-insight/      # Automated backups
/etc/systemd/system/smdr-insight.service  # Service definition
/etc/cron.d/smdr-insight-backup           # Backup cron job
```

---

## 🔧 Service Management

### Check Status

```bash
sudo systemctl status smdr-insight
```

### Start Service

```bash
sudo systemctl start smdr-insight
```

### Stop Service

```bash
sudo systemctl stop smdr-insight
```

### Restart Service

```bash
sudo systemctl restart smdr-insight
```

### Enable Auto-Start

```bash
sudo systemctl enable smdr-insight
```

### View Logs (Real-time)

```bash
sudo journalctl -u smdr-insight -f
```

### View Today's Logs

```bash
sudo journalctl -u smdr-insight --since today
```

---

## 🔐 Security Configuration

### Bootstrap First Admin

1. Set `SMDR_BOOTSTRAP_ADMIN_PASSWORD` in your service environment
2. Optionally set `SMDR_BOOTSTRAP_ADMIN_USERNAME`
3. Start the service and sign in with those credentials

### Set JWT Secret (Production)

Edit systemd service:

```bash
sudo systemctl edit smdr-insight
```

Add:

```ini
[Service]
Environment=SMDR_JWT_SECRET=your-secure-random-string-here
Environment=SMDR_BOOTSTRAP_ADMIN_PASSWORD=your-initial-admin-password
```

Then restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart smdr-insight
```

### Firewall Configuration

The installer automatically configures UFW:

```bash
# Verify firewall rules
sudo ufw status

# Manually allow port if needed
sudo ufw allow 61593/tcp comment "SMDR Insight Web Interface"
```

### HTTPS with Reverse Proxy (Optional)

For production, use nginx with Let's Encrypt:

```nginx
server {
    listen 443 ssl;
    server_name smdr.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/smdr.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/smdr.yourdomain.com/privkey.pem;

    location / {
        proxy_pass https://localhost:61593;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📊 Backup and Recovery

### Manual Backup

```bash
sudo /opt/smdr-insight/scripts/backup.sh
```

### Restore from Backup

```bash
# Stop service
sudo systemctl stop smdr-insight

# Restore database
cp /var/backups/smdr-insight/smdr-backup-YYYYMMDD-HHMMSS.sqlite \
   /opt/smdr-insight/config/smdr-insight.sqlite

# Fix permissions
sudo chown $USER:$USER /opt/smdr-insight/config/smdr-insight.sqlite

# Start service
sudo systemctl start smdr-insight
```

### Backup Retention

Edit backup script to change retention:

```bash
sudo nano /opt/smdr-insight/scripts/backup.sh

# Change:
RETENTION_DAYS=30
```

---

## 🐛 Troubleshooting

### Service Won't Start

```bash
# Check status
sudo systemctl status smdr-insight

# View recent errors
sudo journalctl -u smdr-insight -n 50 --no-pager

# Test manually
cd /opt/smdr-insight
node dist/main/main/node-server.js
```

### Port Already in Use

```bash
# Find process using port
sudo ss -tlnp | grep 61593

# Kill process (if safe)
sudo kill -9 <PID>

# Or change port in systemd service
sudo systemctl edit smdr-insight
# Add: Environment=SMDR_PORT=3001
sudo systemctl daemon-reload
sudo systemctl restart smdr-insight
```

### Build Fails on Headless Server

The installer handles headless builds automatically with:

```bash
export QT_QPA_PLATFORM=offscreen
export DISPLAY=:99
export FONTCONFIG_PATH=/etc/fonts
export XDG_RUNTIME_DIR=/tmp/runtime-$USER
```

If build still fails:

```bash
# Install font configuration
sudo apt-get install -y fontconfig libfontconfig1

# Retry build
cd /opt/smdr-insight
npm rebuild better-sqlite3
npm run build
```

### High Memory Usage

```bash
# Check memory
systemctl show smdr-insight --property=MemoryCurrent

# Restart service
sudo systemctl restart smdr-insight

# If persistent, reduce retention days
sudo nano /opt/smdr-insight/config/settings.json
# Set: "retentionDays": 30
```

### Connection Issues to MiVB

```bash
# Test connectivity
ping 192.168.0.10

# Test port
telnet 192.168.0.10 1752

# Check firewall
sudo ufw status

# Check logs for errors
sudo journalctl -u smdr-insight | grep -i "error\|timeout"
```

---

## 🗑️ Uninstall

### Automated Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Insight/main/uninstall.sh | sudo bash
```

### Manual Uninstall

```bash
# Stop service
sudo systemctl stop smdr-insight
sudo systemctl disable smdr-insight

# Remove service files
sudo rm /etc/systemd/system/smdr-insight.service
sudo rm /etc/cron.d/smdr-insight-backup
sudo rm /etc/logrotate.d/smdr-insight
sudo systemctl daemon-reload

# Remove installation
sudo rm -rf /opt/smdr-insight
sudo rm -rf /var/backups/smdr-insight
```

---

## 📞 Support

For additional help:

- **GitHub Repository**: https://github.com/gabaelmer/SMDR-Insight
- **GitHub Issues**: https://github.com/gabaelmer/SMDR-Insight/issues
- **Discussions**: https://github.com/gabaelmer/SMDR-Insight/discussions

---

**Version:** 2.1.0-web  
**Last Updated:** February 2026  
**Publisher:** elmertech
