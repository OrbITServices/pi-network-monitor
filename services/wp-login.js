const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const file = path.join(__dirname, '..', 'data', 'wp-login.json');
const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
function read() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
}
function write(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
function ensure() {
  let entry = read();
  if (!entry) {
    const salt = crypto.randomBytes(16).toString('hex');
    entry = { username: 'pimon', salt, passwordHash: hash('pimon', salt), mustChange: true };
    write(entry);
  }
  return entry;
}
function verify(username, password) {
  const entry = ensure();
  const expected = Buffer.from(entry.passwordHash, 'hex');
  const actual = Buffer.from(hash(password, entry.salt), 'hex');
  return username === entry.username && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function change(username, password) {
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw Error('Username must be 3-40 letters, numbers, dots, hyphens or underscores');
  if (password.length < 12) throw Error('Password must be at least 12 characters');
  if (password.toLowerCase() === 'pimon') throw Error('Choose a different password');
  const salt = crypto.randomBytes(16).toString('hex');
  write({ username, salt, passwordHash: hash(password, salt), mustChange: false });
}
module.exports = { ensure, verify, change };
