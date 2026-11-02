'use strict';
// ============================================================
// shelters_ops.js — מודול מקלטים מורחב
// דיירים, אינטרנט אלחוטי, מצב פעילות בזמן אמת, מפה עירונית חיה,
// דוח פעילות וחלוקת ערכות, סנכרון בין מכשירים.
// נטען אחרי modules.js ו-emergency_dashboard.js ודורס את פונקציות המקלטים.
// ============================================================

const ACTIVITIES_KEY = 'em_shelter_activities';

const SH_LEVELS = {
  quiet:    { label: 'שקט',            icon: '🟢', color: '#16a34a', rank: 0 },
  active:   { label: 'פעילות במקלט',   icon: '🔵', color: '#1d4ed8', rank: 1 },
  incident: { label: 'אירוע / דורש טיפול', icon: '🟠', color: '#d97706', rank: 2 },
  critical: { label: 'חירום — מצוקה',  icon: '🔴', color: '#dc2626', rank: 3 },
};
const ACTIVITY_TYPES = ['חלוקת ערכות', 'פעילות הפגה', 'פעילות ילדים', 'בדיקת ציוד', 'הדרכה', 'סיור / ביקורת', 'אספקה (מזון/מים)', 'אחר'];
const KIT_SUGGESTIONS = ['ערכת הפגה', 'ערכת חירום משפחתית', 'ערכת היגיינה', 'בקבוקי מים', 'מזון יבש', 'שמיכות', 'משחקים / ציוד יצירה', 'פנסים'];

// ------------------------------------------------------------
// STORES — רשומות עם updatedAt ו-tombstone למחיקה (נדרש לסנכרון)
// ------------------------------------------------------------
function makeStore(key) {
  const raw = () => safeGet(key);
  return {
    raw,
    get: () => raw().filter(r => !r.deleted),
    save(arr) {
      const old = new Map(raw().map(r => [r.id, r]));
      const now = new Date().toISOString();
      const seen = new Set();
      const out = [];
      arr.forEach(r => {
        seen.add(r.id);
        const o = old.get(r.id);
        const { updatedAt: _a, ...a } = r;
        const { updatedAt: _b, ...b } = o || {};
        out.push(o && JSON.stringify(a) === JSON.stringify(b) ? o : { ...r, updatedAt: now });
      });
      old.forEach((o, id) => { if (!seen.has(id)) out.push(o.deleted ? o : { ...o, deleted: true, updatedAt: now }); });
      safeSet(key, out);
      shSyncSoon();
    },
  };
}
const shelterStore  = makeStore(SHELTERS_KEY);
const activityStore = makeStore(ACTIVITIES_KEY);

// דריסת הפונקציות מ-modules.js כך שכל שאר הקוד (דשבורד, ייבוא) ימשיך לעבוד
getShelters   = () => shelterStore.get();
saveShelters  = (arr) => shelterStore.save(arr);
const getActivities  = () => activityStore.get();
const saveActivities = (arr) => activityStore.save(arr);

const shCanWrite = () => typeof hasPermission === 'function' && hasPermission('shelters', 'write');
const shUser = () => (typeof getCurrentUser === 'function' && getCurrentUser()?.displayName) || 'מערכת';
const shFmtTime = (iso) => iso ? new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const shNum = (v) => Number(v) || 0;

function shAgo(iso) {
  if (!iso) return 'לא עודכן';
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'ממש עכשיו';
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.round(m / 60);
  return h < 24 ? `לפני ${h} שע'` : `לפני ${Math.round(h / 24)} ימים`;
}

function shLevel(s) { return SH_LEVELS[s.activity?.level] || SH_LEVELS.quiet; }

// סכום דיירים רשומים; אם אין רשימת דיירים — נשאר הערך הידני
function shOccupancy(s) {
  const occ = s.occupants || [];
  return occ.length ? occ.reduce((n, o) => n + (shNum(o.count) || 1), 0) : shNum(s.current);
}

// ------------------------------------------------------------
// VIEWS
// ------------------------------------------------------------
let shView = 'list';
let shBound = false;

function initSheltersTab() {
  if (!shBound) {
    shBound = true;
    document.querySelectorAll('#shelter-category-tabs .sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#shelter-category-tabs .sub-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeShelterCategory = btn.getAttribute('data-category') || 'all';
        renderSheltersGrid();
      });
    });
    document.getElementById('shelters-tab')?.addEventListener('click', shHandleClick);
    window.addEventListener('storage', (e) => {
      if ([SHELTERS_KEY, ACTIVITIES_KEY].includes(e.key)) shRenderCurrent();
    });
    setInterval(() => { if (shTabVisible()) shRenderCurrent(true); }, 30000);
  }
  shUpdateSyncBadge();
  shSetView(shView);
}

const shTabVisible = () => document.getElementById('shelters-tab')?.classList.contains('active');

