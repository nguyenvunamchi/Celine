(function () {
  'use strict';

  var OPEN = 8, CLOSE = 18, MAX_DUR = 4;
  var WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

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

  function toast(msg, kind) {
    var stack = document.getElementById('toastStack');
    var el = document.createElement('div');
    el.className = 'toast';
    var icon = kind === 'warn' ? 'i-alert' : 'i-check-circle';
    var cls = kind === 'warn' ? 'toast-warn' : 'toast-ok';
    el.innerHTML = '<svg class="icon ' + cls + '" width="17" height="17"><use href="#' + icon + '"></use></svg><span>' + esc(msg) + '</span>';
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
    if (!c) { el.innerHTML = '<p class="hint">Chưa có công ty nào trong hệ thống.</p>'; return; }
    var ratio = c.usedHours / c.freeHours;
    var st = c.usedHours > c.freeHours ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
    var pct = Math.min(100, Math.round(ratio * 100));
    var badgeText = st === 'danger' ? 'Đã vượt hạn mức' : st === 'warn' ? 'Sắp đạt hạn mức' : 'Trong hạn mức';
    var remaining = c.freeHours - c.usedHours;
    var opts = companies.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === state.companyId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('');
    var monthLabel = c.month ? c.month.split('-').reverse().join('/') : '';
    el.innerHTML =
      '<div class="usage-strip-inner">' +
        '<div class="usage-identity">' +
          '<div class="avatar">' + esc(initials(c.name)) + '</div>' +
          '<div>' +
            '<label class="usage-role-label" for="roleSelect">Đang đặt với vai trò</label>' +
            '<select id="roleSelect" class="role-select">' + opts + '</select>' +
          '</div>' +
        '</div>' +
        '<div class="usage-meter">' +
          '<div class="usage-meter-head">' +
            '<span class="usage-meter-title">Giờ họp miễn phí — tháng ' + monthLabel + '</span>' +
            '<span class="badge badge-' + st + '">' + badgeText + '</span>' +
          '</div>' +
          '<div class="usage-track"><div class="usage-fill is-' + st + '" style="width:' + pct + '%"></div></div>' +
          '<div class="usage-figures"><span><span class="mono">' + fmtH(c.usedHours) + '</span> / <span class="mono">' + fmtH(c.freeHours) + '</span> đã dùng</span>' +
          '<span>' + (remaining >= 0 ? 'còn ' + fmtH(remaining) : 'vượt ' + fmtH(Math.abs(remaining))) + '</span></div>' +
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
    document.getElementById('gridRoomTitle').textContent = 'Lịch phòng ' + (r ? r.name : '') + ' theo giờ';
  }
  function renderDateNav() {
    document.getElementById('dateDisplayText').textContent = fmtDateFull(state.date);
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
        mainHtml = '<span class="slot-main">Còn trống — đặt khung giờ này</span>';
      } else if (b.companyId === state.companyId) {
        rowState = 'mine';
        mainHtml = '<span class="slot-main">Của bạn' + (b.overLimit ? ' <span style="color:var(--warn);font-weight:700"> · vượt hạn mức</span>' : '') + '</span><span class="slot-sub">' + esc(b.note || 'Không có ghi chú') + ' · ' + fmtRange(b.start, b.end) + '</span>';
        cancelHidden = false;
      } else {
        rowState = 'other';
        mainHtml = '<span class="slot-main">Đã có người đặt</span><span class="slot-sub">' + esc(b.companyName || 'Công ty khác') + ' · ' + fmtRange(b.start, b.end) + '</span>';
      }
      rows.push('<div class="slot-row state-' + rowState + '">' +
        '<div class="slot-time mono">' + fmtRange(h, h + 1) + '</div>' +
        '<button class="slot-btn" type="button" data-hour="' + h + '">' + mainHtml + '</button>' +
        '<button class="slot-cancel" type="button" data-cancel-hour="' + h + '"' + (cancelHidden ? ' hidden' : '') + '>Huỷ</button>' +
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
        '<p>Chọn một khung giờ còn trống trong lịch bên trái để bắt đầu đặt phòng.</p></div>';
      return;
    }
    if (typeof sel === 'object' && sel.conflict) {
      var b = sel.conflict;
      el.innerHTML = '<div class="alert alert-danger"><svg class="icon"><use href="#i-alert"></use></svg><div>' +
        '<p class="alert-title">Khung giờ đã có người đặt</p>' +
        '<p>' + fmtRange(b.start, b.end) + ' tại ' + esc((room(state.roomId) || {}).name) + ' ngày ' + fmtDateShort(state.date) + ' đã được <strong>' + esc(b.companyName || 'công ty khác') + '</strong> giữ chỗ trước. Theo nguyên tắc đặt trước – phục vụ trước, bạn không thể đặt trùng khung giờ này.</p>' +
        '</div></div>' +
        '<button class="btn btn-ghost btn-block" id="dismissAlertBtn" type="button">Chọn khung giờ khác</button>';
      document.getElementById('dismissAlertBtn').addEventListener('click', function () { state.selectedHour = null; renderGrid(); renderPanel(); });
      return;
    }

    var h = sel;
    var maxAvail = maxContiguous(gridBookings, h);
    var durOpts = '';
    for (var d = 1; d <= maxAvail; d++) durOpts += '<option value="' + d + '">' + d + ' giờ (đến ' + fmtHour(h + d) + ')</option>';

    el.innerHTML =
      '<h3>Đặt phòng ' + esc((room(state.roomId) || {}).name) + '</h3>' +
      '<dl class="summary-list">' +
        '<div><dt>Ngày</dt><dd>' + fmtDateShort(state.date) + '</dd></div>' +
        '<div><dt>Bắt đầu</dt><dd class="mono">' + fmtHour(h) + '</dd></div>' +
      '</dl>' +
      '<div class="field"><label for="durationSelect">Thời lượng</label><select id="durationSelect">' + durOpts + '</select></div>' +
      '<div class="field"><label for="noteInput">Ghi chú (không bắt buộc)</label><input id="noteInput" type="text" maxlength="60" placeholder="VD: Họp với đối tác ABC"></div>' +
      '<div id="limitWarning"></div>' +
      '<div class="panel-actions">' +
        '<button type="button" class="btn btn-ghost" id="cancelSelectBtn">Huỷ chọn</button>' +
        '<button type="button" class="btn btn-primary" id="confirmBtn" style="flex:1">Xác nhận đặt phòng</button>' +
      '</div>';

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
        box.innerHTML = '<div class="alert alert-warn" style="margin-bottom:12px"><svg class="icon"><use href="#i-alert"></use></svg><div><p class="alert-title">Sẽ vượt giờ họp miễn phí</p><p>' + msg + '</p></div></div>';
        document.getElementById('confirmBtn').classList.add('is-warn');
        document.getElementById('confirmBtn').textContent = 'Xác nhận đặt (vượt hạn mức)';
      } else {
        box.innerHTML = '';
        document.getElementById('confirmBtn').classList.remove('is-warn');
        document.getElementById('confirmBtn').textContent = 'Xác nhận đặt phòng';
      }
    }
    durSel.addEventListener('change', updateWarning);
    updateWarning();

    document.getElementById('cancelSelectBtn').addEventListener('click', function () { state.selectedHour = null; renderGrid(); renderPanel(); });
    document.getElementById('confirmBtn').addEventListener('click', function () {
      var confirmBtn = document.getElementById('confirmBtn');
      confirmBtn.disabled = true;
      var dur = parseInt(durSel.value, 10);
      var note = document.getElementById('noteInput').value.trim();
      api('/api/bookings', {
        method: 'POST',
        body: { roomId: state.roomId, date: state.date, start: h, duration: dur, companyId: state.companyId, note: note }
      }).then(function (result) {
        state.selectedHour = null;
        toast('Đã đặt ' + (room(state.roomId) || {}).name + ' ' + fmtRange(h, h + dur) + ' ngày ' + fmtDateShort(state.date) + ' thành công' + (result.overLimit ? ' (đã vượt giờ miễn phí)' : ''), result.overLimit ? 'warn' : 'ok');
        refreshAll();
      }).catch(function (err) {
        confirmBtn.disabled = false;
        if (err.status === 409) {
          toast(err.message, 'warn');
          state.selectedHour = null;
          refreshGrid();
        } else {
          toast(err.message || 'Không thể đặt phòng, vui lòng thử lại.', 'warn');
        }
      });
    });
  }

  function cancelBooking(id) {
    api('/api/bookings/' + id + '?companyId=' + encodeURIComponent(state.companyId), { method: 'DELETE' })
      .then(function () { toast('Đã huỷ lịch đặt phòng', 'ok'); refreshAll(); })
      .catch(function (err) { toast(err.message || 'Không thể huỷ lịch.', 'warn'); });
  }

  // ---------- render: my bookings ----------
  function renderMyBookings() {
    var el = document.getElementById('myBookingsList');
    if (!myBookings.length) { el.innerHTML = '<p class="empty-note">Bạn chưa có lịch đặt phòng nào sắp tới.</p>'; return; }
    el.innerHTML = myBookings.map(function (b) {
      var r = room(b.roomId);
      return '<div class="booking-row"><div class="booking-row-main">' +
        '<span class="booking-room-chip">' + esc(r ? r.name : b.roomId) + '</span>' +
        '<span class="mono">' + fmtDateShort(b.date) + ' · ' + fmtRange(b.start, b.end) + '</span>' +
        (b.note ? '<span class="booking-note">' + esc(b.note) + '</span>' : '') +
        (b.overLimit ? '<span class="badge badge-warn">Vượt hạn mức</span>' : '') +
        '</div><button class="btn btn-ghost btn-sm" data-cancel-id="' + b.id + '" type="button">Huỷ lịch</button></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-cancel-id]'), function (btn) {
      btn.addEventListener('click', function () { cancelBooking(btn.getAttribute('data-cancel-id')); });
    });
  }

  // ---------- data loading ----------
  function refreshGrid() {
    renderRoomTabs();
    renderDateNav();
    document.getElementById('slotGrid').innerHTML = '<p class="hint">Đang tải…</p>';
    return api('/api/bookings?roomId=' + encodeURIComponent(state.roomId) + '&date=' + encodeURIComponent(state.date))
      .then(function (list) { gridBookings = list; renderGrid(); renderPanel(); })
      .catch(function (err) { document.getElementById('slotGrid').innerHTML = '<p class="hint">Không tải được lịch: ' + esc(err.message) + '</p>'; });
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
    document.getElementById('usageStrip').innerHTML = '<p class="hint">Không kết nối được máy chủ: ' + esc(err.message) + '</p>';
  });
})();
