const express = require('express');
const router = express.Router();
const { db, getSettings } = require('../services/db');

router.get('/', (req, res) => {
  const alerts = db.prepare(`
    SELECT alerts.*, devices.name, devices.ip
    FROM alerts
    LEFT JOIN devices ON devices.id = alerts.device_id
    ORDER BY alerts.id DESC
    LIMIT 200
  `).all();

  res.render('alerts', { title: 'Alerts', settings: getSettings(), alerts });
});

router.post('/clear', (req, res) => {
  db.prepare('DELETE FROM alerts').run();
  res.redirect('/alerts');
});

module.exports = router;
