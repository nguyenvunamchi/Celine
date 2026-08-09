'use strict';

const { readSession } = require('../lib/auth');

module.exports = function requireAdmin(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn.' });
  }
  req.admin = session;
  next();
};
