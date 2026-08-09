(function () {
  'use strict';

  var OPEN = 8, CLOSE = 18, MAX_DUR = 4;

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
          throw err;
        }
        return data;
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtHour(h) { return (h < 10 ? '0' : '') + h + ':00'; }
  function fmtRange(s, e) { return fmtHour(s) + '–' + fmtHour(e); }
  function fmtDateShort(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function fmtH(n) {
    n = Math.round(n * 10) / 10;
    var s = Math.abs(n % 1) < 0.001 ? String(Math.round(n)) : n.toFixed(1).replace('.', ',');
    return s + 'h';
  }
  function currentMonthStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  }

  function toast(msg, kind) {
    var stack = document.getElementById('toastStack');
    var el = document.createElement('div');
    el.className = 'toast';
    el.style.color = kind === 'warn' ? 'var(--warn)' : 'var(--ok)';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 260);
    }, 3800);
  }

  // ---------- auth gate ----------
  function showLogin() {
    document.getElementById('loginWrap').hidden = false;
    document.getElementById('dashboard').hidden = true;
  }
  var reportInitialized = false;
  function showDashboard(username) {
    document.getElementById('loginWrap').hidden = true;
    document.getElementById('dashboard').hidden = false;
    document.getElementById('whoami').textContent = username ? ('Xin chào, ' + username) : '';
    loadAll();
    if (!reportInitialized) {
      reportInitialized = true;
      var monthInput = document.getElementById('reportMonth');
      monthInput.value = currentMonthStr();
      updateReportLink();
      loadReport(monthInput.value);
    }
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = document.getElementById('loginBtn');
    var errBox = document.getElementById('loginError');
    errBox.classList.remove('is-visible');
    btn.disabled = true;
    api('/api/admin/login', {
      method: 'POST',
      body: { username: document.getElementById('loginUser').value, password: document.getElementById('loginPass').value }
    }).then(function (data) {
      document.getElementById('loginPass').value = '';
      showDashboard(data.username);
    }).catch(function (err) {
      errBox.textContent = err.message || 'Đăng nhập thất bại.';
      errBox.classList.add('is-visible');
    }).finally(function () { btn.disabled = false; });
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).finally(function () { showLogin(); });
  });

  api('/api/admin/me').then(function (data) { showDashboard(data.username); }).catch(function () { showLogin(); });

  // ---------- data loading ----------
  function loadAll() {
    loadStats();
    loadRooms();
    loadBookings();
    loadCompanies();
  }

  function loadStats() {
    api('/api/admin/stats').then(function (s) {
      var overCount = s.overLimitCompanies;
      var tiles = [
        { label: 'Phòng họp', value: s.rooms },
        { label: 'Lượt đặt đang hoạt động', value: s.activeBookings },
        { label: 'Công ty đang thuê', value: s.activeCompanies },
        { label: 'Công ty vượt giờ miễn phí', value: overCount, warn: overCount > 0 }
      ];
      document.getElementById('statGrid').innerHTML = tiles.map(function (t) {
        return '<div class="stat-tile' + (t.warn ? ' stat-tile-warn' : '') + '"><p class="stat-label">' + esc(t.label) + '</p><p class="stat-value mono">' + t.value + '</p></div>';
      }).join('');
    }).catch(function (err) { if (err.status === 401) showLogin(); });
  }

  function updateReportLink() {
    var month = document.getElementById('reportMonth').value || currentMonthStr();
    document.getElementById('downloadReportBtn').href = '/api/admin/reports/monthly.xlsx?month=' + encodeURIComponent(month);
  }

  function loadReport(month) {
    var tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-note">Đang tải…</td></tr>';
    api('/api/admin/reports/monthly?month=' + encodeURIComponent(month)).then(function (data) {
      if (!data.companies.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-note">Chưa có công ty nào.</td></tr>'; return; }
      var rowsHtml = data.companies.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="mono">' + fmtH(c.freeHours) + '</td><td class="mono">' + fmtH(c.usedHours) + '</td>' +
          '<td>' + (c.overageHours > 0 ? '<span class="mono" style="color:var(--warn);font-weight:700">' + fmtH(c.overageHours) + '</span>' : '<span class="mono mini-figure">—</span>') + '</td>' +
          '<td class="mono">' + c.bookingCount + '</td></tr>';
      }).join('');
      var totalHtml = '<tr style="font-weight:700"><td>Tổng cộng</td><td></td><td class="mono">' + fmtH(data.totals.usedHours) + '</td>' +
        '<td class="mono" style="color:var(--warn)">' + fmtH(data.totals.overageHours) + '</td><td class="mono">' + data.totals.bookingCount + '</td></tr>';
      tbody.innerHTML = rowsHtml + totalHtml;
    }).catch(function (err) {
      if (err.status === 401) { showLogin(); return; }
      tbody.innerHTML = '<tr><td colspan="5" class="empty-note">Lỗi tải báo cáo: ' + esc(err.message) + '</td></tr>';
    });
  }

  document.getElementById('reportMonth').addEventListener('change', function () {
    updateReportLink();
    loadReport(this.value || currentMonthStr());
  });
  document.getElementById('viewReportBtn').addEventListener('click', function () {
    var month = document.getElementById('reportMonth').value || currentMonthStr();
    loadReport(month);
  });

  function loadRooms() {
    api('/api/admin/rooms').then(function (rows) {
      var el = document.getElementById('roomsTableBody');
      if (!rows.length) { el.innerHTML = '<tr><td colspan="4" class="empty-note">Chưa có phòng họp nào.</td></tr>'; return; }
      el.innerHTML = rows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td class="mono">' + r.capacity + ' chỗ</td><td>' + esc(r.floor) + '</td>' +
          '<td class="table-actions">' +
            '<button class="icon-btn" data-edit-room="' + r.id + '" type="button" aria-label="Sửa thông tin phòng"><svg class="icon" width="15" height="15"><use href="#i-pencil"></use></svg></button>' +
            '<button class="icon-btn icon-btn-danger" data-delete-room="' + r.id + '" type="button" aria-label="Xoá phòng"><svg class="icon" width="15" height="15"><use href="#i-trash"></use></svg></button>' +
          '</td></tr>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('[data-edit-room]'), function (btn) {
        btn.addEventListener('click', function () { openRoomModal(rows.find(function (r) { return r.id === btn.getAttribute('data-edit-room'); })); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-delete-room]'), function (btn) {
        btn.addEventListener('click', function () {
          var r = rows.find(function (x) { return x.id === btn.getAttribute('data-delete-room'); });
          if (!r) return;
          if (!window.confirm('Xoá phòng "' + r.name + '"? Mọi lịch đặt đang có trong phòng này cũng sẽ bị huỷ.')) return;
          api('/api/admin/rooms/' + r.id, { method: 'DELETE' })
            .then(function () { toast('Đã xoá phòng "' + r.name + '"', 'ok'); loadAll(); })
            .catch(function (err) { toast(err.message, 'warn'); });
        });
      });
    }).catch(function (err) { if (err.status === 401) showLogin(); });
  }

  function loadBookings() {
    api('/api/admin/bookings').then(function (rows) {
      var el = document.getElementById('bookingsTableBody');
      if (!rows.length) { el.innerHTML = '<tr><td colspan="6" class="empty-note">Chưa có lịch đặt nào.</td></tr>'; return; }
      el.innerHTML = rows.map(function (b) {
        return '<tr><td>' + esc(b.roomName) + '</td><td>' + esc(b.companyName) + '</td><td class="mono">' + fmtDateShort(b.date) + '</td><td class="mono">' + fmtRange(b.start, b.end) + '</td>' +
          '<td>' + (b.overLimit ? '<span class="chip chip-warn">Vượt hạn mức</span>' : '<span class="chip chip-ok">Trong hạn</span>') + '</td>' +
          '<td class="table-actions">' +
            '<button class="icon-btn" data-edit-booking="' + b.id + '" type="button" aria-label="Sửa giờ họp"><svg class="icon" width="15" height="15"><use href="#i-pencil"></use></svg></button>' +
            '<button class="icon-btn icon-btn-danger" data-delete-booking="' + b.id + '" type="button" aria-label="Xoá lịch"><svg class="icon" width="15" height="15"><use href="#i-trash"></use></svg></button>' +
          '</td></tr>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('[data-edit-booking]'), function (btn) {
        btn.addEventListener('click', function () { openEditBookingModal(rows.find(function (r) { return r.id === btn.getAttribute('data-edit-booking'); })); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-delete-booking]'), function (btn) {
        btn.addEventListener('click', function () {
          if (!window.confirm('Xoá lịch đặt này khỏi hệ thống?')) return;
          api('/api/admin/bookings/' + btn.getAttribute('data-delete-booking'), { method: 'DELETE' })
            .then(function () { toast('Đã xoá lịch đặt', 'ok'); loadAll(); })
            .catch(function (err) { toast(err.message, 'warn'); });
        });
      });
    }).catch(function (err) { if (err.status === 401) showLogin(); });
  }

  function loadCompanies() {
    api('/api/admin/companies').then(function (rows) {
      var el = document.getElementById('companiesTableBody');
      el.innerHTML = rows.map(function (c) {
        var overage = c.overageHours || 0;
        var ratio = c.usedHours / c.freeHours;
        var st = overage > 0 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
        var pct = Math.min(100, Math.round(ratio * 100));
        return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.plan) + '</td>' +
          '<td><div class="mini-meter"><div class="mini-track"><div class="mini-fill is-' + st + '" style="width:' + pct + '%"></div></div><span class="mono mini-figure">' + fmtH(c.usedHours) + ' / ' + fmtH(c.freeHours) + '</span></div></td>' +
          '<td>' + (overage > 0 ? '<span class="mono" style="color:var(--warn);font-weight:700">' + fmtH(overage) + '</span>' : '<span class="mono mini-figure">—</span>') + '</td>' +
          '<td>' + (c.status === 'active' ? '<span class="chip chip-ok">Đang hoạt động</span>' : '<span class="chip chip-off">Tạm ngưng</span>') + '</td>' +
          '<td class="table-actions">' +
            '<button class="icon-btn" data-edit-company="' + c.id + '" type="button" aria-label="Sửa thông tin công ty"><svg class="icon" width="15" height="15"><use href="#i-pencil"></use></svg></button>' +
            '<button class="icon-btn icon-btn-danger" data-delete-company="' + c.id + '" type="button" aria-label="Xoá công ty"><svg class="icon" width="15" height="15"><use href="#i-trash"></use></svg></button>' +
          '</td></tr>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('[data-edit-company]'), function (btn) {
        btn.addEventListener('click', function () { openCompanyModal(rows.find(function (r) { return r.id === btn.getAttribute('data-edit-company'); })); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('[data-delete-company]'), function (btn) {
        btn.addEventListener('click', function () {
          var c = rows.find(function (r) { return r.id === btn.getAttribute('data-delete-company'); });
          if (!c) return;
          if (!window.confirm('Xoá "' + c.name + '" khỏi danh sách công ty thuê? Các lịch đặt phòng của công ty này cũng sẽ bị huỷ.')) return;
          api('/api/admin/companies/' + c.id, { method: 'DELETE' })
            .then(function () { toast('Đã xoá công ty "' + c.name + '"', 'ok'); loadAll(); })
            .catch(function (err) { toast(err.message, 'warn'); });
        });
      });
    }).catch(function (err) { if (err.status === 401) showLogin(); });
  }

  // ---------- modal ----------
  function closeModal() { document.getElementById('modalOverlay').hidden = true; document.getElementById('modalDialog').innerHTML = ''; }
  document.getElementById('modalOverlay').addEventListener('click', function (e) { if (e.target.id === 'modalOverlay') closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function openEditBookingModal(b) {
    if (!b) return;
    var startOpts = '';
    for (var h = OPEN; h < CLOSE; h++) startOpts += '<option value="' + h + '"' + (h === b.start ? ' selected' : '') + '>' + fmtHour(h) + '</option>';
    var durOpts = '';
    for (var d = 1; d <= MAX_DUR; d++) durOpts += '<option value="' + d + '"' + (d === (b.end - b.start) ? ' selected' : '') + '>' + d + ' giờ</option>';

    var dlg = document.getElementById('modalDialog');
    dlg.innerHTML =
      '<div class="modal-head"><h2 id="modalTitle">Sửa giờ họp — ' + esc(b.roomName) + '</h2>' +
      '<button class="icon-btn" id="modalCloseBtn" type="button" aria-label="Đóng"><svg class="icon" width="15" height="15"><use href="#i-x"></use></svg></button></div>' +
      '<p class="hint" style="margin-bottom:14px">Công ty: <strong style="color:var(--ink)">' + esc(b.companyName) + '</strong></p>' +
      '<div id="editBookingError"></div>' +
      '<div class="field"><label for="editDate">Ngày</label><input type="date" id="editDate" value="' + b.date + '"></div>' +
      '<div class="field"><label for="editStart">Giờ bắt đầu</label><select id="editStart">' + startOpts + '</select></div>' +
      '<div class="field"><label for="editDur">Thời lượng</label><select id="editDur">' + durOpts + '</select></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="modalCancelBtn" type="button">Huỷ</button><button class="btn btn-primary" id="modalSaveBtn" type="button">Lưu thay đổi</button></div>';
    document.getElementById('modalOverlay').hidden = false;
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('modalSaveBtn').addEventListener('click', function () {
      api('/api/admin/bookings/' + b.id, {
        method: 'PUT',
        body: {
          date: document.getElementById('editDate').value,
          start: parseInt(document.getElementById('editStart').value, 10),
          duration: parseInt(document.getElementById('editDur').value, 10)
        }
      }).then(function () {
        closeModal();
        toast('Đã cập nhật giờ họp cho ' + b.roomName, 'ok');
        loadAll();
      }).catch(function (err) {
        document.getElementById('editBookingError').innerHTML = '<div class="modal-error">' + esc(err.message) + '</div>';
      });
    });
  }

  function openCompanyModal(existing) {
    var editing = !!existing;
    var c = existing || { name: '', plan: '', freeHours: 18, status: 'active' };
    var dlg = document.getElementById('modalDialog');
    dlg.innerHTML =
      '<div class="modal-head"><h2 id="modalTitle">' + (editing ? 'Sửa thông tin công ty' : 'Thêm công ty') + '</h2>' +
      '<button class="icon-btn" id="modalCloseBtn" type="button" aria-label="Đóng"><svg class="icon" width="15" height="15"><use href="#i-x"></use></svg></button></div>' +
      '<div id="companyModalError"></div>' +
      '<div class="field"><label for="companyName">Tên công ty</label><input type="text" id="companyName" value="' + esc(c.name) + '" maxlength="80"></div>' +
      '<div class="field"><label for="companyPlan">Gói dịch vụ</label><input type="text" id="companyPlan" value="' + esc(c.plan) + '" maxlength="80" placeholder="VD: Văn phòng riêng · 6 chỗ"></div>' +
      '<div class="field"><label for="companyFree">Giờ họp miễn phí / tháng</label><input type="text" inputmode="decimal" id="companyFree" value="' + c.freeHours + '"></div>' +
      '<div class="field"><label for="companyStatus">Trạng thái</label><select id="companyStatus">' +
        '<option value="active"' + (c.status === 'active' ? ' selected' : '') + '>Đang hoạt động</option>' +
        '<option value="paused"' + (c.status === 'paused' ? ' selected' : '') + '>Tạm ngưng</option>' +
      '</select></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="modalCancelBtn" type="button">Huỷ</button><button class="btn btn-primary" id="modalSaveBtn" type="button">Lưu</button></div>';
    document.getElementById('modalOverlay').hidden = false;
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('modalSaveBtn').addEventListener('click', function () {
      var body = {
        name: document.getElementById('companyName').value.trim(),
        plan: document.getElementById('companyPlan').value.trim(),
        freeHours: document.getElementById('companyFree').value.replace(',', '.'),
        status: document.getElementById('companyStatus').value
      };
      var req = editing ? api('/api/admin/companies/' + c.id, { method: 'PUT', body: body }) : api('/api/admin/companies', { method: 'POST', body: body });
      req.then(function () {
        closeModal();
        toast(editing ? ('Đã cập nhật "' + body.name + '"') : ('Đã thêm công ty "' + body.name + '"'), 'ok');
        loadAll();
      }).catch(function (err) {
        document.getElementById('companyModalError').innerHTML = '<div class="modal-error">' + esc(err.message) + '</div>';
      });
    });
  }

  function openRoomModal(existing) {
    var editing = !!existing;
    var r = existing || { name: '', capacity: 4, floor: '' };
    var dlg = document.getElementById('modalDialog');
    dlg.innerHTML =
      '<div class="modal-head"><h2 id="modalTitle">' + (editing ? 'Sửa thông tin phòng' : 'Thêm phòng họp') + '</h2>' +
      '<button class="icon-btn" id="modalCloseBtn" type="button" aria-label="Đóng"><svg class="icon" width="15" height="15"><use href="#i-x"></use></svg></button></div>' +
      '<div id="roomModalError"></div>' +
      '<div class="field"><label for="roomName">Tên phòng</label><input type="text" id="roomName" value="' + esc(r.name) + '" maxlength="60" placeholder="VD: Cedar"></div>' +
      '<div class="field"><label for="roomCapacity">Sức chứa (số chỗ)</label><input type="text" inputmode="numeric" id="roomCapacity" value="' + r.capacity + '"></div>' +
      '<div class="field"><label for="roomFloor">Tầng</label><input type="text" id="roomFloor" value="' + esc(r.floor) + '" maxlength="40" placeholder="VD: Tầng 8"></div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="modalCancelBtn" type="button">Huỷ</button><button class="btn btn-primary" id="modalSaveBtn" type="button">Lưu</button></div>';
    document.getElementById('modalOverlay').hidden = false;
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
    document.getElementById('modalSaveBtn').addEventListener('click', function () {
      var body = {
        name: document.getElementById('roomName').value.trim(),
        capacity: document.getElementById('roomCapacity').value.trim(),
        floor: document.getElementById('roomFloor').value.trim()
      };
      var req = editing ? api('/api/admin/rooms/' + r.id, { method: 'PUT', body: body }) : api('/api/admin/rooms', { method: 'POST', body: body });
      req.then(function () {
        closeModal();
        toast(editing ? ('Đã cập nhật phòng "' + body.name + '"') : ('Đã thêm phòng "' + body.name + '"'), 'ok');
        loadAll();
      }).catch(function (err) {
        document.getElementById('roomModalError').innerHTML = '<div class="modal-error">' + esc(err.message) + '</div>';
      });
    });
  }

  document.getElementById('addRoomBtn').addEventListener('click', function () { openRoomModal(null); });
  document.getElementById('addCompanyBtn').addEventListener('click', function () { openCompanyModal(null); });
})();
