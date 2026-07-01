const ping = require('ping');
const net = require('net');

async function checkPing(ip) {
  try {
    const result = await ping.promise.probe(ip, { timeout: 2, min_reply: 1 });
    return result.alive;
  } catch {
    return false;
  }
}

function checkTcp(ip, port) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(2500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function checkDevice(device) {
  if (device.check_type === 'tcp' && device.check_port) {
    return checkTcp(device.ip, device.check_port);
  }
  return checkPing(device.ip);
}

module.exports = { checkDevice };
