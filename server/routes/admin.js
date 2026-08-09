'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const rules = require('../lib/booking-rules');
const auth = require('../lib/auth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();
const json = express.json();

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ---------- auth ----------

router.post('/login', json, async (req, res) => {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;

  if (!expectedUser || !expectedHash) {
    return res.status(500).json({
      error: 'Chưa cấu hình ADMIN_USERNAME / ADMIN_PASSWORD_HASH trên server (xem .env.example).'
    });
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu.' });
  }

  // Compare username with a fixed-time check too, so timing can't reveal it.
  const userOk = username.length === expectedUser.length &&
    require('crypto').timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser));
  const passOk = userOk && (await bcrypt.compare(password, expectedHash));

  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu.' });
  }

  auth.issueCookie(res, expectedUser);
  res.json({ ok: true, username: expectedUser });
});

router.post('/logout', (req, res) => {
  auth.clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const session = auth.readSession(req);
  if (!session) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  res.json({ username: session.u });
});

// Everything below requires a valid admin session.
router.use(requireAdmin);

// ---------- stats ----------

router.get('/stats', (req, res) => {
  const state = db.get();
  const month = currentMonth();
  const overLimit = state.companies.filter(
    (c) => rules.usedHoursInMonth(state.bookings, c.id, month + '-01') > c.freeHours
  ).length;
  res.json({
    rooms: state.rooms.length,
    activeBookings: state.bookings.length,
    activeCompanies: state.companies.filter((c) => c.status === 'active').length,
    overLimitCompanies: overLimit
  });
});

// ---------- bookings ----------

router.get('/bookings', (req, res) => {
  const state = db.get();
  const list = state.bookings
    .slice()
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
    .map((b) => {
      const room = state.rooms.find((r) => r.id === b.roomId);
      const company = state.companies.find((c) => c.id === b.companyId);
      return {
        ...b,
        roomName: room ? room.name : b.roomId,
        companyName: company ? company.name : 'Công ty đã xoá'
      };
    });
  res.json(list);
});

router.put('/bookings/:id', json, (req, res) => {
  const { id } = req.params;
  const state = db.get();
  const booking = state.bookings.find((b) => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Không tìm thấy lịch đặt.' });

  const date = rules.isValidDate(req.body.date) ? req.body.date : booking.date;
  const start = Number.isInteger(Number(req.body.start)) ? Number(req.body.start) : booking.start;
  const duration = Number.isInteger(Number(req.body.duration))
    ? Number(req.body.duration)
    : booking.end - booking.start;
  const end = start + duration;

  if (duration < 1 || duration > rules.MAX_DURATION || start < rules.OPEN_HOUR || end > rules.CLOSE_HOUR) {
    return res.status(400).json({ error: 'Khung giờ không hợp lệ.' });
  }
  const conflict = rules.findConflict(state.bookings, {
    roomId: booking.roomId,
    date,
    start,
    end,
    excludeId: id
  });
  if (conflict) {
    const cc = state.companies.find((c) => c.id === conflict.companyId);
    return res.status(409).json({
      error: `Trùng lịch với ${cc ? cc.name : 'công ty khác'} (${conflict.start}:00–${conflict.end}:00).`
    });
  }

  const updated = db.mutate((s) => {
    const b = s.bookings.find((x) => x.id === id);
    b.date = date;
    b.start = start;
    b.end = end;
    const company = s.companies.find((c) => c.id === b.companyId);
    b.overLimit = company ? rules.usedHoursInMonth(s.bookings, company.id, date) > company.freeHours : false;
    return b;
  });

  res.json(updated);
});

router.delete('/bookings/:id', (req, res) => {
  const { id } = req.params;
  const state = db.get();
  if (!state.bookings.find((b) => b.id === id)) {
    return res.status(404).json({ error: 'Không tìm thấy lịch đặt.' });
  }
  db.mutate((s) => {
    s.bookings = s.bookings.filter((b) => b.id !== id);
  });
  res.json({ ok: true });
});

// ---------- companies ----------

router.get('/companies', (req, res) => {
  const state = db.get();
  const month = currentMonth();
  res.json(
    state.companies.map((c) => ({
      ...c,
      usedHours: rules.usedHoursInMonth(state.bookings, c.id, month + '-01'),
      month
    }))
  );
});

router.post('/companies', json, (req, res) => {
  const { name, plan, freeHours, status } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên công ty.' });
  }
  const free = Number(freeHours);
  if (!Number.isFinite(free) || free < 0) {
    return res.status(400).json({ error: 'Giờ miễn phí phải là một số hợp lệ.' });
  }
  const created = db.mutate((s) => {
    const id = 'c' + s.meta.companySeq++;
    const record = {
      id,
      name: name.trim().slice(0, 80),
      plan: typeof plan === 'string' && plan.trim() ? plan.trim().slice(0, 80) : 'Chưa cập nhật gói',
      freeHours: free,
      status: status === 'paused' ? 'paused' : 'active'
    };
    s.companies.push(record);
    return record;
  });
  res.status(201).json(created);
});

