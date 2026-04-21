const EM_ENTRIES_KEY = 'em_entries';

// stub so old code that references webappInput doesn't crash
const webappInput = { value: '' };
const saveUrlBtn = null;
const refreshBtn = document.getElementById('refreshBtn');
const eventsBody = document.getElementById('eventsBody');
const autoRefresh = document.getElementById('autoRefresh');
const lastUpdated = document.getElementById('lastUpdated');

const eventForm = document.getElementById('eventForm');
const performerInput = document.getElementById('performerInput');
const locationInput = document.getElementById('locationInput');
const classificationInput = document.getElementById('classificationInput');
const statusInput = document.getElementById('statusInput');
const sourceInput = document.getElementById('sourceInput');
const messageInput = document.getElementById('messageInput');
const formStatus = document.getElementById('formStatus');

const kpiTotal = document.getElementById('kpiTotal');
const kpi24h = document.getElementById('kpi24h');
const statusKpiInjured = document.getElementById('statusKpiInjured');
const statusKpiScenes = document.getElementById('statusKpiScenes');
const statusKpiDisconnected = document.getElementById('statusKpiDisconnected');
const statusKpiDamaged = document.getElementById('statusKpiDamaged');
const sitrepRawInput = document.getElementById('sitrepRawInput');
const sitrepJsonInput = document.getElementById('sitrepJsonInput');
const sitrepPromptBtn = document.getElementById('sitrepPromptBtn');
const sitrepSaveBtn = document.getElementById('sitrepSaveBtn');
const sitrepFormStatus = document.getElementById('sitrepFormStatus');
const sitrepLatestContainer = document.getElementById('sitrepLatestContainer');
const openSitrepEditorBtn = document.getElementById('openSitrepEditorBtn');

const mapContainer = document.getElementById('mapContainer');
const mapResetBtn = document.getElementById('mapResetBtn');
const mapUndoBtn = document.getElementById('mapUndoBtn');
const mapSearchBtn = document.getElementById('mapSearchBtn');
const mapAddressInput = document.getElementById('mapAddressInput');
const mapSearchStatusEl = document.getElementById('mapSearchStatus');
const mapSearchResultsEl = document.getElementById('mapSearchResults');
const mapPointsCountEl = document.getElementById('mapPointsCount');
const mapPointsListEl = document.getElementById('mapPointsList');
const openBatYamGisBtn = document.getElementById('openBatYamGisBtn');
const mapHintText = document.getElementById('mapHintText');
const mapSelectedCoordinatesEl = document.getElementById('mapSelectedCoordinates');
const mapSelectedLabelEl = document.getElementById('mapSelectedLabel');

let refreshTimer = null;
let statusLogLastSignature = '';
let statusLogLastAt = 0;
let map = null;
let mapMarkersLayer = null;
let selectedMapLocation = { lat: null, lng: null };
let mapPoints = [];
let mapSearchResults = [];
let activeAddressLabel = '';
let activeMarkerType = 'rocket';

const MARKER_TYPES = {
  rocket:           { emoji: '💥', label: 'נפילת רקטה',   color: '#ef4444' },
  rescue:           { emoji: '🚑', label: 'זירת חילוץ',   color: '#f97316' },
  assembly:         { emoji: '🏕️', label: 'נקודת כינוס', color: '#22c55e' },
  damaged_building: { emoji: '🏚️', label: 'בניין פגוע',  color: '#a855f7' },
  electric:         { emoji: '⚡',  label: 'תשתית חשמל',  color: '#eab308' },
  police_station:   { emoji: '👮',  label: 'תחנת משטרה',  color: '#3b82f6' },
  police_hq:        { emoji: '🚔',  label: 'חפ"ק משטרה',  color: '#1d4ed8' },
  gas:              { emoji: '🔥',  label: 'תשתית גז',    color: '#f97316' },
  water:            { emoji: '💧',  label: 'תשתית מים',   color: '#06b6d4' },
  custom:           { emoji: '📍',  label: 'מותאם אישית', color: '#94a3b8' },
};

const mapTileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const mapTileAttribution = 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
const BAT_YAM_CENTER = [32.0231, 34.7503];
const BAT_YAM_GIS_URL = 'https://v5.gis-net.co.il/v5/batyam';
const MAX_MEDIA_FILE_SIZE = 8 * 1024 * 1024; // 8MB לפריט
let statusModalUploadedMediaItems = [];

ensureDemoEntries();
refreshBtn.addEventListener('click', loadData);

autoRefresh?.addEventListener('change', setupAutoRefresh);
mapSearchBtn?.addEventListener('click', searchMapAddress);
mapAddressInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchMapAddress();
  }
});
mapUndoBtn?.addEventListener('click', removeLastMapPoint);
mapResetBtn?.addEventListener('click', resetMapSelection);
openBatYamGisBtn?.addEventListener('click', () => {
  window.open(BAT_YAM_GIS_URL, '_blank', 'noopener,noreferrer');
});
document.getElementById('openBatYamGisFullBtn')?.addEventListener('click', () => {
  window.open(BAT_YAM_GIS_URL, '_blank', 'noopener,noreferrer');
});
document.getElementById('openBatYamGisSideBtn')?.addEventListener('click', () => {
  window.open(BAT_YAM_GIS_URL, 'gis_window', 'width=1300,height=850,left=50,top=50,resizable=yes,scrollbars=yes');
});
document.getElementById('mapExportBtn')?.addEventListener('click', exportMapImage);
document.getElementById('mapPrintBtn')?.addEventListener('click', printMap);

async function exportMapImage() {
  if (typeof html2canvas === 'undefined') {
    alert('ספריית html2canvas לא נטענה');
    return;
  }
  const mapEl = document.getElementById('map');
  try {
    const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 1.5 });
    const link = document.createElement('a');
    link.download = 'מפה_' + new Date().toISOString().slice(0,16).replace('T','_') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(err) {
    console.error('שגיאת ייצוא מפה:', err);
    alert('שגיאה בייצוא המפה: ' + err.message);
  }
}

async function printMap() {
  if (typeof html2canvas === 'undefined') {
    alert('ספריית html2canvas לא נטענה');
    return;
  }
  const mapEl = document.getElementById('map');
  try {
    const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 1.5 });
    const imgData = canvas.toDataURL('image/png');
    const points = JSON.parse(localStorage.getItem('em_map_points') || '[]');
    const rows = points.map((p, i) =>
      `<tr><td>${i+1}</td><td>${escapeHtmlPrint(p.label||'')}</td><td>${p.lat?.toFixed(5)||''}</td><td>${p.lng?.toFixed(5)||''}</td><td>${escapeHtmlPrint(p.type||'')}</td></tr>`
    ).join('');
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>הדפסת מפה</title>
      <style>body{font-family:Arial,sans-serif;margin:20px}img{max-width:100%;border:1px solid #ccc}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12px}
      th,td{border:1px solid #999;padding:4px 8px;text-align:right}th{background:#eee}
      @media print{button{display:none}}</style></head><body>
      <h2>מפת תמונת מצב - ${new Date().toLocaleString('he-IL')}</h2>
      <img src="${imgData}" />`);
    if (rows) {
      win.document.write(`<table><thead><tr><th>#</th><th>תיאור</th><th>קו רוחב</th><th>קו אורך</th><th>סוג</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    win.document.write(`<br><button onclick="window.print()">הדפס</button></body></html>`);
    win.document.close();
  } catch(err) {
    console.error('שגיאת הדפסת מפה:', err);
    alert('שגיאה בהדפסת המפה: ' + err.message);
  }
}

function escapeHtmlPrint(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- marker type chips ----
document.querySelectorAll('.marker-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.marker-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeMarkerType = btn.getAttribute('data-type');
    const customFields = document.getElementById('customMarkerFields');
    if (customFields) {
      customFields.style.display = activeMarkerType === 'custom' ? 'flex' : 'none';
    }
  });
});

eventForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  formStatus.classList.remove('error');

  const payload = {
    id: 'e' + Date.now(),
    timestamp: new Date().toISOString(),
    sender: performerInput.value.trim(),
    message: messageInput.value.trim(),
    location: locationInput.value.trim(),
    classification: classificationInput?.value || '',
    status: statusInput.value,
    chat_type: 'manual',
    source: sourceInput.value.trim() || 'מוקד מרכזי',
    latitude: null,
    longitude: null,
  };

  if (selectedMapLocation.lat !== null && selectedMapLocation.lng !== null) {
    payload.latitude = selectedMapLocation.lat;
    payload.longitude = selectedMapLocation.lng;
  }

  if (!payload.sender || !payload.message) {
    formStatus.classList.add('error');
    formStatus.textContent = 'שולח ותיאור אירוע הם שדות חובה';
    return;
  }

  // שמירה ב-localStorage
  const entries = JSON.parse(localStorage.getItem(EM_ENTRIES_KEY) || '[]');
  entries.push(payload);
  localStorage.setItem(EM_ENTRIES_KEY, JSON.stringify(entries));

  // סימון אוטומטי על המפה אם יש קואורדינטות
  if (payload.latitude && payload.longitude) {
    autoMarkEntryOnMap(payload);
  }

  formStatus.textContent = 'האירוע נשמר בהצלחה';
  messageInput.value = '';
  loadData();
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseTime(v) {
  if (!v) return null;
  const normalized = String(v).replace(' ', 'T');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function fmt(v) {
  const d = parseTime(v);
  if (!d) return v || '-';
  return d.toLocaleString('he-IL');
}

function toDateTimeLocalValue(v) {
  const d = parseTime(v);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseMediaItems(raw) {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(s => String(s).trim()).filter(Boolean).slice(0, 20);
  }

  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map(s => String(s).trim()).filter(Boolean).slice(0, 20);
    }
  } catch (_) {}

  let items = text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  // תאימות לאחור: אם נשמר בעבר בשורה אחת עם פסיקים
  if (items.length === 1 && items[0].includes(',') && !items[0].startsWith('data:')) {
    items = items[0].split(',').map(s => s.trim()).filter(Boolean);
  }

  return items.slice(0, 20);
}

function mediaTypeFromUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.startsWith('data:image/')) return 'image';
  if (lower.startsWith('data:video/')) return 'video';
  if (/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/.test(lower)) return 'image';
  if (/\.(mp4|webm|ogg|mov)(\?|$)/.test(lower)) return 'video';
  return 'link';
}

async function appendEventViaProxy(base, payload) {
  const proxyData = { url: base, action: 'append', ...payload };
  const data = await fetchJson('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(proxyData)
  });

  if (!(data?.ok === true && data?.saved === true)) {
    throw new Error(normalizeServerError(data?.error, base));
  }

  return data;
}

async function appendEventViaNoCorsGet(base, payload) {
  const u = new URL(base);
  u.searchParams.set('action', 'append');
  Object.entries(payload || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  });

  // no-cors: אין קריאת תגובה, אבל מאפשר שליחה גם בלי /api/proxy
  await fetch(u.toString(), { method: 'GET', mode: 'no-cors', cache: 'no-store' });
  return { ok: true, saved: true, transport: 'no-cors-get' };
}

