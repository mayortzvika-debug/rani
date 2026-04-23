'use strict';
// ============================================================
// auth.js — Emergency Dashboard Security Module v2.0
// אימות, הרשאות, audit log, ניהול משתמשים
// ============================================================

const AUTH_USERS_KEY    = 'em_auth_users';
const AUTH_SESSION_KEY  = 'em_auth_session';
const AUTH_AUDIT_KEY    = 'em_audit_log';
const INACTIVITY_MS     = 30 * 60 * 1000; // 30 דקות
const MAX_ATTEMPTS      = 5;
const LOCKOUT_MS        = 30 * 1000;       // 30 שניות

// ---- הרשאות לפי לשונית ----
// 'write' = קריאה + כתיבה | 'read' = קריאה בלבד | null = חסום
const TAB_PERMISSIONS = {
  dashboard:      { admin:'read',  commander:'read',  info_officer:'read',  dispatcher:'read',  viewer:'read'  },
  entries:        { admin:'write', commander:'write', info_officer:'read',  dispatcher:'write', viewer:'read'  },
  status:         { admin:'write', commander:'write', info_officer:'write', dispatcher:'read',  viewer:'read'  },
  map:            { admin:'write', commander:'write', info_officer:'write', dispatcher:'write', viewer:'read'  },
  evacuees:       { admin:'write', commander:'write', info_officer:'write', dispatcher:null,    viewer:null    },
  infrastructure: { admin:'write', commander:'write', info_officer:'read',  dispatcher:'read',  viewer:'read'  },
  shelters:       { admin:'write', commander:'write', info_officer:'write', dispatcher:'read',  viewer:'read'  },
  hotels:         { admin:'write', commander:'write', info_officer:'write', dispatcher:null,    viewer:null    },
  sitrep:         { admin:'write', commander:'write', info_officer:'read',  dispatcher:'read',  viewer:'read'  },
  users:          { admin:'write', commander:null,    info_officer:null,    dispatcher:null,    viewer:null    },
};

const ROLE_LABELS = {
  admin:        'מנהל מערכת',
  commander:    'מפקד חפ"ק',
  info_officer: 'קצין מידע',
  dispatcher:   'מוקדן',
  viewer:       'צופה',
};

// ---- State ----
let currentUser    = null;
let inactivityTimer = null;
let loginAttempts  = {};  // { username: { count, lockedUntil } }

// ============================================================
// INIT
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}

async function initAuth() {
  // הסתר הכל עד לאימות
  setMainContentVisible(false);
  createLoginOverlay();

  // חסום את הטופס עד שהמשתמש הדיפולטי נוצר
  const submitBtn = document.getElementById('auth-submit');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'מאתחל...'; }

  await ensureDefaultAdmin();

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'כניסה למערכת'; }

  checkExistingSession();
}

function setMainContentVisible(visible) {
  ['.topbar', '.banner-container', '.dashboard-shell'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.style.display = visible ? '' : 'none';
  });
}

