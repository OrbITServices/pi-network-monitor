const express = require('express');
const router = express.Router();
const { getSettings, setSetting } = require('../services/db');
const { sendTestEmail } = require('../services/mailer');
const crypto = require('crypto');
const wordpress = require('../services/wordpress-reporting');

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

function requireWpPassword(req, res, next) {
  const expected = process.env.ORB_WP_SETTINGS_PASSWORD;
  if (!expected) return res.status(503).send('WordPress configuration is locked. Rerun the installer to generate an admin password.');
  const auth = req.headers.authorization || '';
  let supplied = '';
  if (auth.startsWith('Basic ')) {
    try { supplied = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':'); } catch (_) {}
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.set('WWW-Authenticate', 'Basic realm="Orb WordPress Settings"');
    return res.status(401).send('WordPress settings password required.');
  }
  next();
}
router.get('/wordpress', requireWpPassword, (req, res) => {
  res.render('wordpress-settings', { title: 'WordPress Reporting', settings: getSettings(), wp: wordpress.publicConfig(), message: req.query.message || '' });
});
router.post('/wordpress', requireWpPassword, (req, res) => {
  try { wordpress.save(req.body); res.redirect('/settings/wordpress?message=Configuration saved'); }
  catch (e) { res.status(400).render('wordpress-settings', { title: 'WordPress Reporting', settings: getSettings(), wp: wordpress.publicConfig(), message: e.message }); }
});
router.post('/wordpress/test', requireWpPassword, async (req, res) => {
  const result = await wordpress.send();
  res.redirect('/settings/wordpress?message=' + encodeURIComponent(result.status));
});
module.exports = router;
