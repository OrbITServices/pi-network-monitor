const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

function parseRecipients(value) {
  const addresses = String(value || '').split(/[,;\r\n]+/).map(s => s.trim()).filter(Boolean);
  const invalid = addresses.filter(a => !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(a));
  if (invalid.length) throw new Error('Invalid alert recipient: ' + invalid.join(', '));
  return [...new Set(addresses.map(a => a.toLowerCase()))];
}

function getTransport() {
  const s = getSettings();

  if (!s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    throw new Error('SMTP settings are incomplete.');
  }

  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port || 587),
    secure: String(s.smtp_secure) === 'true',
    auth: {
      user: s.smtp_user,
      pass: s.smtp_pass
    },
    requireTLS: String(s.smtp_secure) !== 'true'
  });
}

async function sendMail(subject, text) {
  const s = getSettings();
  const recipients = parseRecipients(s.alert_to);
  if (!recipients.length) throw new Error('Add at least one alert recipient.');
  const transporter = getTransport();

  return transporter.sendMail({
    from: s.alert_from || s.smtp_user,
    to: recipients.join(', '),
    subject,
    text
  });
}

async function sendTestEmail() {
  const s = getSettings();
  return sendMail(
    `Test alert from ${s.site_name || 'Pi Network Monitor'}`,
    `This is a test email from ${s.site_name || 'Pi Network Monitor'}.\n\nIf you received this, email alerting is working.`
  );
}

module.exports = { sendMail, sendTestEmail, parseRecipients };