// ============================================================
// LOGIN OVERLAY
// ============================================================
function createLoginOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-box">
      <div class="auth-logo">🚨</div>
      <div class="auth-title">דשבורד חירום עירוני</div>
      <div class="auth-subtitle">עיריית בת ים — מערכת ניהול חירום מאובטחת</div>
      <div id="auth-error" class="auth-error" style="display:none"></div>
      <form id="auth-form" novalidate>
        <div class="auth-field">
          <label for="auth-username">שם משתמש</label>
          <input type="text" id="auth-username" autocomplete="username" placeholder="הזן שם משתמש" />
        </div>
        <div class="auth-field">
          <label for="auth-password">סיסמה</label>
          <input type="password" id="auth-password" autocomplete="current-password" placeholder="הזן סיסמה" />
        </div>
        <button type="submit" id="auth-submit" class="auth-btn">כניסה למערכת</button>
      </form>
      <div class="auth-footer">
        <span>🔒 מידע רגיש — גישה מורשית בלבד</span>
        <button type="button" onclick="resetAuthData()" style="background:none; border:none; color:#334155; font-size:0.72rem; cursor:pointer; padding:0; text-decoration:underline">איפוס חשבונות</button>
      </div>
    </div>
  `;
  document.body.prepend(overlay);
  document.getElementById('auth-form').addEventListener('submit', handleLogin);
}

// ============================================================
// SESSION CHECK
// ============================================================
function checkExistingSession() {
  const sessionStr = sessionStorage.getItem(AUTH_SESSION_KEY);
  if (!sessionStr) return;

  try {
    const session = JSON.parse(sessionStr);
    const users = getUsers();
    const user = users.find(u => u.id === session.userId);

    if (!user || user.locked) {
      sessionStorage.removeItem(AUTH_SESSION_KEY);
      return;
    }

    setCurrentUser(user);
    onLoginSuccess();
  } catch {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  }
}

// ============================================================
// LOGIN
// ============================================================
async function handleLogin(e) {
  e.preventDefault();

  const username  = (document.getElementById('auth-username')?.value || '').trim().toLowerCase();
  const password  = document.getElementById('auth-password')?.value || '';
  const submitBtn = document.getElementById('auth-submit');

  document.getElementById('auth-error').style.display = 'none';

  // בדיקת נעילה
  const att = loginAttempts[username] || { count: 0, lockedUntil: 0 };
  if (att.lockedUntil > Date.now()) {
    const secs = Math.ceil((att.lockedUntil - Date.now()) / 1000);
    showAuthError(`חשבון נעול זמנית. נסה שוב בעוד ${secs} שניות`);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'מתחבר...';

  try {
    const users = getUsers();
    const user  = users.find(u => u.username.toLowerCase() === username);

    if (!user || user.locked) {
      recordFailedAttempt(username);
      showAuthError('שם משתמש או סיסמה שגויים');
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash, user.salt);
    if (!valid) {
      const updated = recordFailedAttempt(username);
      if (updated.lockedUntil > Date.now()) {
        showAuthError('חשבון נעול ל-30 שניות עקב ניסיונות כושלים');
      } else {
        const remaining = MAX_ATTEMPTS - updated.count;
        showAuthError(`סיסמה שגויה. נותרו ${Math.max(0, remaining)} ניסיונות`);
      }
      return;
    }

    // הצלחה
    loginAttempts[username] = { count: 0, lockedUntil: 0 };
    setCurrentUser(user);

    sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      userId: user.id,
      loginAt: Date.now(),
    }));

    user.lastLogin = new Date().toISOString();
    saveUsers(users);
    logAudit('LOGIN', 'system', 'כניסה מוצלחת למערכת');

    if (user.mustChangePassword) {
      showChangePasswordModal();
      return;
    }

    onLoginSuccess();
  } catch (err) {
    console.error('Login error:', err);
    showAuthError('שגיאה בכניסה: ' + (err.message || String(err)));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'כניסה למערכת';
  }
}

function recordFailedAttempt(username) {
  const att = loginAttempts[username] || { count: 0, lockedUntil: 0 };
  att.count++;
  if (att.count >= MAX_ATTEMPTS) {
    att.lockedUntil = Date.now() + LOCKOUT_MS;
    att.count = 0;
  }
  loginAttempts[username] = att;
  return att;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ============================================================
// POST-LOGIN
// ============================================================
function onLoginSuccess() {
  document.getElementById('auth-overlay')?.remove();
  setMainContentVisible(true);
  applyRolePermissions();
  injectUserBar();
  startInactivityTimer();
  // אתחול הדשבורד לאחר כניסה מוצלחת
  setTimeout(() => {
    if (typeof window.__afterLogin === 'function') window.__afterLogin();
  }, 50);
}

function setCurrentUser(user) {
  currentUser = {
    id:          user.id,
    username:    user.username,
    displayName: user.displayName,
    role:        user.role,
  };
}

function applyRolePermissions() {
  const role = currentUser?.role;
  if (!role) return;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tabName = btn.getAttribute('data-tab');
    if (!tabName) return;
    const perm = TAB_PERMISSIONS[tabName]?.[role];
    if (perm === null || perm === undefined) {
      btn.style.display = 'none';
    }
  });

  // הסתר כפתורי כתיבה ממשתמשי צפייה בלבד
  if (role === 'viewer') {
    document.querySelectorAll('.write-only').forEach(el => {
      el.style.display = 'none';
    });
  }
}

function injectUserBar() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  const bar = document.createElement('div');
  bar.className = 'user-bar';
  bar.id = 'user-bar';
  bar.innerHTML = `
    <span class="user-info">
      <span class="user-name">👤 ${authEscape(currentUser.displayName)}</span>
      <span class="user-role-badge">${ROLE_LABELS[currentUser.role] || currentUser.role}</span>
    </span>
    <button class="btn-logout" onclick="logout()">🚪 יציאה</button>
  `;
  topbar.appendChild(bar);
}

// ============================================================
// INACTIVITY & LOGOUT
// ============================================================
function startInactivityTimer() {
  ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(ev =>
    document.addEventListener(ev, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    logAudit('AUTO_LOGOUT', 'system', 'נעילה אוטומטית — חוסר פעילות 30 דקות');
    logout(true);
  }, INACTIVITY_MS);
}

function logout(isAuto = false) {
  if (!isAuto) logAudit('LOGOUT', 'system', 'יציאה ידנית מהמערכת');
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  currentUser = null;
  clearTimeout(inactivityTimer);
  location.reload();
}

// ============================================================
// CRYPTO — PBKDF2 + fallback פשוט לסביבות file://
// ============================================================
function isCryptoAvailable() {
  return typeof crypto !== 'undefined' && crypto.subtle;
}

// fallback hash — עבור סביבת file:// שבה crypto.subtle אינו זמין
function simpleFallbackHash(password, salt) {
  const str = password + ':' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  // הפוך ל-64 תווים כדי לא להתנגש עם PBKDF2
  return 'fallback_' + h.toString(16).padStart(8, '0') + '_' + btoa(str.slice(0, 24)).replace(/[^a-z0-9]/gi, '').slice(0, 48);
}

async function hashPassword(password, salt) {
  if (!isCryptoAvailable()) {
    return simpleFallbackHash(password, salt);
  }
  try {
    const enc         = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // fallback אם PBKDF2 נכשל (למשל Chrome עם file://)
    return simpleFallbackHash(password, salt);
  }
}

async function verifyPassword(password, storedHash, salt) {
  const hash = await hashPassword(password, salt);
  return hash === storedHash;
}

function _randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function _randomSalt() {
  return _randomId() + _randomId();
}

// ============================================================
// USER STORAGE
// ============================================================
function getUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_USERS_KEY) || '[]'); }
  catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

// זיהוי hash ישן (100k iterations — 64 תווים hex ללא prefix)
function isLegacyHash(hash) {
  return hash && !hash.startsWith('fallback_') && hash.length === 64;
}

async function ensureDefaultAdmin() {
  const users = getUsers();

  // אם אין משתמשים — צור admin חדש
  if (!users.length) {
    const salt = _randomSalt();
    const hash = await hashPassword('admin123', salt);
    saveUsers([{
      id:                 _randomId(),
      username:           'admin',
      displayName:        'מנהל מערכת',
      role:               'admin',
      passwordHash:       hash,
      salt,
      mustChangePassword: false,
      locked:             false,
      createdAt:          new Date().toISOString(),
      lastLogin:          null,
    }]);
    return;
  }

  // אם כל המשתמשים הם admin עם hash ישן (100k iterations) — אפס אותם
  const adminUser = users.find(u => u.username === 'admin');
  if (adminUser && isLegacyHash(adminUser.passwordHash)) {
    // hash ישן — מחק והתחל מחדש עם hash חדש
    localStorage.removeItem(AUTH_USERS_KEY);
    const salt = _randomSalt();
    const hash = await hashPassword('admin123', salt);
    saveUsers([{
      id:                 adminUser.id || _randomId(),
      username:           'admin',
      displayName:        adminUser.displayName || 'מנהל מערכת',
      role:               'admin',
      passwordHash:       hash,
      salt,
      mustChangePassword: false,
      locked:             false,
      createdAt:          adminUser.createdAt || new Date().toISOString(),
      lastLogin:          adminUser.lastLogin || null,
    }]);
  }
}

// ============================================================
// CHANGE PASSWORD MODAL
// ============================================================
function showChangePasswordModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'change-pass-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:440px">
      <h3>🔐 שינוי סיסמה נדרש</h3>
      <p style="color:#94a3b8; margin-bottom:20px">יש לשנות את הסיסמה הדיפולטית לפני הכניסה למערכת</p>
      <div id="cp-error" style="display:none; color:#f87171; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:10px; margin-bottom:12px"></div>
      <input type="password" id="cp-new"     placeholder="סיסמה חדשה (לפחות 8 תווים)" style="margin-bottom:10px" />
      <input type="password" id="cp-confirm" placeholder="אימות סיסמה חדשה" />
      <div class="modal-buttons" style="margin-top:20px">
        <button onclick="handleChangePassword()">שמור סיסמה חדשה</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function handleChangePassword() {
  const newPass  = document.getElementById('cp-new')?.value || '';
  const confirm  = document.getElementById('cp-confirm')?.value || '';
  const errorEl  = document.getElementById('cp-error');

  if (newPass.length < 8) {
    errorEl.textContent = 'הסיסמה חייבת להכיל לפחות 8 תווים';
    errorEl.style.display = 'block';
    return;
  }
  if (newPass !== confirm) {
    errorEl.textContent = 'הסיסמאות אינן תואמות';
    errorEl.style.display = 'block';
    return;
  }

  const users = getUsers();
  const user  = users.find(u => u.id === currentUser.id);
  if (!user) return;

  const salt           = crypto.randomUUID();
  user.passwordHash    = await hashPassword(newPass, salt);
  user.salt            = salt;
  user.mustChangePassword = false;
  saveUsers(users);

  logAudit('CHANGE_PASSWORD', currentUser.username, 'שינוי סיסמה ראשוני');
  document.getElementById('change-pass-overlay')?.remove();
  onLoginSuccess();
}

// ============================================================
// USER MANAGEMENT MODAL (admin only)
// ============================================================
function openUserManager() {
  if (!hasPermission('users', 'write')) {
    alert('אין הרשאה לניהול משתמשים');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'user-manager-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:820px; width:96%">
      <h3>👥 ניהול משתמשים</h3>
      <div id="users-list-container">${buildUsersListHTML()}</div>
      <hr style="border-color:rgba(148,163,184,0.2); margin:20px 0" />
      <h4 style="color:#38bdf8; margin:0 0 14px">הוסף משתמש חדש</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px">
        <input id="new-username"    placeholder="שם משתמש" />
        <input id="new-displayname" placeholder="שם מלא לתצוגה" />
        <input type="password" id="new-password" placeholder="סיסמה (לפחות 6 תווים)" />
        <select id="new-role">
          ${Object.entries(ROLE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div id="add-user-error" style="display:none; color:#f87171; font-size:0.9rem; margin-bottom:10px"></div>
      <div class="modal-buttons">
        <button onclick="addNewUser()">➕ הוסף משתמש</button>
        <button class="btn-cancel" onclick="document.getElementById('user-manager-overlay')?.remove()">סגור</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function buildUsersListHTML() {
  const users = getUsers();
  if (!users.length) return '<p style="color:#94a3b8">אין משתמשים</p>';

  return `
    <div style="overflow-x:auto">
    <table style="width:100%; font-size:0.88rem; border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:right; color:#94a3b8; padding:8px 10px">שם מלא</th>
          <th style="text-align:right; color:#94a3b8; padding:8px 10px">משתמש</th>
          <th style="text-align:right; color:#94a3b8; padding:8px 10px">תפקיד</th>
          <th style="text-align:right; color:#94a3b8; padding:8px 10px">כניסה אחרונה</th>
          <th style="text-align:right; color:#94a3b8; padding:8px 10px">פעולות</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr style="border-top:1px solid rgba(148,163,184,0.1)">
            <td style="padding:8px 10px">
              <strong>${authEscape(u.displayName)}</strong>
              ${u.locked ? '<span class="status-pill status-emergency" style="font-size:0.72rem; margin-right:6px">נעול</span>' : ''}
              ${u.mustChangePassword ? '<span class="status-pill status-active" style="font-size:0.72rem">נדרש שינוי סיסמה</span>' : ''}
            </td>
            <td style="padding:8px 10px; color:#94a3b8">@${authEscape(u.username)}</td>
            <td style="padding:8px 10px"><span class="status-pill status-default">${ROLE_LABELS[u.role] || u.role}</span></td>
            <td style="padding:8px 10px; color:#94a3b8; font-size:0.83rem">${u.lastLogin ? new Date(u.lastLogin).toLocaleString('he-IL') : 'מעולם'}</td>
            <td style="padding:8px 10px">
              <div style="display:flex; gap:5px; flex-wrap:wrap">
                <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem" onclick="resetUserPassword('${u.id}')">איפוס סיסמה</button>
                ${u.id !== currentUser?.id ? `
                  <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem; background:rgba(239,68,68,0.2)" onclick="toggleLockUser('${u.id}')">${u.locked ? 'פתח נעילה' : 'נעל'}</button>
                  <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem; background:rgba(239,68,68,0.15); color:#fca5a5" onclick="deleteUser('${u.id}')">מחק</button>
                ` : '<span style="color:#64748b; font-size:0.8rem">(משתמש נוכחי)</span>'}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

