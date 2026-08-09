// Minimal signed-cookie admin session — no server-side session store needed,
// which means restarting the process (PM2 redeploys, reboots) never logs the
// admin out early and there is nothing extra to run on the VPS.
//
// Cookie value shape: "<base64url(payload JSON)>.<hex HMAC-SHA256 signature>"
'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'atrium_admin';
const SESSION_HOURS = 12;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET is missing or too short. Set a long random value in your .env file (see .env.example).'
    );
  }
  return secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}

function issueCookie(res, username) {
  const exp = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const token = sign({ u: username, exp });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.TRUST_HTTPS === 'true',
    maxAge: SESSION_HOURS * 60 * 60 * 1000
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function readSession(req) {
  return verify(req.cookies && req.cookies[COOKIE_NAME]);
}

module.exports = { COOKIE_NAME, issueCookie, clearCookie, readSession };