async function appendEventWithFallback(base, payload) {
  if (window.location.protocol === 'file:') {
    try {
      const data = await appendEventViaNoCorsGet(base, payload);
      return { ok: true, via: 'direct', data };
    } catch (directErr) {
      throw new Error(`Direct upload failed: ${directErr.message}`);
    }
  }

  try {
    const data = await appendEventViaProxy(base, payload);
    return { ok: true, via: 'proxy', data };
  } catch (proxyErr) {
    console.warn('⚠️ append דרך proxy נכשל, מנסה שליחה ישירה:', proxyErr.message);
    try {
      const data = await appendEventViaNoCorsGet(base, payload);
      return { ok: true, via: 'direct', data, warning: proxyErr.message };
    } catch (directErr) {
      throw new Error(`Proxy: ${proxyErr.message} | Direct: ${directErr.message}`);
    }
  }
}

function render(rows) {
  console.log('🎨 Rendering rows:', rows);
  
  if (!rows.length) {
    eventsBody.innerHTML = '<tr><td colspan="8">אין נתונים</td></tr>';
    kpiTotal.textContent = '0';
    kpi24h.textContent = '0';
    return;
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let c24 = 0;

  rows.forEach(r => {
    console.log('📊 Processing row:', r);
    const t = parseTime(r.timestamp);
    if (t && t >= dayAgo) c24++;
  });

  kpiTotal.textContent = String(rows.length);
  kpi24h.textContent = String(c24);

  const statusClass = (status) => {
    const s = String(status || '').trim();
    if (s === 'חירום') return 'status-emergency';
    if (s === 'בטיפול') return 'status-active';
    if (s === 'נסגר') return 'status-closed';
    return 'status-default';
  };

  const html = rows.map(r => {
    const row = `
    <tr>
      <td>${escapeHtml(fmt(r.timestamp))}</td>
      <td><span class="status-pill ${statusClass(r.status)}">${escapeHtml(r.status || '-')}</span></td>
      <td>${escapeHtml(r.classification || r.category || '-')}</td>
      <td>${escapeHtml(r.sender || '-')}</td>
      <td>${escapeHtml(r.message || '-')}</td>
      <td>${escapeHtml(r.location || '-')}</td>
      <td>${escapeHtml(r.chat_type || '-')}</td>
      <td>${escapeHtml(r.source || 'Telegram')}</td>
    </tr>
    `;
    console.log('HTML for row:', row);
    return row;
  }).join('');
  
  console.log('✅ Final HTML:', html);
  eventsBody.innerHTML = html;
}

function setupAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (autoRefresh?.checked) {
    refreshTimer = setInterval(loadData, 5000);
  }
}

async function fetchJson(url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    
    console.log('🔍 Response:', { status: res.status, text: text.substring(0, 200) });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error('JSON Parse Error:', e, 'Text:', text);
      throw new Error(`תגובה לא תקינה מהשרת (לא JSON). בדוק URL / הרשאות deployment. HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
      throw new Error(`שגיאת CORS או כשל בחיבור לשרת. בדוק את כתובת ה-URL וודא שהיא HTTPS`);
    }
    throw err;
  }
}

function normalizeServerError(err, baseUrl) {
  const text = String(err || '').trim();
  if (!text) {
    return `השמירה נכשלה. בדוק שה-URL הוא Web App מסוג /exec: ${baseUrl}`;
  }

  if (/apps\s*script|appps\s*script|deploy|לא עודכן/i.test(text)) {
    return `השרת שהוגדר בכתובת הזו מחזיר גרסה ישנה או שגויה: ${baseUrl}. יש לפתוח את הכתובת בדפדפן עם ?action=list ולוודא שמתקבל JSON עם ok=true.`;
  }

  return text;
}

function loadData() {
  const entries = JSON.parse(localStorage.getItem(EM_ENTRIES_KEY) || '[]');
  render(entries.slice().reverse());
  if (lastUpdated) lastUpdated.textContent = `עודכן: ${new Date().toLocaleTimeString('he-IL')}`;
}

function ensureDemoEntries() {
  if (localStorage.getItem(EM_ENTRIES_KEY)) return; // כבר יש נתונים
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const demo = [
    { id: 'd1', timestamp: ago(180), sender: 'פיקוד צפון', message: 'נפילת רקטה ברחוב הרצל 42 - דיווח על נפגעים', location: 'רחוב הרצל 42, בת ים', classification: 'חירום', status: 'בטיפול', chat_type: 'Telegram', source: 'מוקד מרכזי', latitude: 32.0170, longitude: 34.7492 },
    { id: 'd2', timestamp: ago(155), sender: 'מד"א בת ים', message: '3 פצועים הועברו לבית חולים וולפסון', location: 'רחוב הרצל 42', classification: 'כוחות', status: 'בטיפול', chat_type: 'מוקד', source: 'מד"א', latitude: null, longitude: null },
    { id: 'd3', timestamp: ago(130), sender: 'כבאות', message: 'שריפה קטנה בעקבות פגיעה - טופלה בשטח', location: 'שד\' בן גוריון 10', classification: 'כוחות', status: 'נסגר', chat_type: 'מוקד', source: 'כבאות', latitude: 32.0210, longitude: 34.7510 },
    { id: 'd4', timestamp: ago(110), sender: 'עירייה', message: 'פינוי תושבים מבניין פגוע - 18 נפשות פונו', location: 'רחוב ביאליק 17', classification: 'אוכלוסייה', status: 'בטיפול', chat_type: 'מוקד', source: 'מוקד עירוני', latitude: 32.0195, longitude: 34.7480 },
    { id: 'd5', timestamp: ago(85), sender: 'תאגיד מים', message: 'נזק לצינור מים ראשי - אספקה מופסקת ל-3 בניינים', location: 'רחוב אחד העם 55', classification: 'תשתיות', status: 'בטיפול', chat_type: 'מוקד', source: 'תאגיד מים', latitude: null, longitude: null },
    { id: 'd6', timestamp: ago(60), sender: 'פיקוד עורף', message: 'התרעה: צפי לנפילות נוספות באזור מרכז בת ים', location: 'בת ים - מרכז', classification: 'חירום', status: 'חירום', chat_type: 'Telegram', source: 'פיקוד עורף', latitude: null, longitude: null },
    { id: 'd7', timestamp: ago(42), sender: 'מוקד מרכזי', message: 'נפגע נוסף מחפצים שנשרו - פצוע קל', location: 'שד\' רוטשילד 7', classification: 'כוחות', status: 'בטיפול', chat_type: 'manual', source: 'מוקד מרכזי', latitude: 32.0225, longitude: 34.7498 },
    { id: 'd8', timestamp: ago(20), sender: 'עירייה', message: 'מרכז קהילתי גאולה נפתח לאיסוף מפונים - קיבולת 80 נפש', location: 'רחוב הרצל 20', classification: 'אוכלוסייה', status: 'פעיל', chat_type: 'מוקד', source: 'מוקד עירוני', latitude: 32.0175, longitude: 34.7505 },
    { id: 'd9', timestamp: ago(10), sender: 'משטרה', message: 'תחנת משטרה בת ים מתגברת - כוחות בשטח', location: 'רחוב הנביאים 3', classification: 'כוחות', status: 'פעיל', chat_type: 'מוקד', source: 'משטרה', latitude: null, longitude: null },
    { id: 'd10', timestamp: ago(3), sender: 'חפ"ק עיר', message: 'מצב עדכני: 4 פצועים, 18 מפונים, תשתיות מים בטיפול', location: 'בת ים', classification: 'מצב כולל', status: 'בטיפול', chat_type: 'manual', source: 'חפ"ק עיר', latitude: null, longitude: null },
  ];
  localStorage.setItem(EM_ENTRIES_KEY, JSON.stringify(demo));
}

loadData();
setupAutoRefresh();

// סימון אוטומטי על המפה כשנוצר אירוע עם מיקום
function autoMarkEntryOnMap(payload) {
  const markerType = (['חירום','נפילה','פגיעה'].some(w => (payload.message||'').includes(w))) ? 'rocket' : 'rescue';
  const label = payload.location || payload.message?.slice(0,30) || 'אירוע';
  // שמור ל-localStorage של המפה
  const pts = JSON.parse(localStorage.getItem('em_map_points') || '[]');
  pts.push({ lat: payload.latitude, lng: payload.longitude, label, type: markerType, emoji: '', index: pts.length + 1 });
  localStorage.setItem('em_map_points', JSON.stringify(pts));
  // אם המפה פתוחה, עדכן אותה בזמן אמת
  if (typeof notifyImpactPoint === 'function') {
    notifyImpactPoint(payload.latitude, payload.longitude, label, markerType);
  }
  if (typeof renderMapPoints === 'function') renderMapPoints();
}

// אתחול דשבורד בטעינה ראשונה
setTimeout(() => {
  if (typeof initDashboardTab === 'function') initDashboardTab();
}, 1200);
// ============ TABS & STATUS DASHBOARD ============
const TAB_CONFIG_KEY = 'emergency_status_cards';
const STATUS_ACTIONS = {
  list: 'status_cards_list',
  upsert: 'status_cards_upsert',
  delete: 'status_cards_delete'
};
const SITREP_ACTIONS = {
  list: 'sitrep_list',
  latest: 'sitrep_latest',
  upsert: 'sitrep_upsert'
};
let statusCards = [];

// קבע טבים
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  // בדיקת הרשאה (auth.js)
  if (typeof hasPermission === 'function' && !hasPermission(tabName, 'read')) return;

  // הסר active מכל הטבים וקונטנט
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  // הוסף active לטאב ותוכן הנבחר
  document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
  document.getElementById(`${tabName}-tab`)?.classList.add('active');

  if (tabName === 'dashboard') {
    if (typeof initDashboardTab === 'function') initDashboardTab();
    return;
  }

  if (tabName === 'status') {
    loadStatusCards();
  }

  if (tabName === 'map') {
    initMap();
  }

  if (tabName === 'sitrep') {
    loadSitrepLatest();
  }

  if (tabName === 'evacuees') {
    if (typeof initEvacueesTab === 'function') initEvacueesTab();
  }

  if (tabName === 'infrastructure') {
    if (typeof initInfraTab === 'function') initInfraTab();
  }

  if (tabName === 'shelters') {
    if (typeof initSheltersTab === 'function') initSheltersTab();
  }

  if (tabName === 'hotels') {
    if (typeof renderHotelsTab === 'function') renderHotelsTab();
  }

  if (tabName === 'users') {
    if (typeof loadUsersTab === 'function') loadUsersTab();
  }
}

function initMap() {
  if (!mapContainer) return;
  if (map) {
    setTimeout(() => map.invalidateSize(), 0);
    return;
  }

  map = L.map(mapContainer, {
    center: BAT_YAM_CENTER,
    zoom: 17,
    preferCanvas: true
  });

  L.tileLayer(mapTileUrl, {
    attribution: mapTileAttribution,
    maxZoom: 19
  }).addTo(map);

  mapMarkersLayer = L.layerGroup().addTo(map);

  map.on('click', (event) => {
    const { lat, lng } = event.latlng;
    addMapPoint(lat, lng, activeAddressLabel || mapAddressInput?.value?.trim() || '');
  });
}

function resetMapSelection() {
  selectedMapLocation = { lat: null, lng: null };
  mapSelectedCoordinatesEl.textContent = 'לא נבחר';
  mapSelectedLabelEl.textContent = '-';
  locationInput.value = locationInput.value || '';
  if (mapMarker && map) {
    map.removeLayer(mapMarker);
    mapMarker = null;
  }
}

function updateMapSelection(lat, lng) {
  selectedMapLocation = { lat, lng };
  mapSelectedCoordinatesEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  mapSelectedLabelEl.textContent = `מסומן מפה`;
  locationInput.value = `קו"מ: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  if (mapMarker) {
    mapMarker.setLatLng([lat, lng]);
  } else {
    mapMarker = L.marker([lat, lng]).addTo(map);
  }
}