async function addNewUser() {
  const username    = (document.getElementById('new-username')?.value || '').trim();
  const displayName = (document.getElementById('new-displayname')?.value || '').trim();
  const password    = document.getElementById('new-password')?.value || '';
  const role        = document.getElementById('new-role')?.value || '';
  const errEl       = document.getElementById('add-user-error');

  errEl.style.display = 'none';

  if (!username || !displayName || !password) {
    errEl.textContent = 'יש למלא את כל השדות';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'סיסמה חייבת להכיל לפחות 6 תווים';
    errEl.style.display = 'block';
    return;
  }

  const users = getUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    errEl.textContent = 'שם משתמש כבר קיים במערכת';
    errEl.style.display = 'block';
    return;
  }

  const salt = _randomSalt();
  const hash = await hashPassword(password, salt);

  users.push({
    id:                 _randomId(),
    username,
    displayName,
    role,
    passwordHash:       hash,
    salt,
    mustChangePassword: false,
    locked:             false,
    createdAt:          new Date().toISOString(),
    lastLogin:          null,
  });

  saveUsers(users);
  logAudit('ADD_USER', username, `הוסף משתמש חדש — תפקיד: ${ROLE_LABELS[role] || role}`);

  document.getElementById('users-list-container').innerHTML = buildUsersListHTML();
  document.getElementById('new-username').value    = '';
  document.getElementById('new-displayname').value = '';
  document.getElementById('new-password').value    = '';
}

