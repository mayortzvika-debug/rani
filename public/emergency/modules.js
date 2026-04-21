'use strict';
// ============================================================
// modules.js — Emergency Dashboard — Feature Modules v2.0
// מרכזי משפחות, מפונים, תשתיות, מקלטים, מלונות, Red Alert
// ============================================================

// ---- Storage Keys ----
const FAMILY_CENTERS_KEY  = 'em_family_centers';
const RESIDENTS_KEY       = 'em_residents';
const INFRA_KEY           = 'em_infrastructure';
const SHELTERS_KEY        = 'em_shelters';
const GEOCACHE_KEY        = 'em_geocache';

// ---- Active impact point (set from map) ----
let activeImpactPoint     = null;  // { lat, lng, label }
let activeRadiusFilter    = 100;   // מטר

// ============================================================
// UTILS
// ============================================================
function safeGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch {}
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R   = 6371000; // מטר
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a   = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180)
            * Math.cos(lat2 * Math.PI / 180)
            * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function mEscape(val) {
  return String(val ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function formatPhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').replace(/^972/, '0');
}

// ============================================================
// PART 1: FAMILY CENTERS
// ============================================================
function getFamilyCenters()      { return safeGet(FAMILY_CENTERS_KEY); }
function saveFamilyCenters(arr)  { safeSet(FAMILY_CENTERS_KEY, arr); }

function getNearestFamilyCenters(lat, lng, n = 3) {
  return getFamilyCenters()
    .filter(c => c.lat && c.lng)
    .map(c => ({ ...c, dist: Math.round(haversineDistance(lat, lng, c.lat, c.lng)) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// קרוי מ-emergency_dashboard.js לאחר סימון נקודה על המפה
function onImpactPointSet(lat, lng, label) {
  activeImpactPoint = { lat, lng, label };
  renderNearestCenters(lat, lng);

  // עדכון תווית בלשונית מפונים
  const lbl = document.getElementById('evacuees-impact-label');
  if (lbl) lbl.textContent = `נקודת פגיעה: ${label || `${lat.toFixed(4)},${lng.toFixed(4)}`}`;

  renderEvacueesTable();
}

function renderNearestCenters(lat, lng) {
  const panel = document.getElementById('nearestCentersPanel');
  if (!panel) return;

  const centers = getNearestFamilyCenters(lat, lng, 3);
  if (!centers.length) {
    panel.innerHTML = '<div class="map-empty-state">אין מרכזי משפחות מוגדרים. לחץ "ניהול" להוספה.</div>';
    return;
  }

  panel.innerHTML = centers.map((c, i) => `
    <div class="center-card">
      <div class="center-rank">${i + 1}</div>
      <div class="center-info">
        <strong>${mEscape(c.name)}</strong>
        <span>${mEscape(c.address)}</span>
        <span class="center-dist">${c.dist < 1000 ? c.dist + ' מ\'' : (c.dist / 1000).toFixed(1) + ' ק"מ'}</span>
      </div>
    </div>
  `).join('');
}

function openFamilyCenterManager() {
  const centers = getFamilyCenters();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'fc-manager-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:760px; width:96%">
      <h3>🏢 ניהול מרכזי משפחות</h3>
      <div id="fc-list">${buildFCListHTML(centers)}</div>
      <hr style="border-color:rgba(148,163,184,0.2); margin:18px 0" />
      <h4 style="color:#38bdf8; margin:0 0 12px">הוסף / ייבא מרכז</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px">
        <input id="fc-name"    placeholder="שם המרכז" />
        <input id="fc-address" placeholder="כתובת מלאה" />
        <input id="fc-streets" placeholder="רחובות (פסיק מפריד)" />
      </div>
      <p style="color:#64748b; font-size:0.82rem; margin:4px 0 12px">הקואורדינטות יחושבו אוטומטית לפי הכתובת.</p>
      <div id="fc-error" style="display:none; color:#f87171; margin-bottom:10px; font-size:0.88rem"></div>
      <div class="modal-buttons">
        <button onclick="addFamilyCenter()">➕ הוסף מרכז</button>
        <button class="btn-cancel" onclick="document.getElementById('fc-manager-overlay')?.remove()">סגור</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function buildFCListHTML(centers) {
  if (!centers.length) return '<p style="color:#94a3b8; padding:8px">אין מרכזים מוגדרים עדיין.</p>';
  return `
    <div style="overflow-x:auto">
    <table style="width:100%; font-size:0.88rem; border-collapse:collapse">
      <thead><tr>
        <th style="color:#94a3b8; padding:8px; text-align:right">שם</th>
        <th style="color:#94a3b8; padding:8px; text-align:right">כתובת</th>
        <th style="color:#94a3b8; padding:8px; text-align:right">רחובות</th>
        <th style="color:#94a3b8; padding:8px; text-align:right">פעולות</th>
      </tr></thead>
      <tbody>
        ${centers.map(c => `
          <tr style="border-top:1px solid rgba(148,163,184,0.1)">
            <td style="padding:8px; font-weight:500">${mEscape(c.name)}</td>
            <td style="padding:8px; color:#94a3b8">${mEscape(c.address)}</td>
            <td style="padding:8px; color:#94a3b8; font-size:0.82rem">${mEscape((c.streets || []).join(', '))}</td>
            <td style="padding:8px">
              <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem; background:rgba(239,68,68,0.2)" onclick="deleteFamilyCenter('${c.id}')">מחק</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

async function addFamilyCenter() {
  const name    = (document.getElementById('fc-name')?.value || '').trim();
  const address = (document.getElementById('fc-address')?.value || '').trim();
  const streets = (document.getElementById('fc-streets')?.value || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const errEl   = document.getElementById('fc-error');

  if (!name || !address) {
    errEl.textContent = 'יש למלא שם וכתובת';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';

  const coords = await geocodeAddress(address + ', בת ים, ישראל');
  const centers = getFamilyCenters();

  centers.push({
    id: genId(),
    name,
    address,
    streets,
    lat: coords?.lat || null,
    lng: coords?.lng || null,
  });

  saveFamilyCenters(centers);
  document.getElementById('fc-list').innerHTML = buildFCListHTML(centers);
  document.getElementById('fc-name').value    = '';
  document.getElementById('fc-address').value = '';
  document.getElementById('fc-streets').value = '';
}

function deleteFamilyCenter(id) {
  if (!confirm('למחוק מרכז זה?')) return;
  saveFamilyCenters(getFamilyCenters().filter(c => c.id !== id));
  document.getElementById('fc-list').innerHTML = buildFCListHTML(getFamilyCenters());
}

// ============================================================
// PART 2: SHELTERS
// ============================================================
function getShelters()      { return safeGet(SHELTERS_KEY); }
function saveShelters(arr)  { safeSet(SHELTERS_KEY, arr); }

function initSheltersTab() {
  renderSheltersGrid();
}

function renderSheltersGrid() {
  const grid     = document.getElementById('shelters-grid');
  if (!grid) return;
  const shelters = getShelters();

  if (!shelters.length) {
    grid.innerHTML = '<div class="map-empty-state" style="margin:20px">אין מקלטים מוגדרים. לחץ "+ הוסף מקלט".</div>';
    return;
  }

  grid.innerHTML = shelters.map(s => {
    const pct  = s.capacity ? Math.min(100, Math.round((s.current || 0) / s.capacity * 100)) : 0;
    const pctColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f97316' : '#22c55e';
    const needs = Object.entries(s.needs || {}).filter(([,v]) => v).map(([k]) => SHELTER_NEED_LABELS[k] || k);

    return `
      <div class="shelter-card">
        <div class="shelter-header">
          <strong>${mEscape(s.name)}</strong>
          <div style="display:flex; gap:6px">
            <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem" onclick="openEditShelterModal('${s.id}')">✏️ ערוך</button>
            <button class="btn-secondary" style="padding:3px 8px; font-size:0.78rem; background:rgba(239,68,68,0.18); color:#fca5a5" onclick="deleteShelter('${s.id}')">🗑️</button>
          </div>
        </div>
        <div style="color:#94a3b8; font-size:0.85rem; margin-bottom:8px">${mEscape(s.address)}</div>
        <div class="shelter-capacity-row">
          <span>תפוסה: <strong style="color:${pctColor}">${s.current || 0}</strong> / ${s.capacity || '?'}</span>
          <span style="color:${pctColor}; font-weight:600">${pct}%</span>
        </div>
        <div class="capacity-bar"><div class="capacity-fill" style="width:${pct}%; background:${pctColor}"></div></div>
        ${needs.length ? `<div class="shelter-needs">🆘 נדרש: ${needs.map(n => `<span class="need-chip">${n}</span>`).join('')}</div>` : ''}
        <div class="shelter-populations" style="margin-top:8px; font-size:0.82rem; color:#94a3b8">
          ${s.elderly ? `👴 קשישים: ${s.elderly}  ` : ''}
          ${s.disabled ? `♿ נכים: ${s.disabled}  ` : ''}
          ${s.infants ? `👶 תינוקות: ${s.infants}  ` : ''}
          ${s.animals ? `🐾 בע"ח: ${s.animals}` : ''}
        </div>
        ${s.notes ? `<div style="margin-top:8px; font-size:0.85rem; color:#cbd5e1; background:rgba(15,23,42,0.4); padding:8px; border-radius:8px">${mEscape(s.notes)}</div>` : ''}
      </div>
    `;
  }).join('');
}

const SHELTER_NEED_LABELS = {
  food:'אוכל', medical:'רפואי', blankets:'שמיכות', staff:'כוח אדם',
  generator:'גנרטור', water:'מים', hygiene:'היגיינה'
};

function openAddShelterModal(existing) {
  const s   = existing || {};
  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'shelter-modal-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:560px; width:96%">
      <h3>${s.id ? '✏️ עריכת מקלט' : '🏠 הוסף מקלט'}</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
        <input id="sh-name"     placeholder="שם המקלט"      value="${mEscape(s.name || '')}" />
        <input id="sh-address"  placeholder="כתובת"         value="${mEscape(s.address || '')}" />
        <input id="sh-capacity" placeholder="קיבולת מקסימלית" type="number" min="0" value="${s.capacity || ''}" />
        <input id="sh-current"  placeholder="תפוסה נוכחית"  type="number" min="0" value="${s.current || ''}" />
        <input id="sh-elderly"  placeholder="קשישים"        type="number" min="0" value="${s.elderly || ''}" />
        <input id="sh-disabled" placeholder="נכים"          type="number" min="0" value="${s.disabled || ''}" />
        <input id="sh-infants"  placeholder="תינוקות"       type="number" min="0" value="${s.infants || ''}" />
        <input id="sh-animals"  placeholder="בע&quot;ח"    type="number" min="0" value="${s.animals || ''}" />
      </div>
      <div style="margin:14px 0 10px; font-size:0.88rem; color:#94a3b8">צרכים דחופים:</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px">
        ${Object.entries(SHELTER_NEED_LABELS).map(([k,l]) => `
          <label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:0.88rem; color:#cbd5e1">
            <input type="checkbox" id="sh-need-${k}" ${s.needs?.[k] ? 'checked' : ''} style="accent-color:#38bdf8" />
            ${l}
          </label>
        `).join('')}
      </div>
      <textarea id="sh-notes" rows="2" placeholder="הערות">${mEscape(s.notes || '')}</textarea>
      <div class="modal-buttons">
        <button onclick="saveShelterFromModal('${s.id || ''}')">💾 שמור</button>
        <button class="btn-cancel" onclick="document.getElementById('shelter-modal-overlay')?.remove()">ביטול</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

function openEditShelterModal(id) {
  const s = getShelters().find(x => x.id === id);
  if (s) openAddShelterModal(s);
}

function saveShelterFromModal(existingId) {
  const needs = {};
  Object.keys(SHELTER_NEED_LABELS).forEach(k => {
    needs[k] = document.getElementById(`sh-need-${k}`)?.checked || false;
  });

  const record = {
    id:       existingId || genId(),
    name:     document.getElementById('sh-name')?.value.trim()   || '',
    address:  document.getElementById('sh-address')?.value.trim() || '',
    capacity: Number(document.getElementById('sh-capacity')?.value) || 0,
    current:  Number(document.getElementById('sh-current')?.value)  || 0,
    elderly:  Number(document.getElementById('sh-elderly')?.value)  || 0,
    disabled: Number(document.getElementById('sh-disabled')?.value) || 0,
    infants:  Number(document.getElementById('sh-infants')?.value)  || 0,
    animals:  Number(document.getElementById('sh-animals')?.value)  || 0,
    needs,
    notes: document.getElementById('sh-notes')?.value.trim() || '',
  };

  if (!record.name) { alert('יש להזין שם למקלט'); return; }

  const shelters = getShelters();
  const idx      = shelters.findIndex(x => x.id === existingId);
  if (idx >= 0) shelters[idx] = record;
  else          shelters.push(record);

  saveShelters(shelters);
  document.getElementById('shelter-modal-overlay')?.remove();
  renderSheltersGrid();

  if (typeof logAudit === 'function')
    logAudit(existingId ? 'EDIT_SHELTER' : 'ADD_SHELTER', record.name, '');
}

function deleteShelter(id) {
  if (!confirm('למחוק מקלט זה?')) return;
  saveShelters(getShelters().filter(s => s.id !== id));
  renderSheltersGrid();
}

// ============================================================
// PART 3: RESIDENTS / EVACUEES
// ============================================================
const RESIDENT_STATUS_OPTS = ['לא ידוע','בבית','פונה','מאושפז','נעדר','בבית מלון','נפטר'];
const RESIDENT_GENDER_OPTS = ['זכר','נקבה','אחר'];

function getResidents()      { return safeGet(RESIDENTS_KEY); }
function saveResidents(arr)  { safeSet(RESIDENTS_KEY, arr); }

function initEvacueesTab() {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const r = btn.getAttribute('data-radius');
      activeRadiusFilter = r === 'all' ? 'all' : Number(r);
      renderEvacueesTable();
    });
  });
  renderEvacueesTable();
}

function getFilteredResidents() {
  const all = getResidents();
  if (!activeImpactPoint || activeRadiusFilter === 'all') return all;

  const { lat, lng } = activeImpactPoint;
  const maxR         = activeRadiusFilter;
  const minR         = maxR === 100 ? 0 : maxR === 200 ? 100 : 200;

  return all.filter(r => {
    if (!r.lat || !r.lng) return maxR >= 500;
    const d = haversineDistance(lat, lng, r.lat, r.lng);
    return d >= minR && d <= maxR;
  });
}

function renderEvacueesTable() {
  const container = document.getElementById('evacuees-table-container');
  if (!container) return;

  const residents = getFilteredResidents();

  if (!residents.length) {
    container.innerHTML = `
      <div style="padding:24px; text-align:center; color:#94a3b8">
        <div style="font-size:2rem; margin-bottom:8px">🏘️</div>
        אין תושבים ב${activeRadiusFilter === 'all' ? 'מאגר' : `טווח ${activeRadiusFilter} מ\' מנקודת הפגיעה`}.
        <br/><br/>
        <button onclick="openAddResidentModal()" class="btn-secondary write-only">+ הוסף תושב ידנית</button>
      </div>
    `;
    return;
  }

  // קיבוץ לפי בניין
  const byBuilding = {};
  residents.forEach(r => {
    const key = r.address || 'כתובת לא ידועה';
    if (!byBuilding[key]) byBuilding[key] = [];
    byBuilding[key].push(r);
  });

  let html = `
    <div style="overflow-x:auto">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px">
      <span style="color:#94a3b8; font-size:0.88rem">מוצגים ${residents.length} תושבים ב-${Object.keys(byBuilding).length} כתובות</span>
    </div>
    <table class="residents-table">
      <thead><tr>
        <th>שם מלא</th><th>כתובת</th><th>קומה</th><th>גיל</th><th>מין</th>
        <th>סטטוס</th><th>מרכז משפחות</th><th>עדכון אחרון</th>
        <th>חילוץ</th><th>עזרה ראשונה</th><th>חפ"ק</th><th>בע"ח</th>
        <th>פעולות</th>
      </tr></thead>
      <tbody>
  `;

  residents.forEach(r => {
    const statusColor = {
      'נעדר':'#ef4444','מאושפז':'#f97316','פונה':'#eab308',
      'בבית':'#22c55e','בבית מלון':'#3b82f6',
    }[r.status] || '#94a3b8';

    const phone = (r.household || []).find(m => ['אב','אם'].includes(m.relation))?.phone || '';

    html += `
      <tr class="resident-row" data-id="${r.id}">
        <td>
          <a href="javascript:void(0)" onclick="openResidentCard('${r.id}')" class="resident-name-link">${mEscape(r.fullName || '—')}</a>
          ${(r.household?.length > 0) ? `<span class="family-badge" onclick="toggleHousehold('${r.id}')">👨‍👩‍👧 ${r.household.length}</span>` : ''}
        </td>
        <td>
          <a href="javascript:void(0)" onclick="openBuildingCard('${mEscape(r.address || '')}')" class="address-link">${mEscape(r.address || '—')}</a>
        </td>
        <td>${mEscape(r.floor || '—')}</td>
        <td>${r.age || '—'}</td>
        <td>${mEscape(r.gender || '—')}</td>
        <td><span class="status-pill" style="background:${statusColor}22; color:${statusColor}; border-color:${statusColor}44">${mEscape(r.status || 'לא ידוע')}</span></td>
        <td style="font-size:0.82rem; color:#94a3b8">${mEscape(r.familyCenter || '—')}</td>
        <td style="font-size:0.78rem; color:#64748b">${r.lastUpdate ? new Date(r.lastUpdate).toLocaleString('he-IL') : '—'}</td>
        <td class="note-cell">${mEscape(r.rescueUnit || '')}</td>
        <td class="note-cell">${mEscape(r.firstAid || '')}</td>
        <td class="note-cell">${mEscape(r.hqNotes || '')}</td>
        <td class="note-cell">${mEscape(r.animals || '')}</td>
        <td>
          <div style="display:flex; gap:4px; flex-wrap:wrap">
            ${phone ? `<button class="action-btn" onclick="sendWhatsApp('${formatPhone(phone)}','${mEscape('שלום, זוהי הודעה מרשות החירום העירונית')}')" title="WhatsApp">📱</button>` : ''}
            ${phone ? `<button class="action-btn" onclick="openSmsModal('${formatPhone(phone)}')" title="SMS">💬</button>` : ''}
            <button class="action-btn write-only" onclick="openEditResidentModal('${r.id}')" title="עריכה">✏️</button>
            <button class="action-btn write-only" onclick="deleteResident('${r.id}')" title="מחיקה" style="color:#f87171">🗑️</button>
          </div>
        </td>
      </tr>
      <tr class="household-row" id="household-${r.id}" style="display:none">
        <td colspan="13" style="padding:0 16px 12px">
          ${buildHouseholdHTML(r)}
        </td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function buildHouseholdHTML(r) {
  const members = r.household || [];
  if (!members.length) return '<span style="color:#64748b; font-size:0.85rem">אין בני משפחה רשומים.</span>';

  return `
    <div class="household-box">
      <strong style="font-size:0.88rem; color:#7dd3fc">בני משפחה — ${mEscape(r.address || '')} קומה ${r.floor || '?'}</strong>
      <table style="width:100%; font-size:0.83rem; margin-top:8px; border-collapse:collapse">
        <thead><tr>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">שם</th>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">ת"ז</th>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">גיל</th>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">מין</th>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">קשר</th>
          <th style="color:#94a3b8; text-align:right; padding:4px 8px">טלפון</th>
        </tr></thead>
        <tbody>
          ${members.map(m => `
            <tr style="border-top:1px solid rgba(148,163,184,0.1)">
              <td style="padding:4px 8px; font-weight:500">${mEscape(m.name)}</td>
              <td style="padding:4px 8px; color:#94a3b8">${mEscape(m.idNumber || '—')}</td>
              <td style="padding:4px 8px">${m.age || '—'}</td>
              <td style="padding:4px 8px">${mEscape(m.gender || '—')}</td>
              <td style="padding:4px 8px">${mEscape(m.relation || '—')}</td>
              <td style="padding:4px 8px">
                ${(['אב','אם'].includes(m.relation) && m.phone)
                  ? `<a href="tel:${mEscape(m.phone)}" style="color:#7dd3fc">${mEscape(m.phone)}</a>`
                  : '—'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function toggleHousehold(id) {
  const row = document.getElementById(`household-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

// ---- ADD / EDIT RESIDENT MODAL ----
function openAddResidentModal()         { openResidentFormModal(null); }
function openEditResidentModal(id)      { openResidentFormModal(getResidents().find(r => r.id === id)); }

function openResidentFormModal(existing) {
  const r   = existing || {};
  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'resident-form-overlay';

  const centers    = getFamilyCenters();
  const centersOpts = centers.map(c => `<option value="${mEscape(c.name)}" ${r.familyCenter === c.name ? 'selected' : ''}>${mEscape(c.name)}</option>`).join('');

  ovl.innerHTML = `
    <div class="modal" style="max-width:700px; width:97%; max-height:92vh; overflow-y:auto">
      <h3>${r.id ? '✏️ עריכת תושב' : '➕ הוספת תושב'}</h3>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:12px">
        <input id="rf-fullname"   placeholder="שם מלא *"       value="${mEscape(r.fullName || '')}" />
        <input id="rf-id"         placeholder="ת&quot;ז"       value="${mEscape(r.idNumber || '')}" />
        <input id="rf-address"    placeholder="כתובת (רחוב + מס') *" value="${mEscape(r.address || '')}" />
        <input id="rf-floor"      placeholder="קומה"           value="${mEscape(r.floor || '')}" />
        <input id="rf-residence"  placeholder="סוג מגורים"     value="${mEscape(r.residence || '')}" />
        <input id="rf-age"        placeholder="גיל" type="number" min="0" max="120" value="${r.age || ''}" />
        <select id="rf-gender">
          <option value="">מין...</option>
          ${RESIDENT_GENDER_OPTS.map(g => `<option ${r.gender===g?'selected':''}>${g}</option>`).join('')}
        </select>
        <select id="rf-status">
          ${RESIDENT_STATUS_OPTS.map(s => `<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <input id="rf-children"   placeholder="מספר ילדים" type="number" min="0" value="${r.children || ''}" />
        <select id="rf-center" style="grid-column:span 2">
          <option value="">שיוך מרכז משפחות...</option>
          ${centersOpts}
        </select>
        <input id="rf-hotel"      placeholder="מלון (אם רלוונטי)" value="${mEscape(r.hotelName || '')}" />
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px">
        <textarea id="rf-rescue"   rows="2" placeholder="הערות יחידת חילוץ">${mEscape(r.rescueUnit || '')}</textarea>
        <textarea id="rf-firstaid" rows="2" placeholder="הערות עזרה ראשונה">${mEscape(r.firstAid || '')}</textarea>
        <textarea id="rf-hq"       rows="2" placeholder="הערות חפ&quot;ק עירוני">${mEscape(r.hqNotes || '')}</textarea>
        <textarea id="rf-animals"  rows="2" placeholder="בעלי חיים">${mEscape(r.animals || '')}</textarea>
      </div>

      <hr style="border-color:rgba(148,163,184,0.2); margin:12px 0" />
      <h4 style="color:#38bdf8; margin:0 0 10px">בני משפחה</h4>
      <div id="rf-household-list">${buildHouseholdFormHTML(r.household || [])}</div>
      <button type="button" class="btn-secondary" style="padding:7px 14px; font-size:0.85rem; margin-top:8px" onclick="addHouseholdMember()">+ הוסף בן משפחה</button>

      <div class="modal-buttons" style="margin-top:16px">
        <button onclick="saveResidentFromModal('${r.id || ''}')">💾 שמור תושב</button>
        <button class="btn-cancel" onclick="document.getElementById('resident-form-overlay')?.remove()">ביטול</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

function buildHouseholdFormHTML(members) {
  if (!members.length) return '<div id="rf-hh-container"></div>';
  return `<div id="rf-hh-container">${members.map((m, i) => householdRowHTML(i, m)).join('')}</div>`;
}

function householdRowHTML(i, m = {}) {
  const isParent = ['אב','אם'].includes(m.relation);
  const relations = ['אב','אם','בן','בת','סב','סבתא','אח','אחות','אחר'];
  return `
    <div class="hh-row" id="hh-row-${i}" style="display:grid; grid-template-columns:1fr 1fr 60px 80px 100px 120px auto; gap:8px; margin-bottom:8px; align-items:center">
      <input id="hh-name-${i}"     placeholder="שם"   value="${mEscape(m.name || '')}" />
      <input id="hh-id-${i}"       placeholder="ת&quot;ז" value="${mEscape(m.idNumber || '')}" />
      <input id="hh-age-${i}"      placeholder="גיל" type="number" min="0" max="120" value="${m.age || ''}" />
      <select id="hh-gender-${i}">
        ${RESIDENT_GENDER_OPTS.map(g => `<option ${m.gender===g?'selected':''}>${g}</option>`).join('')}
      </select>
      <select id="hh-relation-${i}" onchange="togglePhoneField(${i})">
        ${relations.map(rel => `<option ${m.relation===rel?'selected':''}>${rel}</option>`).join('')}
      </select>
      <input id="hh-phone-${i}" placeholder="טלפון" value="${mEscape(m.phone || '')}" style="${isParent ? '' : 'opacity:0.35; pointer-events:none'}" />
      <button type="button" onclick="removeHouseholdRow(${i})" style="background:rgba(239,68,68,0.2); color:#fca5a5; border:none; border-radius:6px; padding:5px 9px; cursor:pointer">✕</button>
    </div>
  `;
}

let householdCounter = 0;
function addHouseholdMember() {
  const container = document.getElementById('rf-hh-container');
  if (!container) return;
  const div = document.createElement('div');
  div.innerHTML = householdRowHTML(++householdCounter);
  container.appendChild(div.firstElementChild);
}

function removeHouseholdRow(i) {
  document.getElementById(`hh-row-${i}`)?.remove();
}

function togglePhoneField(i) {
  const rel = document.getElementById(`hh-relation-${i}`)?.value;
  const ph  = document.getElementById(`hh-phone-${i}`);
  if (!ph) return;
  const isParent = ['אב','אם'].includes(rel);
  ph.style.opacity        = isParent ? '1' : '0.35';
  ph.style.pointerEvents  = isParent ? '' : 'none';
  if (!isParent) ph.value = '';
}

function collectHousehold() {
  const container = document.getElementById('rf-hh-container');
  if (!container) return [];
  const rows = container.querySelectorAll('[id^="hh-row-"]');
  const members = [];
  rows.forEach(row => {
    const i = row.id.replace('hh-row-', '');
    const rel = document.getElementById(`hh-relation-${i}`)?.value || '';
    const member = {
      name:      (document.getElementById(`hh-name-${i}`)?.value || '').trim(),
      idNumber:  (document.getElementById(`hh-id-${i}`)?.value   || '').trim(),
      age:       Number(document.getElementById(`hh-age-${i}`)?.value) || 0,
      gender:    document.getElementById(`hh-gender-${i}`)?.value || '',
      relation:  rel,
      phone:     ['אב','אם'].includes(rel) ? (document.getElementById(`hh-phone-${i}`)?.value || '').trim() : '',
    };
    if (member.name) members.push(member);
  });
  return members;
}

async function saveResidentFromModal(existingId) {
  const address = (document.getElementById('rf-address')?.value || '').trim();
  const fullName = (document.getElementById('rf-fullname')?.value || '').trim();

  if (!fullName) { alert('יש להזין שם מלא'); return; }
  if (!address)  { alert('יש להזין כתובת'); return; }

  const record = {
    id:           existingId || genId(),
    fullName,
    idNumber:     (document.getElementById('rf-id')?.value || '').trim(),
    address,
    floor:        (document.getElementById('rf-floor')?.value || '').trim(),
    residence:    (document.getElementById('rf-residence')?.value || '').trim(),
    age:          Number(document.getElementById('rf-age')?.value) || null,
    gender:       document.getElementById('rf-gender')?.value || '',
    status:       document.getElementById('rf-status')?.value || 'לא ידוע',
    children:     Number(document.getElementById('rf-children')?.value) || 0,
    familyCenter: document.getElementById('rf-center')?.value || '',
    hotelName:    (document.getElementById('rf-hotel')?.value || '').trim(),
    rescueUnit:   (document.getElementById('rf-rescue')?.value || '').trim(),
    firstAid:     (document.getElementById('rf-firstaid')?.value || '').trim(),
    hqNotes:      (document.getElementById('rf-hq')?.value || '').trim(),
    animals:      (document.getElementById('rf-animals')?.value || '').trim(),
    household:    collectHousehold(),
    lastUpdate:   new Date().toISOString(),
    lat:          null,
    lng:          null,
  };

  // geocode אם אין קואורדינטות (ניסיון ראשוני)
  const existing = getResidents().find(r => r.id === existingId);
  if (existing?.lat) {
    record.lat = existing.lat;
    record.lng = existing.lng;
  } else {
    const coords = await geocodeAddress(address + ', בת ים, ישראל');
    if (coords) { record.lat = coords.lat; record.lng = coords.lng; }
  }

  const residents = getResidents();
  const idx = residents.findIndex(r => r.id === existingId);
  if (idx >= 0) residents[idx] = record;
  else          residents.push(record);

  saveResidents(residents);
  document.getElementById('resident-form-overlay')?.remove();
  renderEvacueesTable();
  renderHotelsTab();

  if (typeof logAudit === 'function')
    logAudit(existingId ? 'EDIT_RESIDENT' : 'ADD_RESIDENT', record.fullName, record.address);
}

function deleteResident(id) {
  const r = getResidents().find(x => x.id === id);
  if (!r || !confirm(`למחוק את ${r.fullName}?`)) return;
  saveResidents(getResidents().filter(x => x.id !== id));
  renderEvacueesTable();
  renderHotelsTab();
  if (typeof logAudit === 'function') logAudit('DELETE_RESIDENT', r.fullName, r.address);
}

// ============================================================
// PART 4: CSV / EXCEL IMPORT
// ============================================================
const CSV_COLUMN_MAP = {
  fullName:     ['שם מלא','שם','name','full_name','fullname'],
  idNumber:     ['ת"ז','תז','id','id_number','מספר זהות'],
  address:      ['כתובת','address','רחוב'],
  floor:        ['קומה','floor'],
  residence:    ['סוג מגורים','residence','מגורים'],
  age:          ['גיל','age'],
  gender:       ['מין','gender','sex'],
  status:       ['סטטוס','status'],
  children:     ['ילדים','children'],
  familyCenter: ['מרכז משפחות','family_center'],
  phone:        ['טלפון','phone','tel'],
};

async function importResidentsFile(file) {
  if (!file) return;

  const container = document.getElementById('evacuees-table-container');
  if (container) container.innerHTML = `<div style="padding:24px; text-align:center; color:#7dd3fc">⏳ מייבא נתונים... (${file.name})</div>`;

  try {
    let rows;
    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      rows = parseCSV(text);
    } else {
      rows = await parseExcel(file);
    }

    if (!rows.length) { alert('לא נמצאו שורות בקובץ'); renderEvacueesTable(); return; }

    const headers = Object.keys(rows[0]);
    const mapping  = autoMapColumns(headers);

    // הצג מסך תיאום עמודות
    openColumnMappingModal(rows, mapping);
  } catch (err) {
    alert('שגיאה בייבוא: ' + err.message);
    renderEvacueesTable();
  }
}

function parseCSV(text) {
  const lines  = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

async function parseExcel(file) {
  return new Promise((resolve, reject) => {
    if (typeof XLSX === 'undefined') { reject(new Error('ספריית Excel לא נטענה')); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { defval: '' }));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function autoMapColumns(headers) {
  const mapping = {};
  for (const [field, aliases] of Object.entries(CSV_COLUMN_MAP)) {
    const match = headers.find(h =>
      aliases.some(a => h.toLowerCase().includes(a.toLowerCase()))
    );
    if (match) mapping[field] = match;
  }
  return mapping;
}

function openColumnMappingModal(rows, mapping) {
  const headers = Object.keys(rows[0]);
  const fieldLabels = {
    fullName:'שם מלא *', idNumber:'ת"ז', address:'כתובת *', floor:'קומה',
    residence:'סוג מגורים', age:'גיל', gender:'מין', status:'סטטוס',
    children:'ילדים', familyCenter:'מרכז משפחות', phone:'טלפון (ראש משפחה)'
  };

  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'col-map-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:620px; width:96%">
      <h3>📋 תיאום עמודות — ${rows.length} שורות</h3>
      <p style="color:#94a3b8; font-size:0.88rem; margin-bottom:16px">אשר את תיאום העמודות בין הקובץ לשדות המערכת:</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px">
        ${Object.entries(fieldLabels).map(([field, label]) => `
          <div>
            <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:4px">${label}</div>
            <select id="cm-${field}">
              <option value="">-- לא מתואם --</option>
              ${headers.map(h => `<option value="${mEscape(h)}" ${mapping[field]===h?'selected':''}>${mEscape(h)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
      <div class="modal-buttons">
        <button onclick="executeImport(${JSON.stringify(rows).replace(/"/g,'&quot;')})">✅ ייבא ${rows.length} תושבים</button>
        <button class="btn-cancel" onclick="document.getElementById('col-map-overlay')?.remove(); renderEvacueesTable()">ביטול</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) { ovl.remove(); renderEvacueesTable(); } });
  document.body.appendChild(ovl);
}

async function executeImport(rows) {
  const getVal = (row, field) => {
    const col = document.getElementById(`cm-${field}`)?.value;
    return col ? (row[col] || '') : '';
  };

  const residents = getResidents();
  let added = 0;

  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#1e293b; border:1px solid rgba(56,189,248,0.4); border-radius:12px; padding:14px 20px; z-index:9998; color:#e2e8f0; font-size:0.9rem';
  bar.id = 'import-progress';
  document.body.appendChild(bar);

  for (let i = 0; i < rows.length; i++) {
    bar.textContent = `⏳ מייבא שורה ${i + 1} / ${rows.length}...`;

    const row    = rows[i];
    const addr   = getVal(row, 'address');
    const name   = getVal(row, 'fullName');
    if (!name && !addr) continue;

    const phone  = getVal(row, 'phone');
    const record = {
      id:           genId(),
      fullName:     name,
      idNumber:     getVal(row, 'idNumber'),
      address:      addr,
      floor:        getVal(row, 'floor'),
      residence:    getVal(row, 'residence'),
      age:          Number(getVal(row, 'age')) || null,
      gender:       getVal(row, 'gender'),
      status:       getVal(row, 'status') || 'לא ידוע',
      children:     Number(getVal(row, 'children')) || 0,
      familyCenter: getVal(row, 'familyCenter'),
      household:    phone ? [{ name, relation: 'אב', phone }] : [],
      lastUpdate:   new Date().toISOString(),
      lat:          null, lng: null,
    };

    if (addr) {
      await new Promise(r => setTimeout(r, 800)); // Nominatim rate limit
      const coords = await geocodeAddress(addr + ', בת ים, ישראל');
      if (coords) { record.lat = coords.lat; record.lng = coords.lng; }
    }

    residents.push(record);
    added++;
  }

  saveResidents(residents);
  bar.remove();
  document.getElementById('col-map-overlay')?.remove();
  renderEvacueesTable();
  renderHotelsTab();
  alert(`✅ יובאו ${added} תושבים בהצלחה.`);

  if (typeof logAudit === 'function')
    logAudit('IMPORT_RESIDENTS', 'system', `יובאו ${added} תושבים`);
}

// ============================================================
// PART 5: GEOCODING
// ============================================================
async function geocodeAddress(query) {
  const cache = (() => { try { return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || '{}'); } catch { return {}; } })();
  if (cache[query]) return cache[query];

  try {
    const proxyBase = window.location.origin + '/api/proxy';
    const response  = await fetch(proxyBase, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query),
        method: 'GET',
      }),
    });
    const data = await response.json();
    if (!Array.isArray(data) || !data[0]) return null;
    const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    cache[query] = result;
    try { localStorage.setItem(GEOCACHE_KEY, JSON.stringify(cache)); } catch {}
    return result;
  } catch {
    return null;
  }
}

// ============================================================
// PART 6: MESSAGING — WhatsApp + SMS
// ============================================================
const MSG_TEMPLATES = [
  { label: 'הנחיית פינוי', text: 'שלום, ברשות החירום העירונית של בת ים. אנא התפנו בהקדם לכתובת: __מרכז__. יש להביא מסמכים ותרופות ל-72 שעות.' },
  { label: 'עדכון מצב',    text: 'עדכון מרשות החירום: המצב ב__רחוב__ בטיפול. ניתן לחזור לבית בעוד שעתיים. אנא המתינו להנחיות.' },
  { label: 'הזמנה לבדיקה', text: 'שלום, נציג רשות החירום יגיע לדירתכם ב__כתובת__ בשעה __שעה__ לבדיקת מצב.' },
  { label: 'הודעה כללית',  text: '' },
];

function sendWhatsApp(phone, defaultMsg) {
  openMessageModal(phone, 'whatsapp', defaultMsg);
}

function openSmsModal(phone) {
  openMessageModal(phone, 'sms', '');
}

function openMessageModal(phone, channel, defaultMsg) {
  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'msg-modal-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:520px; width:96%">
      <h3>${channel === 'whatsapp' ? '📱 WhatsApp' : '💬 SMS'} — ${phone}</h3>
      <div style="margin-bottom:12px">
        <div style="font-size:0.85rem; color:#94a3b8; margin-bottom:6px">בחר תבנית:</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px">
          ${MSG_TEMPLATES.map((t, i) => `
            <button class="marker-chip" onclick="setMsgTemplate(${i})">${t.label}</button>
          `).join('')}
        </div>
      </div>
      <textarea id="msg-text" rows="5" placeholder="הקלד הודעה...">${mEscape(defaultMsg || '')}</textarea>
      <div class="modal-buttons" style="margin-top:14px">
        <button onclick="sendMessage('${phone}', '${channel}')">שלח</button>
        <button class="btn-cancel" onclick="document.getElementById('msg-modal-overlay')?.remove()">ביטול</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

function setMsgTemplate(i) {
  const ta = document.getElementById('msg-text');
  if (ta) ta.value = MSG_TEMPLATES[i]?.text || '';
}

function sendMessage(phone, channel) {
  const text = (document.getElementById('msg-text')?.value || '').trim();
  if (!text) { alert('יש לכתוב הודעה'); return; }

  const intlPhone = phone.replace(/^0/, '972');

  if (channel === 'whatsapp') {
    window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  } else {
    const a   = document.createElement('a');
    a.href    = `sms:${phone}?body=${encodeURIComponent(text)}`;
    a.click();
    try { navigator.clipboard.writeText(text); } catch {}
  }

  document.getElementById('msg-modal-overlay')?.remove();
  if (typeof logAudit === 'function')
    logAudit(`SEND_${channel.toUpperCase()}`, phone, text.slice(0, 80));
}

// ============================================================
// PART 7: INFRASTRUCTURE TAB
// ============================================================
const INFRA_CATEGORIES  = ['חשמל','מים','גז','כבישים','תקשורת','ביוב','אחר'];
const INFRA_STATUSES    = ['תקין','מושבת','חלקי','לא ידוע'];
const INFRA_STATUS_COLORS = { 'תקין':'#22c55e', 'מושבת':'#ef4444', 'חלקי':'#f97316', 'לא ידוע':'#94a3b8' };

function getInfra()      { return safeGet(INFRA_KEY); }
function saveInfra(arr)  { safeSet(INFRA_KEY, arr); }

function initInfraTab() { renderInfraTable(); }

function renderInfraTable() {
  const container = document.getElementById('infra-table-container');
  if (!container) return;
  const items = getInfra();

  if (!items.length) {
    container.innerHTML = `<div style="padding:24px; text-align:center; color:#94a3b8">אין פריטי תשתית מוגדרים.<br/><br/><button onclick="openAddInfraModal()" class="btn-secondary write-only">+ הוסף פריט</button></div>`;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x:auto">
    <table style="width:100%; border-collapse:collapse; font-size:0.88rem">
      <thead><tr>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">קטגוריה</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">תיאור</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">מיקום</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">סטטוס</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">קצין אחראי</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">הערות</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">עדכון אחרון</th>
        <th style="color:#94a3b8; padding:10px 8px; text-align:right">פעולות</th>
      </tr></thead>
      <tbody>
        ${items.map(item => {
          const sc = INFRA_STATUS_COLORS[item.status] || '#94a3b8';
          return `
            <tr style="border-top:1px solid rgba(148,163,184,0.1)" class="${item.status==='מושבת'?'infra-row-critical':''}">
              <td style="padding:10px 8px"><span class="status-pill status-default">${mEscape(item.category)}</span></td>
              <td style="padding:10px 8px; font-weight:500">${mEscape(item.name)}</td>
              <td style="padding:10px 8px; color:#94a3b8">${mEscape(item.location)}</td>
              <td style="padding:10px 8px">
                <span class="status-pill" style="background:${sc}22; color:${sc}; border-color:${sc}44">${mEscape(item.status)}</span>
              </td>
              <td style="padding:10px 8px; color:#94a3b8">${mEscape(item.officer || '—')}</td>
              <td style="padding:10px 8px; color:#cbd5e1; font-size:0.83rem">${mEscape(item.notes || '—')}</td>
              <td style="padding:10px 8px; color:#64748b; font-size:0.8rem">${item.updatedAt ? new Date(item.updatedAt).toLocaleString('he-IL') : '—'}</td>
              <td style="padding:10px 8px">
                <div style="display:flex; gap:5px">
                  <button class="action-btn write-only" onclick="openEditInfraModal('${item.id}')">✏️</button>
                  <button class="action-btn write-only" onclick="deleteInfraItem('${item.id}')" style="color:#f87171">🗑️</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function openAddInfraModal(existing) {
  const item = existing || {};
  const ovl  = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'infra-modal-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:520px; width:96%">
      <h3>${item.id ? '✏️ עריכת תשתית' : '⚡ הוסף פריט תשתית'}</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px">
        <select id="inf-cat">
          ${INFRA_CATEGORIES.map(c => `<option ${item.category===c?'selected':''}>${c}</option>`).join('')}
        </select>
        <input id="inf-name"     placeholder="תיאור / שם" value="${mEscape(item.name || '')}" />
        <input id="inf-location" placeholder="מיקום"       value="${mEscape(item.location || '')}" />
        <select id="inf-status">
          ${INFRA_STATUSES.map(s => `<option ${item.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <input id="inf-officer"  placeholder="קצין אחראי"  value="${mEscape(item.officer || '')}" style="grid-column:span 2"/>
      </div>
      <textarea id="inf-notes" rows="2" placeholder="הערות">${mEscape(item.notes || '')}</textarea>
      <div class="modal-buttons">
        <button onclick="saveInfraFromModal('${item.id || ''}')">💾 שמור</button>
        <button class="btn-cancel" onclick="document.getElementById('infra-modal-overlay')?.remove()">ביטול</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

function openEditInfraModal(id) {
  openAddInfraModal(getInfra().find(x => x.id === id));
}

function saveInfraFromModal(existingId) {
  const record = {
    id:        existingId || genId(),
    category:  document.getElementById('inf-cat')?.value     || '',
    name:      (document.getElementById('inf-name')?.value   || '').trim(),
    location:  (document.getElementById('inf-location')?.value || '').trim(),
    status:    document.getElementById('inf-status')?.value  || 'לא ידוע',
    officer:   (document.getElementById('inf-officer')?.value || '').trim(),
    notes:     (document.getElementById('inf-notes')?.value  || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!record.name) { alert('יש להזין תיאור'); return; }
  const items = getInfra();
  const idx   = items.findIndex(x => x.id === existingId);
  if (idx >= 0) items[idx] = record; else items.push(record);
  saveInfra(items);
  document.getElementById('infra-modal-overlay')?.remove();
  renderInfraTable();
}

function deleteInfraItem(id) {
  if (!confirm('למחוק פריט זה?')) return;
  saveInfra(getInfra().filter(x => x.id !== id));
  renderInfraTable();
}

// ============================================================
// PART 8: HOTELS TAB
// ============================================================
function renderHotelsTab() {
  const container = document.getElementById('hotels-cards-container');
  if (!container) return;

  const residents = getResidents().filter(r => r.hotelName);
  if (!residents.length) {
    container.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8">אין תושבים ששויכו למלון עדיין.<br/>שייך תושבים למלון בלשונית מפונים.</div>';
    return;
  }

  // קיבוץ לפי מלון
  const byHotel = {};
  residents.forEach(r => {
    const key = r.hotelName.trim();
    if (!byHotel[key]) byHotel[key] = [];
    byHotel[key].push(r);
  });

  // עדכן dropdown
  const sel    = document.getElementById('hotelFilterSelect');
  const filter = sel?.value || 'all';
  if (sel) {
    const existing = new Set(Array.from(sel.options).map(o => o.value));
    Object.keys(byHotel).forEach(h => {
      if (!existing.has(h)) {
        const opt   = document.createElement('option');
        opt.value   = h;
        opt.textContent = h;
        sel.appendChild(opt);
      }
    });
  }

  const hotelsToShow = filter === 'all' ? Object.entries(byHotel)
    : Object.entries(byHotel).filter(([name]) => name === filter);

  container.innerHTML = hotelsToShow.map(([hotelName, guests]) => {
    const souls    = guests.reduce((s, r) => s + 1 + (r.household?.length || 0), 0);
    const families = guests.length;
    const checkins = guests.filter(r => r.hotelCheckIn).map(r => new Date(r.hotelCheckIn));
    const avgDays  = checkins.length
      ? Math.round(checkins.reduce((s, d) => s + (Date.now() - d) / 86400000, 0) / checkins.length)
      : null;

    return `
      <div class="panel" style="margin-bottom:16px">
        <div class="panel-head">
          <h2>🏨 ${mEscape(hotelName)}</h2>
          <div style="display:flex; gap:12px; flex-wrap:wrap">
            <span class="status-pill status-default">👨‍👩‍👧 ${families} משפחות</span>
            <span class="status-pill status-default">👤 ${souls} נפשות</span>
            ${avgDays !== null ? `<span class="status-pill status-default">📅 ממוצע ${avgDays} ימים</span>` : ''}
          </div>
        </div>
        <div style="overflow-x:auto; margin-top:14px">
        <table style="width:100%; border-collapse:collapse; font-size:0.88rem">
          <thead><tr>
            <th style="color:#94a3b8; padding:8px; text-align:right">שם</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">כתובת מקורית</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">נפשות</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">צ'ק אין</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">סטטוס</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">הערות</th>
            <th style="color:#94a3b8; padding:8px; text-align:right">פעולות</th>
          </tr></thead>
          <tbody>
            ${guests.map(r => `
              <tr style="border-top:1px solid rgba(148,163,184,0.1)">
                <td style="padding:8px; font-weight:500">
                  <a href="javascript:void(0)" onclick="openResidentCard('${r.id}')" class="resident-name-link">${mEscape(r.fullName)}</a>
                </td>
                <td style="padding:8px; color:#94a3b8">${mEscape(r.address)}</td>
                <td style="padding:8px">${1 + (r.household?.length || 0)}</td>
                <td style="padding:8px; color:#94a3b8; font-size:0.82rem">${r.hotelCheckIn ? new Date(r.hotelCheckIn).toLocaleDateString('he-IL') : '—'}</td>
                <td style="padding:8px">${mEscape(r.status || '—')}</td>
                <td style="padding:8px; color:#94a3b8; font-size:0.82rem">${mEscape(r.hotelNotes || '—')}</td>
                <td style="padding:8px">
                  <button class="action-btn write-only" onclick="openEditResidentModal('${r.id}')">✏️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// PART 9: BUILDING CARD
// ============================================================
function openBuildingCard(address) {
  if (!address) return;
  const residents   = getResidents().filter(r => r.address === address);
  const byFloor     = {};
  residents.forEach(r => {
    const fl = r.floor || '?';
    if (!byFloor[fl]) byFloor[fl] = [];
    byFloor[fl].push(r);
  });

  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'building-card-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:780px; width:97%; max-height:92vh; overflow-y:auto">
      <h3>🏢 כרטיס בניין — ${mEscape(address)}</h3>
      <p style="color:#94a3b8; font-size:0.88rem">${residents.length} תושבים רשומים</p>

      ${Object.entries(byFloor).sort(([a],[b]) => {
        const na = Number(a), nb = Number(b);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      }).map(([floor, flResidents]) => `
        <div style="margin-bottom:16px">
          <div style="font-size:0.88rem; font-weight:600; color:#7dd3fc; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid rgba(56,189,248,0.2)">
            קומה ${mEscape(floor)} — ${flResidents.length} תושבים
          </div>
          <div style="display:grid; gap:8px">
            ${flResidents.map(r => {
              const statusColor = {'נעדר':'#ef4444','מאושפז':'#f97316','פונה':'#eab308','בבית':'#22c55e','בבית מלון':'#3b82f6'}[r.status] || '#94a3b8';
              const phone = (r.household || []).find(m => ['אב','אם'].includes(m.relation))?.phone || '';
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(30,41,59,0.6); border-radius:10px; padding:10px 14px; border:1px solid rgba(148,163,184,0.15)">
                  <div>
                    <a href="javascript:void(0)" onclick="openResidentCard('${r.id}')" class="resident-name-link" style="font-weight:500">${mEscape(r.fullName || '—')}</a>
                    <span style="margin-right:10px; font-size:0.82rem; color:#64748b">${r.age ? r.age + ' שנה' : ''} ${mEscape(r.gender || '')}</span>
                    ${r.hotelName ? `<span class="status-pill" style="font-size:0.75rem; background:rgba(59,130,246,0.15); color:#93c5fd">🏨 ${mEscape(r.hotelName)}</span>` : ''}
                  </div>
                  <div style="display:flex; align-items:center; gap:8px">
                    <span class="status-pill" style="font-size:0.78rem; background:${statusColor}22; color:${statusColor}">${mEscape(r.status || 'לא ידוע')}</span>
                    ${phone ? `<a href="tel:${mEscape(phone)}" style="color:#7dd3fc; font-size:0.85rem">📞 ${mEscape(phone)}</a>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('')}

      <div class="modal-buttons" style="margin-top:8px">
        <button class="btn-cancel" onclick="document.getElementById('building-card-overlay')?.remove()">סגור</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

// ============================================================
// PART 10: RESIDENT CARD
// ============================================================
function openResidentCard(id) {
  const r = getResidents().find(x => x.id === id);
  if (!r) return;

  const phone = (r.household || []).find(m => ['אב','אם'].includes(m.relation))?.phone || '';
  const statusColor = {'נעדר':'#ef4444','מאושפז':'#f97316','פונה':'#eab308','בבית':'#22c55e','בבית מלון':'#3b82f6'}[r.status] || '#94a3b8';

  const ovl = document.createElement('div');
  ovl.className = 'modal-overlay';
  ovl.id = 'resident-card-overlay';
  ovl.innerHTML = `
    <div class="modal" style="max-width:680px; width:97%; max-height:92vh; overflow-y:auto">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:16px">
        <div>
          <h3 style="margin:0 0 6px">${mEscape(r.fullName || 'תושב')}</h3>
          <span class="status-pill" style="background:${statusColor}22; color:${statusColor}; border-color:${statusColor}44">${mEscape(r.status || 'לא ידוע')}</span>
        </div>
        <div style="display:flex; gap:6px">
          ${phone ? `<button class="btn-secondary" onclick="sendWhatsApp('${formatPhone(phone)}','')">📱</button>` : ''}
          ${phone ? `<button class="btn-secondary" onclick="openSmsModal('${formatPhone(phone)}')">💬</button>` : ''}
          <button class="btn-secondary write-only" onclick="document.getElementById('resident-card-overlay')?.remove(); openEditResidentModal('${r.id}')">✏️ ערוך</button>
        </div>
      </div>

      <!-- פרטים -->
      <div class="resident-card-grid">
        ${residentCardField('📍 כתובת', r.address)}
        ${residentCardField('🏢 קומה', r.floor)}
        ${residentCardField('🏠 סוג מגורים', r.residence)}
        ${residentCardField('🪪 ת"ז', r.idNumber)}
        ${residentCardField('👤 גיל', r.age)}
        ${residentCardField('⚥ מין', r.gender)}
        ${residentCardField('👶 ילדים', r.children)}
        ${residentCardField('🏢 מרכז משפחות', r.familyCenter)}
        ${r.hotelName ? residentCardField('🏨 מלון', r.hotelName + (r.hotelCheckIn ? ` (מ-${new Date(r.hotelCheckIn).toLocaleDateString('he-IL')})` : '')) : ''}
      </div>

      <!-- בני משפחה -->
      ${(r.household?.length > 0) ? `
        <h4 style="color:#7dd3fc; margin:16px 0 8px">👨‍👩‍👧 בני משפחה (${r.household.length})</h4>
        ${buildHouseholdHTML(r)}
      ` : ''}

      <!-- הערות מבצעיות -->
      ${(r.rescueUnit || r.firstAid || r.hqNotes || r.animals) ? `
        <h4 style="color:#7dd3fc; margin:16px 0 8px">📋 הערות מבצעיות</h4>
        <div style="display:grid; gap:8px">
          ${r.rescueUnit ? `<div class="op-note"><strong>🚒 חילוץ:</strong> ${mEscape(r.rescueUnit)}</div>` : ''}
          ${r.firstAid   ? `<div class="op-note"><strong>🩺 עזרה ראשונה:</strong> ${mEscape(r.firstAid)}</div>` : ''}
          ${r.hqNotes    ? `<div class="op-note"><strong>🏛️ חפ"ק:</strong> ${mEscape(r.hqNotes)}</div>` : ''}
          ${r.animals    ? `<div class="op-note"><strong>🐾 בע"ח:</strong> ${mEscape(r.animals)}</div>` : ''}
        </div>
      ` : ''}

      <div style="margin-top:16px; color:#64748b; font-size:0.8rem">
        עדכון אחרון: ${r.lastUpdate ? new Date(r.lastUpdate).toLocaleString('he-IL') : '—'}
      </div>

      <div class="modal-buttons" style="margin-top:16px">
        <button class="btn-cancel" onclick="document.getElementById('resident-card-overlay')?.remove()">סגור</button>
      </div>
    </div>
  `;
  ovl.addEventListener('click', e => { if (e.target === ovl) ovl.remove(); });
  document.body.appendChild(ovl);
}

function residentCardField(label, val) {
  if (!val && val !== 0) return '';
  return `
    <div class="rc-field">
      <div class="rc-label">${label}</div>
      <div class="rc-value">${mEscape(String(val))}</div>
    </div>
  `;
}

// ============================================================
// PART 11: RED ALERT
// ============================================================
const RED_ALERT_URL      = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
const RED_ALERT_INTERVAL = 5000;
let   redAlertTimer      = null;
let   lastAlertId        = null;
let   alertAudio         = null;

function startRedAlertPolling() {
  if (redAlertTimer) return;
  redAlertTimer = setInterval(pollRedAlert, RED_ALERT_INTERVAL);
  pollRedAlert();
}

async function pollRedAlert() {
  try {
    const proxyBase = window.location.origin + '/api/proxy';
    const res       = await fetch(proxyBase, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: RED_ALERT_URL, method: 'GET', headers: {
        'Referer':          'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
      }}),
    });
    const data = await res.json();
    if (!data || !data.id) return;
    if (data.id === lastAlertId) return;
    lastAlertId = data.id;

    const cities   = data.data || [];
    const isLocal  = cities.some(c => String(c).includes('בת ים') || String(c).includes('bat yam'));

    showAlertBanner(data, isLocal);
    if (isLocal) triggerLocalAlert(data);
  } catch {}
}

function showAlertBanner(data, isLocal) {
  document.querySelectorAll('.red-alert-banner').forEach(el => el.remove());

  const banner = document.createElement('div');
  banner.className = 'red-alert-banner' + (isLocal ? ' red-alert-local' : '');
  banner.innerHTML = `
    <strong>${isLocal ? '🚨 אזעקה בבת ים!' : '⚠️ אזעקה באזור'}</strong>
    <span>${mEscape((data.data || []).slice(0, 5).join(', '))}${(data.data||[]).length > 5 ? ' ועוד...' : ''}</span>
    <button onclick="this.parentElement.remove()" style="background:none; border:none; color:inherit; font-size:1.1rem; cursor:pointer; padding:2px 6px">✕</button>
  `;
  document.body.prepend(banner);
}

function triggerLocalAlert(data) {
  // השמע צליל
  if (!alertAudio) alertAudio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAA...');
  alertAudio.play().catch(() => {});

  // יצירת אירוע אוטומטי בלוג (דרך הפונקציה של emergency_dashboard.js)
  if (typeof appendEventWithFallback === 'function') {
    const base = (document.getElementById('webappUrl')?.value || '').trim();
    if (base) {
      appendEventWithFallback(base, {
        timestamp:      new Date().toISOString(),
        sender:         'מערכת',
        message:        `🚨 אזעקה אדומה — ${(data.data||[]).join(', ')}`,
        classification: 'מבצעים',
        status:         'חירום',
        chat_type:      'auto',
        source:         'פיקוד העורף',
      }).catch(() => {});
    }
  }
}

// ============================================================
// PART 12: TAB INITIALIZATION HOOKS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  startRedAlertPolling();

  // כשמסמנים נקודה על המפה — hook לעדכון מרכזי משפחות
  // emergency_dashboard.js קורא ל-onImpactPointSet אחרי addMapPoint
});

// Hook: emergency_dashboard.js צריך לקרוא לזה לאחר addMapPoint מסוג פגיעה
function notifyImpactPoint(lat, lng, label, type) {
  if (['rocket','damaged_building'].includes(type)) {
    onImpactPointSet(lat, lng, label);
  }
}

// ============================================================
// PART 13: DASHBOARD WITH CHARTS
// ============================================================
let dashCharts = {};

function initDashboardTab() {
  renderDashboardKPIs();
  renderDashboardCharts();
}

function renderDashboardKPIs() {
  const residents = getResidents();
  const infra     = getInfra();
  const shelters  = getShelters();

  // אירועים — קרא מהטבלה הקיימת
  const eventsRows = document.querySelectorAll('#eventsBody tr');
  const totalEvents = Math.max(0, eventsRows.length - (eventsRows[0]?.querySelector('td[colspan]') ? 1 : 0));
  const openEvents  = Array.from(eventsRows).filter(tr => {
    const cells = tr.querySelectorAll('td');
    return cells[1]?.textContent.includes('חירום') || cells[1]?.textContent.includes('בטיפול');
  }).length;

  const injured    = Number(document.getElementById('statusKpiInjured')?.textContent) || 0;
  const infraDown  = infra.filter(i => i.status === 'מושבת').length;
  const activeShelters = shelters.filter(s => (s.current || 0) > 0).length;

  setKPI('dkpi-events',   totalEvents);
  setKPI('dkpi-open',     openEvents,    openEvents > 0 ? '#ef4444' : '#22c55e');
  setKPI('dkpi-injured',  injured,       injured > 0 ? '#f97316' : '#22c55e');
  setKPI('dkpi-evacuees', residents.length);
  setKPI('dkpi-shelters', activeShelters);
  setKPI('dkpi-infra',    infraDown,     infraDown > 0 ? '#ef4444' : '#22c55e');
}

function setKPI(id, val, color) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = el.querySelector('.dkpi-val');
  if (valEl) {
    valEl.textContent = String(val);
    if (color) valEl.style.color = color;
  }
}

function renderDashboardCharts() {
  if (typeof Chart === 'undefined') return;

  Chart.defaults.color          = '#94a3b8';
  Chart.defaults.borderColor    = 'rgba(148,163,184,0.15)';
  Chart.defaults.font.family    = 'Rubik, Arial, sans-serif';

  renderCategoryChart();
  renderTimelineChart();
  renderResidentsChart();
  renderSheltersChart();
}

function renderCategoryChart() {
  const ctx = document.getElementById('chart-categories');
  if (!ctx) return;

  // ספור אירועים מהטבלה
  const counts = {};
  document.querySelectorAll('#eventsBody tr td:nth-child(3)').forEach(td => {
    const cat = td.textContent.trim();
    if (cat) counts[cat] = (counts[cat] || 0) + 1;
  });

  const labels = Object.keys(counts);
  const data   = Object.values(counts);

  destroyChart('categories');
  dashCharts['categories'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#3b82f6','#ef4444','#22c55e','#f97316','#a855f7','#06b6d4'],
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function renderTimelineChart() {
  const ctx = document.getElementById('chart-timeline');
  if (!ctx) return;

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const counts = new Array(24).fill(0);

  document.querySelectorAll('#eventsBody tr td:first-child').forEach(td => {
    const text = td.textContent.trim();
    if (!text || text === 'זמן') return;
    const date = new Date(text.replace(' ', 'T'));
    if (!isNaN(date)) counts[date.getHours()]++;
  });

  destroyChart('timeline');
  dashCharts['timeline'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours.map(h => `${String(h).padStart(2,'0')}:00`),
      datasets: [{
        data:         counts,
        borderColor:  '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.12)',
        fill:         true,
        tension:      0.4,
        pointRadius:  3,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function renderResidentsChart() {
  const ctx = document.getElementById('chart-residents');
  if (!ctx) return;

  const counts = {};
  getResidents().forEach(r => {
    const s = r.status || 'לא ידוע';
    counts[s] = (counts[s] || 0) + 1;
  });

  const COLORS = { 'בבית':'#22c55e','פונה':'#eab308','מאושפז':'#f97316','נעדר':'#ef4444','בבית מלון':'#3b82f6','נפטר':'#6b7280','לא ידוע':'#94a3b8' };

  destroyChart('residents');
  dashCharts['residents'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   Object.keys(counts),
      datasets: [{
        data:            Object.values(counts),
        backgroundColor: Object.keys(counts).map(k => COLORS[k] || '#94a3b8'),
        borderWidth:     2,
        borderColor:     'rgba(15,23,42,0.8)',
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right', labels: { font: { size: 11 }, padding: 10 } },
      },
    },
  });
}

function renderSheltersChart() {
  const ctx = document.getElementById('chart-shelters');
  if (!ctx) return;

  const shelters = getShelters();
  if (!shelters.length) { ctx.parentElement.innerHTML = '<h3>תפוסת מקלטים</h3><p style="color:#64748b; padding:20px; text-align:center">אין מקלטים מוגדרים</p>'; return; }

  destroyChart('shelters');
  dashCharts['shelters'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: shelters.map(s => s.name),
      datasets: [
        { label: 'תפוסה נוכחית', data: shelters.map(s => s.current || 0), backgroundColor: '#38bdf8', borderRadius: 6 },
        { label: 'קיבולת',       data: shelters.map(s => s.capacity || 0), backgroundColor: 'rgba(148,163,184,0.2)', borderRadius: 6 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { stepSize: 10 } },
      },
    },
  });
}

function destroyChart(name) {
  if (dashCharts[name]) {
    dashCharts[name].destroy();
    delete dashCharts[name];
  }
}
