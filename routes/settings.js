const express = require('express');
const router = express.Router();
const { getSettings, setSetting } = require('../services/db');
const { sendTestEmail } = require('../services/mailer');

router.get('/', (req, res) => {
  res.render('settings', { title: 'Settings', settings: getSettings(), message: req.query.message || '' });
});

router.post('/', (req, res) => {
  const allowed = [
    'site_name',
    'subnet',
    'check_interval_seconds',
    'fail_threshold',
    'recovery_threshold',
    'smtp_host',
    'smtp_port',
    'smtp_secure',
    'smtp_user',
    'smtp_pass',
    'alert_from',
    'alert_to'
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      setSetting(key, req.body[key]);
    }
  }

  res.redirect('/settings?message=' + encodeURIComponent('Settings saved. Restart the service if you changed the check interval.'));
});

router.post('/test-email', async (req, res) => {
  try {
    await sendTestEmail();
    res.redirect('/settings?message=' + encodeURIComponent('Test email sent.'));
  } catch (err) {
    res.redirect('/settings?message=' + encodeURIComponent('Email failed: ' + err.message));
  }
});

module.exports = router;
