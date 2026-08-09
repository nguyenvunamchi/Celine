// Shared booking rules: office hours, first-in-first-served conflict detection,
// and the monthly 18-free-hours calculation. The server is the source of truth —
// the frontend mirrors this logic only to give instant feedback before it asks
// the server to confirm.
'use strict';

const OPEN_HOUR = 8;
const CLOSE_HOUR = 18;
const MAX_DURATION = 4;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(d) {
  return typeof d === 'string' && DATE_RE.test(d);
}

function monthOf(dateStr) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

// Two [start,end) hour ranges overlap if start < otherEnd && end > otherStart.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function findConflict(bookings, { roomId, date, start, end, excludeId }) {
  return (
    bookings.find(
      (b) =>
        b.roomId === roomId &&
        b.date === date &&
        b.id !== excludeId &&
        rangesOverlap(start, end, b.start, b.end)
    ) || null
  );
}

// How many contiguous free hours starting at `start` on this room/date, capped
// at MAX_DURATION and the 18:00 close time. Used to build the duration picker.
function maxContiguousHours(bookings, { roomId, date, start }) {
  let h = start;
  let count = 0;
  while (h < CLOSE_HOUR && count < MAX_DURATION) {
    if (findConflict(bookings, { roomId, date, start: h, end: h + 1 })) break;
    count += 1;
    h += 1;
  }
  return count;
}

// Sum of hours a company has already booked in the calendar month of `dateStr`.
function usedHoursInMonth(bookings, companyId, dateStr) {
  const month = monthOf(dateStr);
  return bookings
    .filter((b) => b.companyId === companyId && monthOf(b.date) === month)
    .reduce((sum, b) => sum + (b.end - b.start), 0);
}

// One company's billing picture for a given 'YYYY-MM' month: how many hours it
// used, how many of those are billable overage past its free-hours allowance,
// and how many separate bookings made up that total. Shared by the customer
// usage strip, the admin companies table, and the monthly Excel report so all
// three always agree on the same number.
function companyMonthSummary(bookings, company, month) {
  const monthBookings = bookings.filter((b) => b.companyId === company.id && monthOf(b.date) === month);
  const usedHours = monthBookings.reduce((sum, b) => sum + (b.end - b.start), 0);
  const overageHours = Math.max(0, usedHours - company.freeHours);
  return { usedHours, overageHours, bookingCount: monthBookings.length };
}

module.exports = {
  OPEN_HOUR,
  CLOSE_HOUR,
  MAX_DURATION,
  isValidDate,
  monthOf,
  rangesOverlap,
  findConflict,
  maxContiguousHours,
  usedHoursInMonth,
  companyMonthSummary
};
