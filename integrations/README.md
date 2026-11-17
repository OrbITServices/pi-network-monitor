# Orb Monitor Hub integration (test release)

This repository contains the original Pi Network Monitor (Node.js) in the root.

- `wordpress/orb-monitor-hub/orb-monitor-hub.php` — WordPress receiver plugin v0.1.0.
- `integrations/pi-agent/` — optional Python reporter and systemd timer.

## WordPress

Upload a ZIP containing the `orb-monitor-hub` folder through WordPress Plugins > Add New, activate, and create a site in Orb Monitor. Keep the generated API key private.

## Raspberry Pi

First install and verify the root Pi Network Monitor app. As the `wallboard` user, run:

```bash
cd /opt/pi-network-monitor/integrations/pi-agent
bash install.sh
```

The installer prompts for the HTTPS WordPress URL, site key and API key, then enables a one-minute timer. Configuration is saved locally at `/opt/pi-network-monitor/orb-reporter.json` and must **never** be committed to Git.

The reporter reads the existing SQLite database without modifying it. It does not alter local monitoring frequency. The original `main` branch monitor still enforces a minimum 15-second interval and uses the original IP-only database schema. These need separate tested changes for 10-second critical monitoring and MAC-first support.

**Status:** Initial integration, not production-validated. Do not rely on WordPress alone for critical outage alerting. The timer reports every minute and WordPress events are inferred from successive snapshots; short outages may be missed centrally.