// ניהול קוביות תמונת מצב
function resetMapSelection() {
  mapPoints = [];
  selectedMapLocation = { lat: null, lng: null };
  activeAddressLabel = '';
  mapSelectedCoordinatesEl.textContent = 'לא נבחר';
  mapSelectedLabelEl.textContent = '-';
  if (mapSearchStatusEl) {
    mapSearchStatusEl.textContent = 'הסימון אופס. אפשר לחפש כתובת חדשה או לסמן נקודות על התצ"א.';
  }
  if (mapMarkersLayer) {
    mapMarkersLayer.clearLayers();
  }
  renderMapPoints();
}

function removeLastMapPoint() {
  if (!mapPoints.length) return;
  mapPoints.pop();
  const lastPoint = mapPoints[mapPoints.length - 1];
  if (lastPoint) {
    selectedMapLocation = { lat: lastPoint.lat, lng: lastPoint.lng };
    activeAddressLabel = lastPoint.label || activeAddressLabel;
  } else {
    selectedMapLocation = { lat: null, lng: null };
    activeAddressLabel = '';
  }
  renderMapPoints();
}

function updateMapSelection(lat, lng, label = '') {
  selectedMapLocation = { lat, lng };
  mapSelectedCoordinatesEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  mapSelectedLabelEl.textContent = label || 'סימון מפה';
  locationInput.value = label || `נ.צ.: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function renderMapPoints() {
  if (mapMarkersLayer) {
    mapMarkersLayer.clearLayers();
    mapPoints.forEach((point, index) => {
      const icon   = getMarkerIcon(point.type, point.emoji, index);
      const marker = L.marker([point.lat, point.lng], {
        icon,
        title: point.label || `נקודה ${index + 1}`,
      });
      const typeInfo = MARKER_TYPES[point.type] || MARKER_TYPES.custom;
      marker.bindPopup(`
        <div dir="rtl" style="text-align:right; font-family:Rubik,Arial,sans-serif; min-width:170px">
          <div style="font-size:1.6rem; margin-bottom:4px">${point.emoji || typeInfo.emoji}</div>
          <strong style="font-size:0.95rem">${escapeHtml(point.label)}</strong>
          <div style="color:#94a3b8; font-size:0.82rem; margin-top:6px">
            ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}
          </div>
        </div>
      `);
      marker.addTo(mapMarkersLayer);
    });
  }

  if (mapPointsCountEl) {
    mapPointsCountEl.textContent = String(mapPoints.length);
  }

  if (mapPointsListEl) {
    if (!mapPoints.length) {
      mapPointsListEl.innerHTML = '<div class="map-empty-state">עדיין לא סומנו נקודות.</div>';
    } else {
      mapPointsListEl.innerHTML = mapPoints.map((point, index) => `
        <div class="map-point-item">
          <strong>${point.emoji || '📍'} ${escapeHtml(point.label || 'סימון ידני')}</strong>
          <span>${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</span>
        </div>
      `).join('');
    }
  }

  const lastPoint = mapPoints[mapPoints.length - 1];
  if (lastPoint) {
    updateMapSelection(lastPoint.lat, lastPoint.lng, lastPoint.label || activeAddressLabel || '');
  } else {
    mapSelectedCoordinatesEl.textContent = 'לא נבחר';
    mapSelectedLabelEl.textContent = '-';
  }
}

function getMarkerIcon(type, emoji, index) {
  const typeInfo = MARKER_TYPES[type] || MARKER_TYPES.custom;
  const color    = typeInfo.color;
  const icon     = emoji || typeInfo.emoji;
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin" style="border-color:${color}; box-shadow:0 3px 10px ${color}66">
             <span class="marker-emoji">${icon}</span>
             <span class="marker-num">${index + 1}</span>
           </div>`,
    iconSize:    [44, 44],
    iconAnchor:  [22, 44],
    popupAnchor: [0, -46],
  });
}

function addMapPoint(lat, lng, label = '') {
  const resolvedType = activeMarkerType || 'rocket';
  const typeInfo     = MARKER_TYPES[resolvedType] || MARKER_TYPES.custom;

  let emoji      = typeInfo.emoji;
  let pointLabel = String(label || '').trim();

  if (resolvedType === 'custom') {
    const customEmoji = (document.getElementById('customMarkerEmoji')?.value || '').trim();
    const customLabel = (document.getElementById('customMarkerLabel')?.value || '').trim();
    if (customEmoji) emoji = customEmoji;
    if (!pointLabel && customLabel) pointLabel = customLabel;
  }

  if (!pointLabel) pointLabel = `${typeInfo.label} ${mapPoints.length + 1}`;

  const newPoint = { lat, lng, label: pointLabel, type: resolvedType, emoji };
  mapPoints.push(newPoint);
  renderMapPoints();

  // עדכון מודולים (מרכזי משפחות / מפונים)
  if (typeof notifyImpactPoint === 'function') {
    notifyImpactPoint(lat, lng, pointLabel, resolvedType);
  }
}

function renderMapSearchResults(results = []) {
  mapSearchResults = Array.isArray(results) ? results : [];
  if (!mapSearchResultsEl) return;

  if (!mapSearchResults.length) {
    mapSearchResultsEl.innerHTML = '';
    return;
  }

  mapSearchResultsEl.innerHTML = mapSearchResults.map((result, index) => `
    <button type="button" class="map-search-result" data-result-index="${index}">
      ${escapeHtml(result.display_name || `${result.lat}, ${result.lon}`)}
    </button>
  `).join('');

  mapSearchResultsEl.querySelectorAll('[data-result-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const resultIndex = Number(button.getAttribute('data-result-index'));
      focusMapOnAddress(mapSearchResults[resultIndex]);
    });
  });
}

function focusMapOnAddress(result) {
  if (!result || !map) return;
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  activeAddressLabel = String(result.display_name || mapAddressInput?.value || '').trim();
  map.setView([lat, lng], Math.max(map.getZoom(), 18), { animate: true });
  updateMapSelection(lat, lng, activeAddressLabel || 'כתובת שנמצאה');
  if (mapSearchStatusEl) {
    mapSearchStatusEl.textContent = 'הכתובת נמצאה. אפשר עכשיו ללחוץ על המפה ולהוסיף נקודות בזירה.';
  }
}

async function searchMapAddress() {
  const rawQuery = mapAddressInput?.value?.trim();
  if (!rawQuery) {
    if (mapSearchStatusEl) mapSearchStatusEl.textContent = 'יש להזין כתובת לפני החיפוש.';
    renderMapSearchResults([]);
    return;
  }

  if (mapSearchStatusEl) mapSearchStatusEl.textContent = 'מחפש כתובת בבת ים...';

  const query = rawQuery.includes('בת ים') ? rawQuery : `${rawQuery}, בת ים, ישראל`;
  const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
  searchUrl.searchParams.set('format', 'jsonv2');
  searchUrl.searchParams.set('limit', '5');
  searchUrl.searchParams.set('countrycodes', 'il');
  searchUrl.searchParams.set('q', query);

  try {
    const results = await fetchJson('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: searchUrl.toString(),
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'he'
        }
      })
    });

    if (!Array.isArray(results) || !results.length) {
      renderMapSearchResults([]);
      if (mapSearchStatusEl) mapSearchStatusEl.textContent = 'לא נמצאה כתובת מתאימה. נסה לחדד מספר בית או רחוב.';
      return;
    }

    renderMapSearchResults(results);
    focusMapOnAddress(results[0]);
  } catch (error) {
    renderMapSearchResults([]);
    if (mapSearchStatusEl) mapSearchStatusEl.textContent = `חיפוש הכתובת נכשל: ${error.message}`;
  }
}

const statusCardsContainer = document.getElementById('statusCardsContainer');
const addStatusCardBtn = document.getElementById('addStatusCard');
const statusSyncStatusEl = document.getElementById('statusSyncStatus');

function setStatusSyncStatus(type = 'warn', text = '⚠️ סטטוס סנכרון לא ידוע') {
  if (!statusSyncStatusEl) return;
  statusSyncStatusEl.classList.remove('sync-status-ok', 'sync-status-warn', 'sync-status-error');
  if (type === 'ok') statusSyncStatusEl.classList.add('sync-status-ok');
  else if (type === 'error') statusSyncStatusEl.classList.add('sync-status-error');
  else statusSyncStatusEl.classList.add('sync-status-warn');
  statusSyncStatusEl.textContent = text;
}

addStatusCardBtn?.addEventListener('click', () => {
  showAddCardModal();
});

async function fetchStatusCardsFromStorage() {
  return JSON.parse(localStorage.getItem(TAB_CONFIG_KEY) || '[]');
}

async function upsertStatusCardToStorage(card) {
  const cards = JSON.parse(localStorage.getItem(TAB_CONFIG_KEY) || '[]');
  const idx = cards.findIndex(c => String(c.id || '') === String(card.id || ''));
  if (idx >= 0) cards[idx] = card;
  else cards.push(card);
  localStorage.setItem(TAB_CONFIG_KEY, JSON.stringify(cards));
  return { synced: true };
}

async function deleteStatusCardFromStorage(cardId) {
  const cards = JSON.parse(localStorage.getItem(TAB_CONFIG_KEY) || '[]').filter(c => String(c.id || '') !== String(cardId || ''));
  localStorage.setItem(TAB_CONFIG_KEY, JSON.stringify(cards));
  return { synced: true };
}

