# SMDR Insight

[![Build and Release](https://github.com/gabaelmer/SMDR-Miner/actions/workflows/build.yml/badge.svg)](https://github.com/gabaelmer/SMDR-Miner/actions/workflows/build.yml)

SMDR Insight is a web-based Mitel SMDR collector, parser, analytics, and billing platform for MiVoice Business/3300 environments.

## Key Features

- Real-time SMDR TCP stream ingestion (MiVB port `1752`)
- Mitel fixed-width + fallback token parser
- Duplicate prevention during live and file ingestion
- Call log filters, analytics, alerts, and billing reports
- TLS-enabled web server (default `https://<host>:61593`)
- Role-based authentication and audit logging
- Linux `systemd` service installer for Ubuntu/Debian

## Latest Updates (March 2026)

- Added Call Log `.txt` SMDR import to backend (`/api/records/import-text`) and UI.
- Import uses the same parse + dedupe + DB insert pipeline as live streaming.
- Added import summary metrics (inserted, duplicates, parse errors, skipped lines).
- Added audit log action for SMDR imports.
- Improved server start script rebuild behavior to avoid stale `dist` route mismatches.
- Improved Transfer/Conference analytics donut:
  - responsive in-donut labels that stay inside on resize,
  - removed redundant hover tooltip.
- Improved Call Log table:
  - completion code indicators/legend,
  - cleaner pagination layout and controls.
- Updated Billing + Alerts layouts:
  - billing report/table containers now keep scroll localized,
  - top extension widgets now show full ranking with scroll,
  - alerts page now uses a fixed viewport container with only alert list scrolling.
- Hardened Debian/Ubuntu installer:
  - supports root and sudo-based install flows,
  - installs required system tooling automatically,
  - rebuilds from repo source so latest pushed changes are always included,
  - removes stale release files on upgrade while preserving `config/` data.

## Build / Release Checklist

Run these before pushing to GitHub:

```bash
npm install
npm run build
```

Optional:

```bash
npm run test
```

Then push:

```bash
git add .
git commit -m "Release: <your message>"
git push origin main
```

## One-Line Install (Ubuntu/Debian)

Install as a `systemd` service from this repo:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash
```

If already logged in as `root`, run:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | bash
```

This installer supports:

- installation from any user account (run with `sudo`) or directly as `root`
- running the service as:
  - dedicated user (`smdr`, default),
  - invoking account (`--service-user current`),
  - `root` (`--service-user root`)

Install from your own GitHub repo in one line:

```bash
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh | sudo bash -s -- --repo-url https://github.com/<YOUR_USER>/<YOUR_REPO>.git --repo-ref main
```

Examples:

```bash
# Run service as the invoking account
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh | sudo bash -s -- --service-user current

# Run service as root
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh | sudo bash -s -- --service-user root
```

Installer behavior:

- Installs OS tools/dependencies automatically (`git`, `curl`, `build-essential`, `python3`, `fontconfig`, `ufw`, etc.)
- Installs/updates Node.js 24.x automatically
- Clones/updates source in `/opt/smdr-insight`
- On upgrade, hard-resets to the selected git ref and cleans stale files (preserves `/opt/smdr-insight/config`)
- Installs npm dependencies and rebuilds native modules (`better-sqlite3`)
- Rebuilds app from source (`npm run build`) so all pushed frontend/backend changes are included
- Creates and starts `smdr-insight.service`
- Configures runtime env at `/etc/default/smdr-insight`
- Optionally opens firewall port with `ufw`
- Verifies full `systemd` integration before install

## Service Operations

```bash
sudo systemctl status smdr-insight
sudo systemctl restart smdr-insight
sudo journalctl -u smdr-insight -f
```

## Local Development

```bash
git clone https://github.com/gabaelmer/SMDR-Miner.git
cd SMDR-Miner
npm install
npm run dev
```

Production local run:

```bash
npm run build
./start-smdr.sh
```

## Security / Bootstrap Login

On first install (fresh DB), the installer writes bootstrap credentials to:

`/etc/default/smdr-insight`

Default bootstrap username:

- `admin`

Change the password immediately after first login.
