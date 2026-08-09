(function () {
  'use strict';

  var OPEN = 8, CLOSE = 18, MAX_DUR = 4;
  var WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  var WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var rooms = [];
  var companies = [];
  var gridBookings = []; // bookings for the currently selected room+date
  var myBookings = [];

  var state = { roomId: null, date: todayISO(), companyId: null, selectedHour: null };

  // ---------- tiny fetch helper ----------
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- helpers ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtHour(h) { return pad2(h) + ':00'; }
  function fmtRange(s, e) { return fmtHour(s) + '–' + fmtHour(e); }
  function fmtDateShort(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function fmtDateFull(iso) {
    var d = new Date(iso + 'T00:00:00');
    var p = iso.split('-');
    return WEEKDAYS[d.getDay()] + ', ' + p[2] + '/' + p[1] + '/' + p[0];
  }
  function fmtDateFullBi(iso) {
    var d = new Date(iso + 'T00:00:00');
    var p = iso.split('-');
    var dateNum = p[2] + '/' + p[1] + '/' + p[0];
    return bi(WEEKDAYS[d.getDay()] + ', ' + dateNum, WEEKDAYS_EN[d.getDay()] + ', ' + dateNum);
  }
  function fmtH(n) {
    n = Math.round(n * 10) / 10;
    var s = Math.abs(n % 1) < 0.001 ? String(Math.round(n)) : n.toFixed(1).replace('.', ',');
    return s + 'h';
  }
  function initials(name) {
    var parts = name.replace(/Công ty( TNHH)?/, '').trim().split(/\s+/);
    var out = '';
    for (var i = 0; i < parts.length && out.length < 2; i++) if (parts[i]) out += parts[i][0];
    return out.toUpperCase() || 'CT';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function room(id) { for (var i = 0; i < rooms.length; i++) if (rooms[i].id === id) return rooms[i]; return null; }
  function company(id) { for (var i = 0; i < companies.length; i++) if (companies[i].id === id) return companies[i]; return null; }
  // Bilingual UI copy: Vietnamese is primary, English trails inline (italic,
  // smaller — see .en in app.css). Only for the app's own fixed chrome text —
  // never wraps user-entered data (company/room/contact names, notes). Does
  // NOT escape its arguments: pass already-esc()'d fragments if you interpolate
  // dynamic data into either string.
  function bi(vi, en) { return vi + ' <span class="en">' + en + '</span>'; }

  // Mirrors server/lib/booking-rules.js findConflict — client-side only for
  // instant UI feedback; the server re-validates every write authoritatively.
  function findConflict(list, start, end, excludeId) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.id === excludeId) continue;
      if (start < b.end && end > b.start) return b;
    }
    return null;
  }
  function maxContiguous(list, start) {
    var h = start, count = 0;
    while (h < CLOSE && count < MAX_DUR) {
      if (findConflict(list, h, h + 1)) break;
      count++; h++;
    }
    return count;
  }

  function toast(msg, kind, msgEn) {
    var stack = document.getElementById('toastStack');
    var el = document.createElement('div');
    el.className = 'toast';
    var icon = kind === 'warn' ? 'i-alert' : 'i-check-circle';
    var cls = kind === 'warn' ? 'toast-warn' : 'toast-ok';
    el.innerHTML = '<svg class="icon ' + cls + '" width="17" height="17"><use href="#' + icon + '"></use></svg><span>' + esc(msg) + (msgEn ? ' <span class="en">' + esc(msgEn) + '</span>' : '') + '</span>';
    stack.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 3800);
  }

  // ---------- render: usage strip ----------
  function renderUsageStrip() {
    var c = company(state.companyId);
    var el = document.getElementById('usageStrip');
    if (!c) { el.innerHTML = '<p class="hint">' + bi('Chưa có công ty nào trong hệ thống.', 'No companies in the system yet.') + '</p>'; return; }
    var overage = c.overageHours || 0;
    var ratio = c.usedHours / c.freeHours;
    var st = overage > 0 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
    var pct = Math.min(100, Math.round(ratio * 100));
    var badgeText = st === 'danger' ? bi('Đã vượt hạn mức', 'Over allowance') : st === 'warn' ? bi('Sắp đạt hạn mức', 'Nearing allowance') : bi('Trong hạn mức', 'Within allowance');
    var remaining = Math.max(0, c.freeHours - c.usedHours);
    var opts = companies.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === state.companyId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    var monthLabel = c.month ? c.month.split('-').reverse().join('/') : '';
    el.innerHTML =
      '<div class="usage-strip-inner">' +
        '<div class="usage-identity">' +
          '<div class="avatar">' + esc(initials(c.name)) + '</div>' +
          '<div>' +
            '<label class="usage-role-label" for="roleSelect">' + bi('Đang đặt với vai trò', 'Booking as') + '</label>' +
            '<select id="roleSelect" class="role-select">' + opts + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="usage-meter">' +
          '<div class="usage-meter-head">' +
            '<span class="usage-meter-title">' + bi('Giờ họp miễn phí — tháng ' + monthLabel, 'Free meeting hours — ' + monthLabel) + '</span>' +
            '<span class="badge badge-' + st + '">' + badgeText + '</span>' +
          '</div>' +
          '<div class="usage-track"><div class="usage-fill is-' + st + '" style="width:' + pct + '%"></div></div>' +
          '<div class="usage-figures"><span><span class="mono">' + fmtH(c.usedHours) + '</span> / <span class="mono">' + fmtH(c.freeHours) + '</span> ' + bi('đã dùng', 'used') + '</span>' +
          (overage > 0 ? '' : '<span>' + bi('còn ' + fmtH(remaining), fmtH(remaining) + ' remaining') + '</span>') +
          '</div>' +
          (overage > 0
            ? '<div class="overage-callout"><svg class="icon" width="16" height="16"><use href="#i-alert"></use></svg>' +
              '<span><strong class="mono">' + fmtH(overage) + '</strong> ' + bi('vượt hạn mức tháng này — tính là giờ phát sinh, sẽ được tính phí thêm.', 'over your free allowance this month — billed as an extra-hours charge.') + '</span></div>'
            : '') +
        '</div>' +
      '</div>';
    document.getElementById('roleSelect').addEventListener('change', function (e) {
      state.companyId = e.target.value;
      state.selectedHour = null;
      refreshAll();
    });
  }

  // ---------- render: room tabs + date nav ----------
  function renderRoomTabs() {
    var el = document.getElementById('roomTabs');
    el.innerHTML = rooms.map(function (r) {
      var active = r.id === state.roomId;
      return '<button class="room-tab' + (active ? ' is-active' : '') + '" role="tab" aria-selected="' + active + '" data-room="' + r.id + '" type="button">' +
        '<span class="room-tab-name">' + esc(r.name) + '</span><span class="room-tab-meta">' + r.capacity + ' chỗ · ' + esc(r.floor) + '</span></button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-room]'), function (btn) {
      btn.addEventListener('click', function () {
        state.roomId = btn.getAttribute('data-room');
        state.selectedHour = null;
        refreshGrid();
      });
    });
    var r = room(state.roomId);
    var rn = esc(r ? r.name : '');
    document.getElementById('gridRoomTitle').innerHTML = bi('Lịch phòng ' + rn + ' theo giờ', rn + ' — hourly schedule');
  }
  function renderDateNav() {
    document.getElementById('dateDisplayText').innerHTML = fmtDateFullBi(state.date);
    document.getElementById('datePicker').value = state.date;
  }
  function shiftDate(days) {
    var d = new Date(state.date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    state.date = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    state.selectedHour = null;
    refreshGrid();
  }

  // ---------- render: slot grid ----------
  function renderGrid() {
    var el = document.getElementById('slotGrid');
    var rows = [];
    for (var h = OPEN; h < CLOSE; h++) {
      var b = findConflict(gridBookings, h, h + 1);
      var rowState, mainHtml, cancelHidden = true;
      if (!b) {
        rowState = state.selectedHour === h ? 'selected' : 'available';
        mainHtml = '<span class="slot-main">' + bi('Còn trống — đặt khung giờ này', 'Available — book this slot') + '</span>';
      } else if (b.companyId === state.companyId) {
        rowState = 'mine';
        mainHtml = '<span class="slot-main">' + bi('Công ty bạn đã đặt', 'Booked by your company') + (b.overLimit ? ' <span style="color:var(--warn);font-weight:700"> · ' + bi('vượt hạn mức', 'over allowance') + '</span>' : '') + '</span><span class="slot-sub">' +
          (b.note ? esc(b.note) : bi('Không có ghi chú', 'No note')) + ' · ' + fmtRange(b.start, b.end) + '</span>';
        cancelHidden = false;
      } else {
        rowState = 'other';
        mainHtml = '<span class="slot-main">' + bi('Đã có người đặt', 'Already booked') + '</span><span class="slot-sub">' + (b.companyName ? esc(b.companyName) : bi('Công ty khác', 'Another company')) + ' · ' + fmtRange(b.start, b.end) + '</span>';
      }
      rows.push('<div class="slot-row state-' + rowState + '">' +
        '<div class="slot-time mono">' + fmtRange(h, h + 1) + '</div>' +
        '<button class="slot-btn" type="button" data-hour="' + h + '">' + mainHtml + '</button>' +
        '<button class="slot-cancel" type="button" data-cancel-hour="' + h + '"' + (cancelHidden ? ' hidden' : '') + '>' + bi('Huỷ', 'Cancel') + '</button>' +
      '</div>');
    }
    el.innerHTML = rows.join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-hour]'), function (btn) {
      btn.addEventListener('click', function () { onSlotClick(parseInt(btn.getAttribute('data-hour'), 10)); });
    });
    Array.prototype.forEach.call(el.querySelectorAll('[data-cancel-hour]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var h = parseInt(btn.getAttribute('data-cancel-hour'), 10);
        var b = findConflict(gridBookings, h, h + 1);
        if (b) cancelBooking(b.id);
      });
    });
  }

  function onSlotClick(h) {
    var b = findConflict(gridBookings, h, h + 1);
    if (b && b.companyId !== state.companyId) {
      state.selectedHour = { conflict: b };
      renderPanel();
      return;
    }
    if (b) return; // mine — use the cancel button instead
    state.selectedHour = h;
    renderGrid();
    renderPanel();
  }

  // ---------- render: booking panel ----------
  function renderPanel() {
    var el = document.getElementById('bookingPanel');
    var sel = state.selectedHour;

    if (sel == null) {
      el.innerHTML = '<div class="panel-empty"><svg class="icon panel-empty-icon"><use href="#i-calendar"></use></svg>' +
        '<p>' + bi('Chọn một khung giờ còn trống trong lịch bên trái để bắt đầu đặt phòng.', 'Select an available time slot on the left to start booking.') + '</p></div>';
      return;
    }
    if (typeof sel === 'object' && sel.conflict) {
      var b = sel.conflict;
      var roomName = esc((room(state.roomId) || {}).name);
      var dateShort = fmtDateShort(state.date);
      var conflictCompany = esc(b.companyName || 'công ty khác');
      el.innerHTML = '<div class="alert alert-danger"><svg class="icon"><use href="#i-alert"></use></svg><div>' +
        '<p class="alert-title">' + bi('Khung giờ đã có người đặt', 'This slot is already booked') + '</p>' +
        '<p>' + fmtRange(b.start, b.end) + ' tại ' + roomName + ' ngày ' + dateShort + ' đã được <strong>' + conflictCompany + '</strong> giữ chỗ trước. Theo nguyên tắc đặt trước – phục vụ trước, bạn không thể đặt trùng khung giờ này.<br>' +
        '<span class="en">' + fmtRange(b.start, b.end) + ' at ' + roomName + ' on ' + dateShort + ' is already held by <strong>' + conflictCompany + '</strong>. Under the first-come, first-served rule, you can’t double-book this slot.</span></p>' +
        '</div></div>' +
        '<button class="btn btn-ghost btn-block" id="dismissAlertBtn" type="button">' + bi('Chọn khung giờ khác', 'Choose another slot') + '</button>';
      document.getElementById('dismissAlertBtn').addEventListener('click', function () { state.selectedHour = null; renderGrid(); renderPanel(); });
      return;
    }

    var h = sel;
    var maxAvail = maxContiguous(gridBookings, h);
    var durOpts = '';
    for (var d = 1; d <= maxAvail; d++) durOpts += '<option value="' + d + '">' + d + ' giờ / ' + d + ' hr (đến ' + fmtHour(h + d) + ')</option>';

    el.innerHTML =
      '<h3>' + bi('Đặt phòng ' + esc((room(state.roomId) || {}).name), 'Book ' + esc((room(state.roomId) || {}).name)) + '</h3>' +
      '<dl class="summary-list">' +
        '<div><dt>' + bi('Ngày', 'Date') + '</dt><dd>' + fmtDateShort(state.date) + '</dd></div>' +
        '<div><dt>' + bi('Bắt đầu', 'Start') + '</dt><dd class="mono">' + fmtHour(h) + '</dd></div>' +
      '</dl>' +
      '<div class="field"><label for="durationSelect">' + bi('Thời lượng', 'Duration') + '</label><select id="durationSelect">' + durOpts + '</select></div>' +
      '<div class="field"><label for="noteInput">' + bi('Ghi chú (không bắt buộc)', 'Note (optional)') + '</label><input id="noteInput" type="text" maxlength="60" placeholder="VD: Họp với đối tác ABC / e.g. Meeting with partner"></div>' +
      '<div class="field"><label for="contactName">' + bi('Họ tên người đặt', "Booker's full name") + '</label><input id="contactName" type="text" maxlength="80" placeholder="VD: Nguyễn Văn A" autocomplete="name"></div>' +
      '<div class="field"><label for="contactPhone">' + bi('Số điện thoại người đặt', "Booker's phone number") + '</label><input id="contactPhone" type="tel" maxlength="20" placeholder="VD: 0938 123 456" autocomplete="tel"></div>' +
      '<p class="privacy-note"><svg class="icon" width="15" height="15"><use href="#i-lock"></use></svg><span>Thông tin này chỉ phục vụ công tác quản trị nội bộ để liên hệ khi cần thiết — không hiển thị công khai và không chia sẻ cho công ty khác.<br><span class="en">This information is for internal admin use only, to contact you if needed — it is never shown publicly or shared with other companies.</span></span></p>' +
      '<div id="limitWarning"></div>' +
      '<div class="panel-actions">' +
        '<button type="button" class="btn btn-ghost" id="cancelSelectBtn">' + bi('Huỷ chọn', 'Clear') + '</button>' +
        '<button type="button" class="btn btn-primary" id="confirmBtn" style="flex:1">' + bi('Xác nhận đặt phòng', 'Confirm booking') + '</button>' +
      '</div>';

    var savedContact = {};
    try { savedContact = JSON.parse(localStorage.getItem('sbsh_contact') || '{}'); } catch (e) { savedContact = {}; }
    if (savedContact.name) document.getElementById('contactName').value = savedContact.name;
    if (savedContact.phone) document.getElementById('contactPhone').value = savedContact.phone;

    var durSel = document.getElementById('durationSelect');
    function updateWarning() {
      var dur = parseInt(durSel.value, 10);
      var c = company(state.companyId);
      var box = document.getElementById('limitWarning');
      if (!c) return;
      var projected = c.usedHours + dur;
      if (projected > c.freeHours) {
        var already = c.usedHours >= c.freeHours;
        var msg = already
          ? 'Công ty của bạn đã vượt hạn mức ' + fmtH(c.freeHours) + ' miễn phí (đang dùng ' + fmtH(c.usedHours) + '). Khung giờ này sẽ được tính là giờ phát sinh ngoài gói.'
          : 'Đặt thêm ' + fmtH(dur) + ' sẽ nâng tổng lên ' + fmtH(projected) + ', vượt ' + fmtH(projected - c.freeHours) + ' so với hạn mức ' + fmtH(c.freeHours) + ' miễn phí tháng này.';
        var msgEn = already
          ? 'Your company has already exceeded its ' + fmtH(c.freeHours) + ' free allowance (currently at ' + fmtH(c.usedHours) + '). This slot will be billed as an extra-hours charge.'
          : 'Booking ' + fmtH(dur) + ' more will bring the total to ' + fmtH(projected) + ', ' + fmtH(projected - c.freeHours) + ' over this month’s ' + fmtH(c.freeHours) + ' free allowance.';
        box.innerHTML = '<div class="alert alert-warn" style="margin-bottom:12px"><svg class="icon"><use href="#i-alert"></use></svg><div><p class="alert-title">' + bi('Sẽ vượt giờ họp miễn phí', 'Will exceed free hours') + '</p><p>' + msg + '<br><span class="en">' + msgEn + '</span></p></div></div>';
        document.getElementById('confirmBtn').classList.add('is-warn');
        document.getElementById('confirmBtn').innerHTML = bi('Xác nhận đặt (vượt hạn mức)', 'Confirm (over allowance)');
      } else {
        box.innerHTML = '';
        document.getElementById('confirmBtn').classList.remove('is-warn');
        document.getElementById('confirmBtn').innerHTML = bi('Xác nhận đặt phòng', 'Confirm booking');
      }
    }
    durSel.addEventListener('change', updateWarning);
    updateWarning();

    document.getElementById('cancelSelectBtn').addEventListener('click', function () { state.selectedHour = null; renderGrid(); renderPanel(); });
    document.getElementById('confirmBtn').addEventListener('click', function () {
      var confirmBtn = document.getElementById('confirmBtn');
      var contactName = document.getElementById('contactName').value.trim();
      var contactPhone = document.getElementById('contactPhone').value.trim();
      var phoneDigits = contactPhone.replace(/[^0-9]/g, '');
      if (!contactName) {
        toast('Vui lòng nhập họ tên người đặt.', 'warn', 'Please enter the booker’s full name.');
        document.getElementById('contactName').focus();
        return;
      }
      if (phoneDigits.length < 8) {
        toast('Vui lòng nhập số điện thoại hợp lệ của người đặt.', 'warn', 'Please enter a valid phone number for the booker.');
        document.getElementById('contactPhone').focus();
        return;
      }

      confirmBtn.disabled = true;
      var dur = parseInt(durSel.value, 10);
      var note = document.getElementById('noteInput').value.trim();
      var roomName = (room(state.roomId) || {}).name;
      var rangeStr = fmtRange(h, h + dur);
      var dateStr = fmtDateShort(state.date);
      api('/api/bookings', {
        method: 'POST',
        body: { roomId: state.roomId, date: state.date, start: h, duration: dur, companyId: state.companyId, note: note, contactName: contactName, contactPhone: contactPhone }
      }).then(function (result) {
        state.selectedHour = null;
        try { localStorage.setItem('sbsh_contact', JSON.stringify({ name: contactName, phone: contactPhone })); } catch (e) { /* ignore */ }
        toast(
          'Đã đặt ' + roomName + ' ' + rangeStr + ' ngày ' + dateStr + ' thành công' + (result.overLimit ? ' (đã vượt giờ miễn phí)' : ''),
          result.overLimit ? 'warn' : 'ok',
          'Booked ' + roomName + ' ' + rangeStr + ' on ' + dateStr + (result.overLimit ? ' (over free hours)' : '')
        );
        refreshAll();
      }).catch(function (err) {
        confirmBtn.disabled = false;
        if (err.status === 409) {
          toast(err.message, 'warn');
          state.selectedHour = null;
          refreshGrid();
        } else {
          toast(err.message || 'Không thể đặt phòng, vui lòng thử lại.', 'warn', err.message ? undefined : 'Could not book the room, please try again.');
        }
      });
    });
  }

  function cancelBooking(id) {
    api('/api/bookings/' + id + '?companyId=' + encodeURIComponent(state.companyId), { method: 'DELETE' })
      .then(function () { toast('Đã huỷ lịch đặt phòng', 'ok', 'Booking cancelled'); refreshAll(); })
      .catch(function (err) { toast(err.message || 'Không thể huỷ lịch.', 'warn', err.message ? undefined : 'Could not cancel the booking.'); });
  }

  // ---------- render: my bookings ----------
  function renderMyBookings() {
    var el = document.getElementById('myBookingsList');
    if (!myBookings.length) { el.innerHTML = '<p class="empty-note">' + bi('Công ty bạn chưa có lịch đặt phòng nào sắp tới.', 'Your company has no upcoming bookings yet.') + '</p>'; return; }
    el.innerHTML = myBookings.map(function (b) {
      var r = room(b.roomId);
      return '<div class="booking-row"><div class="booking-row-main">' +
        '<span class="booking-room-chip">' + esc(r ? r.name : b.roomId) + '</span>' +
        '<span class="mono">' + fmtDateShort(b.date) + ' · ' + fmtRange(b.start, b.end) + '</span>' +
        (b.note ? '<span class="booking-note">' + esc(b.note) + '</span>' : '') +
        (b.overLimit ? '<span class="badge badge-warn">' + bi('Vượt hạn mức', 'Over allowance') + '</span>' : '') +
        '</div><button class="btn btn-ghost btn-sm" data-cancel-id="' + b.id + '" type="button">' + bi('Huỷ lịch', 'Cancel') + '</button></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-cancel-id]'), function (btn) {
      btn.addEventListener('click', function () { cancelBooking(btn.getAttribute('data-cancel-id')); });
    });
  }

  // ---------- data loading ----------
  function refreshGrid() {
    renderRoomTabs();
    renderDateNav();
    document.getElementById('slotGrid').innerHTML = '<p class="hint">' + bi('Đang tải…', 'Loading…') + '</p>';
    return api('/api/bookings?roomId=' + encodeURIComponent(state.roomId) + '&date=' + encodeURIComponent(state.date))
      .then(function (list) { gridBookings = list; renderGrid(); renderPanel(); })
      .catch(function (err) { document.getElementById('slotGrid').innerHTML = '<p class="hint">' + bi('Không tải được lịch: ' + esc(err.message), 'Could not load the schedule: ' + esc(err.message)) + '</p>'; });
  }

  function refreshCompaniesAndUsage() {
    return api('/api/companies').then(function (list) {
      companies = list;
      if (!state.companyId || !company(state.companyId)) state.companyId = companies.length ? companies[0].id : null;
      renderUsageStrip();
    });
  }

  function refreshMyBookings() {
    if (!state.companyId) return Promise.resolve();
    return api('/api/bookings/mine?companyId=' + encodeURIComponent(state.companyId)).then(function (list) {
      myBookings = list;
      renderMyBookings();
    });
  }

  function refreshAll() {
    return Promise.all([refreshCompaniesAndUsage(), refreshGrid(), refreshMyBookings()]);
  }

  // ---------- init ----------
  document.getElementById('prevDay').addEventListener('click', function () { shiftDate(-1); });
  document.getElementById('nextDay').addEventListener('click', function () { shiftDate(1); });
  document.getElementById('dateDisplayBtn').addEventListener('click', function () {
    var input = document.getElementById('datePicker');
    if (input.showPicker) { try { input.showPicker(); } catch (e) { input.focus(); } } else { input.focus(); input.click(); }
  });
  document.getElementById('datePicker').addEventListener('change', function (e) {
    if (e.target.value) { state.date = e.target.value; state.selectedHour = null; refreshGrid(); }
  });

  Promise.all([api('/api/rooms'), api('/api/companies')]).then(function (results) {
    rooms = results[0];
    companies = results[1];
    state.roomId = rooms.length ? rooms[0].id : null;
    state.companyId = companies.length ? companies[0].id : null;
    renderUsageStrip();
    refreshGrid();
    refreshMyBookings();
  }).catch(function (err) {
    document.getElementById('usageStrip').innerHTML = '<p class="hint">' + bi('Không kết nối được máy chủ: ' + esc(err.message), 'Could not connect to the server: ' + esc(err.message)) + '</p>';
  });
})();
