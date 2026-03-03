# SMDR Insight - Ubuntu/Debian Install Guide

This guide matches the current `install.sh` behavior.

## Quick Install (One-Liner)

Run from any non-root user account:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash
```

Run directly as root:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | bash
```

## Custom Install Examples

Custom HTTPS port:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash -s -- --port 61594
```

Install from your own repository:

```bash
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh \
  | sudo bash -s -- --repo-url https://github.com/<YOUR_USER>/<YOUR_REPO>.git --repo-ref main
```

Run service as invoking account:

```bash
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh \
  | sudo bash -s -- --service-user current
```

Run service as root:

```bash
curl -fsSL https://raw.githubusercontent.com/<YOUR_USER>/<YOUR_REPO>/main/install.sh \
  | sudo bash -s -- --service-user root
```

## What the Installer Does

- Validates systemd availability (full systemd integration required).
- Installs required packages automatically (`git`, `curl`, `build-essential`, `python3`, `fontconfig`, `ufw`, etc.).
- Installs/updates Node.js 24.x automatically.
- Clones or updates app source in `/opt/smdr-insight`.
- Installs npm dependencies and rebuilds native modules (`better-sqlite3`).
- Builds latest app code (`npm run build`) so all pushed frontend/backend changes are included.
- Creates and enables `smdr-insight.service`.
- Writes runtime env to `/etc/default/smdr-insight`.
- Configures firewall rule for the HTTPS port when UFW is active.

## Installed Paths

- App directory: `/opt/smdr-insight`
- Runtime env: `/etc/default/smdr-insight`
- Systemd unit: `/etc/systemd/system/smdr-insight.service`
- Config/data: `/opt/smdr-insight/config`

## First Login

On fresh install, installer writes bootstrap admin credentials to:

- `/etc/default/smdr-insight`

Default username is `admin`. Change password immediately after first login.

## Verify and Operate Service

```bash
sudo systemctl status smdr-insight
sudo systemctl restart smdr-insight
sudo journalctl -u smdr-insight -f
```

Web URL:

```text
https://<server-ip>:61593
```

(Port may differ if `--port` is used.)

## Upgrade / Reinstall to Pull Latest GitHub Changes

Re-run the installer one-liner on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/gabaelmer/SMDR-Miner/main/install.sh | sudo bash
```

This updates source, reinstalls dependencies as needed, rebuilds, and restarts the systemd service.

## Uninstall

From a cloned repo checkout:

```bash
sudo ./uninstall-smdr.sh
```

## Troubleshooting

If service fails to start:

```bash
sudo journalctl -u smdr-insight --no-pager -n 200
```

If you changed service/env values manually:

```bash
sudo systemctl daemon-reload
sudo systemctl restart smdr-insight
```
