'use strict';
// ============================================================
// auth_server.js — אימות מול השרת (em-auth.mjs)
// כשהאתר מוגש משרת עם /api/auth — הכניסה, המשתמשים וההרשאות נאכפים בשרת.
// בפתיחה כקובץ מקומי (file://) נשארים במצב המקומי הישן של auth.js.
// נטען אחרי auth.js ולפני שאר הסקריפטים.
// ============================================================
(function () {
  const legacy = {};
  ['initAuth', 'handleLogin', 'logout', 'showChangePasswordModal', 'handleChangePassword', 'openUserManager',
    'buildUsersListHTML', 'addNewUser', 'resetUserPassword', 'toggleLockUser', 'deleteUser', 'logAudit',
    'loadUsersTab', 'exportAuditLog'].forEach(n => { legacy[n] = window[n]; });

  const serverMode = () => window.EM_SERVER_AUTH === true;
  let srvUsers = [];

  async function emFetch(path, opts = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...opts,
      headers: { 'x-requested-with': 'em', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && !path.endsWith('/login')) { location.reload(); throw new Error('פג תוקף ההתחברות'); }
    return res;
  }
  window.emFetch = emFetch;

  async function errText(res) { return (await res.text()) || `שגיאה ${res.status}`; }

  // ---- init ----
  window.initAuth = async function () {
    if (location.protocol === 'file:') return legacy.initAuth();
    setMainContentVisible(false);
    let res;
    try { res = await fetch('/api/auth/me', { credentials: 'same-origin' }); } catch { return legacy.initAuth(); }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    if (res.status === 404 || (res.ok && !isJson)) return legacy.initAuth(); // אין שרת אימות — מצב מקומי

    window.EM_SERVER_AUTH = true;
    if (res.ok) { startSession((await res.json()).user); return; }
    createLoginOverlay();
  };

  function startSession(user) {
    setCurrentUser(user);
    document.getElementById('auth-overlay')?.remove();
    if (user.mustChangePassword) { window.showChangePasswordModal(); return; }
    onLoginSuccess();
  }

  window.handleLogin = async function (e) {
    if (!serverMode()) return legacy.handleLogin(e);
    e.preventDefault();
    const username = (document.getElementById('auth-username')?.value || '').trim();
    const password = document.getElementById('auth-password')?.value || '';
    const btn = document.getElementById('auth-submit');
    document.getElementById('auth-error').style.display = 'none';
    btn.disabled = true; btn.textContent = 'מתחבר...';
    try {
      const res = await emFetch('/api/auth/login', { method: 'POST', body: { username, password } });
      if (!res.ok) { showAuthError(await errText(res)); return; }
      startSession((await res.json()).user);
    } catch (err) {
      showAuthError('שגיאת תקשורת: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'כניסה למערכת';
    }
  };

  window.logout = async function (isAuto) {
    if (!serverMode()) return legacy.logout(isAuto);
    try { await emFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ממשיכים לניקוי */ }
    currentUser = null;
    clearTimeout(inactivityTimer);
    location.reload();
  };

  // ---- change password ----
  window.showChangePasswordModal = function () {
    if (!serverMode()) return legacy.showChangePasswordModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'change-pass-overlay';
    overlay.style.zIndex = 100000;
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px">
        <h3>🔐 שינוי סיסמה נדרש</h3>
        <p style="color:#64748b; margin-bottom:16px">יש להחליף את הסיסמה הזמנית לפני הכניסה למערכת (לפחות 8 תווים)</p>
        <div id="cp-error" style="display:none; color:#dc2626; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px; margin-bottom:12px"></div>
        <input type="password" id="cp-current" placeholder="הסיסמה הנוכחית (הזמנית)" autocomplete="current-password" style="margin-bottom:10px" />
        <input type="password" id="cp-new" placeholder="סיסמה חדשה" autocomplete="new-password" style="margin-bottom:10px" />
        <input type="password" id="cp-confirm" placeholder="אימות סיסמה חדשה" autocomplete="new-password" />
        <div class="modal-buttons" style="margin-top:20px">
          <button onclick="handleChangePassword()">שמור סיסמה חדשה</button>
          <button class="btn-cancel" onclick="logout()">יציאה</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  };

  window.handleChangePassword = async function () {
    if (!serverMode()) return legacy.handleChangePassword();
    const cur = document.getElementById('cp-current')?.value || '';
    const next = document.getElementById('cp-new')?.value || '';
    const conf = document.getElementById('cp-confirm')?.value || '';
    const err = document.getElementById('cp-error');
    const fail = (m) => { err.textContent = m; err.style.display = 'block'; };
    if (next.length < 8) return fail('הסיסמה חייבת להכיל לפחות 8 תווים');
    if (next !== conf) return fail('הסיסמאות אינן תואמות');
    try {
      const res = await emFetch('/api/auth/change-password', { method: 'POST', body: { current: cur, next } });
      if (!res.ok) return fail(await errText(res));
      document.getElementById('change-pass-overlay')?.remove();
      setCurrentUser((await res.json()).user);
      onLoginSuccess();
    } catch (e) { fail(e.message); }
  };

  // ---- user management (admin) ----
  async function refreshUsers() {
    const res = await emFetch('/api/auth/users');
    if (!res.ok) throw new Error(await errText(res));
    srvUsers = (await res.json()).users;
    const box = document.getElementById('users-list-container');
    if (box) box.innerHTML = window.buildUsersListHTML();
  }

  window.buildUsersListHTML = function () {
    if (!serverMode()) return legacy.buildUsersListHTML();
    if (!srvUsers.length) return '<p style="color:#64748b">טוען...</p>';
    return `<div style="overflow-x:auto"><table style="width:100%; font-size:0.88rem; border-collapse:collapse">
      <thead><tr>${['שם מלא', 'משתמש', 'תפקיד', 'כניסה אחרונה', 'פעולות'].map(h => `<th style="text-align:right; color:#64748b; padding:8px 10px">${h}</th>`).join('')}</tr></thead>
      <tbody>${srvUsers.map(u => {
        const me = u.id === currentUser?.id;
        return `<tr style="border-top:1px solid #e2e8f0">
          <td style="padding:8px 10px"><strong>${authEscape(u.displayName)}</strong>
            ${u.locked ? '<span class="status-pill status-emergency" style="font-size:0.72rem">נעול</span>' : ''}
            ${u.mustChangePassword ? '<span class="status-pill status-active" style="font-size:0.72rem">סיסמה זמנית</span>' : ''}</td>
          <td style="padding:8px 10px; color:#64748b">@${authEscape(u.username)}</td>
          <td style="padding:8px 10px">${me ? authEscape(ROLE_LABELS[u.role] || u.role)
            : `<select onchange="srvSetRole('${authEscape(u.id)}', this.value)">${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}" ${v === u.role ? 'selected' : ''}>${l}</option>`).join('')}</select>`}</td>
          <td style="padding:8px 10px; color:#64748b; font-size:0.83rem">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('he-IL') : 'מעולם'}</td>
          <td style="padding:8px 10px"><div style="display:flex; gap:5px; flex-wrap:wrap">
            <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem" onclick="resetUserPassword('${authEscape(u.id)}')">איפוס סיסמה</button>
            ${me ? '<span style="color:#94a3b8; font-size:0.8rem">(משתמש נוכחי)</span>' : `
              <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem" onclick="toggleLockUser('${authEscape(u.id)}')">${u.locked ? 'פתח נעילה' : 'נעל'}</button>
              <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem; color:#dc2626" onclick="deleteUser('${authEscape(u.id)}')">מחק</button>`}
          </div></td></tr>`;
      }).join('')}</tbody></table></div>`;
  };

  window.openUserManager = async function () {
    if (!serverMode()) return legacy.openUserManager();
    if (!hasPermission('users', 'write')) { alert('אין הרשאה לניהול משתמשים'); return; }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'user-manager-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:860px; width:96%">
        <h3>👥 ניהול משתמשים</h3>
        <div id="users-list-container"><p>טוען...</p></div>
        <hr style="margin:20px 0" />
        <h4 style="margin:0 0 14px">הוסף משתמש חדש</h4>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px">
          <input id="new-username" placeholder="שם משתמש (אנגלית/מספרים)" autocomplete="off" />
          <input id="new-displayname" placeholder="שם מלא לתצוגה" />
          <input type="text" id="new-password" placeholder="סיסמה זמנית (לפחות 8 תווים)" autocomplete="off" />
          <select id="new-role">${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}" ${v === 'viewer' ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div id="add-user-error" style="display:none; color:#dc2626; font-size:0.9rem; margin-bottom:10px"></div>
        <div class="modal-buttons">
          <button onclick="addNewUser()">➕ הוסף משתמש</button>
          <button class="btn-cancel" onclick="document.getElementById('user-manager-overlay')?.remove()">סגור</button>
        </div>
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    try { await refreshUsers(); } catch (e) { document.getElementById('users-list-container').textContent = e.message; }
  };

  async function userAction(fn) {
    try { await fn(); await refreshUsers(); } catch (e) { alert(e.message); }
  }
  const mustOk = async (res) => { if (!res.ok) throw new Error(await errText(res)); return res; };

  window.addNewUser = async function () {
    if (!serverMode()) return legacy.addNewUser();
    const errEl = document.getElementById('add-user-error');
    errEl.style.display = 'none';
    const body = {
      username: document.getElementById('new-username').value.trim(),
      displayName: document.getElementById('new-displayname').value.trim(),
      password: document.getElementById('new-password').value,
      role: document.getElementById('new-role').value,
    };
    try {
      await mustOk(await emFetch('/api/auth/users', { method: 'POST', body }));
      ['new-username', 'new-displayname', 'new-password'].forEach(id => { document.getElementById(id).value = ''; });
      await refreshUsers();
    } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
  };

  window.resetUserPassword = function (id) {
    if (!serverMode()) return legacy.resetUserPassword(id);
    const pw = prompt('הזן סיסמה זמנית חדשה (לפחות 8 תווים). המשתמש יידרש להחליף אותה בכניסה:');
    if (!pw) return;
    userAction(async () => { await mustOk(await emFetch('/api/auth/users/' + id, { method: 'PATCH', body: { password: pw } })); alert('הסיסמה אופסה'); });
  };

  window.toggleLockUser = function (id) {
    if (!serverMode()) return legacy.toggleLockUser(id);
    const u = srvUsers.find(x => x.id === id);
    if (u) userAction(async () => mustOk(await emFetch('/api/auth/users/' + id, { method: 'PATCH', body: { locked: !u.locked } })));
  };

  window.srvSetRole = function (id, role) {
    userAction(async () => mustOk(await emFetch('/api/auth/users/' + id, { method: 'PATCH', body: { role } })));
  };

  window.deleteUser = function (id) {
    if (!serverMode()) return legacy.deleteUser(id);
    const u = srvUsers.find(x => x.id === id);
    if (!u || !confirm(`האם למחוק את המשתמש "${u.displayName}"? פעולה זו אינה הפיכה.`)) return;
    userAction(async () => mustOk(await emFetch('/api/auth/users/' + id, { method: 'DELETE' })));
  };

  // ---- audit ----
  window.logAudit = function (action, target, details) {
    if (!serverMode()) return legacy.logAudit(action, target, details);
    emFetch('/api/em/audit', { method: 'POST', body: { action, target, details } }).catch(() => {});
  };

  async function fetchAudit() {
    const res = await emFetch('/api/auth/audit');
    if (!res.ok) throw new Error(await errText(res));
    return (await res.json()).log;
  }

  window.loadUsersTab = async function () {
    if (!serverMode()) return legacy.loadUsersTab();
    const box = document.getElementById('audit-log-container');
    if (!box) return;
    try {
      const log = await fetchAudit();
      box.innerHTML = !log.length ? '<p style="color:#64748b; padding:12px">אין רשומות ביקורת עדיין</p>' : `
        <div style="overflow-x:auto"><table style="width:100%; font-size:0.88rem; border-collapse:collapse">
          <thead><tr>${['זמן', 'משתמש', 'תפקיד', 'פעולה', 'יעד', 'פרטים'].map(h => `<th style="text-align:right; color:#64748b; padding:8px">${h}</th>`).join('')}</tr></thead>
          <tbody>${log.slice(0, 200).map(e => `<tr style="border-top:1px solid #e2e8f0">
            <td style="padding:8px; white-space:nowrap">${new Date(e.timestamp).toLocaleString('he-IL')}</td>
            <td style="padding:8px">${authEscape(e.username)}</td>
            <td style="padding:8px">${authEscape(ROLE_LABELS[e.role] || e.role)}</td>
            <td style="padding:8px"><code>${authEscape(e.action)}</code></td>
            <td style="padding:8px">${authEscape(e.target)}</td>
            <td style="padding:8px">${authEscape(e.details || '-')}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { box.innerHTML = `<p style="color:#dc2626">${authEscape(e.message)}</p>`; }
  };

  window.exportAuditLog = async function () {
    if (!serverMode()) return legacy.exportAuditLog();
    if (!hasPermission('users', 'write')) return;
    try {
      const log = await fetchAudit();
      const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
      const csv = [['זמן', 'משתמש', 'תפקיד', 'פעולה', 'יעד', 'פרטים'].map(cell).join(','),
        ...log.map(e => [e.timestamp, e.username, ROLE_LABELS[e.role] || e.role, e.action, e.target, e.details].map(cell).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url; a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert(e.message); }
  };
})();
