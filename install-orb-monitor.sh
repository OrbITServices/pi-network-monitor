#!/usr/bin/env bash
# Orb Pi Network Monitor one-file installer for Raspberry Pi OS Lite (64-bit).
# Usage: curl -fsSLo install-orb-monitor.sh https://raw.githubusercontent.com/OrbITServices/pi-network-monitor/main/install-orb-monitor.sh
#        less install-orb-monitor.sh
#        bash install-orb-monitor.sh
set -Eeuo pipefail
trap 'echo "Installation failed on line $LINENO. Check output above." >&2' ERR

REPO_URL="https://github.com/OrbITServices/pi-network-monitor.git"
INSTALL_DIR="/opt/pi-network-monitor"
SERVICE_NAME="pi-network-monitor"
APP_USER="$(id -un)"
APP_GROUP="$(id -gn)"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
OS_ARCH="$(dpkg --print-architecture)"
SUDO=""
if [ "$(id -u)" -eq 0 ]; then
  echo "Run as your normal PiMon account, not root. The script uses sudo where necessary." >&2
  exit 1
fi
if [ "$OS_ARCH" != "arm64" ]; then
  echo "This installer is intended for Raspberry Pi OS Lite 64-bit (arm64). Found: $OS_ARCH" >&2
  exit 1
fi
if ! grep -qi 'debian' /etc/os-release; then
  echo "Warning: this installer is tested for Debian-based Raspberry Pi OS." >&2
fi
command -v sudo >/dev/null || { echo "sudo is required." >&2; exit 1; }
sudo -v
echo "=== Orb Pi Network Monitor installer ==="
echo "Linux account: $APP_USER"
echo "Hostname: $(hostname)"
echo "Installation: $INSTALL_DIR"
echo
read -r -p "Continue? [Y/n] " ANSWER
if [[ "${ANSWER,,}" == "n" ]]; then exit 0; fi

echo "[1/8] Installing system dependencies..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates build-essential python3 python3-dev make g++ sqlite3 arp-scan iputils-ping libcap2-bin unattended-upgrades caddy ufw

echo "[2/8] Checking Node.js..."
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"; fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Installing Node.js 22 from NodeSource..."
  curl -fsSLo /tmp/orb-nodesource-setup.sh https://deb.nodesource.com/setup_22.x
  echo "Review the NodeSource installer at /tmp/orb-nodesource-setup.sh if required."
  sudo -E bash /tmp/orb-nodesource-setup.sh
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
node --version
npm --version

echo "[3/8] Installing or updating Git repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
  OWNER="$(stat -c '%U' "$INSTALL_DIR")"
  if [ "$OWNER" != "$APP_USER" ]; then
    echo "$INSTALL_DIR is owned by $OWNER; refusing to modify another user's install." >&2
    exit 1
  fi
  cd "$INSTALL_DIR"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "Tracked local changes exist. Commit or back them up before updating. Nothing overwritten." >&2
    exit 1
  fi
  git fetch --tags origin
  git checkout main
  git pull --ff-only origin main
else
  if [ -e "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR")" ]; then
    echo "$INSTALL_DIR already contains files but is not a Git checkout. Stopping to protect data." >&2
    exit 1
  fi
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown "$APP_USER:$APP_GROUP" "$INSTALL_DIR"
  git clone --branch main "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo "[4/8] Preparing data and dependencies..."
mkdir -p data backups
chmod 700 data backups
# Existing installs already have customised monitoring settings; preserve them.
if [ -f data/monitor.db ]; then touch data/.orb-defaults-initialized; fi
if [ -f data/monitor.db ]; then
  BACKUP="backups/monitor-$(date -u +%Y%m%dT%H%M%SZ).db"
  sqlite3 data/monitor.db ".backup '$BACKUP'"
  chmod 600 "$BACKUP"
  echo "Database backed up to $BACKUP"
