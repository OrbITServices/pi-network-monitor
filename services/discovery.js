const { execFile } = require('child_process');

function parseArpScan(output) {
  const devices = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})\s+(.+)$/);
    if (match) {
      devices.push({
        ip: match[1],
        mac: match[2].toLowerCase(),
        vendor: match[3].trim(),
        hostname: ''
      });
    }
  }

  return devices;
}

function discover(subnet) {
  return new Promise((resolve) => {
    execFile('arp-scan', ['--localnet'], { timeout: 60000 }, (err, stdout) => {
      if (err) {
        return resolve({
          ok: false,
          error: 'arp-scan failed. Make sure it is installed and the app has permission to run it.',
          devices: []
        });
      }

      resolve({ ok: true, devices: parseArpScan(stdout) });
    });
  });
}

module.exports = { discover };
