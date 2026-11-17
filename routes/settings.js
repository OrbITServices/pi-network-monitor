const express = require('express');
const router = express.Router();
const { getSettings, setSetting } = require('../services/db');
const { sendTestEmail, parseRecipients } = require('../services/mailer');
const login = require('../services/wp-login');
const wordpress = require('../services/wordpress-reporting');

router.get('/', (req, res) => {
  res.render('settings', { title: 'Settings', settings: getSettings(), message: req.query.message || '' });
});

router.post('/', (req, res) => {
  const allowed = [
    'check_interval_seconds',
    'fail_threshold',
    'recovery_threshold',
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      const value = Number(req.body[key]);
      if (!Number.isInteger(value) || value < 1 || value > 3600) {
        return res.redirect('/settings?message=' + encodeURIComponent('Monitoring values must be whole numbers between 1 and 3600.'));
      }
    }
  }
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) setSetting(key, String(req.body[key]));
  }

  res.redirect('/settings?message=' + encodeURIComponent('Settings saved. Restart the service if you changed the check interval.'));
});

router.post('/advanced/test-email', requireWpPassword, async (req, res) => {
  try {
    await sendTestEmail();
    res.redirect('/settings/advanced?message=' + encodeURIComponent('Test email sent.'));
  } catch (err) {
    res.redirect('/settings/advanced?message=' + encodeURIComponent('Email failed: ' + err.message));
  }
});

function requireWpPassword(req, res, next) {
  const auth = req.headers.authorization || '';
  let username = '', password = '';
  if (auth.startsWith('Basic ')) {
    try {
      const value = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const index = value.indexOf(':');
      username = value.slice(0, index);
      password = value.slice(index + 1);
    } catch (_) {}
  }
  if (!login.verify(username, password)) {
    res.set('WWW-Authenticate', 'Basic realm="Orb WordPress Settings"');
    return res.status(401).send('WordPress settings login required.');
  }
  res.set('Cache-Control', 'no-store');
  req.wpLogin = login.ensure();
  next();
}
router.get('/advanced', requireWpPassword, (req, res) => {
  res.render('advanced-settings', { title: 'Advanced Settings', settings: getSettings(), message: req.query.message || '', mustChange: req.wpLogin.mustChange });
});
router.post('/advanced', requireWpPassword, (req, res) => {
  const allowed = ['site_name','subnet','smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','alert_from','alert_to'];
  try {
    const values = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) values[key] = String(req.body[key]);
    }
    if (Object.prototype.hasOwnProperty.call(values, 'alert_to')) {
      const recipients = parseRecipients(values.alert_to);
      if (recipients.length > 50) throw Error('Maximum 50 alert recipients.');
      values.alert_to = recipients.join(', ');
    }
    if (Object.prototype.hasOwnProperty.call(values, 'smtp_port')) {
      const port = Number(values.smtp_port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid SMTP port.');
    }
    // An empty password retains the existing SMTP password.
    if (!values.smtp_pass) delete values.smtp_pass;
    for (const [key, value] of Object.entries(values)) setSetting(key, value);
    res.redirect('/settings/advanced?message=' + encodeURIComponent('Advanced settings saved.'));
  } catch (err) {
    res.redirect('/settings/advanced?message=' + encodeURIComponent(err.message + ' No settings were saved.'));
  }
});
function renderWp(req, res, message, status = 200) {
  res.status(status).render('wordpress-settings', {
    title: 'WordPress Reporting', settings: getSettings(),
    wp: wordpress.publicConfig(), message, mustChange: req.wpLogin.mustChange,
    loginUsername: req.wpLogin.username
  });
}
router.post('/wordpress/change-login', requireWpPassword, (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (password !== String(req.body.confirm_password || '')) throw Error('Passwords do not match');
    login.change(username, password);
    res.set('WWW-Authenticate', 'Basic realm="Orb WordPress Settings"');
    res.status(401).send('Login updated. Refresh the page and sign in with your new username and password.');
  } catch (e) { renderWp(req, res, e.message, 400); }
});
router.get('/wordpress', requireWpPassword, (req, res) => {
  renderWp(req, res, req.query.message || '');
});
router.post('/wordpress', requireWpPassword, (req, res) => {
  try { wordpress.save(req.body); res.redirect('/settings/wordpress?message=Configuration saved'); }
  catch (e) { renderWp(req, res, e.message, 400); }
});
router.post('/wordpress/test', requireWpPassword, async (req, res) => {
  const result = await wordpress.send();
  res.redirect('/settings/wordpress?message=' + encodeURIComponent(result.status));
});
router.get('/security', requireWpPassword, async (req, res) => {
  try {
    const security = await require('../services/security-status').status();
    res.render('security', { title: 'Security Status', settings: getSettings(), security });
  } catch (err) {
    res.status(500).send('Security checks unavailable.');
  }
});
module.exports = router;