fi
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
# WordPress settings login is stored as a salted hash under data/wp-login.json.
# Fresh installs start with pimon/pimon and require changing it in the GUI.
# Existing changed credentials are retained on subsequent updates.
echo "WordPress settings login on first use: username pimon / password pimon"
echo "Change these credentials immediately in Settings > Configure WordPress Reporting."
# The Node app now schedules reporting itself. Disable the legacy timer to avoid duplicates.
if systemctl list-unit-files orb-pi-reporter.timer --no-legend 2>/dev/null | grep -q '^orb-pi-reporter.timer'; then
  sudo systemctl disable --now orb-pi-reporter.timer || true
fi


echo "[5/8] Initialising monitoring defaults..."
# Do not overwrite settings chosen in the dashboard on subsequent installer runs.
if [ ! -f data/.orb-defaults-initialized ]; then
# The application must support intervals below 15 seconds; this is included in the repository version.
node - <<'NODE'
const { init, setSetting } = require('./services/db');
init();
setSetting('check_interval_seconds', '10');
setSetting('fail_threshold', '2');
setSetting('recovery_threshold', '2');
console.log('Configured interval=10s, failures=2, recovery=2');
NODE
  touch data/.orb-defaults-initialized
fi

echo "Enabling automatic OS security updates..."
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AUTO
sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer || true

echo "Configuring UFW safely..."
# UFW is installed on fresh and existing installations. Never reset existing rules.
# Only enable automatically when no custom inbound services are detected.
if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(sudo ufw status 2>/dev/null | head -n 1 || true)"
  if [[ "$UFW_STATUS" == "Status: active" ]]; then
    echo "UFW already active; preserving existing rules and policies."
  else
    echo "UFW installed but not active. Leaving it disabled to avoid disrupting SSH or other services."
    echo "After reviewing inbound services, allow your SSH port and ports 80/443, then enable UFW."
  fi
else
  echo "Warning: UFW installation could not be verified."
fi

echo "[6/8] Enabling local ARP discovery..."
ARP_BIN="$(command -v arp-scan)"
sudo setcap cap_net_raw,cap_net_admin=eip "$ARP_BIN"
if ! getcap "$ARP_BIN" | grep -q 'cap_net_raw'; then
  echo "Warning: arp-scan capabilities could not be verified." >&2
fi

echo "[7/8] Installing systemd service..."
sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<UNIT
[Unit]
Description=Orb Pi Network Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Restart=always
RestartSec=5
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo "Installing restricted HTTPS management helper..."
sudo install -d -m 755 /usr/local/libexec/orb-monitor
sudo install -o root -g root -m 755 scripts/configure-https.py /usr/local/libexec/orb-monitor/configure-https.py
# Restrict sudo to this root-owned helper, not the Git working tree.
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/orb-monitor/configure-https.py *\n' "$APP_USER" | sudo tee /etc/sudoers.d/orb-monitor-https >/dev/null
sudo chmod 440 /etc/sudoers.d/orb-monitor-https
sudo visudo -cf /etc/sudoers.d/orb-monitor-https

echo "[8/8] Checking service..."
sleep 3
if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  sudo journalctl -u "$SERVICE_NAME" -n 50 --no-pager
  echo "Service did not stay active. See logs above." >&2
  exit 1
fi
sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -n 16 || true
echo
echo "Dashboard: http://$(hostname).local:3000"
echo "Local IP(s): $(hostname -I 2>/dev/null || true)"
echo "Health check: curl -fsS http://127.0.0.1:3000/health"
echo "Logs: sudo journalctl -u pi-network-monitor -f"
echo
echo "Configure or change WordPress from the Pi dashboard: Settings > Configure WordPress Reporting"
echo "Fresh login: pimon / pimon (must be changed on first use). Existing changed login is retained."
echo "Optional HTTPS setup: cd /opt/pi-network-monitor && bash setup-https.sh"
echo "Security status: /settings/security (WordPress settings login required)"
echo "Installation finished."
