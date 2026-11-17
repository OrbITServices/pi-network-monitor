const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
async function command(file, args = []) {
  try { const r = await run(file, args, { timeout: 7000, maxBuffer: 150000 }); return r.stdout.trim(); }
  catch (e) { return e.stdout ? String(e.stdout).trim() : 'Unavailable'; }
}
async function status() {
  const os = await command('/usr/bin/grep', ['PRETTY_NAME=', '/etc/os-release']);
  const node = await command('/usr/bin/node', ['--version']);
  const caddy = await command('/usr/bin/systemctl', ['is-active', 'caddy']);
  const updates = await command('/usr/bin/dpkg-query', ['-W', '-f=${Status}', 'unattended-upgrades']);
  const ssh = await command('/usr/bin/systemctl', ['is-active', 'ssh']);
  const firewall = await command('/usr/bin/systemctl', ['is-active', 'ufw']);
  const reboot = fs.existsSync('/var/run/reboot-required');
  const upgradeList = await command('/usr/bin/apt', ['list', '--upgradable']);
  return {
    os: os.replace(/^PRETTY_NAME="?|"?$/g, ''),
    node, caddy, ssh, firewall,
    unattended: updates.includes('install ok installed'),
    reboot,
    pending: upgradeList === 'Unavailable' ? 'Unknown' : Math.max(0, upgradeList.split('\n').filter(x => x.includes('[upgradable from:')).length),
    checkedAt: new Date().toISOString()
  };
}
module.exports = { status };
