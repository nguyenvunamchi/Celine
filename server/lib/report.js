// Builds the end-of-month billing report: which companies went over their free
// hours, by how much, and the underlying bookings that add up to those totals.
// Used both for the in-app preview table and the downloadable .xlsx.
'use strict';

const ExcelJS = require('exceljs');
const rules = require('./booking-rules');

const NAVY = 'FF0F2A54';
const AMBER_FILL = 'FFFBF0DD';
const AMBER_TEXT = 'FFB87A1F';

function fmtHour(h) {
  return String(h).padStart(2, '0') + ':00';
}

// Plain-data version of the report (no Excel objects) — used for the JSON
// preview endpoint and reused internally when building the workbook.
function buildReportData(state, month) {
  const rows = state.companies.map((c) => {
    const summary = rules.companyMonthSummary(state.bookings, c, month);
    return {
      companyId: c.id,
      name: c.name,
      plan: c.plan,
      freeHours: c.freeHours,
      usedHours: summary.usedHours,
      overageHours: summary.overageHours,
      bookingCount: summary.bookingCount
    };
  });

  const bookingsThisMonth = state.bookings
    .filter((b) => rules.monthOf(b.date) === month)
    .slice()
    .sort((a, b) => (a.date === b.date ? a.start - b.start : a.date < b.date ? -1 : 1))
    .map((b) => {
      const room = state.rooms.find((r) => r.id === b.roomId);
      const company = state.companies.find((c) => c.id === b.companyId);
      return {
        date: b.date,
        roomName: room ? room.name : b.roomId,
        companyName: company ? company.name : 'Công ty đã xoá',
        contactName: b.contactName || '',
        contactPhone: b.contactPhone || '',
        start: b.start,
        end: b.end,
        hours: b.end - b.start,
        note: b.note || '',
        overLimit: !!b.overLimit
      };
    });

  const totals = rows.reduce(
    (acc, r) => ({
      usedHours: acc.usedHours + r.usedHours,
      overageHours: acc.overageHours + r.overageHours,
      bookingCount: acc.bookingCount + r.bookingCount
    }),
    { usedHours: 0, overageHours: 0, bookingCount: 0 }
  );

  return { month, companies: rows, bookings: bookingsThisMonth, totals };
}

async function buildMonthlyWorkbook(state, month) {
  const data = buildReportData(state, month);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SB Space Holding';
  wb.created = new Date();

  const summary = wb.addWorksheet('Tổng hợp');
  summary.columns = [
    { header: 'Công ty', key: 'name', width: 32 },
    { header: 'Gói dịch vụ', key: 'plan', width: 28 },
    { header: 'Giờ miễn phí', key: 'free', width: 14 },
    { header: 'Giờ đã dùng', key: 'used', width: 14 },
    { header: 'Giờ vượt (tính phí)', key: 'overage', width: 18 },
    { header: 'Số lượt đặt', key: 'count', width: 12 }
  ];
  styleHeaderRow(summary.getRow(1));

  data.companies.forEach((c) => {
    const row = summary.addRow({
      name: c.name,
      plan: c.plan,
      free: c.freeHours,
      used: c.usedHours,
      overage: c.overageHours,
      count: c.bookingCount
    });
    if (c.overageHours > 0) {
      const cell = row.getCell('overage');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_FILL } };
      cell.font = { color: { argb: AMBER_TEXT }, bold: true };
    }
  });

  const totalRow = summary.addRow({
    name: 'Tổng cộng',
    plan: '',
    free: '',
    used: data.totals.usedHours,
    overage: data.totals.overageHours,
    count: data.totals.bookingCount
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.border = { top: { style: 'thin', color: { argb: 'FFC2CCE0' } } };
  });

  const detail = wb.addWorksheet('Chi tiết đặt phòng');
  detail.columns = [
    { header: 'Ngày', key: 'date', width: 12 },
    { header: 'Phòng', key: 'room', width: 14 },
    { header: 'Công ty', key: 'company', width: 30 },
    { header: 'Người đặt', key: 'contactName', width: 22 },
    { header: 'SĐT người đặt', key: 'contactPhone', width: 16 },
    { header: 'Giờ bắt đầu', key: 'start', width: 12 },
    { header: 'Giờ kết thúc', key: 'end', width: 12 },
    { header: 'Số giờ', key: 'hours', width: 10 },
    { header: 'Ghi chú', key: 'note', width: 30 },
    { header: 'Vượt hạn mức', key: 'over', width: 14 }
  ];
  styleHeaderRow(detail.getRow(1));

  data.bookings.forEach((b) => {
    const row = detail.addRow({
      date: b.date,
      room: b.roomName,
      company: b.companyName,
      contactName: b.contactName,
      contactPhone: b.contactPhone,
      start: fmtHour(b.start),
      end: fmtHour(b.end),
      hours: b.hours,
      note: b.note,
      over: b.overLimit ? 'Có' : ''
    });
    if (b.overLimit) {
      const cell = row.getCell('over');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER_FILL } };
      cell.font = { color: { argb: AMBER_TEXT }, bold: true };
    }
  });

  return wb;
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  });
}

module.exports = { buildReportData, buildMonthlyWorkbook };
