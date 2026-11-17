const { db, getSettings } = require('./db');
const { checkDevice } = require('./checker');
const { sendMail } = require('./mailer');

let running = false;
let timer = null;

function now() {
  return new Date().toISOString();
}

async function createAlert(device, type, message) {
  const result = db.prepare('INSERT INTO alerts (device_id, type, message) VALUES (?, ?, ?)').run(device.id, type, message);

  try {
    const s = getSettings();
    const subject = `${type === 'offline' ? 'Device Offline' : 'Device Restored'} - ${device.name || device.ip}`;
    const body = [
      `Site: ${s.site_name || 'Main Site'}`,
      `Device: ${device.name || device.ip}`,
      `IP: ${device.ip}`,
      device.mac ? `MAC: ${device.mac}` : '',
      '',
      message
    ].filter(Boolean).join('\n');

    await sendMail(subject, body);
    db.prepare('UPDATE alerts SET emailed = 1 WHERE id = ?').run(result.lastInsertRowid);
  } catch (err) {
    console.error('Email failed:', err.message);
  }
}

async function runChecks() {
  if (running) return;
  running = true;

  try {
    const s = getSettings();
    const failThreshold = Number(s.fail_threshold || 3);
    const recoveryThreshold = Number(s.recovery_threshold || 1);

    const devices = db.prepare('SELECT * FROM devices WHERE monitored = 1').all();

    for (const device of devices) {
      const online = await checkDevice(device);
      const previousStatus = device.status;

      if (online) {
        const recoveryCount = (device.recovery_count || 0) + 1;
        const shouldRecover = previousStatus === 'offline' && recoveryCount >= recoveryThreshold;

        db.prepare(`
          UPDATE devices
          SET status = ?, fail_count = 0, recovery_count = ?, last_seen = ?, last_checked = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shouldRecover ? 'online' : 'online', recoveryCount, now(), now(), device.id);

        if (shouldRecover) {
          await createAlert(device, 'recovery', `${device.name || device.ip} is responding again.`);
          db.prepare('UPDATE devices SET recovery_count = 0 WHERE id = ?').run(device.id);
        }
      } else {
        const failCount = (device.fail_count || 0) + 1;
        const shouldAlert = previousStatus !== 'offline' && failCount >= failThreshold;

        db.prepare(`
          UPDATE devices
          SET status = ?, fail_count = ?, recovery_count = 0, last_checked = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(shouldAlert ? 'offline' : previousStatus || 'unknown', failCount, now(), device.id);

        if (shouldAlert) {
          await createAlert(device, 'offline', `${device.name || device.ip} failed ${failCount} consecutive checks and is considered offline.`);
        }
      }
    }
  } catch (err) {
    console.error('Monitor error:', err);
  } finally {
    running = false;
  }
}

function start() {
  const s = getSettings();
  const interval = Math.max(2, Number(s.check_interval_seconds || 10)) * 1000;

  runChecks();
  timer = setInterval(runChecks, interval);
  console.log(`Monitor running every ${interval / 1000} seconds.`);
}

module.exports = { start, runChecks };
