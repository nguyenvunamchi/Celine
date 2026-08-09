'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { loginLimiter } = require('./lib/rateLimit');

const app = express();
app.set('trust proxy', 1); // needed for correct req.ip behind Nginx/Hostinger's proxy

app.use(cookieParser());

// Basic hardening headers (no extra dependency needed for a project this size).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/admin/login', loginLimiter);
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// JSON 404 for anything under /api that didn't match a route above.
app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy endpoint.' }));

// Fallback error handler — keeps a bad request from leaking a stack trace.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Đã có lỗi xảy ra phía máy chủ.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ATRIUM booking server listening on port ${PORT}`);
});