async function loadStatusCards() {
  try {
    const cards = await fetchStatusCardsFromStorage();
    statusCards = cards;
    updateStatusSummary(cards);
    statusCardsContainer.innerHTML = '';
    setStatusSyncStatus('ok', '🟢 מסונכרן עם השרת');
  
    if (cards.length === 1) {
      statusCardsContainer.classList.add('single-card-layout');
    } else {
      statusCardsContainer.classList.remove('single-card-layout');
    }
  
    if (cards.length === 0) {
      statusCardsContainer.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748b; padding: 40px;">אין קוביות עדיין. הוסף קובייה חדשה!</p>';
      return;
    }
  
    cards.forEach((card, idx) => {
      const cardEl = createStatusCardElement(card, idx);
      statusCardsContainer.appendChild(cardEl);
    });
  } catch (err) {
    statusCards = [];
    updateStatusSummary([]);
    statusCardsContainer.classList.remove('single-card-layout');
    statusCardsContainer.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #fca5a5; padding: 40px;">שגיאה בטעינת תמונת מצב מהשרת: ${escapeHtml(err.message)}</p>`;
    setStatusSyncStatus('error', '🔴 אין סנכרון מול השרת');
  }
}

function updateStatusSummary(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const totals = list.reduce((acc, card) => {
    const injuries = card?.injuries || {};
    const injured = Number(injuries['קל'] || 0) + Number(injuries['בינוני'] || 0) + Number(injuries['קשה'] || 0) + Number(injuries['חרדה'] || 0);
    acc.injured += injured;
    acc.disconnected += Number(card?.disconnected ?? card?.evacuated ?? 0);
    acc.damaged += Number(card?.damaged || 0);
    return acc;
  }, { injured: 0, disconnected: 0, damaged: 0 });

  if (statusKpiInjured) statusKpiInjured.textContent = String(totals.injured);
  if (statusKpiScenes) statusKpiScenes.textContent = String(list.length);
  if (statusKpiDisconnected) statusKpiDisconnected.textContent = String(totals.disconnected);
  if (statusKpiDamaged) statusKpiDamaged.textContent = String(totals.damaged);
}

