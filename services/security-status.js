const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const run = promisify(execFile);
async function command(file, args = [], timeout = 7000) {
  try { const r = await run(file, args, { timeout, maxBuffer: 200000 }); return r.stdout.trim(); }
  catch (e) { return 'Unavailable'; }
}
function read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } }
function aptConfig(key) {
  const files = ['/etc/apt/apt.conf', ...(() => { try { return fs.readdirSync('/etc/apt/apt.conf.d').map(n => '/etc/apt/apt.conf.d/' + n); } catch { return []; } })()];
  for (const file of files.reverse()) {
    const lines = read(file).split('\n').filter(line => !/^\s*(#|\/\/)/.test(line));
    for (const line of lines.reverse()) {
      const m = line.match(new RegExp('^\\s*' + key.replace(/:/g, '\\:') + '\\s+"([^"]+)"'));
      if (m) return m[1];
    }
  }
  return 'Not configured';
}
async function status() {
  const os = read('/etc/os-release').match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] || 'Unknown';
  const node = await command('/usr/bin/node', ['--version']);
  const npm = await command('/usr/bin/npm', ['--version']);
  const python = await command('/usr/bin/python3', ['--version']);
  const sqlite = await command('/usr/bin/sqlite3', ['--version']);
  const caddyVersion = await command('/usr/bin/caddy', ['version']);
  const caddy = await command('/usr/bin/systemctl', ['is-active', 'caddy']);
  const updates = await command('/usr/bin/dpkg-query', ['-W', '-f=${Status}', 'unattended-upgrades']);
  const ssh = await command('/usr/bin/systemctl', ['is-active', 'ssh']);
  const firewall = await command('/usr/bin/systemctl', ['is-active', 'ufw']);
  const reboot = fs.existsSync('/var/run/reboot-required');
  const upgradeList = await command('/usr/bin/apt', ['list', '--upgradable']);
  const sshEffective = await command('/usr/sbin/sshd', ['-T']);
  const sshValues = {};
  for (const line of sshEffective.split('\n')) {
    const [key, ...value] = line.split(' ');
    if (['port','passwordauthentication','permitrootlogin','pubkeyauthentication','kbdinteractiveauthentication','maxauthtries','x11forwarding'].includes(key)) sshValues[key] = value.join(' ');
  }
  const lastUpdate = await command('/usr/bin/stat', ['-c', '%y', '/var/lib/apt/periodic/update-success-stamp']);
  let appVersion = 'Unknown';
  try { appVersion = require('../package.json').version || 'Unknown'; } catch {}
  return {
    os, node, npm, python, sqlite, caddyVersion, appVersion, caddy, ssh, firewall,
    sshValues, sshEffectiveAvailable: sshEffective !== 'Unavailable',
    unattended: updates.includes('install ok installed'),
    autoLists: aptConfig('APT::Periodic::Update-Package-Lists'),
    autoUpgrade: aptConfig('APT::Periodic::Unattended-Upgrade'),
    lastUpdate,
    reboot,
    pending: upgradeList === 'Unavailable' ? 'Unknown' : upgradeList.split('\n').filter(x => x.includes('[upgradable from:')).length,
    checkedAt: new Date().toISOString()
  };
}
module.exports = { status };
