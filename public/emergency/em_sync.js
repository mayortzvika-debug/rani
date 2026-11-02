'use strict';
// ============================================================
// em_sync.js — סנכרון כל נתוני הדשבורד מול השרת, כך שהמערכת עובדת מכל מחשב.
// הקוד הקיים ממשיך לקרוא ולכתוב ל-localStorage; המנוע מזהה שינויים (diff),
// שולח רק רשומות ששונו, ומחיל שינויים של אחרים. עדכון אחרון בכל רשומה מנצח.
// ההרשאות נאכפות בשרת (em-auth.mjs) — אין בצד הלקוח אפשרות לעקוף אותן.
// ============================================================
(function () {
  const META_KEY = 'em_syncmeta_v1';
  const INTERVAL_MS = 5000;
  const MAX_BATCH_CHARS = 8 * 1024 * 1024;

  // inline  = הרשומות כוללות updatedAt/deleted בעצמן (חנויות המקלטים)
  // single  = המפתח מחזיק אובייקט בודד ולא מערך
  const COLLECTIONS = [
    { name: 'shelters',      key: 'em_shelters',              inline: true },
    { name: 'activities',    key: 'em_shelter_activities',    inline: true },
    { name: 'residents',     key: 'em_residents' },
    { name: 'infra',         key: 'em_infrastructure' },
    { name: 'familyCenters', key: 'em_family_centers' },
    { name: 'statusCards',   key: 'emergency_status_cards' },
    // d1..d7 הן רשומות הדמו שנוצרות אוטומטית בדפדפן — לא משתפים אותן
    { name: 'entries',       key: 'em_entries', exclude: (r) => /^d\d$/.test(String(r.id)) },
    { name: 'sitrep',        key: 'em_sitrep_latest', single: true },
  ];
  const byKey = new Map(COLLECTIONS.map(c => [c.key, c]));

  const state = { ok: null, at: null, msg: '', writable: {} };
  let meta = loadMeta();
  let timer = null, busy = false, started = false, applying = false;

  function loadMeta() {
    try { const m = JSON.parse(localStorage.getItem(META_KEY)); if (m && m.c) return m; } catch { /* אין מטא-דאטה */ }
    return { rev: 0, initialized: false, c: {} };
  }
  const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* אחסון מלא */ } };

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  // גיבוב קצר (cyrb53) — כדי שה-meta לא ישכפל את תוכן הרשומות בתוך localStorage
  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
  }
  function hashOf(c, rec) {
    if (c.inline) { const { updatedAt, ...rest } = rec; return cyrb53(stable(rest)); }
    return cyrb53(stable(rec));
  }

  function readList(c) {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(c.key) || (c.single ? 'null' : '[]')); } catch { raw = c.single ? null : []; }
    if (c.single) return raw && typeof raw === 'object' ? [{ id: 'latest', obj: raw }] : [];
    return Array.isArray(raw) ? raw : [];
  }
  function writeList(c, list) {
    applying = true;
    try {
      if (c.single) { list[0] ? localStorage.setItem(c.key, JSON.stringify(list[0].obj)) : localStorage.removeItem(c.key); }
      else localStorage.setItem(c.key, JSON.stringify(list));
    } finally { applying = false; }
  }

  // מזהה שינויים מקומיים מאז הסריקה הקודמת
  const lastRaw = {};
  function scan(c) {
    const m = (meta.c[c.name] ||= {});
    const rawNow = localStorage.getItem(c.key);
    if (lastRaw[c.name] === rawNow && rawNow !== null) return; // לא השתנה מאז הסריקה הקודמת
    let list = readList(c);
    let mutated = false;
    const now = new Date().toISOString();

    if (c.exclude) {
      const kept = list.filter(r => !c.exclude(r));
      if (kept.length !== list.length) { list = kept; mutated = true; }
    }
    const seen = new Set();
    for (const rec of list) {
      if (rec.id === undefined || rec.id === null || rec.id === '') { rec.id = newId(); mutated = true; }
      if (c.inline && !rec.updatedAt) { rec.updatedAt = now; mutated = true; }
      const id = String(rec.id);
      seen.add(id);
      const h = hashOf(c, rec);
      const e = m[id];
      if (!e || e.h !== h || e.del) m[id] = { h, u: c.inline ? rec.updatedAt : now, del: false, dirty: true };
    }
    if (!c.inline) {
      for (const [id, e] of Object.entries(m)) {
        if (!seen.has(id) && !e.del) m[id] = { h: null, u: now, del: true, dirty: true };
      }
    }
    if (mutated) writeList(c, list);
    lastRaw[c.name] = localStorage.getItem(c.key);
  }

  function buildChanges() {
    const changes = {};
    let size = 0;
    for (const c of COLLECTIONS) {
      if (state.writable[c.name] === false) continue;
      const m = meta.c[c.name] || {};
      const dirtyIds = Object.keys(m).filter(id => m[id].dirty);
      if (!dirtyIds.length) continue;
      const byId = new Map(readList(c).map(r => [String(r.id), r]));
      const out = [];
      for (const id of dirtyIds) {
        const e = m[id];
        const env = e.del ? { id, updatedAt: e.u, deleted: true } : (byId.has(id) ? { id, updatedAt: e.u, data: byId.get(id) } : null);
        if (!env) { delete m[id]; continue; }
        const len = JSON.stringify(env).length;
        if (size + len > MAX_BATCH_CHARS && out.length) break; // השאר בסבב הבא
        size += len;
        out.push(env);
      }
      if (out.length) changes[c.name] = out;
    }
    return changes;
  }

  // מחיל על ה-localStorage את מה שהשרת החזיר. מחזיר שמות אוספים ששונו.
  function applyResponse(resp) {
    const changed = new Set();
    for (const c of COLLECTIONS) {
      const envs = resp.changes?.[c.name];
      if (!envs) continue;
      const m = (meta.c[c.name] ||= {});
      const forceServer = resp.writable?.[c.name] === false;
      let list = readList(c);
      let touched = false;
      const idx = () => new Map(list.map((r, i) => [String(r.id), i]));

      for (const env of envs) {
        const e = m[env.id];
        if (e && !forceServer) {
          if (env.updatedAt === e.u) { e.dirty = false; continue; }  // אישור על מה ששלחנו
          if (env.updatedAt < e.u) continue;                          // לשינוי המקומי יש עדיפות
        }
        const i = idx().get(String(env.id));
        if (env.deleted) {
          if (i !== undefined && !c.inline) { list.splice(i, 1); touched = true; }
          m[env.id] = { h: null, u: env.updatedAt, del: true, dirty: false };
        } else {
          const rec = c.single ? { id: 'latest', obj: env.data?.obj ?? env.data } : env.data;
          if (!rec) continue;
          if (i !== undefined) list[i] = rec; else list.push(rec);
          touched = true;
          m[env.id] = { h: hashOf(c, rec), u: env.updatedAt, del: false, dirty: false };
        }
      }
      if (c.exclude) list = list.filter(r => !c.exclude(r));
      if (touched) { writeList(c, list); changed.add(c.name); delete lastRaw[c.name]; }
    }
    return changed;
  }

  function markAllDirty() {
    for (const c of COLLECTIONS) {
      const m = meta.c[c.name] || {};
      Object.values(m).forEach(e => { e.dirty = true; });
    }
  }

  async function syncNow() {
    if (busy || window.EM_SERVER_AUTH !== true || location.protocol === 'file:') return;
    busy = true;
    try {
      // בחיבור הראשון מושכים קודם: מה שכבר קיים בשרת גובר על עותק מקומי ישן
      if (meta.initialized) COLLECTIONS.forEach(scan);
      const changes = meta.initialized ? buildChanges() : {};
      const res = await emFetch('/api/em/sync', { method: 'POST', body: { since: meta.rev, changes } });
      if (!res.ok) throw new Error('שגיאת שרת ' + res.status);
      const resp = await res.json();
      Object.assign(state.writable, resp.writable || {});
      const changed = applyResponse(resp);
      if (resp.reset) { meta.initialized = true; markAllDirty(); }
      meta.rev = resp.rev;
      meta.initialized = true;
      saveMeta();
      Object.assign(state, { ok: true, at: new Date(), msg: '' });
      if (changed.size) refreshViews(changed);
    } catch (e) {
      Object.assign(state, { ok: false, msg: e.message });
    } finally {
      busy = false;
      updateIndicator();
    }
  }

  function syncSoon() {
    if (!started) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 700);
  }

  // רענון המסך הפעיל אחרי שינויים של אחרים
  function refreshViews(changed) {
    const tab = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
    const call = (fn, ...a) => { try { if (typeof window[fn] === 'function') window[fn](...a); } catch (e) { console.warn('refresh', fn, e); } };
    if (changed.has('entries')) call('loadData');
    if (tab === 'shelters' && (changed.has('shelters') || changed.has('activities'))) call('shRenderCurrent');
    if (tab === 'evacuees' && changed.has('residents')) call('renderEvacueesTable');
    if (tab === 'hotels' && changed.has('residents')) call('renderHotelsTab');
    if (tab === 'status' && (changed.has('statusCards') || changed.has('familyCenters'))) call('loadStatusCards');
    if (tab === 'sitrep' && changed.has('sitrep')) call('loadSitrepLatest');
    if (tab === 'dashboard') call('renderDashboardKPIs');
    if (changed.has('infra')) call('renderInfraTable');
  }

  function updateIndicator() {
    let el = document.getElementById('em-sync-status');
    if (!el) {
      const bar = document.getElementById('user-bar');
      if (!bar) return;
      el = document.createElement('span');
      el.id = 'em-sync-status';
      el.style.cssText = 'font-size:0.78rem; margin-inline-end:10px; white-space:nowrap';
      bar.prepend(el);
    }
    el.textContent = state.ok === false ? `⚠️ ${state.msg}` : state.at ? `🟢 מסונכרן ${state.at.toLocaleTimeString('he-IL')}` : '⏳ מסנכרן...';
    el.title = 'כל הנתונים נשמרים בשרת ומשותפים בין כל המחשבים המחוברים';
    if (typeof window.shUpdateSyncBadge === 'function') window.shUpdateSyncBadge();
  }

  // כל כתיבה של הקוד הקיים ל-localStorage של מפתח מסונכרן מפעילה סנכרון מהיר
  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === window.localStorage && !applying && byKey.has(k)) syncSoon();
  };
  window.addEventListener('storage', (e) => { if (byKey.has(e.key)) syncSoon(); });

  function start() {
    if (started || window.EM_SERVER_AUTH !== true) return;
    started = true;
    setInterval(syncNow, INTERVAL_MS);
    syncNow();
    setTimeout(updateIndicator, 300);
  }

  window.EMSync = { start, syncNow, syncSoon, state, collections: COLLECTIONS };

  const prevAfterLogin = window.__afterLogin;
  window.__afterLogin = function () {
    if (typeof prevAfterLogin === 'function') prevAfterLogin();
    start();
  };
})();