router.put('/companies/:id', json, (req, res) => {
  const { id } = req.params;
  const state = db.get();
  const company = state.companies.find((c) => c.id === id);
  if (!company) return res.status(404).json({ error: 'Không tìm thấy công ty.' });

  const { name, plan, freeHours, status } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Tên công ty không được để trống.' });
  }
  if (freeHours !== undefined && !(Number.isFinite(Number(freeHours)) && Number(freeHours) >= 0)) {
    return res.status(400).json({ error: 'Giờ miễn phí phải là một số hợp lệ.' });
  }

  const updated = db.mutate((s) => {
    const c = s.companies.find((x) => x.id === id);
    if (name !== undefined) c.name = String(name).trim().slice(0, 80);
    if (plan !== undefined) c.plan = String(plan).trim().slice(0, 80) || c.plan;
    if (freeHours !== undefined) c.freeHours = Number(freeHours);
    if (status !== undefined) c.status = status === 'paused' ? 'paused' : 'active';
    return c;
  });
  res.json(updated);
});

router.delete('/companies/:id', (req, res) => {
  const { id } = req.params;
  const state = db.get();
  const company = state.companies.find((c) => c.id === id);
  if (!company) return res.status(404).json({ error: 'Không tìm thấy công ty.' });

  db.mutate((s) => {
    s.bookings = s.bookings.filter((b) => b.companyId !== id);
    s.companies = s.companies.filter((c) => c.id !== id);
  });
  res.json({ ok: true });
});

// ---------- rooms ----------

router.get('/rooms', (req, res) => {
  res.json(db.get().rooms);
});

router.post('/rooms', json, (req, res) => {
  const { name, capacity, floor } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Vui lòng nhập tên phòng.' });
  }
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap < 1) {
    return res.status(400).json({ error: 'Sức chứa phải là một số lớn hơn 0.' });
  }
  const created = db.mutate((s) => {
    s.meta.roomSeq = s.meta.roomSeq || 1;
    const id = 'room' + s.meta.roomSeq++;
    const record = {
      id,
      name: name.trim().slice(0, 60),
      capacity: Math.round(cap),
      floor: typeof floor === 'string' && floor.trim() ? floor.trim().slice(0, 40) : 'Chưa cập nhật'
    };
    s.rooms.push(record);
    return record;
  });
  res.status(201).json(created);
});

router.put('/rooms/:id', json, (req, res) => {
  const { id } = req.params;
  const state = db.get();
  const room = state.rooms.find((r) => r.id === id);
  if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng họp.' });

  const { name, capacity, floor } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Tên phòng không được để trống.' });
  }
  if (capacity !== undefined && !(Number.isFinite(Number(capacity)) && Number(capacity) >= 1)) {
    return res.status(400).json({ error: 'Sức chứa phải là một số lớn hơn 0.' });
  }

  const updated = db.mutate((s) => {
    const r = s.rooms.find((x) => x.id === id);
    if (name !== undefined) r.name = String(name).trim().slice(0, 60);
    if (capacity !== undefined) r.capacity = Math.round(Number(capacity));
    if (floor !== undefined) r.floor = String(floor).trim().slice(0, 40) || r.floor;
    return r;
  });
  res.json(updated);
});

router.delete('/rooms/:id', (req, res) => {
  const { id } = req.params;
  const state = db.get();
  const room = state.rooms.find((r) => r.id === id);
  if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng họp.' });

  db.mutate((s) => {
    s.bookings = s.bookings.filter((b) => b.roomId !== id);
    s.rooms = s.rooms.filter((r) => r.id !== id);
  });
  res.json({ ok: true });
});

module.exports = router;