async function resetUserPassword(userId) {
  const newPass = prompt('הזן סיסמה חדשה (לפחות 8 תווים):');
  if (!newPass) return;
  if (newPass.length < 8) { alert('הסיסמה חייבת להכיל לפחות 8 תווים'); return; }

  const users = getUsers();
  const user  = users.find(u => u.id === userId);
  if (!user) return;

  const salt           = crypto.randomUUID();
  user.passwordHash    = await hashPassword(newPass, salt);
  user.salt            = salt;
  user.mustChangePassword = true;
  saveUsers(users);

  logAudit('RESET_PASSWORD', user.username, 'איפוס סיסמה ע"י מנהל מערכת');
  alert(`סיסמת ${user.displayName} אופסה. המשתמש יתבקש לשנות בכניסה הבאה.`);
  document.getElementById('users-list-container').innerHTML = buildUsersListHTML();
}

function toggleLockUser(userId) {
  const users = getUsers();
  const user  = users.find(u => u.id === userId);
  if (!user || user.id === currentUser?.id) return;

  user.locked = !user.locked;
  saveUsers(users);
  logAudit(user.locked ? 'LOCK_USER' : 'UNLOCK_USER', user.username, '');
  document.getElementById('users-list-container').innerHTML = buildUsersListHTML();
}

