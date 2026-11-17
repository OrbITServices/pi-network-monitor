const crypto = require('crypto');
const login = require('./wp-login');
const sessions = new Map();
const IDLE_MS = 15 * 60 * 1000;
const MAX_MS = 8 * 60 * 60 * 1000;
const cookieName = 'orb_admin_session';
function parseCookie(req) {
  const raw = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
  return raw ? raw.slice(cookieName.length+1) : '';
}
function cookie(req, token, maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' && ['127.0.0.1','::1'].includes(req.socket.remoteAddress);
  return cookieName+'='+token+'; Path=/settings; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(secure?'; Secure':'');
}
function get(req) {
  const token=parseCookie(req);
  const s=sessions.get(token);
  if (!s) return null;
  const now=Date.now();
  if (now-s.last>IDLE_MS || now-s.created>MAX_MS || s.passwordHash!==login.ensure().passwordHash) {sessions.delete(token);return null;}
  s.last=now;
  return s;
}
function create(req,res) {
  const token=crypto.randomBytes(32).toString('hex');
  const now=Date.now();
  sessions.set(token,{created:now,last:now,passwordHash:login.ensure().passwordHash});
  res.setHeader('Set-Cookie',cookie(req,token,Math.floor(MAX_MS/1000)));
  if(sessions.size>1000) for(const [k,s] of sessions) if(now-s.last>IDLE_MS) sessions.delete(k);
}
function clear(req,res) {
  sessions.delete(parseCookie(req));
  res.setHeader('Set-Cookie',cookie(req,'',0));
}
function sameOrigin(req) {
  const origin=req.get('origin');
  if(!origin) return false;
  try {
    const url=new URL(origin);
    return url.host===req.get('host') && (url.protocol==='http:' || url.protocol==='https:');
  } catch {return false;}
}
function requireAdmin(req,res,next) {
  res.set('Cache-Control','no-store');
  const s=get(req);
  if(!s) return res.redirect(303,'/settings/login?next='+encodeURIComponent(req.originalUrl.startsWith('/settings/')?req.originalUrl:'/settings/advanced'));
  if(req.method==='POST' && !sameOrigin(req)) return res.status(403).send('Invalid request origin.');
  req.wpLogin=login.ensure();
  next();
}
module.exports={get,create,clear,requireAdmin,sameOrigin};
