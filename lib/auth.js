'use strict';

const crypto = require('node:crypto');
const {
  q
} = require('./db');
const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || 'admin@example.com').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_DAYS = 30;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const now = () => Date.now();
const normEmail = e => String(e || '').trim().toLowerCase();
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isAdminEmail = e => ADMIN_EMAILS.includes(normEmail(e));
function safeEqual(a, b) {
  const x = Buffer.from(sha(a)),
    y = Buffer.from(sha(b));
  return crypto.timingSafeEqual(x, y);
}
async function createSession(email, isAdmin) {
  const token = randomToken();
  await q('INSERT INTO sessions (token_hash, email, is_admin, expires) VALUES (?,?,?,?)').run(sha(token), normEmail(email), isAdmin ? 1 : 0, now() + SESSION_DAYS * 864e5);
  return token;
}
async function getSession(token) {
  if (!token) return null;
  const s = await q('SELECT email, is_admin, expires FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!s || s.expires < now()) return null;
  return {
    email: s.email,
    isAdmin: isAdminEmail(s.email)
  };
}
const destroySession = async token => token && (await q('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)));

// ---- One-time email codes ----
async function issueOtp(email) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await q('INSERT OR REPLACE INTO otps (email, code_hash, expires, attempts) VALUES (?,?,?,0)').run(email, sha(email + ':' + code), now() + 10 * 60e3);
  return code;
}
async function verifyOtp(email, code) {
  const row = await q('SELECT * FROM otps WHERE email = ?').get(email);
  if (!row || row.expires < now() || row.attempts >= 5) return false;
  if (row.code_hash !== sha(email + ':' + String(code).trim())) {
    await q('UPDATE otps SET attempts = attempts + 1 WHERE email = ?').run(email);
    return false;
  }
  await q('DELETE FROM otps WHERE email = ?').run(email);
  return true;
}

// ---- Admin-generated single-use sign-in links (work without any email provider) ----
async function issueLoginLink(email, hours = 72) {
  const token = randomToken(24);
  await q('INSERT INTO login_links (token_hash, email, expires) VALUES (?,?,?)').run(sha(token), normEmail(email), now() + hours * 36e5);
  return token;
}
async function consumeLoginLink(token) {
  const row = await q('SELECT * FROM login_links WHERE token_hash = ?').get(sha(token));
  if (!row) return null;
  await q('DELETE FROM login_links WHERE token_hash = ?').run(sha(token));
  return row.expires > now() ? row.email : null;
}

// ---- API tokens ----
async function createApiToken(name) {
  const token = 'rh_' + randomToken(24);
  await q('INSERT INTO api_tokens (name, prefix, token_hash, created_at) VALUES (?,?,?,?)').run(name, token.slice(0, 9), sha(token), now());
  return token;
}
async function checkApiToken(token) {
  if (!token) return false;
  const row = await q('SELECT id FROM api_tokens WHERE token_hash = ?').get(sha(token));
  if (!row) return false;
  await q('UPDATE api_tokens SET last_used = ? WHERE id = ?').run(now(), row.id);
  return true;
}

// ---- Email delivery: Resend API if configured, otherwise server console ----
async function sendEmail(to, subject, text) {
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Research Hub <onboarding@resend.dev>',
        to: [to],
        subject,
        text
      })
    });
    if (!r.ok) throw new Error(`Email provider error ${r.status}: ${await r.text()}`);
    return 'sent';
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('Email delivery is not configured.');
  console.log(`\n[email -> ${to}] ${subject}\n${text}\n`);
  return 'console';
}
module.exports = {
  ADMIN_EMAILS,
  ADMIN_PASSWORD,
  sha,
  normEmail,
  isEmail,
  isAdminEmail,
  safeEqual,
  createSession,
  getSession,
  destroySession,
  issueOtp,
  verifyOtp,
  issueLoginLink,
  consumeLoginLink,
  createApiToken,
  checkApiToken,
  sendEmail
};
