#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d /opt/pi-network-monitor ]; then
  echo 'Missing /opt/pi-network-monitor. Install the local Pi monitor first.' >&2
  exit 1
fi
if [ "$(id -un)" != 'wallboard' ]; then
  echo 'Run this installer as the wallboard user (it will ask for sudo).' >&2
  exit 1
fi
install -m 755 orb_reporter.py /opt/pi-network-monitor/orb_reporter.py
install -m 700 configure.py /opt/pi-network-monitor/configure_orb_reporter.py
sudo install -m 644 orb-pi-reporter.service /etc/systemd/system/orb-pi-reporter.service
sudo install -m 644 orb-pi-reporter.timer /etc/systemd/system/orb-pi-reporter.timer
python3 /opt/pi-network-monitor/configure_orb_reporter.py
python3 /opt/pi-network-monitor/orb_reporter.py --dry-run
sudo systemctl daemon-reload
sudo systemctl enable --now orb-pi-reporter.timer
sudo systemctl start orb-pi-reporter.service
sudo systemctl --no-pager status orb-pi-reporter.timer
