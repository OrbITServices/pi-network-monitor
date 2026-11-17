#!/usr/bin/env python3
"""Optional outbound WordPress reporting for the existing Pi Network Monitor.
Uses Python standard library only. Does not modify the local monitoring database.
"""
import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_CONFIG = '/opt/pi-network-monitor/orb-reporter.json'


def load_config(path):
    with open(path, encoding='utf-8') as handle:
        cfg = json.load(handle)
    for key in ('wordpress_url', 'site_key', 'api_key', 'database'):
        if not cfg.get(key):
            raise ValueError('Missing configuration: ' + key)
    url = cfg['wordpress_url'].rstrip('/')
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('wordpress_url must be a public HTTPS website URL, without credentials or query parameters')
    cfg['wordpress_url'] = url
    return cfg


def normalise_status(value):
    v = str(value or '').strip().lower()
    if v in ('up', 'online', 'ok', 'healthy'):
        return 'online'
    if v in ('down', 'offline', 'failed', 'unreachable'):
        return 'offline'
    return 'unknown'


def collect(db_path):
    uri = Path(db_path).resolve().as_uri() + '?mode=ro'
    conn = sqlite3.connect(uri, uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        cols = {row['name'] for row in conn.execute('PRAGMA table_info(devices)')}
        if not {'id', 'name', 'ip', 'status'}.issubset(cols):
            raise ValueError('The devices table is missing expected columns')
        selected = [c for c in ('id', 'name', 'ip', 'mac', 'hostname', 'status', 'monitored', 'last_checked') if c in cols]
        records = conn.execute('SELECT ' + ','.join(selected) + ' FROM devices').fetchall()
        result = []
        for d in records:
            row = dict(d)
            mac = str(row.get('mac') or '').strip().lower()
            key = 'local-' + str(row['id'])
            result.append({
                'key': key,
                'name': str(row.get('name') or row.get('hostname') or row.get('ip') or key),
                'ip': str(row.get('ip') or ''),
                'mac': mac,
                'hostname': str(row.get('hostname') or ''),
                'status': normalise_status(row.get('status')),
                'monitored': bool(row.get('monitored', 1)),
                'last_checked': str(row.get('last_checked') or ''),
            })
        return result
    finally:
        conn.close()


def report(cfg, devices):
    endpoint = cfg['wordpress_url'] + '/wp-json/orb-monitor/v1/report'
    body = json.dumps({'site_key': cfg['site_key'], 'devices': devices}, separators=(',', ':')).encode('utf-8')
    request = urllib.request.Request(endpoint, data=body, headers={
        'Content-Type': 'application/json',
        'X-Orb-Monitor-Key': cfg['api_key'],
        'User-Agent': 'OrbPiReporter/0.1',
    }, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError('WordPress rejected the report')
    return result


def main():
    parser = argparse.ArgumentParser(description='Send local Pi Monitor status to WordPress')
    parser.add_argument('--config', default=os.environ.get('ORB_REPORTER_CONFIG', DEFAULT_CONFIG))
    parser.add_argument('--dry-run', action='store_true', help='Read devices without sending them')
    args = parser.parse_args()
    try:
        cfg = load_config(args.config)
        devices = collect(cfg['database'])
        if len(devices) > 500:
            raise ValueError('Too many devices (500 maximum per site)')
        if args.dry_run:
            print('Local database OK. Devices: %d. No data sent.' % len(devices))
        else:
            result = report(cfg, devices)
            print('Report accepted: %d devices; %d status changes' % (result.get('received', 0), result.get('changes', 0)))
    except (OSError, ValueError, sqlite3.Error, urllib.error.URLError, RuntimeError) as exc:
        print('Reporter error: %s' % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
