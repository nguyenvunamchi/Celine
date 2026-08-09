'use strict';

const express = require('express');
const db = require('../db');
const rules = require('../lib/booking-rules');

const router = express.Router();

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function companyPublicView(c, bookings, month) {
  const summary = rules.companyMonthSummary(bookings, c, month);
  return {
    id: c.id,
    name: c.name,
    plan: c.plan,
    status: c.status,
    freeHours: c.freeHours,
    usedHours: summary.usedHours,
    overageHours: summary.overageHours,
    month
  };
}

// GET /api/rooms
router.get('/rooms', (req, res) => {
  res.json(db.get().rooms);
});

// GET /api/companies?month=YYYY-MM  (usedHours is computed for that month, default current)
router.get('/companies', (req, res) => {
  const state = db.get();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : currentMonth();
  res.json(state.companies.map((c) => companyPublicView(c, state.bookings, month)));
});

// GET /api/bookings?roomId=cedar&date=2026-08-10
router.get('/bookings', (req, res) => {
  const { roomId, date } = req.query;
  if (!roomId || !rules.isValidDate(date)) {
    return res.status(400).json({ error: 'Thiếu hoặc sai định dạng roomId/date (YYYY-MM-DD).' });
  }
  const state = db.get();
  const list = state.bookings
    .filter((b) => b.roomId === roomId && b.date === date)
    .map((b) => {
      const company = state.companies.find((c) => c.id === b.companyId);
      return { ...b, companyName: company ? company.name : 'Công ty không xác định' };
    })
    .sort((a, b) => a.start - b.start);
  res.json(list);
});

// GET /api/bookings/mine?companyId=c1  (upcoming, all rooms/dates, for "my bookings" list)
router.get('/bookings/mine', (req, res) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: 'Thiếu companyId.' });
  const state = db.get();
  const list = state.bookings
    .filter((b) => b.companyId === companyId)
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1));
  res.json(list);
});

// POST /api/bookings  { roomId, date, start, duration, companyId, note }
router.post('/bookings', express.json(), (req, res) => {
  const { roomId, date, start, duration, companyId, note } = req.body || {};

  const state = db.get();
  const room = state.rooms.find((r) => r.id === roomId);
  const company = state.companies.find((c) => c.id === companyId);

  if (!room) return res.status(400).json({ error: 'Phòng họp không tồn tại.' });
  if (!company) return res.status(400).json({ error: 'Công ty không tồn tại.' });
  if (company.status !== 'active') {
    return res.status(400).json({ error: 'Công ty này đang tạm ngưng hợp đồng, không thể đặt phòng.' });
  }
  if (!rules.isValidDate(date)) {
    return res.status(400).json({ error: 'Ngày không hợp lệ.' });
  }
  const startHour = Number(start);
  const dur = Number(duration);
  if (!Number.isInteger(startHour) || !Number.isInteger(dur) || dur < 1 || dur > rules.MAX_DURATION) {
    return res.status(400).json({ error: 'Giờ bắt đầu hoặc thời lượng không hợp lệ.' });
  }
  const endHour = startHour + dur;
  if (startHour < rules.OPEN_HOUR || endHour > rules.CLOSE_HOUR) {
    return res.status(400).json({ error: `Khung giờ phải nằm trong ${rules.OPEN_HOUR}:00–${rules.CLOSE_HOUR}:00.` });
  }

  const conflict = rules.findConflict(state.bookings, { roomId, date, start: startHour, end: endHour });
  if (conflict) {
    const conflictCompany = state.companies.find((c) => c.id === conflict.companyId);
    return res.status(409).json({
      error: 'Khung giờ này đã có người đặt trước.',
      code: 'CONFLICT',
      conflict: {
        companyName: conflictCompany ? conflictCompany.name : 'Công ty khác',
        start: conflict.start,
        end: conflict.end
      }
    });
  }

  const usedBefore = rules.usedHoursInMonth(state.bookings, company.id, date);
  const overLimit = usedBefore + dur > company.freeHours;

  const booking = db.mutate((s) => {
    const id = 'bk' + s.meta.bookingSeq++;
    const record = {
      id,
      roomId,
      date,
      start: startHour,
      end: endHour,
      companyId: company.id,
      note: typeof note === 'string' ? note.slice(0, 120) : '',
      overLimit,
      createdAt: new Date().toISOString()
    };
    s.bookings.push(record);
    return record;
  });

  res.status(201).json({
    booking,
    overLimit,
    usedHoursAfter: usedBefore + dur,
    freeHours: company.freeHours
  });
});

// DELETE /api/bookings/:id?companyId=c1
// companyId must match the booking's owner — this is not real authentication
// (there is no customer login), just a guard against accidental cross-cancels
// from the UI. See README "Known limitations".
router.delete('/bookings/:id', (req, res) => {
  const { id } = req.params;
  const { companyId } = req.query;
  const state = db.get();
  const booking = state.bookings.find((b) => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Không tìm thấy lịch đặt.' });
  if (!companyId || booking.companyId !== companyId) {
    return res.status(403).json({ error: 'Bạn chỉ có thể huỷ lịch đặt của công ty mình.' });
  }
  db.mutate((s) => {
    s.bookings = s.bookings.filter((b) => b.id !== id);
  });
  res.json({ ok: true });
});

module.exports = router;
