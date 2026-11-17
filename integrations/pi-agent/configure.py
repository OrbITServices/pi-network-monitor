#!/usr/bin/env python3
"""Interactive reporter configuration. Run as the user that runs the monitor."""
import getpass
import json
import os
from pathlib import Path

p = Path('/opt/pi-network-monitor/orb-reporter.json')
old = json.loads(p.read_text()) if p.exists() else {}
print('Orb Pi Reporter configuration (press Enter to retain a previous value)')
url = input('WordPress website URL, e.g. https://monitor.example.co.uk [%s]: ' % old.get('wordpress_url', '')).strip() or old.get('wordpress_url', '')
site = input('Site key from WordPress [%s]: ' % old.get('site_key', '')).strip() or old.get('site_key', '')
key = getpass.getpass('API key (leave blank to retain existing): ').strip() or old.get('api_key', '')
db = input('SQLite database path [%s]: ' % old.get('database', '/opt/pi-network-monitor/data/monitor.db')).strip() or old.get('database', '/opt/pi-network-monitor/data/monitor.db')
if not all((url, site, key, db)):
    raise SystemExit('Missing required settings. Nothing saved.')
new = {'wordpress_url': url, 'site_key': site, 'api_key': key, 'database': db}
fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
    json.dump(new, f, indent=2)
    f.write('\n')
os.chmod(p, 0o600)
print('Saved %s (permissions 600)' % p)
