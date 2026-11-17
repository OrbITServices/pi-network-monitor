const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../services/db');
const { discover } = require('../services/discovery');
const normalizeMac = value => String(value || '').trim().toLowerCase().replace(/-/g, ':');
const validMac = value => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(value);

router.get('/', (req, res) => {
  const devices = db.prepare('SELECT * FROM devices ORDER BY monitored DESC, name ASC, ip ASC').all();
  res.render('devices', { title: 'Devices', settings: getSettings(), devices, message: req.query.message || '' });
});

router.post('/discover', async (req, res) => {
  const s = getSettings();
  const result = await discover(s.subnet);

  if (result.ok) {
    const upsert = db.prepare(`
      INSERT INTO devices (ip, mac, vendor, hostname, name, status, last_seen, last_checked)
      VALUES (@ip, @mac, @vendor, @hostname, @ip, 'online', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(ip) DO UPDATE SET
        mac = excluded.mac,
        vendor = excluded.vendor,
        hostname = excluded.hostname,
        last_seen = CURRENT_TIMESTAMP,
        last_checked = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `);

    const tx = db.transaction((devices) => {
      for (const d of devices) upsert.run(d);
    });
    tx(result.devices);

    return res.redirect('/devices?message=' + encodeURIComponent(`Discovery complete. Found ${result.devices.length} devices.`));
  }

  res.redirect('/devices?message=' + encodeURIComponent(result.error));
});

router.post('/add', (req, res) => {
  const name = String(req.body.name || '').trim();
  const ip = String(req.body.ip || '').trim();
  const mac = normalizeMac(req.body.mac);
  const type = String(req.body.check_type || 'arp');
  const port = Number(req.body.check_port);
  const error = msg => res.redirect('/devices?message=' + encodeURIComponent(msg));
  if (!['arp','ping','tcp'].includes(type)) return error('Invalid monitoring method.');
  if (type === 'arp' && !validMac(mac)) return error('A valid MAC address is required for ARP monitoring.');
  if (type !== 'arp' && !require('net').isIP(ip)) return error('A valid IP address is required for Ping/TCP monitoring.');
  if (type === 'tcp' && (!Number.isInteger(port) || port < 1 || port > 65535)) return error('Enter a valid TCP port.');
  const keyIp = ip || 'mac:' + mac;
  const existing = type === 'arp' ? db.prepare('SELECT id FROM devices WHERE mac = ?').get(mac) : null;
  if (existing) {
    db.prepare('UPDATE devices SET name=?, monitored=1, check_type=?, ip=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(name || mac, type, keyIp, existing.id);
  } else {
    db.prepare(`INSERT INTO devices (name, ip, mac, monitored, check_type, check_port)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET name=excluded.name, mac=excluded.mac,
      monitored=1, check_type=excluded.check_type, check_port=excluded.check_port,
      updated_at=CURRENT_TIMESTAMP`)
      .run(name || mac || ip, keyIp, mac || null, type, type === 'tcp' ? port : null);
  }
  res.redirect('/devices?message=' + encodeURIComponent('Device saved.'));
});

router.post('/:id/toggle', (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (device) {
    db.prepare('UPDATE devices SET monitored = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(device.monitored ? 0 : 1, device.id);
  }
  res.redirect('/devices');
});

router.post('/:id/update', (req, res) => {
  const { name, check_type, check_port } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device || !['arp', 'ping', 'tcp'].includes(check_type)) return res.redirect('/devices?message=Invalid+device+or+method');
  if (check_type === 'arp' && !validMac(normalizeMac(device.mac))) return res.redirect('/devices?message=ARP+requires+a+valid+MAC+address');
  const port = Number(check_port);
  if (check_type === 'tcp' && (!Number.isInteger(port) || port < 1 || port > 65535)) return res.redirect('/devices?message=Invalid+TCP+port');
  db.prepare('UPDATE devices SET name = ?, check_type = ?, check_port = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, check_type, check_type === 'tcp' ? port : null, req.params.id);
  res.redirect('/devices');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM alerts WHERE device_id = ?').run(req.params.id);
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.redirect('/devices');
});

module.exports = router;
