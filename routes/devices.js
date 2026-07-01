const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../services/db');
const { discover } = require('../services/discovery');

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
  const { name, ip, check_type, check_port } = req.body;

  if (!ip) return res.redirect('/devices?message=' + encodeURIComponent('IP address is required.'));

  db.prepare(`
    INSERT INTO devices (name, ip, monitored, check_type, check_port)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      name = excluded.name,
      monitored = 1,
      check_type = excluded.check_type,
      check_port = excluded.check_port,
      updated_at = CURRENT_TIMESTAMP
  `).run(name || ip, ip, check_type || 'ping', check_port || null);

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
  db.prepare('UPDATE devices SET name = ?, check_type = ?, check_port = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, check_type || 'ping', check_port || null, req.params.id);
  res.redirect('/devices');
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM alerts WHERE device_id = ?').run(req.params.id);
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.redirect('/devices');
});

module.exports = router;