function createStatusCardElement(card, idx) {
  const div = document.createElement('div');
  div.className = 'status-card';

  const getMunicipalForceCount = (forceName) => {
    const raw = card.municipalForces?.[forceName];
    if (typeof raw === 'number') return raw;
    if (raw === true) return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  
  // קוד הצבע בהתאם לסוג פגיעה
  const injuryTypeColor = {
    'ישירה': '#ef4444',
    'מצרר': '#f97316',
    'רסיס': '#eab308',
    'הדף': '#3b82f6'
  };
  
  const injuryColor = injuryTypeColor[card.injuryType] || '#64748b';
  const editorName = card.editor || '-';

  const injuries = {
    קל: Number(card.injuries?.קל || 0),
    בינוני: Number(card.injuries?.בינוני || 0),
    קשה: Number(card.injuries?.קשה || 0),
    חרדה: Number(card.injuries?.חרדה || 0)
  };
  const fatalities = Number(card.fatalities || 0);
  const injurySummary = Object.entries(injuries)
    .filter(([, val]) => val > 0)
    .map(([label, val]) => `${label}: ${val}`)
    .join(' | ') || 'אין פצועים מדווחים';

  const disconnected = Number(card.disconnected ?? card.evacuated ?? 0);
  const damaged = Number(card.damaged || 0);
  const hazaram = Number(card.hazaram || 0);
  
  // כוחות שנוכחים
  const forces = ['משטרה', 'כיבוי אש', 'פקע"ר', 'בארי', 'מס רכוש'];
  const presentForces = forces.filter(f => card.forces?.[f]).join(' | ') || 'אין';
  
  // כוחות עירייה, כולל טקסט חופשי
  const municipalForces = ['עובדים סוציאלים', 'מהנדסים', 'חפ"ק', 'פיקוח', 'לביא', 'קהילה'];
  let presentMunicipalForces = municipalForces
    .map(f => ({ name: f, count: getMunicipalForceCount(f) }))
    .filter(item => item.count > 0)
    .map(item => `${item.name}: ${item.count}`)
    .join(' | ');
  if (card.municipalForces?.other) {
    const otherText = escapeHtml(card.municipalForces.other);
    presentMunicipalForces = presentMunicipalForces ? `${presentMunicipalForces} | ${otherText}` : otherText;
  }
  if (!presentMunicipalForces) {
    presentMunicipalForces = 'אין';
  }
  
  // תשתיות
  const infraTypes = ['חשמל', 'גז', 'מים'];
  const presentInfra = infraTypes.filter(f => card.infrastructure?.[f]).join(' | ') || 'אין';

  const toolTypes = ['מנוף', 'באגר', 'גנרטור', 'גרר'];
  const hasTowTruck = !!(card.sceneTools?.['גרר'] || card.sceneTools?.['רכב חילוץ']);
  let presentTools = toolTypes.filter(t => {
    if (t === 'גרר') return hasTowTruck;
    return card.sceneTools?.[t];
  }).join(' | ');
  if (card.sceneTools?.other) {
    presentTools = presentTools ? `${presentTools} | ${escapeHtml(card.sceneTools.other)}` : escapeHtml(card.sceneTools.other);
  }
  if (!presentTools) presentTools = 'אין';
  const mediaItems = Array.isArray(card.mediaItems)
    ? card.mediaItems
    : parseMediaItems(card.media);
  
  // הגדרות נראות, עם ברירת מחדל להצגה
  const vis = {
    metrics: card.visibility?.metrics !== false,
    forces: card.visibility?.forces !== false,
    municipalForces: card.visibility?.municipalForces !== false,
    infrastructure: card.visibility?.infrastructure !== false,
    publicFacilities: card.visibility?.publicFacilities !== false,
    description: card.visibility?.description !== false,
  };
  
  div.innerHTML = `
    <div class="status-card-header">
      <div>
        <div class="status-card-title">${escapeHtml(card.title || 'ללא שם')}</div>
        <div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 2px; margin-right: 10px;">
          👤 מנהל זירה: ${escapeHtml(card.managerName || '-')}
        </div>
        <div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 2px; margin-right: 10px;">
          ✍️ עורך: ${escapeHtml(editorName)}
        </div>
        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px; margin-right: 10px;">
          📍 סוג פגיעה: <span style="color: ${injuryColor}; font-weight: bold;">${escapeHtml(card.injuryType || 'לא צוין')}</span>
        </div>
        ${card.impactTime ? `
        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px; margin-right: 10px;">
          🕒 שעת פגיעה: <span style="color: #facc15; font-weight: bold;">${escapeHtml(fmt(card.impactTime))}</span>
        </div>
        ` : ''}
      </div>
      <button class="status-card-delete" onclick="deleteStatusCard(${idx})">🗑️</button>
    </div>
    
    ${vis.metrics ? `
    <div class="status-card-metrics">
      <div class="metric" style="grid-column: 1 / -1; text-align: right;">
        <div class="metric-label">🚑 פצועים</div>
        <div class="metric-value" style="font-size: 1rem; line-height: 1.35;">${escapeHtml(injurySummary)}</div>
      </div>
      ${fatalities > 0 ? `
      <div class="metric">
        <div class="metric-label">🕯️ הרוגים</div>
        <div class="metric-value">${fatalities}</div>
      </div>
      ` : ''}
      <div class="metric">
        <div class="metric-label">📵 מנותקי קשר</div>
        <div class="metric-value">${disconnected}</div>
      </div>
      <div class="metric">
        <div class="metric-label">🏚️ מבנים שנפגעו</div>
        <div class="metric-value">${damaged}</div>
      </div>
      ${hazaram > 0 ? `
      <div class="metric">
        <div class="metric-label">🛖 חצר"מים</div>
        <div class="metric-value">${hazaram}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}
    
    ${vis.forces ? `
    <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 10px; margin-bottom: 8px; font-size: 0.85rem; color: #cbd5e1;">
      👮 <strong>כוחות בשטח:</strong> ${presentForces}
    </div>
    ` : ''}
    
    ${vis.municipalForces ? `
    <div style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 8px; padding: 10px; margin-bottom: 8px; font-size: 0.85rem; color: #cbd5e1;">
      🏛️ <strong>כוחות עירייה:</strong> ${presentMunicipalForces}
    </div>
    ` : ''}
    
    ${vis.infrastructure ? `
    <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; padding: 10px; margin-bottom: 8px; font-size: 0.85rem; color: #cbd5e1;">
      🔧 <strong>תשתיות שנפגעו:</strong> ${presentInfra}
    </div>
    ` : ''}

    <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 10px; margin-bottom: 8px; font-size: 0.85rem; color: #cbd5e1;">
      🧰 <strong>כלים בזירה:</strong> ${presentTools}
    </div>

    ${mediaItems.length ? `
    <div class="status-media-section">
      <strong>📷 מדיה מהזירה:</strong>
      <div class="status-media-grid">
        ${mediaItems.map((url) => {
          const safeUrl = escapeHtml(url);
          const type = mediaTypeFromUrl(url);
          if (type === 'image') {
            return `<a href="${safeUrl}" target="_blank" rel="noopener"><img class="status-media-thumb" src="${safeUrl}" alt="media"></a>`;
          }
          if (type === 'video') {
            return `<video class="status-media-thumb" controls preload="metadata" src="${safeUrl}"></video>`;
          }
          return `<a class="status-media-link" href="${safeUrl}" target="_blank" rel="noopener">🔗 קישור מדיה</a>`;
        }).join('')}
      </div>
    </div>
    ` : ''}
    
    ${vis.publicFacilities ? `
    <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.85rem; color: #cbd5e1;">
      📢 ${card.infoPoint ? '✅ עמדת מידע פתוחה' : '❌ אין עמדת מידע'} | 
      ${card.familyCenter ? '✅ מרכז משפחות' + (card.familyCenterLocation ? ': ' + escapeHtml(card.familyCenterLocation) : '') : '❌ אין מרכז משפחות'}
    </div>
    ` : ''}
    
    ${vis.description ? `
    <div class="status-card-description">${escapeHtml(card.description || '-')}</div>
    ` : ''}
    
    <div class="status-card-footer">
      <span>עודכן: ${new Date(card.updated || Date.now()).toLocaleString('he-IL')}</span>
      <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;" onclick="editStatusCard(${idx})">✏️ ערוך</button>
    </div>
  `;
  return div;
}

async function deleteStatusCard(idx) {
  if (!confirm('האם בטוח רוצה למחוק קובייה זו?')) return;
  
  const deletedCard = statusCards[idx];
  if (!deletedCard) return;

  try {
    await deleteStatusCardFromStorage(deletedCard.id);
    setStatusSyncStatus('ok', '🟢 מחיקה סונכרנה לשרת');
    await loadStatusCards();

    // שדר גם מחיקה ליומן האירועים
    await logStatusUpdateToSheet(
      { ...deletedCard, updated: new Date().toISOString() },
      'delete',
      `נמחקה קובייה: ${deletedCard.title || 'ללא שם'}`
    );
  } catch (err) {
    setStatusSyncStatus('error', '🔴 מחיקה נכשלה - לא סונכרן לשרת');
    alert(`שגיאה במחיקה: ${err.message}`);
  }
}

function editStatusCard(idx) {
  showAddCardModal(statusCards[idx], idx);
}

function showAddCardModal(card = null, idx = null) {
  const isEdit = card !== null;
  const title = isEdit ? 'עדכן קובייה' : 'הוסף קובייה חדשה';
  const initialMediaItems = Array.isArray(card?.mediaItems)
    ? card.mediaItems
    : parseMediaItems(card?.media);
  const initialMediaLinks = initialMediaItems.filter(item => !String(item || '').startsWith('data:'));
  const initialEmbeddedMedia = initialMediaItems.filter(item => String(item || '').startsWith('data:'));
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-height: 90vh; overflow-y: auto;">
      <h3>${title}</h3>
      
      <input type="text" id="cardTitle" placeholder="כותרת" value="${escapeHtml(card?.title || '')}">
      
      <input type="text" id="cardManagerName" placeholder="שם מנהל הזירה" value="${escapeHtml(card?.managerName || '')}">

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        ✍️ עורך:
        <select id="cardEditor" style="display: block; width: 100%; padding: 8px; margin-top: 4px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px;">
          <option value="">בחר עורך...</option>
          <option value="מבצעים" ${card?.editor === 'מבצעים' ? 'selected' : ''}>מבצעים</option>
          <option value="אוכלוסיה" ${card?.editor === 'אוכלוסיה' ? 'selected' : ''}>אוכלוסיה</option>
          <option value="מכלול מנכ\"ל" ${card?.editor === 'מכלול מנכ"ל' ? 'selected' : ''}>מכלול מנכ"ל</option>
          <option value="מידע לציבור" ${card?.editor === 'מידע לציבור' ? 'selected' : ''}>מידע לציבור</option>
          <option value="קהילה" ${card?.editor === 'קהילה' ? 'selected' : ''}>קהילה</option>
          <option value="תשתיות" ${card?.editor === 'תשתיות' ? 'selected' : ''}>תשתיות</option>
          <option value="לוגיסטיקה" ${card?.editor === 'לוגיסטיקה' ? 'selected' : ''}>לוגיסטיקה</option>
        </select>
      </label>
      
      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        📍 סוג הפגיעה:
        <select id="cardInjuryType" style="display: block; width: 100%; padding: 8px; margin-top: 4px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px;">
          <option value="">בחר סוג פגיעה...</option>
          <option value="ישירה" ${card?.injuryType === 'ישירה' ? 'selected' : ''}>פגיעה ישירה 💣</option>
          <option value="מצרר" ${card?.injuryType === 'מצרר' ? 'selected' : ''}>מצרר 💨</option>
          <option value="רסיס" ${card?.injuryType === 'רסיס' ? 'selected' : ''}>רסיס 🔥</option>
          <option value="הדף" ${card?.injuryType === 'הדף' ? 'selected' : ''}>הדף 💨</option>
        </select>
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🕒 שעת פגיעה:
        <input type="datetime-local" id="cardImpactTime" value="${escapeHtml(toDateTimeLocalValue(card?.impactTime || ''))}" style="display: block; width: 100%; padding: 8px; margin-top: 4px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px;">
      </label>
      
      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        👮 כוחות בשטח:
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="forceMishtar" ${card?.forces?.['משטרה'] ? 'checked' : ''}>
            משטרה
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="forceKibuy" ${card?.forces?.['כיבוי אש'] ? 'checked' : ''}>
            כיבוי אש
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="forceKinua" ${card?.forces?.['פקע"ר'] ? 'checked' : ''}>
            פקע"ר
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="forceBarmi" ${card?.forces?.['בארי'] ? 'checked' : ''}>
            בארי
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="forceRkush" ${card?.forces?.['מס רכוש'] ? 'checked' : ''}>
            מס רכוש
          </label>
        </div>
      </label>
      
      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🏛️ כוחות עירייה בשטח (כמות):
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            עובדים סוציאלים
            <input type="number" id="municSocialWorkers" min="0" value="${Number(card?.municipalForces?.['עובדים סוציאלים'] || (card?.municipalForces?.['עובדים סוציאלים'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            מהנדסים
            <input type="number" id="municEngineers" min="0" value="${Number(card?.municipalForces?.['מהנדסים'] || (card?.municipalForces?.['מהנדסים'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            חפ"ק
            <input type="number" id="municHafak" min="0" value="${Number(card?.municipalForces?.['חפ"ק'] || (card?.municipalForces?.['חפ"ק'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            פיקוח
            <input type="number" id="municPikuach" min="0" value="${Number(card?.municipalForces?.['פיקוח'] || (card?.municipalForces?.['פיקוח'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            לביא
            <input type="number" id="municLavia" min="0" value="${Number(card?.municipalForces?.['לביא'] || (card?.municipalForces?.['לביא'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            קהילה
            <input type="number" id="municKahila" min="0" value="${Number(card?.municipalForces?.['קהילה'] || (card?.municipalForces?.['קהילה'] === true ? 1 : 0))}" style="width: 90px; padding: 6px;">
          </label>
        </div>
        <input type="text" id="municForcesOther" placeholder="כוחות עירייה (אחר, טקסט חופשי)" value="${escapeHtml(card?.municipalForces?.other || '')}" style="width: 100%; padding: 8px; margin-top: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px;">
      </label>
      
      <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px; margin: 10px 0;">
        <input type="checkbox" id="cardInfoPoint" ${card?.infoPoint ? 'checked' : ''}>
        📢 נפתחה עמדת מידע לציבור
      </label>
      
      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🔧 תשתיות שנפגעו:
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px;">
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="infraElectricity" ${card?.infrastructure?.['חשמל'] ? 'checked' : ''}>
            ⚡ חשמל
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="infraGas" ${card?.infrastructure?.['גז'] ? 'checked' : ''}>
            🔥 גז
          </label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <input type="checkbox" id="infraWater" ${card?.infrastructure?.['מים'] ? 'checked' : ''}>
            💧 מים
          </label>
        </div>
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🧰 כלים בזירה:
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="toolCrane" ${card?.sceneTools?.['מנוף'] ? 'checked' : ''}> מנוף</label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="toolExcavator" ${card?.sceneTools?.['באגר'] ? 'checked' : ''}> באגר</label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="toolGenerator" ${card?.sceneTools?.['גנרטור'] ? 'checked' : ''}> גנרטור</label>
          <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="toolTowTruck" ${(card?.sceneTools?.['גרר'] || card?.sceneTools?.['רכב חילוץ']) ? 'checked' : ''}> גרר</label>
        </div>
        <input type="text" id="sceneToolsOther" placeholder="כלים נוספים (טקסט חופשי)" value="${escapeHtml(card?.sceneTools?.other || '')}" style="width: 100%; padding: 8px; margin-top: 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px;">
      </label>
      
      <label style="color: #cbd5e1; display: flex; align-items: center; gap: 6px; margin: 10px 0;">
        <input type="checkbox" id="cardFamilyCenter" ${card?.familyCenter ? 'checked' : ''} onchange="document.getElementById('familyCenterLocation').style.display = this.checked ? 'block' : 'none'">
        👨‍👩‍👧‍👦 נפתח מרכז משפחות
      </label>
      <input type="text" id="familyCenterLocation" placeholder="איפה הוקם מרכז משפחות?" value="${escapeHtml(card?.familyCenterLocation || '')}" style="width: 100%; padding: 8px; margin: 8px 0; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 6px; display: ${card?.familyCenter ? 'block' : 'none'};">
      
      <textarea id="cardDesc" placeholder="תיאור הנזק בטקסט חופשי..." rows="3" style="width: 100%; margin: 10px 0; padding: 10px 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 8px; font-family: inherit;">${escapeHtml(card?.description || '')}</textarea>

      <textarea id="cardMedia" placeholder="מדיה מהזירה (קישורי תמונה/וידאו, כל קישור בשורה חדשה)" rows="3" style="width: 100%; margin: 10px 0; padding: 10px 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.3); color: #f8fafc; border-radius: 8px; font-family: inherit;">${escapeHtml(initialMediaLinks.join('\n'))}</textarea>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 8px 0 4px;">
        📁 העלאת מדיה מהמחשב (תמונות/וידאו):
      </label>
      <input type="file" id="cardMediaFiles" accept="image/*,video/*" multiple style="width: 100%; margin-bottom: 8px;">
      <div style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 8px;">אפשר להעלות עד 8MB לכל קובץ. קבצים נשמרים בתוך הכרטיס.</div>
      <div id="cardMediaUploadsList" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;"></div>
      
      <fieldset style="border: 1px solid #475569; border-radius: 6px; padding: 10px; margin-top: 15px; margin-bottom: 10px;">
        <legend style="color: #94a3b8; font-size: 0.9rem; padding: 0 5px;">הצגת מקטעים בכרטיס</legend>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: #cbd5e1; font-size: 0.9rem;">
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visMetrics" ${card?.visibility?.metrics !== false ? 'checked' : ''}> מדדים</label>
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visForces" ${card?.visibility?.forces !== false ? 'checked' : ''}> כוחות בשטח</label>
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visMunicipal" ${card?.visibility?.municipalForces !== false ? 'checked' : ''}> כוחות עירייה</label>
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visInfra" ${card?.visibility?.infrastructure !== false ? 'checked' : ''}> תשתיות</label>
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visPublic" ${card?.visibility?.publicFacilities !== false ? 'checked' : ''}> מידע ומשפחות</label>
          <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="visDesc" ${card?.visibility?.description !== false ? 'checked' : ''}> תיאור</label>
        </div>
      </fieldset>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        פצועים קל:
        <input type="number" id="cardInjuredLight" value="${Number(card?.injuries?.קל || 0)}" min="0" max="300" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        פצועים בינוני:
        <input type="number" id="cardInjuredMedium" value="${Number(card?.injuries?.בינוני || 0)}" min="0" max="300" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>
      
      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        פצועים קשה:
        <input type="number" id="cardInjuredHard" value="${Number(card?.injuries?.קשה || 0)}" min="0" max="300" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        פצועי חרדה:
        <input type="number" id="cardInjuredAnxiety" value="${Number(card?.injuries?.חרדה || 0)}" min="0" max="300" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        הרוגים:
        <input type="number" id="cardFatalities" value="${Number(card?.fatalities || 0)}" min="0" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        מנותקי קשר:
        <input type="number" id="cardDisconnected" value="${Number(card?.disconnected ?? card?.evacuated ?? 0)}" min="0" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🏚️ מבנים שנפגעו:
        <input type="number" id="cardDamaged" value="${card?.damaged || 0}" min="0" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>

      <label style="color: #94a3b8; font-size: 0.9rem; display: block; margin: 10px 0;">
        🛖 חצר"מים:
        <input type="number" id="cardHazaram" value="${Number(card?.hazaram || 0)}" min="0" style="width: 100%; padding: 8px; margin-top: 4px;">
      </label>
      
      <div class="modal-buttons">
        <button class="btn-secondary" onclick="saveStatusCard(${idx})">
          ${isEdit ? '💾 עדכן' : '➕ הוסף'}
        </button>
        <button class="btn-secondary btn-cancel" onclick="closeModal()">ביטול</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  setupStatusMediaUploader(initialEmbeddedMedia);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

function closeModal() {
  statusModalUploadedMediaItems = [];
  document.querySelector('.modal-overlay')?.remove();
}

function renderStatusModalMediaUploadsList() {
  const listEl = document.getElementById('cardMediaUploadsList');
  if (!listEl) return;

  if (!statusModalUploadedMediaItems.length) {
    listEl.innerHTML = '<div style="font-size: 0.8rem; color: #94a3b8;">לא נבחרו קבצים מהמחשב</div>';
    return;
  }

  listEl.innerHTML = statusModalUploadedMediaItems.map((item, idx) => {
    const type = mediaTypeFromUrl(item);
    if (type === 'image') {
      return `
        <div style="display:flex; align-items:center; gap:8px; background: rgba(15,23,42,.45); border:1px solid rgba(148,163,184,.25); border-radius:8px; padding:8px;">
          <img src="${escapeHtml(item)}" alt="media" style="width:52px; height:52px; object-fit:cover; border-radius:6px;">
          <span style="flex:1; color:#cbd5e1; font-size:0.82rem;">תמונה מקומית ${idx + 1}</span>
          <button type="button" data-remove-media-idx="${idx}" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">הסר</button>
        </div>`;
    }

    if (type === 'video') {
      return `
        <div style="display:flex; align-items:center; gap:8px; background: rgba(15,23,42,.45); border:1px solid rgba(148,163,184,.25); border-radius:8px; padding:8px;">
          <video src="${escapeHtml(item)}" style="width:72px; height:52px; object-fit:cover; border-radius:6px;" muted></video>
          <span style="flex:1; color:#cbd5e1; font-size:0.82rem;">וידאו מקומי ${idx + 1}</span>
          <button type="button" data-remove-media-idx="${idx}" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">הסר</button>
        </div>`;
    }

    return `
      <div style="display:flex; align-items:center; gap:8px; background: rgba(15,23,42,.45); border:1px solid rgba(148,163,184,.25); border-radius:8px; padding:8px;">
        <span style="flex:1; color:#cbd5e1; font-size:0.82rem;">מדיה ${idx + 1}</span>
        <button type="button" data-remove-media-idx="${idx}" style="background:#ef4444; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer;">הסר</button>
      </div>`;
  }).join('');

  listEl.querySelectorAll('button[data-remove-media-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-remove-media-idx'));
      if (Number.isInteger(idx) && idx >= 0) {
        statusModalUploadedMediaItems.splice(idx, 1);
        renderStatusModalMediaUploadsList();
      }
    });
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    reader.readAsDataURL(file);
  });
}