function deleteUser(userId) {
  const users   = getUsers();
  const deleted = users.find(u => u.id === userId);
  if (!deleted || deleted.id === currentUser?.id) return;
  if (!confirm(`האם למחוק את המשתמש "${deleted.displayName}"? פעולה זו אינה הפיכה.`)) return;

  saveUsers(users.filter(u => u.id !== userId));
  logAudit('DELETE_USER', deleted.username, 'מחיקת משתמש');
  document.getElementById('users-list-container').innerHTML = buildUsersListHTML();
}

// ============================================================
// AUDIT LOG
// ============================================================
function logAudit(action, target, details) {
  try {
    const log = JSON.parse(localStorage.getItem(AUTH_AUDIT_KEY) || '[]');
    log.unshift({
      timestamp: new Date().toISOString(),
      username:  currentUser?.username || 'system',
      role:      currentUser?.role     || '-',
      action,
      target:    String(target  || ''),
      details:   String(details || ''),
    });
    if (log.length > 1000) log.length = 1000;
    localStorage.setItem(AUTH_AUDIT_KEY, JSON.stringify(log));
  } catch {}
}

function loadUsersTab() {
  const container = document.getElementById('audit-log-container');
  if (!container) return;

  try {
    const log = JSON.parse(localStorage.getItem(AUTH_AUDIT_KEY) || '[]');

    if (!log.length) {
      container.innerHTML = '<p style="color:#94a3b8; padding:12px">אין רשומות ביקורת עדיין</p>';
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto">
      <table style="width:100%; font-size:0.88rem; border-collapse:collapse">
        <thead>
          <tr>
            <th style="color:#94a3b8; padding:8px; text-align:right">זמן</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">משתמש</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">תפקיד</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">פעולה</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">פרטים</th>
          </tr>
        </thead>
        <tbody>
          ${log.slice(0, 150).map(entry => `
            <tr style="border-top:1px solid rgba(148,163,184,0.1)">
              <td style="padding:8px; color:#94a3b8; white-space:nowrap">${new Date(entry.timestamp).toLocaleString('he-IL')}</td>
              <td style="padding:8px; font-weight:500">${authEscape(entry.username)}</td>
              <td style="padding:8px; color:#94a3b8">${ROLE_LABELS[entry.role] || entry.role}</td>
              <td style="padding:8px"><code style="background:rgba(56,189,248,0.1); padding:2px 7px; border-radius:5px; color:#7dd3fc; font-size:0.83rem">${authEscape(entry.action)}</code></td>
              <td style="padding:8px; color:#cbd5e1">${authEscape(entry.details || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
      ${log.length > 150 ? `<p style="color:#64748b; font-size:0.85rem; padding:8px">מוצגות 150 רשומות מתוך ${log.length}</p>` : ''}
    `;
  } catch {
    container.innerHTML = '<p style="color:#f87171">שגיאה בטעינת הלוג</p>';
  }
}

function exportAuditLog() {
  if (!hasPermission('users', 'write')) return;

  try {
    const log = JSON.parse(localStorage.getItem(AUTH_AUDIT_KEY) || '[]');
    const csv = [
      ['זמן', 'משתמש', 'תפקיד', 'פעולה', 'מטרה', 'פרטים'].join(','),
      ...log.map(e => [
        `"${e.timestamp}"`,
        `"${e.username}"`,
        `"${ROLE_LABELS[e.role] || e.role}"`,
        `"${e.action}"`,
        `"${e.target || ''}"`,
        `"${(e.details || '').replace(/"/g, '""')}"`,
      ].join(',')),
    ].join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    logAudit('EXPORT_AUDIT', 'system', 'ייצוא לוג ביקורת ל-CSV');
  } catch {}
}

// ============================================================
// PUBLIC API (נגיש ל-emergency_dashboard.js)
// ============================================================
function hasPermission(tab, mode = 'read') {
  if (!currentUser) return false;
  const perm = TAB_PERMISSIONS[tab]?.[currentUser.role];
  if (!perm) return false;
  if (mode === 'read')  return true;
  if (mode === 'write') return perm === 'write';
  return false;
}

function getCurrentUser() {
  return currentUser ? { ...currentUser } : null;
}

// ============================================================
// UTILS
// ============================================================
function resetAuthData() {
  if (!confirm('מחיקת כל החשבונות ואיפוס למנהל ברירת מחדל (admin/admin123)?\nפעולה זו תאפס גם את ה-session הנוכחי.')) return;
  localStorage.removeItem(AUTH_USERS_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  location.reload();
}

function authEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
