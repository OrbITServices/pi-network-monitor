#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Updating Pi Network Monitor..."
git pull
npm install --omit=dev

if systemctl list-units --full -all | grep -q "pi-network-monitor.service"; then
  sudo systemctl restart pi-network-monitor
  echo "Service restarted."
else
  echo "Updated. Service not installed, restart the app manually."
fi
