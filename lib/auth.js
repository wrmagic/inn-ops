'use strict';
// Logins: scrypt password hashes, session cookies (stored hashed), one-time flash messages.
const crypto = require('node:crypto');

const SESSION_DAYS = 14;
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(pw), salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  return crypto.timingSafeEqual(crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex'));
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const token = (n = 24) => crypto.randomBytes(n).toString('base64url');

function createSession(db, user) {
  const t = token(32);
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha(t), user.id, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
  return t;
}
function loadSession(db, t) {
  if (!t) return null;
  const row = db.get(`SELECT s.token_hash, s.flash, s.expires_at, u.id, u.username, u.name, u.email, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(t));
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return row;
}
function destroySession(db, t) { if (t) db.run('DELETE FROM sessions WHERE token_hash = ?', sha(t)); }
function setFlash(db, user, msg, kind = 'ok') { if (user) db.run('UPDATE sessions SET flash = ? WHERE token_hash = ?', JSON.stringify({ msg, kind }), user.token_hash); }
function takeFlash(db, user) {
  if (!user || !user.flash) return null;
  db.run('UPDATE sessions SET flash = NULL WHERE token_hash = ?', user.token_hash);
  try { return JSON.parse(user.flash); } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, createSession, loadSession, destroySession, setFlash, takeFlash, token, sha };
