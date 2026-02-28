# SMDR Insight

[![Build and Release](https://github.com/gabaelmer/SMDR-Miner/actions/workflows/build.yml/badge.svg)](https://github.com/gabaelmer/SMDR-Miner/actions/workflows/build.yml)

**SMDR Insight** is a modern, high-stability SMDR (Station Message Detail Recording) collector and analytics platform designed for MiVoice Business systems. It provides real-time call tracking, advanced security alerts, and a beautiful web-based dashboard for network-wide monitoring.

---

## 🌟 Key Features

- **High-Stability TCP Client**: Persistent connection to MiVB SMDR streams (port `1752`) with custom "Quiet Period" handling for low-volume systems.
- **Headless Server Mode**: Optimized background service running on pure Node.js—no display hardware (X Server) required.
- **Modern Web Interface**: Beautiful dashboard accessible from any device on your network, with persistent sessions across page refreshes.
- **Real-time Analytics**: Live call log, volume heatmaps, extension usage, and correlation analytics.
- **Robust Alert Engine**: Instant detection of long calls, watch numbers, repeated busy calls, and toll-denied events.
- **Persistent Configuration**: Settings (including Mitel IP addresses) are saved instantly to the server and survive service restarts.
- **Secure by Design**: Role-based access, session persistence, and optional field-level encryption for PII.
- **Universal Installer**: One-liner installer for Debian/Ubuntu that works for any user account or root, with full systemd integration.

---

## 🚀 Installation (Ubuntu/Debian)

Deploy SMDR Insight as a background service with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash
```

The installer will:
1. Install all required dependencies and tools (Node.js 24, npm, git, build-essential, OpenSSL, etc.)
2. Clone/update this repository in `/opt/smdr-insight`
3. Build frontend + backend and rebuild native modules
4. Create a production `systemd` service (`smdr-insight`)
5. Start HTTPS service on port `61593` and optionally open firewall port in `ufw`

After installation, the app is instantly available at:
`https://your-server-ip:61593`

Installer options example:
```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash -s -- --port 61593 --repo-ref main
```

> [!TIP]
> **First Login Bootstrap**: By default, the installer automatically generates a secure `SMDR_BOOTSTRAP_ADMIN_PASSWORD` and prints it at the end of the installation logs. Use `admin` and this password to log in for the first time, and then change it immediately! If you missed the password, you can check `/etc/default/smdr-insight`.

---

## 🛠️ Technical Stack

- **Runtime**: Node.js 24+ (Web Service)
- **Language**: TypeScript
- **Database**: SQLite (`better-sqlite3`) with daily rollover
- **Frontend**: React 18, TailwindCSS, Zustand
- **Real-time**: Server-Sent Events (SSE)
- **Charts**: Recharts
- **Service**: systemd (Linux)

---

## 💻 Service Management

Manage your collector directly from the terminal:

```bash
# Check status
sudo systemctl status smdr-insight

# View real-time logs (Data stream & Web Access)
sudo journalctl -u smdr-insight -f

# Restart service
sudo systemctl restart smdr-insight
```

---

## 🏗️ Development

### Setup
```bash
git clone https://github.com/gabaelmer/SMDR-Miner.git
cd SMDR-Miner
npm install
npm run build
```

### Run Commands
- `npm run dev`: Run renderer + backend watchers (Dev Mode)
- `npm run serve:node`: Run the pure Node server locally

---

## 📝 Troubleshooting

| Issue | Solution |
|---|---|
| Web UI not accessible | Open port 61593: `sudo ufw allow 61593/tcp` |
| `SQLITE_CANTOPEN` error | Permission issue — re-run `install.sh` to reset ownership |
| Settings not saving | Check write permissions on `/opt/smdr-insight/config/` |
| Can't log in on first start | Check the installation log or `/etc/default/smdr-insight` for `SMDR_BOOTSTRAP_ADMIN_PASSWORD` |
| Connection drops | Check `journalctl` for TCP errors; verify PBX is reachable on port 1752 |
| Port 61593 conflict | Another service is using port 61593 — set `SMDR_PORT` to another value |

---
*Maintained by the elmertech team.*
