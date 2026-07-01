const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const dbPath = path.join(dataDir, 'monitor.db');
const db = new Database(dbPath);

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      ip TEXT NOT NULL UNIQUE,
      mac TEXT,
      vendor TEXT,
      hostname TEXT,
      monitored INTEGER DEFAULT 0,
      check_type TEXT DEFAULT 'ping',
      check_port INTEGER,
      status TEXT DEFAULT 'unknown',
      fail_count INTEGER DEFAULT 0,
      recovery_count INTEGER DEFAULT 0,
      last_seen TEXT,
      last_checked TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      emailed INTEGER DEFAULT 0,
      FOREIGN KEY(device_id) REFERENCES devices(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const defaults = {
    site_name: process.env.SITE_NAME || 'Main Site',
    subnet: process.env.SUBNET || '192.168.1.0/24',
    check_interval_seconds: process.env.CHECK_INTERVAL_SECONDS || '60',
    fail_threshold: process.env.FAIL_THRESHOLD || '3',
    recovery_threshold: process.env.RECOVERY_THRESHOLD || '1',
    smtp_host: process.env.SMTP_HOST || '',
    smtp_port: process.env.SMTP_PORT || '587',
    smtp_secure: process.env.SMTP_SECURE || 'false',
    smtp_user: process.env.SMTP_USER || '',
    smtp_pass: process.env.SMTP_PASS || '',
    alert_from: process.env.ALERT_FROM || '',
    alert_to: process.env.ALERT_TO || ''
  };

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

module.exports = { db, init, getSetting, setSetting, getSettings };