function setupStatusMediaUploader(initialEmbeddedMedia = []) {
  statusModalUploadedMediaItems = Array.isArray(initialEmbeddedMedia)
    ? initialEmbeddedMedia.filter(Boolean)
    : [];
  renderStatusModalMediaUploadsList();

  const fileInput = document.getElementById('cardMediaFiles');
  if (!fileInput) return;

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files) {
      if (file.size > MAX_MEDIA_FILE_SIZE) {
        alert(`הקובץ "${file.name}" גדול מדי (מעל 8MB).`);
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        statusModalUploadedMediaItems.push(dataUrl);
      } catch (err) {
        alert(`לא ניתן להעלות את הקובץ "${file.name}": ${err.message}`);
      }
    }

    fileInput.value = '';
    renderStatusModalMediaUploadsList();
  });
}

function clamp300(num) {
  return Math.max(0, Math.min(300, Number(num) || 0));
}

function summarizeStatusCardChanges(prevCard, nextCard) {
  if (!prevCard) return 'נפתחה זירת אירוע חדשה';

  const changes = [];
  const forceNames = ['משטרה', 'כיבוי אש', 'פקע"ר', 'בארי', 'מס רכוש'];
  const municipalNames = ['עובדים סוציאלים', 'מהנדסים', 'חפ"ק', 'פיקוח', 'לביא', 'קהילה'];
  const infraNames = ['חשמל', 'גז', 'מים'];
  const toolNames = ['מנוף', 'באגר', 'גנרטור', 'גרר'];
  const injuryNames = ['קל', 'בינוני', 'קשה', 'חרדה'];

  const oldForces = prevCard.forces || {};
  const newForces = nextCard.forces || {};
  forceNames.forEach(name => {
    const oldVal = !!oldForces[name];
    const newVal = !!newForces[name];
    if (oldVal !== newVal) {
      changes.push(`${newVal ? 'נוסף' : 'הוסר'} כוח: ${name}`);
    }
  });

  const oldMunicipal = prevCard.municipalForces || {};
  const newMunicipal = nextCard.municipalForces || {};
  municipalNames.forEach(name => {
    const oldCount = Number(oldMunicipal[name] || 0);
    const newCount = Number(newMunicipal[name] || 0);
    if (oldCount !== newCount) {
      changes.push(`כוח עירייה ${name}: ${oldCount}→${newCount}`);
    }
  });

  const oldMunicipalOther = String(oldMunicipal.other || '').trim();
  const newMunicipalOther = String(newMunicipal.other || '').trim();
  if (oldMunicipalOther !== newMunicipalOther) {
    changes.push(`כוחות עירייה (אחר): "${oldMunicipalOther || '-'}" → "${newMunicipalOther || '-'}"`);
  }

  const oldInfra = prevCard.infrastructure || {};
  const newInfra = nextCard.infrastructure || {};
  infraNames.forEach(name => {
    const oldVal = !!oldInfra[name];
    const newVal = !!newInfra[name];
    if (oldVal !== newVal) {
      changes.push(`${newVal ? 'נוספה' : 'הוסרה'} תשתית: ${name}`);
    }
  });

  const oldTools = prevCard.sceneTools || {};
  const newTools = nextCard.sceneTools || {};
  toolNames.forEach(name => {
    const oldVal = name === 'גרר' ? !!(oldTools['גרר'] || oldTools['רכב חילוץ']) : !!oldTools[name];
    const newVal = !!newTools[name];
    if (oldVal !== newVal) {
      changes.push(`${newVal ? 'נוסף' : 'הוסר'} כלי: ${name}`);
    }
  });
  if (String(oldTools.other || '').trim() !== String(newTools.other || '').trim()) {
    changes.push('עודכנו כלים נוספים בזירה');
  }

  const oldInjuries = prevCard.injuries || {};
  const newInjuries = nextCard.injuries || {};
  injuryNames.forEach(level => {
    const oldVal = Number(oldInjuries[level] || 0);
    const newVal = Number(newInjuries[level] || 0);
    if (oldVal !== newVal) {
      changes.push(`פצועים ${level}: ${oldVal}→${newVal}`);
    }
  });

  const scalarFields = [
    ['הרוגים', Number(prevCard.fatalities || 0), Number(nextCard.fatalities || 0)],
    ['מנותקי קשר', Number(prevCard.disconnected ?? prevCard.evacuated ?? 0), Number(nextCard.disconnected ?? nextCard.evacuated ?? 0)],
    ['מבנים שנפגעו', Number(prevCard.damaged || 0), Number(nextCard.damaged || 0)],
    ['חצר"מים', Number(prevCard.hazaram || 0), Number(nextCard.hazaram || 0)],
  ];
  scalarFields.forEach(([label, oldVal, newVal]) => {
    if (oldVal !== newVal) {
      changes.push(`${label}: ${oldVal}→${newVal}`);
    }
  });

  if ((prevCard.managerName || '') !== (nextCard.managerName || '')) {
    changes.push(`מנהל זירה: "${prevCard.managerName || '-'}" → "${nextCard.managerName || '-'}"`);
  }
  if ((prevCard.injuryType || '') !== (nextCard.injuryType || '')) {
    changes.push(`סוג פגיעה: "${prevCard.injuryType || '-'}" → "${nextCard.injuryType || '-'}"`);
  }
  if ((prevCard.editor || '') !== (nextCard.editor || '')) {
    changes.push(`עורך: "${prevCard.editor || '-'}" → "${nextCard.editor || '-'}"`);
  }
  if ((prevCard.description || '') !== (nextCard.description || '')) {
    changes.push('עודכן תיאור');
  }

  return changes.length ? changes.join(' | ') : 'בוצעה עריכה ללא שינוי מפורט';
}

