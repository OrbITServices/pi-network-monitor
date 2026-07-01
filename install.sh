#!/bin/bash
set -e

echo "Installing Pi Network Monitor..."

sudo apt update
sudo apt install -y nodejs npm arp-scan iputils-ping

npm install --omit=dev

mkdir -p data

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Please edit it before production use."
fi

chmod +x update.sh

echo ""
echo "Install complete."
echo "Run with: npm start"
echo "Or install service with:"
echo "sudo cp systemd/pi-network-monitor.service /etc/systemd/system/pi-network-monitor.service"
echo "sudo systemctl daemon-reload && sudo systemctl enable --now pi-network-monitor"