function shSetView(view) {
  shView = view;
  document.querySelectorAll('#shelter-view-tabs .sv-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('shelter-list-controls').style.display = view === 'list' ? '' : 'none';
  document.getElementById('shelters-grid').style.display = view === 'list' ? '' : 'none';
  document.getElementById('shelters-live-view').style.display = view === 'live' ? '' : 'none';
  document.getElementById('shelters-report-view').style.display = view === 'report' ? '' : 'none';
  document.querySelectorAll('#shelters-tab .sh-write').forEach(el => { el.style.display = shCanWrite() ? '' : 'none'; });
  shRenderCurrent();
}

function shRenderCurrent() {
  if (!document.getElementById('shelters-grid')) return;
  if (shView === 'list') renderSheltersGrid();
  else if (shView === 'live') shRenderLive();
  else shRenderReport();
}

// ------------------------------------------------------------
// LIST VIEW
// ------------------------------------------------------------
function renderSheltersGrid() {
  const grid = document.getElementById('shelters-grid');
  if (!grid) return;
  let shelters = getShelters();
  if (activeShelterCategory !== 'all') shelters = shelters.filter(s => s.category === activeShelterCategory);

  if (!shelters.length) {
    grid.innerHTML = `<div class="map-empty-state" style="margin:20px">אין מקלטים מוגדרים. לחץ "+ הוסף מקלט" או ייבא קובץ.</div>`;
    return;
  }
  // אירועים וחירום קודם
  shelters.sort((a, b) => shLevel(b).rank - shLevel(a).rank || String(a.name).localeCompare(String(b.name), 'he'));
  grid.innerHTML = shelters.map(shelterCardHTML).join('');
}

function shWifiHTML(s) {
  const w = s.wifi || {};
  if (w.has === true) {
    const pass = w.password
      ? (shCanWrite() ? `<code class="sh-pass">${mEscape(w.password)}</code>` : '<span class="sh-muted">(סיסמה מוגנת — למורשי עריכה)</span>')
      : '<span class="sh-muted">ללא סיסמה</span>';
    return `📶 <strong>יש אינטרנט</strong>${w.ssid ? ` · רשת: <code>${mEscape(w.ssid)}</code>` : ''} · סיסמה: ${pass}`;
  }
  if (w.has === false) return '📵 <strong style="color:var(--danger)">אין אינטרנט אלחוטי</strong>';
  return '📶 <span class="sh-muted">אינטרנט אלחוטי: לא ידוע</span>';
}

function shelterCardHTML(s) {
  const lvl = shLevel(s);
  const cur = shOccupancy(s);
  const pct = s.capacity ? Math.min(100, Math.round(cur / s.capacity * 100)) : 0;
  const pctColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f97316' : '#22c55e';
  const needs = Object.entries(s.needs || {}).filter(([, v]) => v).map(([k]) => SHELTER_NEED_LABELS[k] || k);
  const w = shCanWrite();
  const catIcon = SHELTER_CATEGORY_ICONS[s.category] || '🏠';
  const isOpen = s.isOpen !== false;
  const lastAct = getActivities().filter(a => a.shelterId === s.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];

  return `
    <div class="shelter-card lvl-${s.activity?.level || 'quiet'}" data-sid="${mEscape(s.id)}" style="border-right:5px solid ${lvl.color}">
      <div class="shelter-header">
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
          <span style="font-size:1.1rem">${catIcon}</span>
          <strong>${mEscape(s.name)}</strong>
          <span class="sh-chip" style="background:${lvl.color}1f; color:${lvl.color}">${lvl.icon} ${lvl.label}</span>
          <span class="sh-chip ${isOpen ? 'sh-open' : 'sh-closed'}">${isOpen ? 'פתוח' : 'סגור'}</span>
        </div>
      </div>
      <div class="sh-muted" style="margin-bottom:6px">${mEscape(s.address)}${s.lat ? '' : ' · <span style="color:var(--warn)">לא ממוקם על המפה</span>'}</div>
      ${s.activity?.note ? `<div class="sh-note" style="border-color:${lvl.color}">${mEscape(s.activity.note)} <span class="sh-muted">(${mEscape(s.activity.by || '')} · ${shAgo(s.activity.at)})</span></div>` : ''}
      <div class="shelter-capacity-row">
        <span>👥 דיירים: <strong style="color:${pctColor}">${cur}</strong> / ${s.capacity || '?'}${(s.occupants || []).length ? ` <span class="sh-muted">(${s.occupants.length} רשומים)</span>` : ''}</span>
        <span style="color:${pctColor}; font-weight:600">${pct}%</span>
      </div>
      <div class="capacity-bar"><div class="capacity-fill" style="width:${pct}%; background:${pctColor}"></div></div>
      <div class="sh-line">${shWifiHTML(s)}</div>
      ${needs.length ? `<div class="shelter-needs">🆘 נדרש: ${needs.map(n => `<span class="need-chip">${mEscape(n)}</span>`).join('')}</div>` : ''}
      <div class="sh-line sh-muted">
        ${s.elderly ? `👴 קשישים: ${s.elderly} ` : ''}${s.disabled ? `♿ נכים: ${s.disabled} ` : ''}${s.infants ? `👶 תינוקות: ${s.infants} ` : ''}${s.animals ? `🐾 בע"ח: ${s.animals}` : ''}
      </div>
      ${lastAct ? `<div class="sh-line sh-muted">📋 פעילות אחרונה: ${mEscape(lastAct.type)}${lastAct.title ? ' — ' + mEscape(lastAct.title) : ''} (${shAgo(lastAct.at)})</div>` : ''}
      ${s.notes ? `<div class="sh-notes">${mEscape(s.notes)}</div>` : ''}
      <div class="sh-actions">
        <button class="btn-secondary" data-act="occupants" data-id="${mEscape(s.id)}">👥 דיירים</button>
        ${w ? `<button class="btn-secondary" data-act="status" data-id="${mEscape(s.id)}">🚦 עדכון מצב</button>
        <button class="btn-secondary" data-act="activity" data-id="${mEscape(s.id)}">📝 רישום פעילות</button>
        <button class="btn-secondary" data-act="toggle" data-id="${mEscape(s.id)}">${isOpen ? '🔒 סגור' : '🔓 פתח'}</button>
        <button class="btn-secondary" data-act="edit" data-id="${mEscape(s.id)}">✏️ ערוך</button>
        <button class="btn-secondary sh-danger" data-act="delete" data-id="${mEscape(s.id)}">🗑️</button>` : ''}
      </div>
    </div>`;
}

// ------------------------------------------------------------
// EVENT DELEGATION
// ------------------------------------------------------------
function shHandleClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = el.dataset.id;
  const act = el.dataset.act;
  const needsWrite = ['status', 'activity', 'toggle', 'edit', 'delete'].includes(act);
  if (needsWrite && !shCanWrite()) { alert('אין הרשאת עריכה'); return; }
  switch (act) {
    case 'occupants': return shOpenOccupants(id);
    case 'status':    return shOpenStatus(id);
    case 'activity':  return shOpenActivity(id);
    case 'toggle':    return shToggleOpen(id);
    case 'edit':      return openEditShelterModal(id);
    case 'delete':    return deleteShelter(id);
    case 'focus':     return shFocusOnMap(id);
    case 'edit-activity':  return shOpenActivity(null, id);
    case 'delete-activity':
      if (!confirm('למחוק רישום פעילות זה?')) return;
      saveActivities(getActivities().filter(a => a.id !== id));
      return shRenderReport();
  }
}

function shToggleOpen(id) {
  const arr = getShelters();
  const s = arr.find(x => x.id === id);
  if (!s) return;
  s.isOpen = s.isOpen === false;
  s.log = shLogAdd(s, s.isOpen ? 'פתיחה' : 'סגירה', s.isOpen ? 'המקלט נפתח' : 'המקלט נסגר');
  saveShelters(arr);
  shRenderCurrent();
}
toggleShelterOpen = shToggleOpen;

function shLogAdd(s, type, text) {
  const log = [{ at: new Date().toISOString(), by: shUser(), type, text }, ...(s.log || [])];
  return log.slice(0, 100);
}

function deleteShelter(id) {
  const s = getShelters().find(x => x.id === id);
  if (!s || !confirm(`למחוק את המקלט "${s.name}"? הדיירים והיומן יימחקו.`)) return;
  saveShelters(getShelters().filter(x => x.id !== id));
  if (typeof logAudit === 'function') logAudit('DELETE_SHELTER', s.name, '');
  shRenderCurrent();
}

// ------------------------------------------------------------
// MODAL HELPERS
// ------------------------------------------------------------
function shModal(id, html, wide) {
  document.getElementById(id)?.remove();
  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = id;
  ovl.innerHTML = `<div class="modal" style="max-width:${wide || 620}px; width:96%; max-height:92vh; overflow:auto">${html}</div>`;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
  return ovl;
}
const shClose = (id) => document.getElementById(id)?.remove();

// ------------------------------------------------------------
// EDIT SHELTER
// ------------------------------------------------------------
function openAddShelterModal(existing) {
  if (!shCanWrite()) { alert('אין הרשאת עריכה'); return; }
  const s = existing || {};
  const w = s.wifi || {};
  const ovl = shModal('shelter-modal-overlay', `
    <h3>${s.id ? '✏️ עריכת מקלט' : '🏠 הוסף מקלט'}</h3>
    <div class="sh-grid">
      <input id="sh-name" placeholder="שם המקלט" value="${mEscape(s.name || '')}" />
      <input id="sh-address" placeholder="כתובת" value="${mEscape(s.address || '')}" />
      <select id="sh-category">${Object.entries(SHELTER_CATEGORIES).map(([v, l]) =>
        `<option value="${v}" ${(s.category || 'public') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="sh-check"><input type="checkbox" id="sh-isopen" ${s.isOpen !== false ? 'checked' : ''} /> פתוח כעת</label>
      <input id="sh-capacity" placeholder="קיבולת מקסימלית" type="number" min="0" value="${s.capacity || ''}" />
      <input id="sh-current" placeholder="תפוסה (ידני, אם אין רשימת דיירים)" type="number" min="0" value="${s.current || ''}" />
      <input id="sh-size" placeholder='שטח (מ"ר)' value="${mEscape(s.size || '')}" />
      <input id="sh-contact" placeholder="איש קשר / אחראי מקלט + טלפון" value="${mEscape(s.contact || '')}" />
    </div>
    <div class="sh-sec">📶 אינטרנט אלחוטי</div>
    <div class="sh-grid">
      <select id="sh-wifi-has">
        <option value="" ${w.has == null ? 'selected' : ''}>לא ידוע</option>
        <option value="yes" ${w.has === true ? 'selected' : ''}>יש</option>
        <option value="no" ${w.has === false ? 'selected' : ''}>אין</option>
      </select>
      <input id="sh-wifi-ssid" placeholder="שם הרשת (SSID)" value="${mEscape(w.ssid || '')}" />
      <input id="sh-wifi-pass" placeholder="סיסמת הרשת" value="${mEscape(w.password || '')}" autocomplete="off" />
    </div>
    <div class="sh-sec">📍 מיקום על המפה</div>
    <div class="sh-grid">
      <input id="sh-lat" placeholder="קו רוחב (lat)" value="${s.lat ?? ''}" />
      <input id="sh-lng" placeholder="קו אורך (lng)" value="${s.lng ?? ''}" />
    </div>
    <div style="margin:6px 0"><button type="button" class="btn-secondary" id="sh-geocode-btn">📍 מקם לפי הכתובת</button> <span id="sh-geocode-msg" class="sh-muted"></span></div>
    <div class="sh-sec">אוכלוסיות מיוחדות (ידני, אם אין רשימת דיירים)</div>
    <div class="sh-grid sh-grid4">
      <input id="sh-elderly" placeholder="קשישים" type="number" min="0" value="${s.elderly || ''}" />
      <input id="sh-disabled" placeholder="נכים" type="number" min="0" value="${s.disabled || ''}" />
      <input id="sh-infants" placeholder="תינוקות" type="number" min="0" value="${s.infants || ''}" />
      <input id="sh-animals" placeholder='בע"ח' type="number" min="0" value="${s.animals || ''}" />
    </div>
    <div class="sh-sec">צרכים דחופים</div>
    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:10px">
      ${Object.entries(SHELTER_NEED_LABELS).map(([k, l]) =>
        `<label class="sh-check"><input type="checkbox" id="sh-need-${k}" ${s.needs?.[k] ? 'checked' : ''} /> ${l}</label>`).join('')}
    </div>
    <textarea id="sh-notes" rows="2" placeholder="הערות">${mEscape(s.notes || '')}</textarea>
    <div class="modal-buttons">
      <button id="sh-save-btn">💾 שמור</button>
      <button class="btn-cancel" onclick="shClose('shelter-modal-overlay')">ביטול</button>
    </div>`);
  ovl.querySelector('#sh-save-btn').onclick = () => saveShelterFromModal(s.id || '');
  ovl.querySelector('#sh-geocode-btn').onclick = async () => {
    const msg = ovl.querySelector('#sh-geocode-msg');
    msg.textContent = 'מחפש...';
    const pos = await shGeocode(ovl.querySelector('#sh-address').value || ovl.querySelector('#sh-name').value);
    if (!pos) { msg.textContent = 'לא נמצא — הזן קואורדינטות ידנית או גרור את הסמן במפה החיה'; return; }
    ovl.querySelector('#sh-lat').value = pos.lat;
    ovl.querySelector('#sh-lng').value = pos.lng;
    msg.textContent = '✓ נמצא';
  };
}

function openEditShelterModal(id) {
  const s = getShelters().find(x => x.id === id);
  if (s) openAddShelterModal(s);
}

function saveShelterFromModal(existingId) {
  if (!shCanWrite()) return;
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const needs = {};
  Object.keys(SHELTER_NEED_LABELS).forEach(k => { needs[k] = document.getElementById(`sh-need-${k}`)?.checked || false; });
  const name = val('sh-name');
  if (!name) { alert('יש להזין שם למקלט'); return; }

  const lat = parseFloat(val('sh-lat'));
  const lng = parseFloat(val('sh-lng'));
  const hasWifi = val('sh-wifi-has');
  const shelters = getShelters();
  const prev = shelters.find(x => x.id === existingId) || {};
  const record = {
    ...prev,
    id: existingId || genId(),
    name,
    address: val('sh-address'),
    category: val('sh-category') || 'public',
    isOpen: document.getElementById('sh-isopen')?.checked !== false,
    capacity: shNum(val('sh-capacity')),
    current: shNum(val('sh-current')),
    size: val('sh-size'),
    contact: val('sh-contact'),
    wifi: { has: hasWifi === 'yes' ? true : hasWifi === 'no' ? false : null, ssid: val('sh-wifi-ssid'), password: val('sh-wifi-pass') },
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    elderly: shNum(val('sh-elderly')), disabled: shNum(val('sh-disabled')),
    infants: shNum(val('sh-infants')), animals: shNum(val('sh-animals')),
    needs,
    notes: val('sh-notes'),
  };
  const idx = shelters.findIndex(x => x.id === existingId);
  if (idx >= 0) shelters[idx] = record; else shelters.push(record);
  saveShelters(shelters);
  shClose('shelter-modal-overlay');
  shRenderCurrent();
  if (typeof logAudit === 'function') logAudit(existingId ? 'EDIT_SHELTER' : 'ADD_SHELTER', record.name, '');
}

// ------------------------------------------------------------
// OCCUPANTS — מי גר במקלט
// ------------------------------------------------------------
function shOpenOccupants(id) {
  const s = getShelters().find(x => x.id === id);
  if (!s) return;
  const w = shCanWrite();
  const occ = s.occupants || [];
  const ovl = shModal('occ-modal-overlay', `
    <h3>👥 דיירי המקלט — ${mEscape(s.name)}</h3>
    <div class="sh-muted" style="margin-bottom:8px">סה"כ מאוכלסים: <strong id="occ-total">${shOccupancy(s)}</strong> מתוך ${s.capacity || '?'} · ${occ.length} רשומים</div>
    <div style="overflow-x:auto"><table class="sh-table" id="occ-table">
      <thead><tr><th>שם</th><th>טלפון</th><th>מס' נפשות</th><th>👴</th><th>♿</th><th>👶</th><th>הערות</th><th></th></tr></thead>
      <tbody>${occ.map(o => shOccRow(o, w)).join('')}</tbody>
    </table></div>
    ${w ? `<div style="margin-top:8px"><button class="btn-secondary" id="occ-add">+ הוסף דייר</button></div>` : '<div class="sh-muted">צפייה בלבד</div>'}
    <div class="sh-muted" style="margin-top:6px">הסימונים 👴 ♿ 👶 מייצגים אדם אחד בכל שורה. כשיש רשימת דיירים, התפוסה והאוכלוסיות המיוחדות מחושבות ממנה.</div>
    <div class="modal-buttons">
      ${w ? '<button id="occ-save">💾 שמור</button>' : ''}
      <button class="btn-cancel" onclick="shClose('occ-modal-overlay')">סגור</button>
    </div>`, 860);
  if (!w) return;
  const tbody = ovl.querySelector('#occ-table tbody');
  const recalc = () => { ovl.querySelector('#occ-total').textContent = [...tbody.querySelectorAll('tr')].reduce((n, tr) => n + (shNum(tr.querySelector('.o-count').value) || 1), 0); };
  ovl.querySelector('#occ-add').onclick = () => { tbody.insertAdjacentHTML('beforeend', shOccRow({}, true)); recalc(); };
  tbody.addEventListener('click', e => { if (e.target.classList.contains('o-del')) { e.target.closest('tr').remove(); recalc(); } });
  tbody.addEventListener('input', recalc);
  ovl.querySelector('#occ-save').onclick = () => {
    const rows = [...tbody.querySelectorAll('tr')].map(tr => ({
      id: tr.dataset.oid || genId(),
      name: tr.querySelector('.o-name').value.trim(),
      phone: tr.querySelector('.o-phone').value.trim(),
      count: shNum(tr.querySelector('.o-count').value) || 1,
      elderly: tr.querySelector('.o-eld').checked,
      disabled: tr.querySelector('.o-dis').checked,
      infant: tr.querySelector('.o-inf').checked,
      notes: tr.querySelector('.o-notes').value.trim(),
    })).filter(o => o.name || o.phone);
    const arr = getShelters();
    const sh = arr.find(x => x.id === id);
    if (!sh) return;
    sh.occupants = rows;
    if (rows.length) {
      sh.current = rows.reduce((n, o) => n + o.count, 0);
      sh.elderly = rows.filter(o => o.elderly).length;
      sh.disabled = rows.filter(o => o.disabled).length;
      sh.infants = rows.filter(o => o.infant).length;
    }
    sh.log = shLogAdd(sh, 'דיירים', `עודכנה רשימת דיירים: ${rows.length} רשומים, ${sh.current} נפשות`);
    saveShelters(arr);
    shClose('occ-modal-overlay');
    shRenderCurrent();
  };
}

function shOccRow(o, w) {
  const dis = w ? '' : 'disabled';
  return `<tr data-oid="${mEscape(o.id || '')}">
    <td><input class="o-name" value="${mEscape(o.name || '')}" ${dis} /></td>
    <td><input class="o-phone" value="${mEscape(o.phone || '')}" ${dis} /></td>
    <td><input class="o-count" type="number" min="1" value="${o.count || 1}" style="width:64px" ${dis} /></td>
    <td><input class="o-eld" type="checkbox" ${o.elderly ? 'checked' : ''} ${dis} /></td>
    <td><input class="o-dis" type="checkbox" ${o.disabled ? 'checked' : ''} ${dis} /></td>
    <td><input class="o-inf" type="checkbox" ${o.infant ? 'checked' : ''} ${dis} /></td>
    <td><input class="o-notes" value="${mEscape(o.notes || '')}" ${dis} /></td>
    <td>${w ? '<button type="button" class="btn-secondary sh-danger o-del">✕</button>' : ''}</td>
  </tr>`;
}

// ------------------------------------------------------------
// STATUS — עדכון מצב בזמן אמת
// ------------------------------------------------------------
function shOpenStatus(id) {
  const s = getShelters().find(x => x.id === id);
  if (!s) return;
  const cur = s.activity?.level || 'quiet';
  const ovl = shModal('status-modal-overlay', `
    <h3>🚦 מה קורה במקלט — ${mEscape(s.name)}</h3>
    <div class="sh-levels">${Object.entries(SH_LEVELS).map(([k, l]) => `
      <label class="sh-level" style="--c:${l.color}"><input type="radio" name="sh-level" value="${k}" ${k === cur ? 'checked' : ''} /> ${l.icon} ${l.label}</label>`).join('')}
    </div>
    <textarea id="st-note" rows="2" placeholder="מה קורה? (למשל: התקף חרדה, חסר מים, התקהלות, חלוקת ערכות...)">${mEscape(s.activity?.note || '')}</textarea>
    <div class="sh-muted" style="margin-top:4px">עדכון ל"אירוע" או "חירום" נרשם גם ביומן האירועים העירוני ומודגש במפה החיה.</div>
    <div class="sh-sec">היסטוריית המקלט</div>
    <div class="sh-log">${(s.log || []).slice(0, 15).map(l => `<div><span class="sh-muted">${shFmtTime(l.at)} · ${mEscape(l.by)}</span> — <strong>${mEscape(l.type)}</strong>: ${mEscape(l.text)}</div>`).join('') || '<span class="sh-muted">אין רשומות</span>'}</div>
    <div class="modal-buttons">
      <button id="st-save">💾 עדכן</button>
      <button class="btn-cancel" onclick="shClose('status-modal-overlay')">ביטול</button>
    </div>`);
  ovl.querySelector('#st-save').onclick = () => {
    const level = ovl.querySelector('input[name="sh-level"]:checked')?.value || 'quiet';
    const note = ovl.querySelector('#st-note').value.trim();
    const arr = getShelters();
    const sh = arr.find(x => x.id === id);
    if (!sh) return;
    sh.activity = { level, note, at: new Date().toISOString(), by: shUser() };
    sh.log = shLogAdd(sh, SH_LEVELS[level].label, note || '—');
    saveShelters(arr);
    if (SH_LEVELS[level].rank >= 2) shPushCityEvent(sh, level, note);
    if (typeof logAudit === 'function') logAudit('SHELTER_STATUS', sh.name, `${SH_LEVELS[level].label}: ${note}`);
    shClose('status-modal-overlay');
    shRenderCurrent();
  };
}

// דיווח לאירועים העירוניים — כך שהמצב במקלט נלקח בחשבון ביומן האירועים
function shPushCityEvent(s, level, note) {
  try {
    const entries = JSON.parse(localStorage.getItem(EM_ENTRIES_KEY) || '[]');
    entries.push({
      id: genId(),
      timestamp: new Date().toISOString(),
      sender: shUser(),
      message: `מקלט "${s.name}": ${SH_LEVELS[level].label}${note ? ' — ' + note : ''}`,
      location: s.address || s.name,
      classification: 'אוכלוסייה',
      status: level === 'critical' ? 'חירום' : 'בטיפול',
      chat_type: 'מקלט',
      source: 'מערכת מקלטים',
      latitude: s.lat ?? null,
      longitude: s.lng ?? null,
    });
    localStorage.setItem(EM_ENTRIES_KEY, JSON.stringify(entries));
    if (typeof loadData === 'function') loadData();
  } catch (_) { /* יומן האירועים אינו קריטי לעדכון המקלט */ }
}

// ------------------------------------------------------------
// ACTIVITY LOG (רישום פעילות / חלוקת ערכות)
// ------------------------------------------------------------
function shOpenActivity(shelterId, activityId) {
  const existing = activityId ? getActivities().find(a => a.id === activityId) : null;
  const a = existing || {};
  const sid = a.shelterId || shelterId || '';
  const shelters = getShelters();
  const at = a.at ? new Date(a.at) : new Date();
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const items = a.items?.length ? a.items : [{ name: '', qty: '' }];

  const ovl = shModal('act-modal-overlay', `
    <h3>${existing ? '✏️ עריכת פעילות' : '📝 רישום פעילות / חלוקת ערכות'}</h3>
    <div class="sh-grid">
      <select id="ac-shelter"><option value="">כללי / כל המקלטים</option>${shelters.map(s => `<option value="${mEscape(s.id)}" ${s.id === sid ? 'selected' : ''}>${mEscape(s.name)}</option>`).join('')}</select>
      <input id="ac-at" type="datetime-local" value="${local}" />
      <select id="ac-type">${ACTIVITY_TYPES.map(t => `<option ${t === a.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input id="ac-participants" type="number" min="0" placeholder="מס' משתתפים / מקבלים" value="${a.participants || ''}" />
    </div>
    <input id="ac-title" placeholder="תיאור קצר (למשל: חלוקת ערכות הפגה לילדים)" value="${mEscape(a.title || '')}" style="margin:8px 0; width:100%" />
    <div class="sh-sec">ערכות / פריטים שחולקו</div>
    <datalist id="ac-kits">${KIT_SUGGESTIONS.map(k => `<option value="${mEscape(k)}">`).join('')}</datalist>
    <div id="ac-items">${items.map(shItemRow).join('')}</div>
    <button type="button" class="btn-secondary" id="ac-add-item" style="margin-top:6px">+ פריט</button>
    <textarea id="ac-notes" rows="2" placeholder="הערות" style="margin-top:10px; width:100%">${mEscape(a.notes || '')}</textarea>
    <div class="modal-buttons">
      <button id="ac-save">💾 שמור</button>
      <button class="btn-cancel" onclick="shClose('act-modal-overlay')">ביטול</button>
    </div>`);
  ovl.querySelector('#ac-add-item').onclick = () => ovl.querySelector('#ac-items').insertAdjacentHTML('beforeend', shItemRow({ name: '', qty: '' }));
  ovl.querySelector('#ac-items').addEventListener('click', e => { if (e.target.classList.contains('ac-del')) e.target.closest('.ac-row').remove(); });
  ovl.querySelector('#ac-save').onclick = () => {
    const chosen = ovl.querySelector('#ac-shelter').value;
    const sh = shelters.find(s => s.id === chosen);
    const itemsOut = [...ovl.querySelectorAll('.ac-row')].map(r => ({ name: r.querySelector('.ac-name').value.trim(), qty: shNum(r.querySelector('.ac-qty').value) })).filter(i => i.name && i.qty > 0);
    const atVal = ovl.querySelector('#ac-at').value;
    const rec = {
      ...a,
      id: a.id || genId(),
      shelterId: chosen,
      shelterName: sh ? sh.name : 'כללי',
      at: atVal ? new Date(atVal).toISOString() : new Date().toISOString(),
      type: ovl.querySelector('#ac-type').value,
      title: ovl.querySelector('#ac-title').value.trim(),
      participants: shNum(ovl.querySelector('#ac-participants').value),
      items: itemsOut,
      notes: ovl.querySelector('#ac-notes').value.trim(),
      by: a.by || shUser(),
    };
    const all = getActivities();
    const idx = all.findIndex(x => x.id === rec.id);
    if (idx >= 0) all[idx] = rec; else all.push(rec);
    saveActivities(all);
    if (sh && !existing) {
      const arr = getShelters();
      const t = arr.find(x => x.id === sh.id);
      if (t) { t.log = shLogAdd(t, rec.type, rec.title || itemsOut.map(i => `${i.name} ×${i.qty}`).join(', ') || '—'); saveShelters(arr); }
    }
    if (typeof logAudit === 'function') logAudit('SHELTER_ACTIVITY', rec.shelterName, `${rec.type} ${rec.title}`);
    shClose('act-modal-overlay');
    shRenderCurrent();
  };
}

function shItemRow(i) {
  return `<div class="ac-row" style="display:flex; gap:6px; margin-bottom:4px">
    <input class="ac-name" list="ac-kits" placeholder="שם פריט / ערכה" value="${mEscape(i.name || '')}" style="flex:1" />
    <input class="ac-qty" type="number" min="1" placeholder="כמות" value="${i.qty || ''}" style="width:90px" />
    <button type="button" class="btn-secondary sh-danger ac-del">✕</button></div>`;
}

// ------------------------------------------------------------
// REPORT — דוח פעילות
// ------------------------------------------------------------
const shReportFilter = { from: '', to: '', shelter: '', type: '' };

function shInitReportFilters() {
  if (shReportFilter.from) return;
  const d = new Date(); d.setDate(d.getDate() - 30);
  shReportFilter.from = d.toISOString().slice(0, 10);
  shReportFilter.to = new Date().toISOString().slice(0, 10);
}

function shFilteredActivities() {
  const f = shReportFilter;
  const from = f.from ? new Date(f.from + 'T00:00:00').getTime() : -Infinity;
  const to = f.to ? new Date(f.to + 'T23:59:59').getTime() : Infinity;
  return getActivities()
    .filter(a => { const t = new Date(a.at).getTime(); return t >= from && t <= to; })
    .filter(a => !f.shelter || a.shelterId === f.shelter)
    .filter(a => !f.type || a.type === f.type)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function shRenderReport() {
  const box = document.getElementById('shelters-report-view');
  if (!box) return;
  shInitReportFilters();
  const f = shReportFilter;
  const acts = shFilteredActivities();
  const w = shCanWrite();

  const kits = {}, byType = {}, byShelter = {};
  let participants = 0, kitTotal = 0;
  acts.forEach(a => {
    participants += shNum(a.participants);
    (a.items || []).forEach(i => { kits[i.name] = (kits[i.name] || 0) + i.qty; kitTotal += i.qty; });
    byType[a.type] = byType[a.type] || { n: 0, p: 0 };
    byType[a.type].n++; byType[a.type].p += shNum(a.participants);
    byShelter[a.shelterName] = (byShelter[a.shelterName] || 0) + 1;
  });
  const rows = (obj, fmt) => Object.entries(obj).sort((x, y) => (y[1].n ?? y[1]) - (x[1].n ?? x[1])).map(([k, v]) => `<tr><td>${mEscape(k)}</td><td>${fmt(v)}</td></tr>`).join('') || '<tr><td colspan="2" class="sh-muted">אין נתונים</td></tr>';

  box.innerHTML = `
    <div class="panel" style="margin-top:12px">
      <div class="sh-filters">
        <label>מתאריך <input type="date" id="rf-from" value="${f.from}" /></label>
        <label>עד תאריך <input type="date" id="rf-to" value="${f.to}" /></label>
        <label>מקלט <select id="rf-shelter"><option value="">הכל</option>${getShelters().map(s => `<option value="${mEscape(s.id)}" ${s.id === f.shelter ? 'selected' : ''}>${mEscape(s.name)}</option>`).join('')}</select></label>
        <label>סוג <select id="rf-type"><option value="">הכל</option>${ACTIVITY_TYPES.map(t => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn-secondary" id="rf-csv">⬇️ ייצוא CSV</button>
        <button class="btn-secondary" onclick="window.print()">🖨️ הדפסה</button>
        ${w ? '<button class="btn-secondary" data-act="activity" data-id="">+ רישום פעילות</button>' : ''}
      </div>
      <div class="sh-kpis">
        <div class="sh-kpi"><div>${acts.length}</div><span>פעילויות</span></div>
        <div class="sh-kpi"><div>${participants}</div><span>משתתפים / מקבלים</span></div>
        <div class="sh-kpi"><div>${kitTotal}</div><span>ערכות / פריטים שחולקו</span></div>
        <div class="sh-kpi"><div>${Object.keys(byShelter).length}</div><span>מקלטים שפעלו</span></div>
      </div>
      <div class="sh-report-cols">
        <div><h4>ערכות / פריטים שחולקו</h4><table class="sh-table"><thead><tr><th>פריט</th><th>כמות</th></tr></thead><tbody>${rows(kits, v => v)}</tbody></table></div>
        <div><h4>לפי סוג פעילות</h4><table class="sh-table"><thead><tr><th>סוג</th><th>פעילויות · משתתפים</th></tr></thead><tbody>${rows(byType, v => `${v.n} · ${v.p}`)}</tbody></table></div>
        <div><h4>לפי מקלט</h4><table class="sh-table"><thead><tr><th>מקלט</th><th>פעילויות</th></tr></thead><tbody>${rows(byShelter, v => v)}</tbody></table></div>
      </div>
      <h4 style="margin-top:16px">פירוט</h4>
      <div style="overflow-x:auto"><table class="sh-table">
        <thead><tr><th>זמן</th><th>מקלט</th><th>סוג</th><th>תיאור</th><th>משתתפים</th><th>פריטים</th><th>נרשם ע"י</th><th></th></tr></thead>
        <tbody>${acts.map(a => `<tr>
          <td>${shFmtTime(a.at)}</td><td>${mEscape(a.shelterName)}</td><td>${mEscape(a.type)}</td>
          <td>${mEscape(a.title)}${a.notes ? `<div class="sh-muted">${mEscape(a.notes)}</div>` : ''}</td>
          <td>${shNum(a.participants) || '—'}</td>
          <td>${(a.items || []).map(i => `${mEscape(i.name)} ×${i.qty}`).join('<br>') || '—'}</td>
          <td>${mEscape(a.by)}</td>
          <td>${w ? `<button class="btn-secondary" data-act="edit-activity" data-id="${mEscape(a.id)}">✏️</button> <button class="btn-secondary sh-danger" data-act="delete-activity" data-id="${mEscape(a.id)}">🗑️</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="sh-muted" style="padding:16px">אין פעילויות בטווח שנבחר</td></tr>'}</tbody>
      </table></div>
    </div>`;
  const bind = (id, key) => { box.querySelector(id).onchange = (e) => { shReportFilter[key] = e.target.value; shRenderReport(); }; };
  bind('#rf-from', 'from'); bind('#rf-to', 'to'); bind('#rf-shelter', 'shelter'); bind('#rf-type', 'type');
  box.querySelector('#rf-csv').onclick = () => shExportCsv(acts);
}

function shExportCsv(acts) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // מניעת הזרקת נוסחאות באקסל
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [
    ['זמן', 'מקלט', 'סוג', 'תיאור', 'משתתפים', 'פריטים', 'הערות', 'נרשם ע"י'].map(cell).join(','),
    ...acts.map(a => [shFmtTime(a.at), a.shelterName, a.type, a.title, a.participants || 0,
      (a.items || []).map(i => `${i.name} x${i.qty}`).join('; '), a.notes, a.by].map(cell).join(',')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = `shelter_activity_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  if (typeof logAudit === 'function') logAudit('EXPORT_SHELTER_REPORT', 'shelters', `${acts.length} רשומות`);
}

// ------------------------------------------------------------
// LIVE MAP — תמונה עירונית בזמן אמת
// ------------------------------------------------------------
let shMap = null, shLayer = null, shImpactLayer = null;
const shMarkers = {};

function shRenderLive() {
  const box = document.getElementById('shelters-live-view');
  if (!box) return;
  const shelters = getShelters();
  const open = shelters.filter(s => s.isOpen !== false);
  const totalOcc = shelters.reduce((n, s) => n + shOccupancy(s), 0);
  const totalCap = shelters.reduce((n, s) => n + shNum(s.capacity), 0);
  const hot = shelters.filter(s => shLevel(s).rank >= 2).sort((a, b) => shLevel(b).rank - shLevel(a).rank);
  const noWifi = shelters.filter(s => s.wifi?.has === false).length;
  const unplaced = shelters.filter(s => !(s.lat && s.lng)).length;

  if (!document.getElementById('sh-live-map')) {
    box.innerHTML = `
      <div id="sh-live-kpis" class="sh-kpis" style="margin-top:12px"></div>
      <div id="sh-live-alert"></div>
      <div id="sh-live-impact"></div>
      <div class="sh-live-grid">
        <div>
          <div class="sh-map-bar">
            <span class="sh-legend">${Object.values(SH_LEVELS).map(l => `<i style="background:${l.color}"></i>${l.label}`).join(' ')}</span>
            <span id="sh-unplaced"></span>
            <button class="btn-secondary sh-write" id="sh-geocode-all">📍 מקם מקלטים לפי כתובת</button>
          </div>
          <div id="sh-live-map"></div>
        </div>
        <div id="sh-live-list" class="sh-live-list"></div>
      </div>`;
    box.querySelector('#sh-geocode-all').onclick = shGeocodeAll;
  }

  document.getElementById('sh-live-kpis').innerHTML = `
    <div class="sh-kpi"><div>${open.length}<small>/${shelters.length}</small></div><span>מקלטים פתוחים</span></div>
    <div class="sh-kpi"><div>${totalOcc}<small>/${totalCap || '?'}</small></div><span>דיירים / קיבולת</span></div>
    <div class="sh-kpi ${hot.length ? 'sh-kpi-hot' : ''}"><div>${hot.length}</div><span>באירוע / חירום</span></div>
    <div class="sh-kpi"><div>${noWifi}</div><span>ללא אינטרנט אלחוטי</span></div>`;

  document.getElementById('sh-live-alert').innerHTML = hot.length ? `
    <div class="sh-alert">
      <strong>🚨 מקלטים הדורשים התייחסות (${hot.length}):</strong>
      ${hot.map(s => `<div class="sh-alert-row" data-act="focus" data-id="${mEscape(s.id)}" style="border-color:${shLevel(s).color}">
        ${shLevel(s).icon} <strong>${mEscape(s.name)}</strong> — ${mEscape(s.activity?.note || shLevel(s).label)}
        <span class="sh-muted">(${shAgo(s.activity?.at)})</span></div>`).join('')}
    </div>` : '';

  shRenderImpactPanel(shelters);
  document.getElementById('sh-unplaced').textContent = unplaced ? `${unplaced} מקלטים ללא מיקום` : '';
  document.getElementById('sh-geocode-all').style.display = shCanWrite() && unplaced ? '' : 'none';

  const sorted = [...shelters].sort((a, b) => shLevel(b).rank - shLevel(a).rank || shNum(b.current) - shNum(a.current));
  document.getElementById('sh-live-list').innerHTML = sorted.map(s => {
    const l = shLevel(s);
    return `<div class="sh-live-item" data-act="focus" data-id="${mEscape(s.id)}" style="border-right:4px solid ${l.color}">
      <div><strong>${mEscape(s.name)}</strong> <span class="sh-chip" style="background:${l.color}1f; color:${l.color}">${l.icon} ${l.label}</span></div>
      <div class="sh-muted">👥 ${shOccupancy(s)}/${s.capacity || '?'} · ${s.wifi?.has === true ? '📶' : s.wifi?.has === false ? '📵' : '📶?'} · ${shAgo(s.activity?.at)}</div>
    </div>`;
  }).join('') || '<div class="sh-muted" style="padding:12px">אין מקלטים</div>';

  shDrawMap(shelters);
}

function shRenderImpactPanel(shelters) {
  const el = document.getElementById('sh-live-impact');
  if (!el) return;
  const p = typeof activeImpactPoint !== 'undefined' ? activeImpactPoint : null;
  if (!p) {
    el.innerHTML = '<div class="sh-hint">💡 סמן נקודת פגיעה במפת תמונת המצב כדי לראות כאן את המקלטים הקרובים והזמינים באירוע.</div>';
    return;
  }
  const near = shelters.filter(s => s.lat && s.lng && s.isOpen !== false)
    .map(s => ({ s, d: Math.round(haversineDistance(p.lat, p.lng, s.lat, s.lng)), free: Math.max(0, shNum(s.capacity) - shOccupancy(s)) }))
    .sort((a, b) => a.d - b.d).slice(0, 5);
  el.innerHTML = `<div class="sh-impact">
    <strong>💥 נקודת פגיעה: ${mEscape(p.label || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)} — מקלטים פתוחים קרובים</strong>
    <table class="sh-table"><thead><tr><th>מקלט</th><th>מרחק</th><th>מקום פנוי</th><th>מצב</th><th>אינטרנט</th></tr></thead><tbody>
    ${near.map(({ s, d, free }) => `<tr data-act="focus" data-id="${mEscape(s.id)}" style="cursor:pointer">
      <td>${mEscape(s.name)}</td><td>${d} מ'</td>
      <td style="color:${free < 10 ? 'var(--danger)' : 'var(--success)'}">${free}</td>
      <td>${shLevel(s).icon} ${shLevel(s).label}</td><td>${s.wifi?.has === true ? '📶 יש' : s.wifi?.has === false ? '📵 אין' : '?'}</td></tr>`).join('')
      || '<tr><td colspan="5" class="sh-muted">אין מקלטים ממוקמים ופתוחים</td></tr>'}
    </tbody></table></div>`;
}

function shDrawMap(shelters) {
  if (typeof L === 'undefined') { document.getElementById('sh-live-map').textContent = 'ספריית המפות לא נטענה'; return; }
  if (!shMap) {
    shMap = L.map('sh-live-map', { zoomControl: true }).setView(BAT_YAM_CENTER, 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(shMap);
    shLayer = L.layerGroup().addTo(shMap);
    shImpactLayer = L.layerGroup().addTo(shMap);
  }
  setTimeout(() => shMap.invalidateSize(), 0);
  shLayer.clearLayers();
  Object.keys(shMarkers).forEach(k => delete shMarkers[k]);
  const canDrag = shCanWrite();

  shelters.filter(s => s.lat && s.lng).forEach(s => {
    const l = shLevel(s);
    const pct = s.capacity ? Math.min(100, Math.round(shOccupancy(s) / s.capacity * 100)) : 0;
    const icon = L.divIcon({
      className: '',
      html: `<div class="sh-pin ${l.rank >= 2 ? 'sh-pulse' : ''} ${s.isOpen === false ? 'sh-pin-closed' : ''}" style="--c:${l.color}">${shOccupancy(s)}</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17],
    });
    const m = L.marker([s.lat, s.lng], { icon, draggable: canDrag, zIndexOffset: l.rank * 100 }).addTo(shLayer);
    m.bindPopup(`<div dir="rtl" style="min-width:200px"><strong>${mEscape(s.name)}</strong><br>${l.icon} ${l.label}${s.activity?.note ? ': ' + mEscape(s.activity.note) : ''}<br>
      👥 ${shOccupancy(s)}/${s.capacity || '?'} (${pct}%)<br>${shWifiHTML(s)}<br><span class="sh-muted">${mEscape(s.address)}</span>${canDrag ? '<br><span class="sh-muted">ניתן לגרור את הסמן לתיקון המיקום</span>' : ''}</div>`);
    m.on('dragend', () => {
      const ll = m.getLatLng();
      const arr = getShelters();
      const t = arr.find(x => x.id === s.id);
      if (t) { t.lat = +ll.lat.toFixed(6); t.lng = +ll.lng.toFixed(6); saveShelters(arr); }
    });
    shMarkers[s.id] = m;
  });

  shImpactLayer.clearLayers();
  const p = typeof activeImpactPoint !== 'undefined' ? activeImpactPoint : null;
  if (p) {
    L.circle([p.lat, p.lng], { radius: 500, color: '#dc2626', weight: 2, fillOpacity: 0.07 }).addTo(shImpactLayer);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: '<div class="sh-impact-pin">💥</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(shImpactLayer);
  }
}

function shFocusOnMap(id) {
  const s = getShelters().find(x => x.id === id);
  if (shView !== 'live') shSetView('live');
  if (!s?.lat || !shMap) { if (s && !s.lat) alert('המקלט עדיין לא ממוקם על המפה'); return; }
  shMap.setView([s.lat, s.lng], 17);
  shMarkers[id]?.openPopup();
  document.getElementById('sh-live-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ------------------------------------------------------------
// GEOCODING (דרך /api/proxy → Nominatim)
// ------------------------------------------------------------
async function shGeocode(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q=' + encodeURIComponent(`${q}, בת ים`), method: 'GET' }),
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]) return { lat: +(+data[0].lat).toFixed(6), lng: +(+data[0].lon).toFixed(6) };
  } catch (_) { /* נפילה שקטה — המשתמש יזין ידנית */ }
  return null;
}

async function shGeocodeAll() {
  const btn = document.getElementById('sh-geocode-all');
  const todo = getShelters().filter(s => !(s.lat && s.lng) && (s.address || s.name));
  let ok = 0;
  for (let i = 0; i < todo.length; i++) {
    btn.textContent = `ממקם ${i + 1}/${todo.length}...`;
    const pos = await shGeocode(todo[i].address || todo[i].name);
    if (pos) {
      const arr = getShelters();
      const t = arr.find(x => x.id === todo[i].id);
      if (t) { t.lat = pos.lat; t.lng = pos.lng; saveShelters(arr); ok++; }
    }
    await new Promise(r => setTimeout(r, 1100)); // מגבלת קצב של Nominatim
  }
  btn.textContent = '📍 מקם מקלטים לפי כתובת';
  alert(`מוקמו ${ok} מתוך ${todo.length} מקלטים. את השאר אפשר לגרור על המפה.`);
  shRenderLive();
}

// ------------------------------------------------------------
// SYNC — מתבצע במנוע המשותף em_sync.js
// ------------------------------------------------------------
function shSyncSoon() { window.EMSync?.syncSoon(); }

function shUpdateSyncBadge() {
  const el = document.getElementById('sh-sync-badge');
  if (!el) return;
  const st = window.EMSync?.state;
  if (window.EM_SERVER_AUTH !== true) { el.textContent = '🔌 מקומי בלבד'; el.title = 'פתיחה כקובץ מקומי: הנתונים נשמרים בדפדפן זה בלבד'; return; }
  el.title = 'הנתונים משותפים בין כל המחשבים המחוברים';
  el.textContent = st?.ok === false ? `⚠️ ${st.msg}` : st?.at ? `🟢 מסונכרן ${st.at.toLocaleTimeString('he-IL')}` : '⏳ מסנכרן...';
}

// חיבור לאירועי המערכת הקיימים
const shPrevImpact = window.onImpactPointSet;
window.onImpactPointSet = function (...args) {
  if (typeof shPrevImpact === 'function') shPrevImpact(...args);
  if (shTabVisible() && shView === 'live') shRenderLive();
};