async function saveStatusCard(idx) {
  const title = document.getElementById('cardTitle')?.value.trim();
  const managerName = document.getElementById('cardManagerName')?.value.trim();
  const editor = document.getElementById('cardEditor')?.value || '';
  const description = document.getElementById('cardDesc')?.value.trim();
  const injuredLight = clamp300(document.getElementById('cardInjuredLight')?.value);
  const injuredMedium = clamp300(document.getElementById('cardInjuredMedium')?.value);
  const injuredHard = clamp300(document.getElementById('cardInjuredHard')?.value);
  const injuredAnxiety = clamp300(document.getElementById('cardInjuredAnxiety')?.value);
  const fatalities = parseInt(document.getElementById('cardFatalities')?.value) || 0;
  const disconnected = parseInt(document.getElementById('cardDisconnected')?.value) || 0;
  const damaged = parseInt(document.getElementById('cardDamaged')?.value) || 0;
  const hazaram = parseInt(document.getElementById('cardHazaram')?.value) || 0;
  const injuryType = document.getElementById('cardInjuryType')?.value || '';
  const impactTime = document.getElementById('cardImpactTime')?.value || '';
  const infoPoint = document.getElementById('cardInfoPoint')?.checked || false;
  const familyCenter = document.getElementById('cardFamilyCenter')?.checked || false;
  const familyCenterLocation = document.getElementById('familyCenterLocation')?.value.trim() || '';
  const municipalForcesOther = document.getElementById('municForcesOther')?.value.trim() || '';
  const sceneToolsOther = document.getElementById('sceneToolsOther')?.value.trim() || '';
  const mediaItemsFromLinks = parseMediaItems(document.getElementById('cardMedia')?.value || '');
  const mediaItems = Array.from(new Set([
    ...mediaItemsFromLinks,
    ...statusModalUploadedMediaItems
  ])).slice(0, 20);
  
  // אסוף כוחות חירום שנבחרו
  const forces = {};
  if (document.getElementById('forceMishtar')?.checked) forces['משטרה'] = true;
  if (document.getElementById('forceKibuy')?.checked) forces['כיבוי אש'] = true;
  if (document.getElementById('forceKinua')?.checked) forces['פקע"ר'] = true;
  if (document.getElementById('forceBarmi')?.checked) forces['בארי'] = true;
  if (document.getElementById('forceRkush')?.checked) forces['מס רכוש'] = true;
  
  // אסוף כוחות עירייה שנבחרו
  const municipalForces = {};
  const socialWorkersCount = parseInt(document.getElementById('municSocialWorkers')?.value) || 0;
  const engineersCount = parseInt(document.getElementById('municEngineers')?.value) || 0;
  const hafakCount = parseInt(document.getElementById('municHafak')?.value) || 0;
  const pikuachCount = parseInt(document.getElementById('municPikuach')?.value) || 0;
  const laviaCount = parseInt(document.getElementById('municLavia')?.value) || 0;
  const kahilaCount = parseInt(document.getElementById('municKahila')?.value) || 0;

  if (socialWorkersCount > 0) municipalForces['עובדים סוציאלים'] = socialWorkersCount;
  if (engineersCount > 0) municipalForces['מהנדסים'] = engineersCount;
  if (hafakCount > 0) municipalForces['חפ"ק'] = hafakCount;
  if (pikuachCount > 0) municipalForces['פיקוח'] = pikuachCount;
  if (laviaCount > 0) municipalForces['לביא'] = laviaCount;
  if (kahilaCount > 0) municipalForces['קהילה'] = kahilaCount;
  if (municipalForcesOther) {
    municipalForces.other = municipalForcesOther;
  }
  
  // אסוף תשתיות שנפגעו
  const infrastructure = {};
  if (document.getElementById('infraElectricity')?.checked) infrastructure['חשמל'] = true;
  if (document.getElementById('infraGas')?.checked) infrastructure['גז'] = true;
  if (document.getElementById('infraWater')?.checked) infrastructure['מים'] = true;

  const sceneTools = {};
  if (document.getElementById('toolCrane')?.checked) sceneTools['מנוף'] = true;
  if (document.getElementById('toolExcavator')?.checked) sceneTools['באגר'] = true;
  if (document.getElementById('toolGenerator')?.checked) sceneTools['גנרטור'] = true;
  if (document.getElementById('toolTowTruck')?.checked) sceneTools['גרר'] = true;
  if (sceneToolsOther) sceneTools.other = sceneToolsOther;
  
  // הגדרות נראות
  const visibility = {
    metrics: document.getElementById('visMetrics')?.checked,
    forces: document.getElementById('visForces')?.checked,
    municipalForces: document.getElementById('visMunicipal')?.checked,
    infrastructure: document.getElementById('visInfra')?.checked,
    publicFacilities: document.getElementById('visPublic')?.checked,
    description: document.getElementById('visDesc')?.checked,
  };
  
  if (!title) {
    alert('חובה להזין כותרת');
    return;
  }
  
  const isEdit = idx !== null && idx >= 0 && idx < statusCards.length;
  const existingCard = isEdit ? statusCards[idx] : null;

  const newCard = {
    id: existingCard?.id || `status_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    managerName,
    editor,
    description,
    injuries: {
      קל: injuredLight,
      בינוני: injuredMedium,
      קשה: injuredHard,
      חרדה: injuredAnxiety
    },
    fatalities,
    disconnected,
    damaged,
    hazaram,
    injuryType,
    impactTime,
    forces,
    municipalForces,
    infoPoint,
    familyCenter,
    familyCenterLocation,
    infrastructure,
    sceneTools,
    mediaItems,
    visibility,
    updated: new Date().toISOString()
  };

  const changeSummary = isEdit
    ? summarizeStatusCardChanges(existingCard, newCard)
    : 'נפתחה זירת אירוע חדשה';

  try {
    await upsertStatusCardToStorage(newCard);
    setStatusSyncStatus('ok', '🟢 השמירה סונכרנה לשרת');
    await logStatusUpdateToSheet(newCard, isEdit ? 'edit' : 'create', changeSummary);

    // סמן על המפה אוטומטית (רק בעת יצירה, לא עריכה)
    if (!isEdit) {
      autoMarkStatusCardOnMap(newCard);
    }

    closeModal();
    await loadStatusCards();
  } catch (err) {
    setStatusSyncStatus('error', '🔴 השמירה נכשלה - לא סונכרן לשרת');
    alert(`שגיאה בשמירת קובייה: ${err.message}`);
  }
}

// גיאוקוד כותרת קובייה וסמן על המפה
async function autoMarkStatusCardOnMap(card) {
  if (!card?.title) return;
  // ניסיון גיאוקוד של הכותרת (עשויה להכיל כתובת)
  const titleForGeo = card.title + ', בת ים, ישראל';
  let coords = null;
  try {
    const proxyBase = window.location.origin + '/api/proxy';
    const resp = await fetch(proxyBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(titleForGeo),
        method: 'GET',
      }),
    });
    const data = await resp.json();
    if (Array.isArray(data) && data[0]) {
      coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch { /* שגיאת גיאוקוד — ממשיכים בלי מיקום */ }

  if (!coords) return; // לא נמצא מיקום — לא מסמנים

  const markerType = 'damaged_building';
  const pts = JSON.parse(localStorage.getItem('em_map_points') || '[]');
  pts.push({ lat: coords.lat, lng: coords.lng, label: card.title, type: markerType, emoji: '', index: pts.length + 1 });
  localStorage.setItem('em_map_points', JSON.stringify(pts));

  if (typeof notifyImpactPoint === 'function') {
    notifyImpactPoint(coords.lat, coords.lng, card.title, markerType);
  }
  if (typeof renderMapPoints === 'function') renderMapPoints();
}

// טען קוביות בעת הטעינה ההתחלתית
async function logStatusUpdateToSheet(card, changeType = 'create', changeSummary = '') {
  const base = ''; // localStorage mode — no server needed

  const actionTextByType = {
    create: 'פתיחת זירת אירוע חדשה',
    edit: 'עדכון זירת אירוע',
    delete: 'מחיקת זירת אירוע'
  };
  const actionText = actionTextByType[changeType] || 'עדכון זירת אירוע';
  const updatedAt = parseTime(card.updated) || new Date();
  const updatedAtText = updatedAt.toLocaleString('he-IL');

  const injuries = {
    קל: Number(card.injuries?.קל || 0),
    בינוני: Number(card.injuries?.בינוני || 0),
    קשה: Number(card.injuries?.קשה || 0),
    חרדה: Number(card.injuries?.חרדה || 0)
  };
  const fatalities = Number(card.fatalities || 0);
  const injuriesText = Object.entries(injuries)
    .filter(([, val]) => val > 0)
    .map(([label, val]) => `${label} ${val}`)
    .join(', ') || 'ללא פצועים';

  const municipalCounts = ['עובדים סוציאלים', 'מהנדסים', 'חפ"ק', 'פיקוח', 'לביא', 'קהילה']
    .map(name => {
      const raw = card.municipalForces?.[name];
      const count = typeof raw === 'number' ? raw : (raw === true ? 1 : Number(raw) || 0);
      return { name, count };
    })
    .filter(item => item.count > 0)
    .map(item => `${item.name} ${item.count}`);

  const forcesList = ['משטרה', 'כיבוי אש', 'פקע"ר', 'בארי', 'מס רכוש'].filter(f => card.forces?.[f]).join(', ') || 'אין';
  const municipalList = municipalCounts
    .concat(card.municipalForces?.other ? [card.municipalForces.other] : [])
    .join(', ') || 'אין';
  const infraList = ['חשמל', 'גז', 'מים'].filter(f => card.infrastructure?.[f]).join(', ') || 'אין';
  const toolsList = ['מנוף', 'באגר', 'גנרטור', 'גרר']
    .filter(t => t === 'גרר' ? (card.sceneTools?.['גרר'] || card.sceneTools?.['רכב חילוץ']) : card.sceneTools?.[t])
    .concat(card.sceneTools?.other ? [card.sceneTools.other] : [])
    .join(', ') || 'אין';
  const mediaCount = (Array.isArray(card.mediaItems) ? card.mediaItems.length : parseMediaItems(card.media).length);
  const hazaram = Number(card.hazaram || 0);
  const disconnected = Number(card.disconnected ?? card.evacuated ?? 0);
  const damaged = Number(card.damaged || 0);

  const changeText = changeSummary || (changeType === 'create' ? 'נפתחה זירה חדשה' : changeType === 'delete' ? 'נמחקה זירה' : 'בוצעה עריכה בזירה');
  const message = changeType === 'delete'
    ? `${actionText}: "${card.title}" | זמן עדכון: ${updatedAtText} | שינוי: ${changeText}.`
    : `${actionText}: "${card.title}" | זמן עדכון: ${updatedAtText} | שינוי: ${changeText} | עורך: ${card.editor || 'לא צוין'} | מנהל זירה: ${card.managerName || 'לא צוין'} | סוג פגיעה: ${card.injuryType || 'לא צוין'}${card.impactTime ? ` | שעת פגיעה: ${fmt(card.impactTime)}` : ''} | פצועים: ${injuriesText}${fatalities > 0 ? ` | הרוגים: ${fatalities}` : ''} | מנותקי קשר: ${disconnected} | מבנים שנפגעו: ${damaged}${hazaram > 0 ? ` | חצר"מים: ${hazaram}` : ''} | כוחות בשטח: ${forcesList} | כוחות עירייה: ${municipalList} | תשתיות: ${infraList} | כלים בזירה: ${toolsList} | מדיה: ${mediaCount} פריטים | עמדת מידע: ${card.infoPoint ? 'כן' : 'לא'} | מרכז משפחות: ${card.familyCenter ? `כן${card.familyCenterLocation ? ` (${card.familyCenterLocation})` : ''}` : 'לא'}${card.description ? ` | תיאור: ${card.description}` : ''}`;

  const payload = {
    timestamp: card.updated,
    sender: 'מערכת תמונת מצב',
    message: message,
    location: card.title, // שימוש בכותרת הכרטיס כמיקום ביומן
    classification: 'תמונת מצב / זירה',
    status: changeType === 'delete' ? 'נסגר' : 'בטיפול',
    chat_type: 'manual',
    source: `${card.editor || 'לא צוין'} - מערכת חמ"ל`
  };

  const tryAppendViaProxy = async () => {
    await appendEventViaProxy(base, payload);
  };

  const signature = `${card.id || card.title || 'card'}|${changeType}|${changeText}`;
  const now = Date.now();
  if (signature === statusLogLastSignature && now - statusLogLastAt < 4000) {
    console.warn('⚠️ נמנעה כתיבת לוג כפולה לאותו שינוי.');
    return false;
  }
  statusLogLastSignature = signature;
  statusLogLastAt = now;

  try {
    // שמור ישירות ב-localStorage
    const entries = JSON.parse(localStorage.getItem(EM_ENTRIES_KEY) || '[]');
    entries.push({ ...payload, id: 'sc' + Date.now() });
    localStorage.setItem(EM_ENTRIES_KEY, JSON.stringify(entries));
    loadData();
    return true;
  } catch (err) {
    console.error('שגיאה ברישום עדכון ליומן:', err);
    return false;
  }
}

