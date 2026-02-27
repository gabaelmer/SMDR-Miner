# SMDR Insight - Web-Only Setup Guide

## Overview

SMDR Insight is now a **web-only application** (Electron desktop app removed).
Access the application through your web browser at `https://localhost:61593`.

---

## 🗑️ Uninstall Old Production Version

If you have the old production version installed at `/opt/smdr-insight`, remove it first:

```bash
# Run the uninstall script
cd /home/elmer/Documents/AppDev/Project-SMDR-billing
sudo ./uninstall-smdr.sh
```

This will:
- Stop the systemd service
- Remove the service file
- Remove the backup cron job
- Delete `/opt/smdr-insight` directory
- Reload systemd

**Manual uninstall (if script doesn't work):**

```bash
# Stop the service
sudo systemctl stop smdr-insight
sudo systemctl disable smdr-insight

# Remove service file
sudo rm /etc/systemd/system/smdr-insight.service

# Remove cron job
sudo rm /etc/cron.d/smdr-insight-backup

# Kill running processes
pkill -f "node.*node-server"

# Remove installation directory
sudo rm -rf /opt/smdr-insight

# Reload systemd
sudo systemctl daemon-reload
```

---

## 🚀 Start the Web Server

### Option 1: Using the start script (Recommended)

```bash
cd /home/elmer/Documents/AppDev/Project-SMDR-billing

# Start on default port 61593
./start-smdr.sh

# Or specify a custom port
./start-smdr.sh 61594
```

### Option 2: Direct command

```bash
cd /home/elmer/Documents/AppDev/Project-SMDR-billing

# Build first (if not already built)
npm run build

# Start the server
SMDR_PORT=61593 node dist/main/main/node-server.js
```

### Option 3: Development mode

```bash
cd /home/elmer/Documents/AppDev/Project-SMDR-billing
npm run dev
```

This starts:
- Vite dev server on port 5173 (hot reload)
- TypeScript watcher for backend

Access at: `http://localhost:5173`

---

## 🌐 Access the Application

Once the server is running:

- **Local:** `https://localhost:61593`
- **Network:** `https://YOUR_SERVER_IP:61593`

**Bootstrap Login:**
- Set `SMDR_BOOTSTRAP_ADMIN_PASSWORD` before first start
- Optional: set `SMDR_BOOTSTRAP_ADMIN_USERNAME` (defaults to `admin`)

---

## 🔧 Configuration

Configuration files are stored in the `config/` directory:

- `config/settings.json` - Main configuration
- `config/billing.json` - Billing rules and rates
- `config/smdr-insight.sqlite` - Database

### Change Port

Edit `config/settings.json` or use environment variable:

```bash
SMDR_PORT=61594 node dist/main/main/node-server.js
```

### Configure MiVB Connection

1. Login to the web interface
2. Go to **Settings** page
3. Enter your MiVoice Business controller IP
4. Default port: `1752`
5. Click **Save Configuration**

---

## 📦 Build Commands

```bash
# Clean build
npm run clean
npm run build

# Build and start
npm run serve

# Development mode (hot reload)
npm run dev

# Run tests
npm test
```

---

## 🔒 Security Recommendations

1. **Set bootstrap admin credentials before first start**
   ```bash
   export SMDR_BOOTSTRAP_ADMIN_PASSWORD="your-initial-admin-password"
   export SMDR_BOOTSTRAP_ADMIN_USERNAME="admin"
   ```
2. **Set JWT secret** in production:
   ```bash
   export SMDR_JWT_SECRET="your-secure-secret-key"
   ```
3. **Use TLS certs for HTTPS** (`config/tls/server.crt` and `config/tls/server.key` are auto-generated if missing)
4. **Configure firewall** to allow only trusted IPs
5. **Regular backups** of the config directory

---

## 🛠️ Troubleshooting

### Port already in use

```bash
# Check what's using port 61593
ss -tlnp | grep 61593

# Kill the process
kill <PID>

# Or use a different port
./start-smdr.sh 61594
```

### Database errors

```bash
# Check file permissions
ls -la config/

# Fix permissions if needed
chmod 644 config/*.sqlite
chmod 755 config/
```

### Can't access from network

```bash
# Check firewall
sudo ufw status
sudo ufw allow 61593/tcp

# Check server IP
hostname -I
```

---

## 📝 What Changed (v2.0 - Web Only)

### Removed:
- ❌ Electron desktop app
- ❌ electron-builder
- ❌ electron-log
- ❌ electron-store
- ❌ wait-on dependency
- ❌ All Electron-specific code

### Added:
- ✅ Web-only architecture
- ✅ Simplified deployment
- ✅ Start script (`start-smdr.sh`)
- ✅ Uninstall script (`uninstall-smdr.sh`)
- ✅ Enhanced UI design from mockup

### Updated:
- ✅ Package.json (web-only scripts)
- ✅ TypeScript config (removed Electron types)
- ✅ README (web-focused documentation)

---

## 📞 Support

For issues or questions:
- Check the logs: Server outputs to console
- Review config: `config/settings.json`
- Check database: `config/smdr-insight.sqlite`

---

**Publisher:** elmertech  
**Version:** 2.1.0-web  
**License:** MIT
