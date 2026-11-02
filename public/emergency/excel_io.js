'use strict';
// ============================================================
// excel_io.js — ייבוא וייצוא Excel עם עדכון רשומות קיימות (upsert)
// מקלטים (+ דיירים), תושבים/מפונים (+ בני בית).
// עיקרון: מייצאים → עורכים באקסל → מייבאים; שורה עם "מזהה מערכת" מעדכנת את אותה רשומה,
// ושורה בלי מזהה מותאמת לפי שם (מקלט) / ת"ז או שם+כתובת (תושב). תא ריק = ללא שינוי.
// כל שינוי נשמר ב-localStorage ומסתנכרן לשרת (em_sync.js) לכל המחשבים.
// ============================================================
(function () {
  const esc = (v) => mEscape(v);
  const norm = (s) => String(s ?? '').replace(/[*()"'״׳‎‏]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const YES = new Set(['כן', 'yes', 'y', 'true', '1', 'v', '✓', 'x', 'פתוח', 'יש']);
  const NO = new Set(['לא', 'no', 'n', 'false', '0', 'סגור', 'אין']);
  const today = () => new Date().toISOString().slice(0, 10);

  // ------------------------------------------------------------
  // קריאה / כתיבה של קבצים
  // ------------------------------------------------------------
  async function readWorkbook(file) {
    if (!window.XLSX) throw new Error('ספריית Excel לא נטענה (בדוק חיבור לאינטרנט)');
    if (/\.csv$/i.test(file.name)) return XLSX.read((await file.text()).replace(/^﻿/, ''), { type: 'string' });
    return XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }

  function sheetRows(wb, names, fallbackFirst) {
    const wanted = names.map(norm);
    const name = wb.SheetNames.find(n => wanted.includes(norm(n))) ?? (fallbackFirst ? wb.SheetNames[0] : null);
    return name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false }) : null;
  }

  function headerGetter(rows) {
    const map = new Map();
    Object.keys(rows[0] || {}).forEach(k => map.set(norm(k), k));
    return (row, aliases) => {
      for (const a of aliases) {
        const k = map.get(norm(a));
        if (k !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
      }
      return '';
    };
  }
  const hasColumn = (rows, aliases) => rows.length && aliases.some(a => Object.keys(rows[0]).some(k => norm(k) === norm(a)));

  function saveWorkbook(filename, sheets) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(sh => {
      const ws = XLSX.utils.aoa_to_sheet([sh.header, ...sh.rows]);
      ws['!cols'] = sh.header.map(h => ({ wch: Math.max(10, Math.min(38, String(h).length + 6)) }));
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    });
    wb.Workbook = { Views: [{ RTL: true }] };
    XLSX.writeFile(wb, filename);
  }
  const needXlsx = () => { if (!window.XLSX) { alert('ספריית Excel לא נטענה (בדוק חיבור לאינטרנט)'); return false; } return true; };

  const toNumber = (s) => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const toBool = (s) => { const v = norm(s); return YES.has(v) ? true : NO.has(v) ? false : null; };
  function cleanPhone(s) {
    const d = String(s || '').replace(/\D/g, '').replace(/^972/, '0');
    return /^[2-9]\d{8}$/.test(d) ? '0' + d : d; // אקסל מוריד 0 מוביל
  }
  const inIsrael = (lat, lng) => lat >= 29 && lat <= 33.6 && lng >= 34 && lng <= 36;

  // ------------------------------------------------------------
  // תצוגה מקדימה לפני החלה
  // ------------------------------------------------------------
  function previewModal({ title, chips, lines, issues, confirmLabel, onConfirm }) {
    document.getElementById('xl-preview')?.remove();
    const ovl = document.createElement('div');
    ovl.className = 'modal-overlay';
    ovl.id = 'xl-preview';
    ovl.innerHTML = `<div class="modal" style="max-width:720px; width:96%; max-height:92vh; overflow:auto">
      <h3>${esc(title)}</h3>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0">${chips.map(c => `<span class="sh-chip" style="background:${c.color}1f; color:${c.color}; font-size:.88rem">${esc(c.label)}</span>`).join('')}</div>
      ${lines.length ? `<div class="sh-muted" style="margin-bottom:4px">פירוט (עד 40 ראשונים):</div>
        <div class="sh-log" style="max-height:220px">${lines.slice(0, 40).map(l => `<div>${l}</div>`).join('')}</div>` : ''}
      ${issues.length ? `<div class="sh-sec" style="color:var(--warn)">⚠️ אזהרות ושגיאות (${issues.length})</div>
        <div class="sh-log" style="max-height:160px">${issues.slice(0, 30).map(i => `<div>${esc(i)}</div>`).join('')}</div>` : ''}
      <div class="modal-buttons">
        ${onConfirm ? `<button id="xl-confirm">${esc(confirmLabel)}</button>` : ''}
        <button class="btn-cancel" onclick="document.getElementById('xl-preview').remove()">${onConfirm ? 'ביטול' : 'סגור'}</button>
      </div></div>`;
    document.body.appendChild(ovl);
    if (onConfirm) ovl.querySelector('#xl-confirm').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'מייבא...';
      try { await onConfirm(); } finally { ovl.remove(); }
    };
  }

  const resetInput = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };

  // ============================================================
  // מקלטים
  // ============================================================
  const CAT_BY_TEXT = {};
  Object.entries(SHELTER_CATEGORIES).forEach(([k, label]) => { CAT_BY_TEXT[norm(k)] = k; CAT_BY_TEXT[norm(label.replace(/^\S+\s/, ''))] = k; });
  Object.assign(CAT_BY_TEXT, { 'ציבורי': 'public', 'חיצוני': 'school_external', 'בי"ס חיצוני': 'school_external', 'פנימי': 'school_internal', 'בי"ס פנימי': 'school_internal', 'חניון': 'parking' });
  Object.keys(CAT_BY_TEXT).forEach(k => { CAT_BY_TEXT[norm(k)] = CAT_BY_TEXT[k]; });
  const NEED_BY_LABEL = Object.fromEntries(Object.entries(SHELTER_NEED_LABELS).map(([k, l]) => [norm(l), k]));
  const catLabel = (k) => (SHELTER_CATEGORIES[k] || k).replace(/^\S+\s/, '');

  const SH_COLS = {
    id: ['מזהה מערכת', 'system id'], name: ['שם', 'שם מקלט', 'name'], address: ['כתובת', 'address'],
    category: ['קטגוריה', 'סוג', 'category'], capacity: ['קיבולת', 'קיבולת מקסימלית', 'capacity'],
    current: ['תפוסה', 'תפוסה נוכחית', 'current'], size: ['שטח', 'שטח מ"ר', 'גודל', 'size'],
    open: ['פתוח', 'פתוח כעת', 'open', 'isOpen'], contact: ['איש קשר', 'אחראי', 'contact'],
    wifi: ['אינטרנט אלחוטי', 'אינטרנט', 'wifi', 'wi-fi'], ssid: ['שם רשת', 'ssid', 'שם הרשת'],
    wifiPass: ['סיסמת רשת', 'סיסמת wifi', 'סיסמה', 'password'],
    lat: ['קו רוחב', 'lat', 'latitude'], lng: ['קו אורך', 'lng', 'lon', 'longitude'],
    needs: ['צרכים', 'צרכים דחופים', 'needs'], notes: ['הערות', 'notes'],
  };
  const OCC_COLS = {
    shelter: ['שם מקלט', 'מקלט', 'shelter'], name: ['שם דייר', 'שם', 'name'], phone: ['טלפון', 'נייד', 'phone'],
    count: ['מס נפשות', 'מספר נפשות', 'נפשות', 'count'], elderly: ['קשיש', 'קשישים'], disabled: ['נכה', 'נכים', 'מוגבלות'],
    infant: ['תינוק', 'תינוקות'], notes: ['הערות', 'notes'],
  };

  function planShelters(wb) {
    const rows = sheetRows(wb, ['מקלטים', 'shelters'], true);
    if (!rows || !rows.length) throw new Error('לא נמצאו שורות בגיליון "מקלטים"');
    if (!hasColumn(rows, SH_COLS.name)) throw new Error('חסרה עמודה "שם" (או "שם מקלט") בגיליון המקלטים');
    const g = headerGetter(rows);
    const existing = getShelters();
    const byId = new Map(existing.map(s => [s.id, s]));
    const byName = new Map(existing.map(s => [norm(s.name), s]));
    const plan = new Map(); // key -> {rec, isNew, changes:Set}
    const issues = [];

    rows.forEach((row, i) => {
      const at = `שורה ${i + 2}`;
      const name = g(row, SH_COLS.name);
      const id = g(row, SH_COLS.id);
      if (!name && !id) return;
      const target = (id && byId.get(id)) || byName.get(norm(name));
      const key = target ? target.id : 'new:' + norm(name);
      let item = plan.get(key);
      if (!item) {
        item = target
          ? { rec: structuredClone(target), isNew: false, changes: new Set() }
          : { rec: { id: genId(), name, address: '', category: 'public', isOpen: true, capacity: 0, current: 0, needs: {}, wifi: { has: null, ssid: '', password: '' } }, isNew: true, changes: new Set(['חדש']) };
        plan.set(key, item);
      }
      const { rec, changes } = item;
      const set = (field, label, value) => {
        const cur = field.split('.').reduce((o, k) => o?.[k], rec);
        if (JSON.stringify(cur) === JSON.stringify(value)) return;
        const path = field.split('.'); const last = path.pop();
        path.reduce((o, k) => (o[k] ??= {}), rec)[last] = value;
        changes.add(label);
      };

      if (name) set('name', 'שם', name);
      const address = g(row, SH_COLS.address); if (address) set('address', 'כתובת', address);
      const cat = g(row, SH_COLS.category);
      if (cat) { const k = CAT_BY_TEXT[norm(cat)]; k ? set('category', 'קטגוריה', k) : issues.push(`${at}: קטגוריה לא מוכרת "${cat}" (${Object.values(SHELTER_CATEGORIES).map(l => l.replace(/^\S+\s/, '')).join(' / ')})`); }
      for (const [f, label, cols] of [['capacity', 'קיבולת', SH_COLS.capacity], ['current', 'תפוסה', SH_COLS.current]]) {
        const v = g(row, cols);
        if (v !== '') { const n = toNumber(v); n !== null && n >= 0 ? set(f, label, Math.round(n)) : issues.push(`${at}: ערך לא תקין ב"${label}": ${v}`); }
      }
      const size = g(row, SH_COLS.size); if (size) set('size', 'שטח', size);
      const open = g(row, SH_COLS.open);
      if (open) { const b = toBool(open); b === null ? issues.push(`${at}: "פתוח" חייב להיות כן/לא`) : set('isOpen', 'פתוח', b); }
      const contact = g(row, SH_COLS.contact); if (contact) set('contact', 'איש קשר', contact);
      const wifi = g(row, SH_COLS.wifi);
      if (wifi) { const v = norm(wifi); v === 'לא ידוע' ? set('wifi.has', 'אינטרנט', null) : (toBool(wifi) === null ? issues.push(`${at}: "אינטרנט אלחוטי" חייב להיות יש/אין/לא ידוע`) : set('wifi.has', 'אינטרנט', toBool(wifi))); }
      const ssid = g(row, SH_COLS.ssid); if (ssid) set('wifi.ssid', 'שם רשת', ssid);
      const wp = g(row, SH_COLS.wifiPass); if (wp) set('wifi.password', 'סיסמת רשת', wp);
      const lat = g(row, SH_COLS.lat), lng = g(row, SH_COLS.lng);
      if (lat || lng) {
        const la = toNumber(lat), ln = toNumber(lng);
        la !== null && ln !== null && inIsrael(la, ln) ? (set('lat', 'מיקום', la), set('lng', 'מיקום', ln)) : issues.push(`${at}: קואורדינטות לא תקינות (${lat}, ${lng})`);
      }
      const needs = g(row, SH_COLS.needs);
      if (needs) {
        const next = {};
        needs.split(/[,;|\n]/).map(norm).filter(Boolean).forEach(t => { NEED_BY_LABEL[t] ? (next[NEED_BY_LABEL[t]] = true) : issues.push(`${at}: צורך לא מוכר "${t}" (${Object.values(SHELTER_NEED_LABELS).join(', ')})`); });
        Object.keys(SHELTER_NEED_LABELS).forEach(k => { next[k] = !!next[k]; });
        set('needs', 'צרכים', next);
      }
      const notes = g(row, SH_COLS.notes); if (notes) set('notes', 'הערות', notes);
      if (item.isNew && !rec.address) issues.push(`${at}: מקלט חדש "${rec.name}" ללא כתובת — לא יהיה אפשר למקם אותו על המפה אוטומטית`);
    });

    // גיליון דיירים: הרשימה בקובץ מחליפה את הרשימה של אותו מקלט
    let occCount = 0, occShelters = 0;
    const occRows = sheetRows(wb, ['דיירים', 'occupants'], false);
    if (occRows && occRows.length) {
      const go = headerGetter(occRows);
      const planByName = new Map([...plan.values()].map(it => [norm(it.rec.name), it]));
      const byShelter = new Map();
      occRows.forEach((row, i) => {
        const sname = go(row, OCC_COLS.shelter), pname = go(row, OCC_COLS.name);
        if (!sname && !pname) return;
        if (!pname) { issues.push(`דיירים שורה ${i + 2}: חסר שם דייר`); return; }
        const item = planByName.get(norm(sname)) || (() => {
          const ex = byName.get(norm(sname));
          if (!ex) return null;
          const it = { rec: structuredClone(ex), isNew: false, changes: new Set() };
          plan.set(ex.id, it); planByName.set(norm(sname), it); return it;
        })();
        if (!item) { issues.push(`דיירים שורה ${i + 2}: המקלט "${sname}" לא קיים במערכת ולא בגיליון המקלטים`); return; }
        const list = byShelter.get(item) || [];
        const count = toNumber(go(row, OCC_COLS.count));
        list.push({
          id: genId(), name: pname, phone: cleanPhone(go(row, OCC_COLS.phone)),
          count: count && count > 0 ? Math.round(count) : 1,
          elderly: toBool(go(row, OCC_COLS.elderly)) === true, disabled: toBool(go(row, OCC_COLS.disabled)) === true,
          infant: toBool(go(row, OCC_COLS.infant)) === true, notes: go(row, OCC_COLS.notes),
        });
        byShelter.set(item, list);
      });
      const occKey = (o) => JSON.stringify([norm(o.name), o.phone, o.count, !!o.elderly, !!o.disabled, !!o.infant, o.notes || '']);
      byShelter.forEach((list, item) => {
        const r = item.rec;
        const before = (r.occupants || []).map(occKey).join('|');
        if (before === list.map(occKey).join('|')) return; // אותה רשימה — אין שינוי
        r.occupants = list;
        r.current = list.reduce((n, o) => n + o.count, 0);
        r.elderly = list.filter(o => o.elderly).length;
        r.disabled = list.filter(o => o.disabled).length;
        r.infants = list.filter(o => o.infant).length;
        item.changes.add(`דיירים (${list.length})`);
        occCount += list.length; occShelters++;
      });
    }
    const items = [...plan.values()].map(it => ({ ...it, state: it.isNew ? 'new' : it.changes.size ? 'update' : 'same' }));
    return { items, issues, occCount, occShelters, existing };
  }

  async function importSheltersFileExcel(file) {
    resetInput('sheltersImportFile');
    if (!file) return;
    if (!shCanWrite()) { alert('אין הרשאת עריכה במקלטים'); return; }
    try {
      const { items, issues, occCount, occShelters, existing } = planShelters(await readWorkbook(file));
      const n = (s) => items.filter(i => i.state === s).length;
      const touched = items.filter(i => i.state !== 'same');
      previewModal({
        title: `ייבוא מקלטים — ${file.name}`,
        chips: [
          { label: `${n('new')} חדשים`, color: '#16a34a' }, { label: `${n('update')} יתעדכנו`, color: '#1d4ed8' },
          { label: `${n('same')} ללא שינוי`, color: '#64748b' },
          ...(occCount ? [{ label: `${occCount} דיירים ב-${occShelters} מקלטים`, color: '#d97706' }] : []),
        ],
        lines: touched.map(i => `${i.isNew ? '🆕' : '✏️'} <strong>${esc(i.rec.name)}</strong> — ${esc([...i.changes].join(', '))}`),
        issues,
        confirmLabel: touched.length ? `✅ אשר ייבוא (${touched.length})` : '',
        onConfirm: touched.length ? async () => {
          const now = new Date().toISOString();
          const byId = new Map(existing.map(s => [s.id, s]));
          touched.forEach(i => {
            i.rec.log = shLogAdd(i.rec, 'ייבוא Excel', [...i.changes].join(', '));
            byId.set(i.rec.id, i.rec);
          });
          saveShelters([...byId.values()]);
          if (typeof logAudit === 'function') logAudit('IMPORT_SHELTERS', file.name, `חדשים ${n('new')}, עודכנו ${n('update')}`);
          shRenderCurrent();
          const unplaced = touched.filter(i => !(i.rec.lat && i.rec.lng)).length;
          alert(`✅ הייבוא הושלם: ${n('new')} חדשים, ${n('update')} עודכנו.` + (unplaced ? `\n${unplaced} מקלטים ללא מיקום — במפה החיה לחץ "מקם מקלטים לפי כתובת".` : ''));
        } : null,
      });
    } catch (err) { alert('שגיאה בקריאת הקובץ: ' + err.message); }
  }

  function exportShelters() {
    if (!needXlsx()) return;
    const shelters = getShelters();
    const header = ['מזהה מערכת', 'שם', 'כתובת', 'קטגוריה', 'קיבולת', 'תפוסה', 'שטח', 'פתוח', 'איש קשר', 'אינטרנט אלחוטי', 'שם רשת', 'סיסמת רשת', 'קו רוחב', 'קו אורך', 'צרכים', 'הערות'];
    const rows = shelters.map(s => [
      s.id, s.name, s.address || '', catLabel(s.category || 'public'), s.capacity || 0, shOccupancy(s), s.size || '',
      s.isOpen === false ? 'לא' : 'כן', s.contact || '',
      s.wifi?.has === true ? 'יש' : s.wifi?.has === false ? 'אין' : 'לא ידוע', s.wifi?.ssid || '', s.wifi?.password || '',
      s.lat ?? '', s.lng ?? '',
      Object.entries(s.needs || {}).filter(([, v]) => v).map(([k]) => SHELTER_NEED_LABELS[k]).join(', '), s.notes || '',
    ]);
    const occ = [];
    shelters.forEach(s => (s.occupants || []).forEach(o => occ.push([s.name, o.name, o.phone || '', o.count || 1, o.elderly ? 'כן' : '', o.disabled ? 'כן' : '', o.infant ? 'כן' : '', o.notes || ''])));
    saveWorkbook(`shelters_${today()}.xlsx`, [
      { name: 'מקלטים', header, rows },
      { name: 'דיירים', header: ['שם מקלט', 'שם דייר', 'טלפון', 'מס נפשות', 'קשיש', 'נכה', 'תינוק', 'הערות'], rows: occ },
      instructions('שורה עם "מזהה מערכת" מעדכנת את אותו מקלט; בלי מזהה — מותאם לפי השם.'),
    ]);
    if (typeof logAudit === 'function') logAudit('EXPORT_SHELTERS', 'excel', `${shelters.length} מקלטים`);
  }

  function shelterTemplate() {
    if (!needXlsx()) return;
    saveWorkbook('shelters_template.xlsx', [
      { name: 'מקלטים', header: ['שם', 'כתובת', 'קטגוריה', 'קיבולת', 'תפוסה', 'שטח', 'פתוח', 'איש קשר', 'אינטרנט אלחוטי', 'שם רשת', 'סיסמת רשת', 'קו רוחב', 'קו אורך', 'צרכים', 'הערות'], rows: [] },
      { name: 'דיירים', header: ['שם מקלט', 'שם דייר', 'טלפון', 'מס נפשות', 'קשיש', 'נכה', 'תינוק', 'הערות'], rows: [] },
      instructions(`קטגוריה: ${Object.values(SHELTER_CATEGORIES).map(l => l.replace(/^\S+\s/, '')).join(' / ')}`, `צרכים: ${Object.values(SHELTER_NEED_LABELS).join(', ')} (מופרדים בפסיק)`),
    ]);
  }

  // ============================================================
  // תושבים / מפונים
  // ============================================================
  const RES_COLS = {
    id: ['מזהה מערכת', 'system id'],
    fullName: ['שם מלא', 'שם', 'name', 'full name', 'fullname', 'full_name'],
    idNumber: ['ת"ז', 'תז', 'תעודת זהות', 'מספר זהות', 'id', 'id number', 'id_number'],
    address: ['כתובת', 'address', 'רחוב'], floor: ['קומה', 'floor'], residence: ['סוג מגורים', 'מגורים', 'residence'],
    age: ['גיל', 'age'], gender: ['מין', 'gender', 'sex'], status: ['סטטוס', 'מצב', 'status'],
    children: ['ילדים', 'מספר ילדים', 'children'], familyCenter: ['מרכז משפחות', 'family center', 'family_center'],
    hotelName: ['מלון', 'שם מלון'], rescueUnit: ['יחידת חילוץ'], firstAid: ['עזרה ראשונה'],
    hqNotes: ['הערות חמל', 'הערות חמ"ל', 'הערות'], animals: ['בעלי חיים', 'בע"ח'],
    phone: ['טלפון', 'נייד', 'phone', 'tel'],
  };
  const HH_COLS = {
    resId: ['מזהה מערכת תושב', 'מזהה מערכת'], resIdNumber: ['ת"ז תושב', 'תז תושב'], resName: ['שם תושב', 'תושב'],
    name: ['שם', 'שם בן בית', 'name'], idNumber: ['ת"ז', 'תז'], age: ['גיל'], gender: ['מין'], relation: ['קרבה', 'קשר'], phone: ['טלפון', 'נייד'],
  };
  const digits = (s) => String(s || '').replace(/\D/g, '');

  function planResidents(wb) {
    const rows = sheetRows(wb, ['תושבים', 'מפונים', 'residents'], true);
    if (!rows || !rows.length) throw new Error('לא נמצאו שורות בקובץ');
    if (!hasColumn(rows, RES_COLS.fullName)) throw new Error('חסרה עמודה "שם מלא" בגיליון התושבים');
    const g = headerGetter(rows);
    const existing = getResidents();
    const byId = new Map(existing.map(r => [r.id, r]));
    const byIdNum = new Map(existing.filter(r => digits(r.idNumber)).map(r => [digits(r.idNumber), r]));
    const byNameAddr = new Map(existing.map(r => [norm(r.fullName) + '|' + norm(r.address), r]));
    const plan = new Map();
    const issues = [];
    const find = (id, idNum, name, addr) =>
      (id && byId.get(id)) || (digits(idNum) && byIdNum.get(digits(idNum))) || byNameAddr.get(norm(name) + '|' + norm(addr)) || null;

    rows.forEach((row, i) => {
      const at = `שורה ${i + 2}`;
      const name = g(row, RES_COLS.fullName), address = g(row, RES_COLS.address);
      const idNum = g(row, RES_COLS.idNumber), id = g(row, RES_COLS.id);
      if (!name && !id && !idNum) return;
      const target = find(id, idNum, name, address);
      if (!target && (!name || !address)) { issues.push(`${at}: תושב חדש חייב שם מלא וכתובת (דולג)`); return; }
      const key = target ? target.id : 'new:' + (digits(idNum) || norm(name) + '|' + norm(address));
      let item = plan.get(key);
      if (!item) {
        item = target
          ? { rec: structuredClone(target), isNew: false, changes: new Set(), addrChanged: false }
          : { rec: { id: genId(), fullName: name, address, idNumber: '', floor: '', residence: '', age: null, gender: '', status: 'לא ידוע', children: 0, familyCenter: '', hotelName: '', rescueUnit: '', firstAid: '', hqNotes: '', animals: '', household: [], lat: null, lng: null }, isNew: true, changes: new Set(['חדש']), addrChanged: true };
        plan.set(key, item);
      }
      const { rec, changes } = item;
      const set = (field, label, value) => {
        if (rec[field] === undefined && (value === 0 || value === '')) return;
        if (rec[field] !== value) { rec[field] = value; changes.add(label); }
      };
      if (name) set('fullName', 'שם', name);
      if (address && address !== rec.address) { set('address', 'כתובת', address); rec.lat = null; rec.lng = null; item.addrChanged = true; }
      for (const [f, label] of [['idNumber', 'ת"ז'], ['floor', 'קומה'], ['residence', 'סוג מגורים'], ['familyCenter', 'מרכז משפחות'], ['hotelName', 'מלון'], ['rescueUnit', 'יחידת חילוץ'], ['firstAid', 'עזרה ראשונה'], ['hqNotes', 'הערות חמ"ל'], ['animals', 'בעלי חיים']]) {
        const v = g(row, RES_COLS[f]); if (v) set(f, label, v);
      }
      const age = g(row, RES_COLS.age); if (age) { const n = toNumber(age); n !== null && n >= 0 && n < 130 ? set('age', 'גיל', Math.round(n)) : issues.push(`${at}: גיל לא תקין "${age}"`); }
      const ch = g(row, RES_COLS.children); if (ch) { const n = toNumber(ch); n !== null && n >= 0 ? set('children', 'ילדים', Math.round(n)) : issues.push(`${at}: מספר ילדים לא תקין "${ch}"`); }
      const gender = g(row, RES_COLS.gender); if (gender) { RESIDENT_GENDER_OPTS.includes(gender) ? set('gender', 'מין', gender) : issues.push(`${at}: מין "${gender}" לא מוכר (${RESIDENT_GENDER_OPTS.join('/')})`); }
      const status = g(row, RES_COLS.status); if (status) { RESIDENT_STATUS_OPTS.includes(status) ? set('status', 'סטטוס', status) : issues.push(`${at}: סטטוס "${status}" לא מוכר (${RESIDENT_STATUS_OPTS.join(' / ')})`); }
      const phone = cleanPhone(g(row, RES_COLS.phone));
      if (phone) {
        const head = rec.household.find(m => ['אב', 'אם'].includes(m.relation));
        if (head ? head.phone !== phone : true) {
          head ? (head.phone = phone) : rec.household.push({ name: rec.fullName, idNumber: '', age: 0, gender: '', relation: 'אב', phone });
          changes.add('טלפון');
        }
      }
    });

    // גיליון בני בית: הרשימה בקובץ מחליפה את בני הבית של אותו תושב
    let hhCount = 0, hhResidents = 0;
    const hhRows = sheetRows(wb, ['בני בית', 'household'], false);
    if (hhRows && hhRows.length) {
      const gh = headerGetter(hhRows);
      const lookup = (row) => {
        const id = gh(row, HH_COLS.resId), idn = gh(row, HH_COLS.resIdNumber), nm = gh(row, HH_COLS.resName);
        for (const it of plan.values()) {
          if ((id && it.rec.id === id) || (digits(idn) && digits(it.rec.idNumber) === digits(idn)) || (nm && !id && !idn && norm(it.rec.fullName) === norm(nm))) return it;
        }
        const ex = find(id, idn, nm, '') || (nm ? existing.find(r => norm(r.fullName) === norm(nm)) : null);
        if (!ex) return null;
        const it = { rec: structuredClone(ex), isNew: false, changes: new Set(), addrChanged: false };
        plan.set(ex.id, it); return it;
      };
      const grouped = new Map();
      hhRows.forEach((row, i) => {
        const mname = gh(row, HH_COLS.name);
        if (!mname) return;
        const it = lookup(row);
        if (!it) { issues.push(`בני בית שורה ${i + 2}: לא נמצא התושב הראשי (מזהה/ת"ז/שם)`); return; }
        const list = grouped.get(it) || [];
        const rel = gh(row, HH_COLS.relation);
        list.push({ name: mname, idNumber: gh(row, HH_COLS.idNumber), age: toNumber(gh(row, HH_COLS.age)) || 0, gender: gh(row, HH_COLS.gender), relation: rel, phone: ['אב', 'אם'].includes(rel) ? cleanPhone(gh(row, HH_COLS.phone)) : '' });
        grouped.set(it, list);
      });
      const hhKey = (m) => JSON.stringify([norm(m.name), digits(m.idNumber), Number(m.age) || 0, m.gender || '', m.relation || '', m.phone || '']);
      grouped.forEach((list, it) => {
        if ((it.rec.household || []).map(hhKey).join('|') === list.map(hhKey).join('|')) return;
        it.rec.household = list; it.changes.add(`בני בית (${list.length})`); hhCount += list.length; hhResidents++;
      });
    }
    const items = [...plan.values()].map(it => ({ ...it, state: it.isNew ? 'new' : it.changes.size ? 'update' : 'same' }));
    return { items, issues, hhCount, hhResidents, existing };
  }

  async function importResidentsFileExcel(file) {
    resetInput('residentsImportFile');
    if (!file) return;
    try {
      const { items, issues, hhCount, hhResidents, existing } = planResidents(await readWorkbook(file));
      const n = (s) => items.filter(i => i.state === s).length;
      const touched = items.filter(i => i.state !== 'same');
      previewModal({
        title: `ייבוא תושבים — ${file.name}`,
        chips: [
          { label: `${n('new')} חדשים`, color: '#16a34a' }, { label: `${n('update')} יתעדכנו`, color: '#1d4ed8' },
          { label: `${n('same')} ללא שינוי`, color: '#64748b' },
          ...(hhCount ? [{ label: `${hhCount} בני בית ל-${hhResidents} תושבים`, color: '#d97706' }] : []),
        ],
        lines: touched.map(i => `${i.isNew ? '🆕' : '✏️'} <strong>${esc(i.rec.fullName)}</strong> — ${esc([...i.changes].join(', '))}`),
        issues,
        confirmLabel: touched.length ? `✅ אשר ייבוא (${touched.length})` : '',
        onConfirm: touched.length ? async () => {
          const byId = new Map(existing.map(r => [r.id, r]));
          const now = new Date().toISOString();
          touched.forEach(i => { i.rec.lastUpdate = now; byId.set(i.rec.id, i.rec); });
          saveResidents([...byId.values()]);
          if (typeof logAudit === 'function') logAudit('IMPORT_RESIDENTS', file.name, `חדשים ${n('new')}, עודכנו ${n('update')}`);
          renderEvacueesTable(); renderHotelsTab();
          const needGeo = touched.filter(i => i.addrChanged && i.rec.address).length;
          alert(`✅ הייבוא הושלם: ${n('new')} חדשים, ${n('update')} עודכנו.` + (needGeo ? `\nמיקום על המפה ל-${needGeo} תושבים יחושב ברקע.` : ''));
          if (needGeo) geocodeMissingResidents();
        } : null,
      });
    } catch (err) { alert('שגיאה בקריאת הקובץ: ' + err.message); }
  }

  function exportResidents() {
    if (!needXlsx()) return;
    const residents = getResidents();
    const header = ['מזהה מערכת', 'שם מלא', 'ת"ז', 'כתובת', 'קומה', 'סוג מגורים', 'גיל', 'מין', 'סטטוס', 'ילדים', 'מרכז משפחות', 'מלון', 'יחידת חילוץ', 'עזרה ראשונה', 'הערות חמ"ל', 'בעלי חיים', 'טלפון'];
    const rows = residents.map(r => [r.id, r.fullName, r.idNumber || '', r.address || '', r.floor || '', r.residence || '', r.age ?? '', r.gender || '', r.status || '', r.children || 0, r.familyCenter || '', r.hotelName || '', r.rescueUnit || '', r.firstAid || '', r.hqNotes || '', r.animals || '', (r.household || []).find(m => m.phone)?.phone || '']);
    const hh = [];
    residents.forEach(r => (r.household || []).forEach(m => hh.push([r.id, r.fullName, m.name || '', m.idNumber || '', m.age || '', m.gender || '', m.relation || '', m.phone || ''])));
    saveWorkbook(`residents_${today()}.xlsx`, [
      { name: 'תושבים', header, rows },
      { name: 'בני בית', header: ['מזהה מערכת תושב', 'שם תושב', 'שם', 'ת"ז', 'גיל', 'מין', 'קרבה', 'טלפון'], rows: hh },
      instructions('שורה עם "מזהה מערכת" מעדכנת את אותו תושב; בלי מזהה — מותאם לפי ת"ז, ואם אין אז לפי שם+כתובת.',
        `סטטוס: ${RESIDENT_STATUS_OPTS.join(' / ')}`, `מין: ${RESIDENT_GENDER_OPTS.join(' / ')}`, 'גיליון "בני בית": רשימת בני הבית שמופיעה בקובץ מחליפה את הרשימה הקיימת של אותו תושב.'),
    ]);
    if (typeof logAudit === 'function') logAudit('EXPORT_RESIDENTS', 'excel', `${residents.length} תושבים`);
  }

  function residentTemplate() {
    if (!needXlsx()) return;
    saveWorkbook('residents_template.xlsx', [
      { name: 'תושבים', header: ['שם מלא', 'ת"ז', 'כתובת', 'קומה', 'סוג מגורים', 'גיל', 'מין', 'סטטוס', 'ילדים', 'מרכז משפחות', 'מלון', 'יחידת חילוץ', 'עזרה ראשונה', 'הערות חמ"ל', 'בעלי חיים', 'טלפון'], rows: [] },
      { name: 'בני בית', header: ['ת"ז תושב', 'שם תושב', 'שם', 'ת"ז', 'גיל', 'מין', 'קרבה', 'טלפון'], rows: [] },
      instructions('חובה לתושב חדש: שם מלא וכתובת (למשל: הרצל 42).', `סטטוס: ${RESIDENT_STATUS_OPTS.join(' / ')}`, `מין: ${RESIDENT_GENDER_OPTS.join(' / ')}`),
    ]);
  }

  // חישוב מיקום ברקע, בקצב שמותר ל-Nominatim
  let geoRunning = false;
  async function geocodeMissingResidents() {
    if (geoRunning) return;
    geoRunning = true;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed; bottom:20px; left:20px; background:#fff; border:1px solid #c8d3e0; border-radius:10px; padding:10px 16px; z-index:9998; font-size:.88rem; box-shadow:0 4px 12px rgba(0,0,0,.15)';
    document.body.appendChild(bar);
    try {
      const todo = getResidents().filter(r => r.address && !r.lat);
      const cache = () => { try { return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || '{}'); } catch { return {}; } };
      let done = 0, found = 0;
      for (const r of todo) {
        bar.textContent = `📍 ממקם תושבים ${++done}/${todo.length}...`;
        const q = r.address + ', בת ים, ישראל';
        const wasCached = !!cache()[q];
        const pos = await geocodeAddress(q);
        if (pos) {
          const all = getResidents();
          const t = all.find(x => x.id === r.id);
          if (t && !t.lat) { t.lat = pos.lat; t.lng = pos.lng; saveResidents(all); found++; }
        }
        if (!wasCached) await new Promise(res => setTimeout(res, 1100));
      }
      bar.textContent = `✅ מיקום חושב ל-${found} מתוך ${todo.length} תושבים`;
      renderEvacueesTable();
      setTimeout(() => bar.remove(), 4000);
    } catch (e) { bar.textContent = 'שגיאה בחישוב מיקום: ' + e.message; setTimeout(() => bar.remove(), 5000); }
    finally { geoRunning = false; }
  }

  function instructions(...lines) {
    return { name: 'הוראות', header: ['הוראות'], rows: [
      ['מלא את הגיליון הראשון ושמור כ-xlsx (או CSV), ואז ייבא במערכת.'],
      ['תא ריק = ללא שינוי ברשומה קיימת. רשומה לא תמחק על ידי ייבוא.'],
      ...lines.map(l => [l]),
    ] };
  }

  // ------------------------------------------------------------
  // חשיפה גלובלית (מחליף את הייבוא הישן שיצר כפילויות)
  // ------------------------------------------------------------
  window.importSheltersFile = importSheltersFileExcel;
  window.importResidentsFile = importResidentsFileExcel;
  window.exportSheltersExcel = exportShelters;
  window.downloadSheltersTemplate = shelterTemplate;
  window.exportResidentsExcel = exportResidents;
  window.downloadResidentsTemplate = residentTemplate;
  window.geocodeMissingResidents = geocodeMissingResidents;
  window.__excelPlan = { planShelters, planResidents }; // לבדיקות
})();