function getSitrepPromptTemplate() {
  return `אתה קצין הערכת מצב עירוני. קבל טקסט חופשי של הערכת מצב והחזר JSON תקני בלבד.

מכלולים יעד:
מבצעים, כח אדם, קהילה, מידע לציבור, אוכלוסיה, חינוך, תפו"ס, לוגיסטיקה,
הנדסה, תשתיות, חכ"ל, פיקוד העורף, משטרה, כיבוי אש, מד"א,
סמנכ"ל תפעול - יוסי נגולה, מנכ"ל העירייה - רני רוזנהיים, ראש העיר - צביקה ברוט.

סכימה נדרשת:
{
  "summary_title": "string",
  "meeting_time": "string|null",
  "executive_summary": ["string"],
  "clusters": {
    "מבצעים": {"status":"string","highlights":["string"],"needs":["string"]},
    "כח אדם": {"status":"string","highlights":["string"],"needs":["string"]},
    "קהילה": {"status":"string","highlights":["string"],"needs":["string"]},
    "מידע לציבור": {"status":"string","highlights":["string"],"needs":["string"]},
    "אוכלוסיה": {"status":"string","highlights":["string"],"needs":["string"]},
    "חינוך": {"status":"string","highlights":["string"],"needs":["string"]},
    "תפו\"ס": {"status":"string","highlights":["string"],"needs":["string"]},
    "לוגיסטיקה": {"status":"string","highlights":["string"],"needs":["string"]},
    "הנדסה": {"status":"string","highlights":["string"],"needs":["string"]},
    "תשתיות": {"status":"string","highlights":["string"],"needs":["string"]},
    "חכ\"ל": {"status":"string","highlights":["string"],"needs":["string"]},
    "פיקוד העורף": {"status":"string","highlights":["string"],"needs":["string"]},
    "משטרה": {"status":"string","highlights":["string"],"needs":["string"]},
    "כיבוי אש": {"status":"string","highlights":["string"],"needs":["string"]},
    "מד\"א": {"status":"string","highlights":["string"],"needs":["string"]},
    "סמנכ\"ל תפעול - יוסי נגולה": {"status":"string","highlights":["string"],"needs":["string"]},
    "מנכ\"ל העירייה - רני רוזנהיים": {"status":"string","highlights":["string"],"needs":["string"]},
    "ראש העיר - צביקה ברוט": {"status":"string","highlights":["string"],"needs":["string"]}
  },
  "decisions": ["string"],
  "actions_0_6h": ["string"],
  "actions_6_24h": ["string"],
  "risks": ["string"],
  "requests_for_hq": ["string"]
}

כללים:
1) החזר JSON בלבד.
2) אם אין מידע על מכלול מסוים, החזר status: "לא דווח" ורשימות ריקות.
3) שמור ניסוח תמציתי ורשמי.`;
}

function renderSitrepLatest(record) {
  if (!sitrepLatestContainer) return;
  if (!record) {
    sitrepLatestContainer.innerHTML = '<div style="color:#94a3b8">אין הערכת מצב שמורה</div>';
    return;
  }

  const clusters = record.clusters || {};
  const clustersHtml = Object.entries(clusters).map(([name, val]) => {
    const status = escapeHtml(val?.status || 'לא דווח');
    const highlights = Array.isArray(val?.highlights) ? val.highlights : [];
    const needs = Array.isArray(val?.needs) ? val.needs : [];
    return `<div class="card" style="margin-bottom:8px;">
      <div class="label">${escapeHtml(name)}</div>
      <div style="margin:4px 0;"><strong>סטטוס:</strong> ${status}</div>
      <div><strong>עיקרי דברים:</strong> ${highlights.length ? highlights.map(escapeHtml).join(' | ') : '—'}</div>
      <div><strong>צרכים:</strong> ${needs.length ? needs.map(escapeHtml).join(' | ') : '—'}</div>
    </div>`;
  }).join('');

  const listToLine = (arr) => Array.isArray(arr) && arr.length ? arr.map(escapeHtml).join(' | ') : '—';

  sitrepLatestContainer.innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <div class="value" style="font-size:22px;">${escapeHtml(record.summary_title || 'סיכום הערכת מצב')}</div>
      <div class="label">עודכן: ${escapeHtml(fmt(record.updated_at || record.created_at || ''))}</div>
      <div class="label">זמן הערכה: ${escapeHtml(record.meeting_time || '-')}</div>
    </div>
    <div class="panel" style="padding:10px; margin-bottom:10px;">
      <h3 style="margin:0 0 8px 0;">תמצית מנהלים</h3>
      <div>${listToLine(record.executive_summary)}</div>
    </div>
    <div>${clustersHtml || '<div class="label">אין פירוט מכלולים</div>'}</div>
    <div class="panel" style="padding:10px; margin-top:10px;">
      <div><strong>החלטות:</strong> ${listToLine(record.decisions)}</div>
      <div><strong>משימות 0-6 שעות:</strong> ${listToLine(record.actions_0_6h)}</div>
      <div><strong>משימות 6-24 שעות:</strong> ${listToLine(record.actions_6_24h)}</div>
      <div><strong>סיכונים:</strong> ${listToLine(record.risks)}</div>
      <div><strong>בקשות למטה:</strong> ${listToLine(record.requests_for_hq)}</div>
    </div>
  `;
}

async function loadSitrepLatest() {
  if (!sitrepLatestContainer) return;
  try {
    const item = JSON.parse(localStorage.getItem('em_sitrep_latest') || 'null');
    renderSitrepLatest(item);
  } catch (err) {
    sitrepLatestContainer.innerHTML = `<div style="color:#fca5a5">שגיאה בטעינת הערכת מצב: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshAfterSitrepSave() {
  try {
    await loadSitrepLatest();
    await loadData();
    return true;
  } catch (err) {
    console.warn('⚠️ Sitrep נשמר אך רענון הנתונים נכשל (כנראה אופליין):', err?.message || err);
    return false;
  }
}

async function logSitrepToEvents(record) {
  const payload = {
    id: 'sitrep' + Date.now(),
    timestamp: record.updated_at || new Date().toISOString(),
    sender: 'מערכת הערכת מצב',
    message: `הוזנה הערכת מצב חדשה: ${record.summary_title || 'ללא כותרת'}`,
    location: 'חמ"ל עירוני',
    classification: 'הערכת מצב',
    status: 'בטיפול',
    chat_type: 'manual',
    source: record.editor || 'Dashboard'
  };
  try {
    const entries = JSON.parse(localStorage.getItem(EM_ENTRIES_KEY) || '[]');
    entries.push(payload);
    localStorage.setItem(EM_ENTRIES_KEY, JSON.stringify(entries));
  } catch (_) {}
}

async function upsertSitrepWithFallback(base, record) {
  localStorage.setItem('em_sitrep_latest', JSON.stringify(record));
  return { ok: true, via: 'localStorage' };
}

sitrepPromptBtn?.addEventListener('click', async () => {
  const prompt = getSitrepPromptTemplate();
  try {
    await navigator.clipboard.writeText(prompt);
    if (sitrepFormStatus) sitrepFormStatus.textContent = 'הפרומפט הועתק ללוח';
  } catch (_) {
    if (sitrepFormStatus) sitrepFormStatus.textContent = 'לא ניתן להעתיק אוטומטית. אפשר להעתיק ידנית מהקוד.';
    alert(prompt);
  }
});

sitrepSaveBtn?.addEventListener('click', async () => {
  if (!sitrepJsonInput) return;
  try {
    const parsed = JSON.parse(sitrepJsonInput.value || '{}');
    const record = {
      ...parsed,
      raw_text: sitrepRawInput?.value?.trim() || parsed.raw_text || ''
    };

    await upsertSitrepWithFallback('', record);

    if (sitrepFormStatus) {
      sitrepFormStatus.classList.remove('error');
      sitrepFormStatus.textContent = 'הערכת מצב נשמרה בהצלחה';
    }

    await logSitrepToEvents(record);
    const refreshed = await refreshAfterSitrepSave();
    if (!refreshed && sitrepFormStatus) {
      sitrepFormStatus.classList.remove('error');
      sitrepFormStatus.textContent = 'הערכת מצב נשמרה בהצלחה (ללא רענון נתונים במצב אופליין)';
    }
  } catch (err) {
    if (sitrepFormStatus) {
      sitrepFormStatus.classList.add('error');
      sitrepFormStatus.textContent = `שגיאה בשמירה: ${err.message}`;
    }
  }
});

function closeSitrepEditorModal() {
  document.querySelector('.sitrep-editor-overlay')?.remove();
}

function bindSitrepEditorModal() {
  const rawEl = document.getElementById('sitrepRawInputModal');
  const jsonEl = document.getElementById('sitrepJsonInputModal');
  const promptBtn = document.getElementById('sitrepPromptBtnModal');
  const saveBtn = document.getElementById('sitrepSaveBtnModal');
  const closeBtn = document.getElementById('sitrepCloseBtnModal');
  const statusEl = document.getElementById('sitrepFormStatusModal');

  closeBtn?.addEventListener('click', closeSitrepEditorModal);

  promptBtn?.addEventListener('click', async () => {
    const prompt = getSitrepPromptTemplate();
    try {
      await navigator.clipboard.writeText(prompt);
      if (statusEl) statusEl.textContent = 'הפרומפט הועתק ללוח';
    } catch (_) {
      if (statusEl) statusEl.textContent = 'לא ניתן להעתיק אוטומטית. מוצג בחלון.';
      alert(prompt);
    }
  });

  saveBtn?.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(jsonEl?.value || '{}');
      const record = {
        ...parsed,
        raw_text: rawEl?.value?.trim() || parsed.raw_text || ''
      };

      await upsertSitrepWithFallback('', record);

      if (statusEl) {
        statusEl.classList.remove('error');
        statusEl.textContent = 'הערכת מצב נשמרה בהצלחה';
      }

      await logSitrepToEvents(record);
      const refreshed = await refreshAfterSitrepSave();
      if (!refreshed && statusEl) {
        statusEl.classList.remove('error');
        statusEl.textContent = 'הערכת מצב נשמרה בהצלחה (ללא רענון נתונים במצב אופליין)';
      }
      setTimeout(closeSitrepEditorModal, 600);
    } catch (err) {
      if (statusEl) {
        statusEl.classList.add('error');
        statusEl.textContent = `שגיאה בשמירה: ${err.message}`;
      }
    }
  });
}

function openSitrepEditorModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay sitrep-editor-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width: 900px; width: 95%; max-height: 90vh; overflow-y: auto;">
      <h3>עדכון הערכת מצב</h3>
      <textarea id="sitrepRawInputModal" rows="7" placeholder="הדבק כאן את הסיכום החופשי של הערכת המצב..."></textarea>
      <textarea id="sitrepJsonInputModal" rows="10" placeholder="הדבק כאן JSON שהופק מ-Gemini לפי הפרומפט"></textarea>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
        <button type="button" id="sitrepPromptBtnModal">הצג פרומפט ל-Gemini</button>
        <button type="button" id="sitrepSaveBtnModal">שמור הערכת מצב</button>
        <button type="button" id="sitrepCloseBtnModal" class="btn-cancel">סגור</button>
      </div>
      <div id="sitrepFormStatusModal" class="form-status"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSitrepEditorModal();
  });
  bindSitrepEditorModal();
}

openSitrepEditorBtn?.addEventListener('click', openSitrepEditorModal);

loadStatusCards();
loadSitrepLatest();
