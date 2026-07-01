const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../services/db');

router.get('/', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) AS c FROM devices').get().c,
    monitored: db.prepare('SELECT COUNT(*) AS c FROM devices WHERE monitored = 1').get().c,
    online: db.prepare("SELECT COUNT(*) AS c FROM devices WHERE monitored = 1 AND status = 'online'").get().c,
    offline: db.prepare("SELECT COUNT(*) AS c FROM devices WHERE monitored = 1 AND status = 'offline'").get().c
  };
  const devices = db.prepare('SELECT * FROM devices ORDER BY monitored DESC, status ASC, name ASC, ip ASC').all();
  const alerts = db.prepare('SELECT alerts.*, devices.name, devices.ip FROM alerts LEFT JOIN devices ON devices.id = alerts.device_id ORDER BY alerts.id DESC LIMIT 8').all();
  res.render('index', { title: 'Dashboard', settings: getSettings(), stats, devices, alerts });
});

module.exports = router;
