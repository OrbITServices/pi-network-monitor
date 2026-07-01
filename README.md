# Pi Network Monitor

Lightweight Raspberry Pi network monitor.

## Features

- Network discovery using `arp-scan` where available
- Manual device add
- Monitor/unmonitor selected devices
- Ping checks
- Offline and recovery alerts
- SMTP email alerts
- Alert history
- SQLite database
- Systemd service
- Git-friendly update script

## Recommended hardware

- Raspberry Pi 3B+ minimum for client sites
- Raspberry Pi 4 or 5 preferred
- Wired Ethernet strongly recommended

## Install on Raspberry Pi OS Lite

```bash
sudo apt update
sudo apt install -y git nodejs npm arp-scan iputils-ping

cd /opt
sudo git clone https://github.com/YOURORG/pi-network-monitor.git
sudo chown -R $USER:$USER /opt/pi-network-monitor
cd /opt/pi-network-monitor

cp .env.example .env
nano .env

chmod +x install.sh update.sh
./install.sh
```

Open:

```text
http://PI-IP:3000
```

## Enable system service

```bash
sudo cp systemd/pi-network-monitor.service /etc/systemd/system/pi-network-monitor.service
sudo systemctl daemon-reload
sudo systemctl enable pi-network-monitor
sudo systemctl start pi-network-monitor
sudo systemctl status pi-network-monitor
```

## Update from Git

```bash
cd /opt/pi-network-monitor
./update.sh
```

## Notes

Keep `.env` out of Git. Use `.env.example` for safe defaults only.
