const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CONFIG = path.join(__dirname, '..', 'orb-reporter.json');
const REPORTER = path.join(__dirname, '..', 'integrations/pi-agent/orb_reporter.py');
const DB = path.join(__dirname, '..', 'data/monitor.db');
let lastResult = { status: 'Not tested', at: null };
let running = false;
const INTERVALS = [10, 30, 60, 120, 300, 600];
let nextReportAt = Date.now() + 10000;
function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (_) { return {}; }
}
function publicConfig() {
  const c = config();
  return { wordpress_url: c.wordpress_url || '', site_key: c.site_key || '', configured: !!(c.wordpress_url && c.site_key && c.api_key), interval_seconds: INTERVALS.includes(c.interval_seconds) ? c.interval_seconds : 60, lastResult };
}
function save(values) {
  const old = config();
  const url = String(values.wordpress_url || '').trim().replace(/\/+$/, '');
  const site = String(values.site_key || '').trim();
  const key = String(values.api_key || '').trim() || old.api_key || '';
  if (!/^https:\/\/[^\s/?#]+(?:\/[^?#]*)?$/.test(url)) throw Error('Enter a valid HTTPS WordPress URL');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.port || !parsed.hostname || !/^[a-z0-9.-]+$/i.test(parsed.hostname)) throw Error('WordPress URL must be a normal HTTPS website URL');
  if (!/^[a-z0-9_-]+$/.test(site)) throw Error('Site key must contain lowercase letters, numbers, - or _');
  if (key.length < 32 || key.length > 256) throw Error('Enter the WordPress API key (32-256 characters)');
  const interval = Number(values.interval_seconds || 60);
  if (!INTERVALS.includes(interval)) throw Error('Select a valid reporting interval');
  const next = { wordpress_url: url, site_key: site, api_key: key, database: DB, interval_seconds: interval };
  const temp = CONFIG + '.tmp-' + process.pid;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, CONFIG);
  nextReportAt = Date.now() + interval * 1000;
  lastResult = { status: 'Saved; awaiting report', at: new Date().toISOString() };
}
function send() {
  if (running) return Promise.resolve({ status: 'Already sending' });
  if (!publicConfig().configured) return Promise.resolve({ status: 'Not configured' });
  running = true;
  return new Promise(resolve => {
    const child = spawn('/usr/bin/python3', [REPORTER], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out = (out + d).slice(-1000); });
    child.stderr.on('data', d => { out = (out + d).slice(-1000); });
    child.on('error', err => finish('Error: ' + err.message));
    child.on('close', code => finish(code === 0 ? out.trim() || 'Success' : 'Error: ' + out.trim()));
    function finish(status) { if (!running) return; running = false; lastResult = { status, at: new Date().toISOString() }; resolve(lastResult); }
  });
}
function start() {
  setInterval(() => {
    const now = Date.now();
    if (now < nextReportAt) return;
    const interval = publicConfig().interval_seconds * 1000;
    nextReportAt = now + interval;
    send().catch(console.error);
  }, 1000).unref();
}
module.exports = { publicConfig, save, send, start };
