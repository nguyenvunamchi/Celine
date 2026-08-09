// Tiny in-memory rate limiter for the admin login endpoint. Good enough for a
// single-process VPS deployment; if you ever run multiple instances behind a
// load balancer, swap this for a shared store (e.g. Redis).
'use strict';

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 8;

const attempts = new Map(); // ip -> [timestamps]

function loginLimiter(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);

  if (list.length >= MAX_ATTEMPTS) {
    return res.status(429).json({
      error: `Đã thử đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(
        (WINDOW_MS - (now - list[0])) / 60000
      )} phút.`
    });
  }

  list.push(now);
  attempts.set(ip, list);
  next();
}

module.exports = { loginLimiter };
