/* Analog Film Logbook — single-file app logic. No framework, no build step.
 * Data lives in localStorage as one versioned JSON document (see Store). */
'use strict';

const APP_VERSION = '1.2.0';
const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'filmlog:db';
const PREV_KEY = 'filmlog:db:prev';

/* ============================================================ reference data */

const FORMATS = {
  '35mm': { label: '35mm', capacity: 36 },
  '120': { label: '120', capacity: 12 },
};

const FILM_STOCKS = [
  ['Kodak', 'Portra 160', 160], ['Kodak', 'Portra 400', 400], ['Kodak', 'Portra 800', 800],
  ['Kodak', 'Ektar 100', 100], ['Kodak', 'Gold 200', 200], ['Kodak', 'ColorPlus 200', 200],
  ['Kodak', 'UltraMax 400', 400], ['Kodak', 'Tri-X 400', 400], ['Kodak', 'T-Max 100', 100],
  ['Kodak', 'T-Max 400', 400], ['Kodak', 'Ektachrome E100', 100],
  ['Ilford', 'HP5 Plus 400', 400], ['Ilford', 'FP4 Plus 125', 125], ['Ilford', 'Delta 100', 100],
  ['Ilford', 'Delta 400', 400], ['Ilford', 'Delta 3200', 3200], ['Ilford', 'Pan F Plus 50', 50],
  ['Ilford', 'XP2 Super 400', 400], ['Kentmere', 'Pan 400', 400], ['Kentmere', 'Pan 100', 100],
  ['Fujifilm', 'Velvia 50', 50], ['Fujifilm', 'Provia 100F', 100], ['Fujifilm', 'Fujicolor 200', 200],
  ['Fujifilm', 'Superia X-TRA 400', 400], ['CineStill', '800T', 800], ['CineStill', '400D', 400],
  ['CineStill', '50D', 50], ['Lomography', 'Color Negative 400', 400], ['Lomography', 'Color Negative 800', 800],
  ['Foma', 'Fomapan 100', 100], ['Foma', 'Fomapan 400', 400], ['Harman', 'Phoenix 200', 200],
].map(([brand, stock, iso]) => ({ brand, stock, iso }));

const ISO_SERIES = [6, 8, 10, 12, 16, 20, 25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500,
  640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];

const APERTURES = [1.0, 1.2, 1.4, 1.7, 1.8, 2, 2.8, 3.5, 4, 5.6, 8, 11, 16, 22, 32];
const fmtAperture = (n) => 'f/' + (Number.isInteger(n) && n !== 1 ? n : n.toFixed(1));

// Seconds value lets each camera define its own usable range.
const SHUTTERS = [
  ['1/4000', 1 / 4000], ['1/2000', 1 / 2000], ['1/1000', 1 / 1000], ['1/500', 1 / 500], ['1/250', 1 / 250],
  ['1/125', 1 / 125], ['1/60', 1 / 60], ['1/30', 1 / 30], ['1/15', 1 / 15], ['1/8', 1 / 8], ['1/4', 1 / 4],
  ['1/2', 1 / 2], ['1s', 1], ['2s', 2], ['4s', 4], ['8s', 8], ['15s', 15], ['30s', 30],
].map(([label, sec]) => ({ label, sec }));
const shutterLabel = (v) => (v === '1s' ? '1 sec' : v);
function shutterSeconds(label) {
  const m = /^1\/(\d+(?:\.\d+)?)$/.exec(label);
  if (m) return 1 / Number(m[1]);
  const n = /^(\d+(?:\.\d+)?)s$/.exec(label);
  return n ? Number(n[1]) : null;
}
// Reads a typed list like "1/300, 100, 50, 25, B". A bare number above 1 is read the
// way shutter dials print it (300 = 1/300); "1" and "2s" are whole seconds.
function parseShutterList(text) {
  const out = [];
  let bulb = false;
  for (const raw of String(text).split(/[\s,;]+/)) {
    const t = raw.trim().toLowerCase().replace(/(sec|"|″)$/, 's');
    if (!t) continue;
    if (t === 'b' || t === 'bulb') { bulb = true; continue; }
    let label = null;
    if (/^1\/\d+(\.\d+)?$/.test(t)) label = t;
    else if (/^\d+(\.\d+)?s$/.test(t)) label = t;
    else if (/^\d+(\.\d+)?$/.test(t)) label = Number(t) > 1 ? '1/' + t : t + 's';
    if (!label) throw new Error(`“${raw}” is not a shutter speed. Use values like 1/300, 50 or 2s.`);
    if (!out.includes(label)) out.push(label);
  }
  out.sort((a, b) => shutterSeconds(a) - shutterSeconds(b));
  return { list: out, bulb };
}

const DEFAULT_CAMERAS = [
  { id: 'cam_pentaxlx', name: 'Pentax LX', format: '35mm', fastest: 1 / 2000, slowest: 4, bulb: true, minF: null, maxF: null },
  { id: 'cam_ae1p', name: 'Canon AE-1 Program', format: '35mm', fastest: 1 / 1000, slowest: 2, bulb: true, minF: null, maxF: null },
  { id: 'cam_yashicaa', name: 'Yashica A Twin Lens Reflex', format: '120', fastest: 1 / 300, slowest: 1 / 25, bulb: true, minF: 3.5, maxF: 22, shutters: ['1/300', '1/100', '1/50', '1/25'] },
];

/* ---------- weather icons: field-notebook line drawings on a 32px grid ---------- */
const CLOUD = 'M4 12H16.5A3.5 3.5 0 0 0 16.9 5.03A5 5 0 0 0 7.3 4.6A3.75 3.75 0 0 0 4 12Z';
const cloud = (x, y, s = 1) => `<path class="cl" vector-effect="non-scaling-stroke" transform="translate(${x} ${y}) scale(${s})" d="${CLOUD}"/>`;
function rays(cx, cy, r1, r2, angles) {
  return angles.map((a) => {
    const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const p = (n) => n.toFixed(2);
    return `M${p(cx + c * r1)} ${p(cy + s * r1)}L${p(cx + c * r2)} ${p(cy + s * r2)}`;
  }).join('');
}
const ALL8 = [0, 45, 90, 135, 180, 225, 270, 315];
const halfSun = (cx, cy, r) => `<path d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}"/>`;
const horizon = '<path d="M3 22H29"/>';
const arrowUp = '<path d="M16 30V25.2M13.6 27.4L16 25L18.4 27.4"/>';
const arrowDown = '<path d="M16 24.8V29.6M13.6 27.2L16 29.6L18.4 27.2"/>';
const moon = (x, y, s = 1) => `<path class="cl" vector-effect="non-scaling-stroke" transform="translate(${x} ${y}) scale(${s})" d="M12 2A9.5 9.5 0 1 0 21.5 14.5A7.5 7.5 0 0 1 12 2Z"/>`;

const WEATHER = [
  { id: 'sunrise', label: 'Sunrise', svg: horizon + halfSun(16, 22, 5.5) + `<path d="${rays(16, 22, 8, 10.5, [180 + 20, 225, 270, 315, 340])}"/>` + arrowUp },
  { id: 'sun', label: 'Sun', svg: `<circle cx="16" cy="16" r="5.5"/><path d="${rays(16, 16, 8.5, 11.5, ALL8)}"/>` },
  { id: 'sun-cloud', label: 'Sun & cloud', svg: `<circle cx="20" cy="11" r="4.2"/><path d="${rays(20, 11, 6.6, 8.8, [270, 315, 0, 225, 45])}"/>` + cloud(1.5, 12.5, 1.05) },
  { id: 'sun-clouds', label: 'Sun & 2 clouds', svg: `<circle cx="21" cy="9" r="3.8"/><path d="${rays(21, 9, 6, 8, [270, 315, 0, 225])}"/>` + cloud(13, 11, .75) + cloud(0.5, 14.5, 1) },
  { id: 'cloud', label: 'Cloud', svg: cloud(3.5, 7, 1.2) },
  { id: 'clouds', label: 'Two clouds', svg: cloud(12, 5, .85) + cloud(1, 12, 1.1) },
  { id: 'sunset', label: 'Sunset', svg: horizon + halfSun(16, 22, 5.5) + `<path d="${rays(16, 22, 8, 10.5, [180 + 20, 225, 270, 315, 340])}"/>` + arrowDown },
  { id: 'sunset-clouds', label: 'Sunset & clouds', svg: horizon + halfSun(13, 22, 5) + `<path d="${rays(13, 22, 7.2, 9.4, [200, 235, 270])}"/>` + cloud(11, 8.5, .95) + arrowDown },
  { id: 'cloudy-dusk', label: 'Cloudy sunset', svg: cloud(12.5, 5.5, .8) + cloud(2, 9, 1.0) + horizon + '<path d="M7 25.5H12M20 25.5H25"/>' + arrowDown },
  { id: 'moon', label: 'Moon', svg: moon(4.5, 4.5, 1.05) },
  { id: 'moon-clouds', label: 'Moon & clouds', svg: moon(11, 2, .85) + cloud(1.5, 13, 1.05) },
];
const WX = Object.fromEntries(WEATHER.map((w) => [w.id, w]));
const wxSvg = (id, title) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${title ? 'false' : 'true'}">${title ? `<title>${esc(title)}</title>` : ''}${WX[id] ? WX[id].svg : ''}</svg>`;

/* ---------- UI icons ---------- */
const I = {
  log: '<path d="M4 7h16v12H4z"/><circle cx="12" cy="13" r="3.5"/><path d="M8 7l1.5-2.5h5L16 7"/>',
  rolls: '<rect x="5" y="3" width="10" height="18" rx="1.5"/><path d="M15 6h3v12h-3M8 6v2M8 11v2M8 16v2"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  left: '<path d="M14.5 6l-6 6 6 6"/>',
  right: '<path d="M9.5 6l6 6-6 6"/>',
  caret: '<path d="M6 9l6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  wind: '<path d="M4 12h13M13 7l5 5-5 5"/><path d="M20 5v14"/>',
  multi: '<circle cx="9.5" cy="12" r="5.5"/><circle cx="14.5" cy="12" r="5.5"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18M3 15h18M7 5v4M12 5v4M17 5v4M7 15v4M12 15v4M17 15v4"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`;

/* ============================================================ utilities */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function newId(prefix) {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => (b % 36).toString(36)).join('');
}
const nowIso = () => new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtStops = (s) => ({ 0.33: '⅓', 0.67: '⅔', 0.5: '½', 1.5: '1½' }[s] || String(s));
function nearestIso(v) {
  if (!(v > 0)) return null;
  return ISO_SERIES.reduce((best, x) => (Math.abs(Math.log(x / v)) < Math.abs(Math.log(best / v)) ? x : best), ISO_SERIES[0]);
}
function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = () => { clearTimeout(t); fn(); };
  return d;
}

/* ============================================================ storage */

function emptyDb() {
  return {
    schemaVersion: SCHEMA_VERSION, createdAt: nowIso(),
    cameras: DEFAULT_CAMERAS.map((c) => ({ ...c })),
    rolls: [], frames: [], exposures: [],
    scans: [],          // future: { id, rollId, frameId, frameNumber, exposureId?, uri, addedAt }
    drafts: {},         // in-progress form state, keyed by roll id / editor key
    outbox: {},         // pending sync records keyed "entity:id" (no server yet; see Sync)
    meta: { lastRollId: null, lastExportAt: null, lastCameraByFormat: {} },
  };
}

// Each schema bump adds one step here so old backups and devices upgrade in place.
function migrate(db) {
  const base = emptyDb();
  if (!db || typeof db !== 'object') return base;
  const v = db.schemaVersion || 1;
  if (v > SCHEMA_VERSION) throw new Error('This data was written by a newer version of the app.');
  for (const k of ['cameras', 'rolls', 'frames', 'exposures', 'scans']) if (!Array.isArray(db[k])) db[k] = k === 'cameras' ? base.cameras : [];
  for (const k of ['drafts', 'outbox']) if (!db[k] || typeof db[k] !== 'object') db[k] = {};
  db.meta = { ...base.meta, ...(db.meta || {}) };
  if (v < 2) {
    // v2: cameras can list exact shutter speeds. Correct the Yashica A to its real
    // 1/300–1/25 shutter unless the user already changed that camera's range.
    const y = db.cameras.find((c) => c.id === 'cam_yashicaa');
    if (y && !y.shutters && Math.abs(y.fastest - 1 / 500) < 1e-9 && y.slowest === 1) {
      Object.assign(y, { shutters: ['1/300', '1/100', '1/50', '1/25'], fastest: 1 / 300, slowest: 1 / 25 });
    }
  }
  db.schemaVersion = SCHEMA_VERSION;
  return db;
}

function validateDb(db) {
  if (!db || !Array.isArray(db.rolls) || !Array.isArray(db.frames) || !Array.isArray(db.exposures)) throw new Error('Not a Film Logbook backup.');
  const frameIds = new Set(db.frames.map((f) => f.id));
  const rollIds = new Set(db.rolls.map((r) => r.id));
  for (const f of db.frames) if (!rollIds.has(f.rollId)) throw new Error('Backup has a frame without its roll.');
  for (const e of db.exposures) if (!frameIds.has(e.frameId)) throw new Error('Backup has an exposure without its frame.');
  const seen = new Set();
  for (const f of db.frames) {
    const k = f.rollId + ':' + f.number;
    if (seen.has(k)) throw new Error('Backup has duplicate frame numbers.');
    seen.add(k);
  }
}

const Store = {
  db: null,
  error: null,
  available: true,
  load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { this.available = false; }
    let db = null;
    if (raw) {
      try { db = JSON.parse(raw); } catch (e) {
        try { db = JSON.parse(localStorage.getItem(PREV_KEY)); this.error = 'The latest save was damaged, so the logbook was restored from the previous save.'; } catch (e2) { db = null; }
      }
    }
    try { this.db = migrate(db); } catch (e) { this.error = e.message; this.db = emptyDb(); this.readOnly = true; }
    if (!this.available) this.error = 'This browser is blocking storage, so entries will not survive closing the app. Export a backup before leaving.';
  },
  save() {
    if (this.readOnly) return false;
    const json = JSON.stringify(this.db);
    try {
      const prev = localStorage.getItem(STORAGE_KEY);
      if (prev) localStorage.setItem(PREV_KEY, prev);
      localStorage.setItem(STORAGE_KEY, json);
      this.lastSavedAt = Date.now();
      if (this.error && this.available) this.error = null;
      return true;
    } catch (e) {
      this.error = 'Could not save to this device (storage full or blocked). Export a backup from Rolls → Settings now.';
      renderBanner();
      return false;
    }
  },
  touch(entity, id, op = 'upsert') {
    this.db.outbox[entity + ':' + id] = { entity, id, op, at: nowIso() };
  },
};

/* Sync seam: nothing is sent anywhere yet. When a server exists, set Sync.endpoint and
 * implement push(); the outbox already queues every change made offline. */
const Sync = {
  endpoint: null,
  async flush() {
    if (!this.endpoint || !navigator.onLine) return;
    const items = Object.values(Store.db.outbox);
    if (!items.length) return;
    const payload = items.map((it) => ({ ...it, record: (Store.db[it.entity] || []).find((r) => r.id === it.id) || null }));
    const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (res.ok) { for (const it of items) delete Store.db.outbox[it.entity + ':' + it.id]; Store.save(); }
  },
};

/* ============================================================ domain */

const db = () => Store.db;
const getRoll = (id) => db().rolls.find((r) => r.id === id);
const getCamera = (id) => db().cameras.find((c) => c.id === id);
const rollCamera = (roll) => getCamera(roll.cameraId) || { name: roll.cameraName || 'Unknown camera', fastest: 1 / 4000, slowest: 30, bulb: true };
const rollTotal = (roll) => roll.frameCapacity + (roll.extraFrames || 0);
const framesOf = (rollId) => db().frames.filter((f) => f.rollId === rollId).sort((a, b) => a.number - b.number);
const frameAt = (rollId, n) => db().frames.find((f) => f.rollId === rollId && f.number === n);
const exposuresOf = (frameId) => db().exposures.filter((e) => e.frameId === frameId).sort((a, b) => a.sequence - b.sequence);
const loggedCount = (roll) => framesOf(roll.id).length; // invariant: a frame exists only while it has exposures
const rollTitle = (roll) => [roll.filmBrand, roll.filmStock].filter(Boolean).join(' ');

function firstEmptyFrom(roll, n) {
  for (let k = Math.max(1, n); k <= rollTotal(roll); k++) if (!frameAt(roll.id, k)) return k;
  return null;
}

function exposureLine(roll) {
  if (roll.exposureApproach === 'push') return `Push +${fmtStops(roll.exposureStops)} · EI ${roll.shootingIso}`;
  if (roll.exposureApproach === 'pull') return `Pull −${fmtStops(roll.exposureStops)} · EI ${roll.shootingIso}`;
  return `Box speed · EI ${roll.shootingIso}`;
}
function processingLine(roll) {
  const s = roll.processingStops || 0;
  const dev = s > 0 ? `Push +${s}` : s < 0 ? `Pull −${-s}` : 'Normal';
  return dev + (roll.processingInstructions ? ` — ${roll.processingInstructions}` : '');
}

function createRoll(w) {
  const now = nowIso();
  const cam = getCamera(w.cameraId);
  const roll = {
    id: newId('r'), format: w.format, frameCapacity: FORMATS[w.format].capacity, extraFrames: 0,
    filmBrand: w.filmBrand.trim(), filmStock: w.filmStock.trim(), boxIso: Number(w.boxIso),
    shootingIso: Number(w.shootingIso), exposureApproach: w.approach,
    exposureStops: w.approach === 'box' ? 0 : Number(w.stops),
    processingStops: Number(w.processingStops) || 0, processingInstructions: (w.processingInstructions || '').trim(),
    cameraId: w.cameraId, cameraName: cam ? cam.name : '',
    startedAt: now, completedAt: null, status: 'active', notes: '',
    cursor: 1, pendingMulti: false, createdAt: now, updatedAt: now,
  };
  db().rolls.push(roll);
  db().meta.lastRollId = roll.id;
  db().meta.lastCameraByFormat[w.format] = w.cameraId;
  Store.touch('rolls', roll.id);
  Store.save();
  return roll;
}

function updateRoll(roll, patch) {
  Object.assign(roll, patch, { updatedAt: nowIso() });
  Store.touch('rolls', roll.id);
  Store.save();
}

/** Writes one exposure. Refuses to touch a logged frame unless `append` is set,
 *  so a frame can never be silently overwritten. */
function addExposure(roll, n, fields, { append = false } = {}) {
  if (!(n >= 1 && n <= rollTotal(roll))) throw new Error(`Frame ${n} is outside this roll.`);
  let frame = frameAt(roll.id, n);
  const existing = frame ? exposuresOf(frame.id) : [];
  if (existing.length && !append) throw new Error(`Frame ${pad2(n)} is already logged.`);
  const now = nowIso();
  if (!frame) {
    frame = { id: newId('f'), rollId: roll.id, number: n, createdAt: now, updatedAt: now };
    db().frames.push(frame);
  }
  const exp = {
    id: newId('e'), frameId: frame.id, rollId: roll.id, sequence: existing.length + 1,
    aperture: fields.aperture || '', shutter: fields.shutter || '', weather: [...(fields.weather || [])],
    subject: (fields.subject || '').trim(), notes: (fields.notes || '').trim(), createdAt: now, updatedAt: now,
  };
  db().exposures.push(exp);
  frame.updatedAt = now;
  roll.updatedAt = now;
  db().meta.lastRollId = roll.id;
  Store.touch('frames', frame.id); Store.touch('exposures', exp.id); Store.touch('rolls', roll.id);
  Store.save();
  return { frame, exp };
}

function updateExposure(exp, fields) {
  Object.assign(exp, {
    aperture: fields.aperture || '', shutter: fields.shutter || '', weather: [...(fields.weather || [])],
    subject: (fields.subject || '').trim(), notes: (fields.notes || '').trim(), updatedAt: nowIso(),
  });
  Store.touch('exposures', exp.id);
  Store.save();
}

function deleteExposure(exp) {
  const d = db();
  d.exposures = d.exposures.filter((e) => e.id !== exp.id);
  Store.touch('exposures', exp.id, 'delete');
  const rest = exposuresOf(exp.frameId);
  rest.forEach((e, i) => { if (e.sequence !== i + 1) { e.sequence = i + 1; Store.touch('exposures', e.id); } });
  if (!rest.length) {
    d.frames = d.frames.filter((f) => f.id !== exp.frameId);
    Store.touch('frames', exp.frameId, 'delete');
  }
  Store.save();
}

function deleteRoll(roll) {
  const d = db();
  const frameIds = new Set(framesOf(roll.id).map((f) => f.id));
  d.exposures.filter((e) => frameIds.has(e.frameId)).forEach((e) => Store.touch('exposures', e.id, 'delete'));
  d.exposures = d.exposures.filter((e) => !frameIds.has(e.frameId));
  frameIds.forEach((id) => Store.touch('frames', id, 'delete'));
  d.frames = d.frames.filter((f) => f.rollId !== roll.id);
  d.rolls = d.rolls.filter((r) => r.id !== roll.id);
  delete d.drafts[roll.id];
  if (d.meta.lastRollId === roll.id) d.meta.lastRollId = null;
  Store.touch('rolls', roll.id, 'delete');
  Store.save();
}

function lastExposureOfRoll(roll) {
  return db().exposures.filter((e) => e.rollId === roll.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
function activeRolls() {
  return db().rolls.filter((r) => r.status === 'active').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function currentRoll() {
  const last = getRoll(db().meta.lastRollId);
  if (last && last.status === 'active') return last;
  return activeRolls()[0] || null;
}

/* ============================================================ drafts */

const blankDraft = () => ({ aperture: '', shutter: '', weather: [], subject: '', notes: '', notesOpen: false, otherField: null });
function getDraft(key, seed) {
  const d = db().drafts;
  if (!d[key]) d[key] = seed ? { ...blankDraft(), ...seed } : blankDraft();
  return d[key];
}
const persistDraftSoon = debounce(() => { Store.save(); setDraftStatus('Draft saved'); }, 350);
function setDraftStatus(text) {
  const el = document.getElementById('draft-status');
  if (el) el.textContent = text;
}
const draftHasContent = (d) => !!(d.aperture || d.shutter || d.weather.length || d.subject || d.notes);

/* ============================================================ router */

// Hash routes are plain words or word-id pairs so links survive anywhere.
function parseRoute() {
  const h = location.hash.replace(/^#/, '');
  const [name, a, b] = h.split('-');
  return { name: name || 'log', a, b };
}
function go(hash, replace = false) {
  if (replace) history.replaceState(null, '', '#' + hash);
  else if (location.hash !== '#' + hash) { location.hash = hash; return; }
  render();
}
window.addEventListener('hashchange', () => render());

/* ============================================================ rendering */

const app = () => document.getElementById('app');
let form = null;         // the exposure form on screen: { key, draft, camera }
let toastTimer = null;
let lastSave = null;     // for undo

function render() {
  closeSheet();
  const r = parseRoute();
  const tab = { log: 'log', new: 'log', rolls: 'rolls', roll: 'rolls', edit: 'rolls', prefs: 'rolls', search: 'search', frame: 'rolls', exp: 'rolls', add: 'rolls' }[r.name] || 'log';
  form = null;
  const el = app();
  el.className = '';
  let html = '';
  try {
    switch (r.name) {
      case 'new': html = viewWizard(); break;
      case 'rolls': html = viewRolls(); el.classList.add('wide'); break;
      case 'roll': html = viewRoll(r.a); break;
      case 'edit': html = viewEditRoll(r.a); break;
      case 'frame': html = viewFrame(r.a, Number(r.b)); break;
      case 'exp': html = viewExposureEditor({ expId: r.a }); break;
      case 'add': html = viewExposureEditor({ rollId: r.a, n: Number(r.b) }); break;
      case 'search': html = viewSearch(); break;
      case 'prefs': html = viewPrefs(); break;
      default: html = viewLog();
    }
  } catch (e) {
    console.error(e);
    html = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#rolls">Back to rolls</a></div>`;
  }
  el.innerHTML = `<div id="banner-slot"></div>` + html;
  if (document.querySelector('.savebar')) el.classList.add('has-bar');
  renderNav(tab);
  renderBanner();
  afterRender(r);
}

function afterRender(r) {
  const cur = document.querySelector('.strip .cur');
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (r.name === 'search') {
    const q = document.getElementById('q');
    if (q && !q.value) q.focus({ preventScroll: true });
  }
}

function renderNav(tab) {
  const nav = document.getElementById('nav');
  const item = (id, label, ic) => `<a href="#${id}" ${tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  nav.innerHTML = `<div class="nav-inner">${item('log', 'Log', 'log')}${item('rolls', 'Rolls', 'rolls')}${item('search', 'Search', 'search')}</div>`;
}

function renderBanner() {
  const slot = document.getElementById('banner-slot');
  if (slot) slot.innerHTML = Store.error ? `<div class="banner" role="alert">${esc(Store.error)}</div>` : '';
}

/* ---------- shared exposure form ---------- */

function apertureOptions(cam) {
  return APERTURES.filter((f) => (!cam.minF || f >= cam.minF - 1e-9) && (!cam.maxF || f <= cam.maxF + 1e-9)).map(fmtAperture);
}
function shutterOptions(cam) {
  const list = Array.isArray(cam.shutters) && cam.shutters.length ? [...cam.shutters] : SHUTTERS.filter((s) => s.sec >= (cam.fastest || 0) - 1e-9 && s.sec <= (cam.slowest || 1e9) + 1e-9).map((s) => s.label);
  if (cam.bulb !== false) list.push('B');
  return list;
}

function dial(field, label, value, options) {
  const opts = [...options];
  if (value && !opts.includes(value)) opts.push(value);
  const shown = field === 'shutter' ? (value === 'B' ? 'Bulb' : shutterLabel(value)) : value;
  return `<label class="dial ${value ? 'set' : ''}" for="dial-${field}">
    <span class="label">${label}</span>
    <span class="value ${value ? '' : 'empty'}">${value ? esc(shown) : '—'}</span>
    <span class="hint">${value ? 'Tap to change' : 'Not recorded'}</span>
    ${icon('caret', 'caret')}
    <select id="dial-${field}" data-field="${field}" aria-label="${label}">
      <option value="">— Not recorded</option>
      ${opts.map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(field === 'shutter' && o === 'B' ? 'Bulb (B)' : shutterLabel(o))}</option>`).join('')}
      <option value="__other">Other / manual entry…</option>
    </select>
  </label>`;
}

function exposureFormHtml(draft, cam, { repeatFrom } = {}) {
  const other = draft.otherField;
  const repeat = repeatFrom && (repeatFrom.aperture || repeatFrom.shutter || repeatFrom.weather.length)
    ? `<button type="button" class="repeat" data-act="repeat">${icon('repeat')}<span>Same as last: <b class="mono">${esc([repeatFrom.aperture, shutterLabel(repeatFrom.shutter)].filter(Boolean).join(' · ') || 'weather only')}</b>${repeatFrom.weather.length ? ' · ' + repeatFrom.weather.map((w) => WX[w]?.label).join(', ') : ''}</span></button>` : '';
  return `
  <section class="section" aria-labelledby="wx-h">
    <div class="section-head"><h2 class="label" id="wx-h">Weather &amp; Light</h2><span class="hint">${draft.weather.length ? draft.weather.length + ' selected' : 'Optional'}</span></div>
    <div class="wx-grid">${WEATHER.map((w) => `<button type="button" class="wx" data-act="wx" data-id="${w.id}" aria-pressed="${draft.weather.includes(w.id)}">${wxSvg(w.id)}<span>${w.label}</span></button>`).join('')}</div>
  </section>
  <section class="section" aria-labelledby="exp-h">
    <div class="section-head"><h2 class="label" id="exp-h">Exposure</h2><span class="hint">${esc(cam.name || '')}</span></div>
    <div class="dials">
      ${dial('aperture', 'Aperture', draft.aperture, apertureOptions(cam))}
      ${dial('shutter', 'Shutter', draft.shutter, shutterOptions(cam))}
    </div>
    ${other ? `<div class="dial-other">
        <input class="input mono" id="other-input" data-other="${other}" inputmode="${other === 'aperture' ? 'decimal' : 'text'}" placeholder="${other === 'aperture' ? 'e.g. 3.2 or f/6.3' : 'e.g. 1/90 or 3s'}" autocomplete="off">
        <button type="button" class="btn primary" data-act="other-done">Set</button>
        <button type="button" class="btn ghost" data-act="other-cancel">Cancel</button>
      </div>` : ''}
    ${repeat}
  </section>
  <section class="section">
    <label class="label" for="subject">What are you photographing?</label>
    <input class="input subject" id="subject" data-field="subject" value="${esc(draft.subject)}" placeholder="e.g. Bellagio fountain, street portrait, afternoon light..." autocomplete="off" enterkeyhint="done">
    ${draft.notesOpen || draft.notes
      ? `<label class="label" for="notes">Notes</label><textarea class="textarea" id="notes" data-field="notes" placeholder="Metering, filters, who you were with, anything to remember for the scan…">${esc(draft.notes)}</textarea>`
      : `<button type="button" class="link" data-act="notes-open">+ Add a longer note</button>`}
  </section>`;
}

/* ---------- Log ---------- */

function viewLog() {
  const roll = currentRoll();
  if (!roll) {
    return `<header class="topbar"><div class="grow"><p class="eyebrow">Film Logbook</p></div></header>
    <div class="empty">${icon('film')}
      <h1>Nothing loaded yet</h1>
      <p>Start a roll to log each frame as you shoot. It takes about ten seconds.</p>
      <a class="btn primary big" href="#new">${icon('plus')} New Roll</a>
      ${db().rolls.length ? `<a class="link" href="#rolls">Browse past rolls</a>` : ''}
    </div>`;
  }
  const cam = rollCamera(roll);
  const total = rollTotal(roll);
  const n = Math.min(roll.cursor, total + 1);
  const frame = n <= total ? frameAt(roll.id, n) : null;
  const exps = frame ? exposuresOf(frame.id) : [];
  const logged = loggedCount(roll);
  const others = activeRolls().length - 1;

  let state;
  if (n > total) state = 'end';
  else if (!exps.length) state = 'empty';
  else if (roll.pendingMulti) state = 'multi';
  else state = 'filled';

  const head = `
  <header class="roll-head">
    <div class="grow">
      <p class="eyebrow">${esc(roll.format)} · ${roll.frameCapacity} frames</p>
      <h1>${esc(rollTitle(roll))}</h1>
      <div class="meta-line"><span>${esc(cam.name)}</span><span class="mono">${esc(exposureLine(roll))}</span></div>
    </div>
    <button class="icon-btn" data-act="switch-roll" aria-label="${others > 0 ? 'Switch roll or start a new one' : 'Start a new roll'}">${icon(others > 0 ? 'swap' : 'plus')}</button>
  </header>
  <div class="counter">
    <button class="icon-btn step" data-act="nav-frame" data-d="-1" aria-label="Previous frame" ${n <= 1 ? 'disabled' : ''}>${icon('left')}</button>
    <div style="text-align:center">
      <div class="counter-num" aria-live="polite"><b>${n > total ? pad2(total) : pad2(n)}</b><span>/ ${pad2(roll.frameCapacity)}</span></div>
      <div class="counter-sub">${state === 'end' ? 'Roll finished' : state === 'empty' ? 'Ready to log' : state === 'multi' ? `Exposure ${exps.length + 1} on this frame` : exps.length > 1 ? `${exps.length} exposures logged` : 'Logged'}</div>
    </div>
    <button class="icon-btn step" data-act="nav-frame" data-d="1" aria-label="Next frame" ${n > total ? 'disabled' : ''}>${icon('right')}</button>
  </div>
  ${stripHtml(roll, n)}
  <div class="progress-text"><span>${logged} of ${total} frames logged</span><span>${logged === 0 ? '' : Math.round((logged / total) * 100) + '%'}</span></div>`;

  if (state === 'end') {
    return head + `<div class="panel accent">
      <h2>All ${total} frames logged</h2>
      <p class="muted">Rewind, then mark the roll complete. If your camera gave you an extra frame, add it.</p>
      <button class="btn primary big block" data-act="complete-roll">${icon('check')} Mark roll complete</button>
      <div class="btn-row"><button class="btn" data-act="extra-frame">Add frame ${pad2(total + 1)}</button><a class="btn" href="#roll-${roll.id}">View roll</a></div>
    </div>`;
  }

  if (state === 'filled') {
    const next = firstEmptyFrom(roll, n + 1);
    const nextLabel = next ? `Frame ${pad2(next)}` : 'End of roll';
    return head + `<div class="panel ${roll.format === '120' ? 'accent' : ''}">
      <div class="section-head"><h2>Frame ${pad2(n)} ${exps.length > 1 ? `<span class="chip mx">×${exps.length}</span>` : ''}</h2><a class="link" href="#frame-${roll.id}-${n}">Open</a></div>
      ${exps.map((e) => expMiniHtml(e, exps.length)).join('')}
      <p class="label" style="margin-top:4px">${roll.format === '120' ? 'How is the next photograph recorded?' : 'This frame is already logged'}</p>
      <div class="choice">
        <button data-act="wind-on" class="wind">${icon('wind')}<b>Next frame</b><small>Wind on to ${nextLabel}</small></button>
        <button data-act="start-multi" class="dbl">${icon('multi')}<b>${roll.format === '120' ? 'Double exposure' : 'Multiple exposure'}</b><small>Expose Frame ${pad2(n)} again</small></button>
      </div>
    </div>`;
  }

  const draft = getDraft(roll.id);
  form = { key: roll.id, draft, camera: cam };
  const last = lastExposureOfRoll(roll);
  const multiBanner = state === 'multi'
    ? `<div class="multi-banner" role="status">${icon('multi')}<div><b>DOUBLE EXPOSURE</b><small>Adding exposure ${exps.length + 1} to Frame ${pad2(n)}. The counter will not advance.</small></div><button data-act="cancel-multi">Cancel</button></div>` : '';
  return head + multiBanner + exposureFormHtml(draft, cam, { repeatFrom: last }) + `
  <div class="savebar"><div class="savebar-inner">
    <button class="btn ${state === 'multi' ? 'mx' : 'primary'} big block" data-act="save-frame">${icon(state === 'multi' ? 'multi' : 'check')} ${state === 'multi' ? `Save Double Exposure · ${pad2(n)}` : `Save Frame ${pad2(n)}`}</button>
    <div class="draft-status" id="draft-status">${draftHasContent(draft) ? 'Draft saved' : ''}</div>
  </div></div>`;
}

function stripHtml(roll, n) {
  const total = rollTotal(roll);
  const counts = {};
  framesOf(roll.id).forEach((f) => { counts[f.number] = exposuresOf(f.id).length; });
  let cells = '';
  for (let k = 1; k <= total; k++) {
    const c = counts[k] || 0;
    const cls = [c ? 'done' : '', c > 1 ? 'multi' : '', k === n ? 'cur' : '', k > roll.frameCapacity ? 'extra' : ''].join(' ');
    cells += `<button class="${cls}" data-act="goto-frame" data-n="${c}" data-frame="${k}" aria-label="Frame ${k}${c ? ', logged' + (c > 1 ? `, ${c} exposures` : '') : ', empty'}">${k}</button>`;
  }
  return `<div class="strip-wrap"><div class="strip-holes"></div><div class="strip" role="group" aria-label="Frames on this roll">${cells}</div><div class="strip-holes"></div></div>`;
}

function expMiniHtml(e, count) {
  return `<div class="exp-mini" style="${count > 1 ? 'border-left-color:var(--ink)' : ''}">
    <div class="row1">${count > 1 ? `<span class="chip mx">Exp ${e.sequence}</span>` : ''}<span class="${e.subject ? '' : 'muted'}" style="font-family:var(--font-display);font-size:1.1rem">${esc(e.subject || 'No description')}</span></div>
    <div class="mono muted" style="font-size:.85rem">${settingsText(e)} ${e.weather.length ? '· ' + e.weather.map((w) => WX[w]?.label).join(', ') : ''}</div>
  </div>`;
}
const settingsText = (e) => esc([e.aperture || 'f/—', e.shutter ? (e.shutter === 'B' ? 'Bulb' : shutterLabel(e.shutter)) : '—'].join(' · '));

/* ---------- log actions ---------- */

function saveFrame() {
  const roll = currentRoll();
  if (!roll || !form) return;
  const n = roll.cursor;
  const frame = frameAt(roll.id, n);
  const append = !!(frame && roll.pendingMulti);
  const draft = { ...form.draft, weather: [...form.draft.weather] };
  const prev = { cursor: roll.cursor, pendingMulti: roll.pendingMulti };
  let result;
  try { result = addExposure(roll, n, draft, { append }); } catch (e) { toast(e.message); render(); return; }

  let msg = append ? `Exposure ${result.exp.sequence} saved on Frame ${pad2(n)}` : `Frame ${pad2(n)} saved`;
  let sub = '';
  roll.pendingMulti = false;
  if (roll.format === '35mm' && !append) {
    const next = firstEmptyFrom(roll, n + 1);
    roll.cursor = next || rollTotal(roll) + 1;
    if (next && next !== n + 1) sub = `Frame ${pad2(n + 1)} was already logged · now on ${pad2(next)}`;
    else if (next) sub = `Now on Frame ${pad2(next)}`;
    else sub = 'That was the last frame';
  } else {
    sub = roll.format === '120' ? 'Choose: next frame or double exposure' : 'Still on this frame';
  }
  db().drafts[roll.id] = blankDraft();
  updateRoll(roll, {});
  lastSave = { rollId: roll.id, expId: result.exp.id, prev, draft };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast(msg, { sub, undo: true, editId: result.exp.id });
}

function undoLastSave() {
  if (!lastSave) return;
  const roll = getRoll(lastSave.rollId);
  const exp = db().exposures.find((e) => e.id === lastSave.expId);
  if (!roll || !exp) return;
  deleteExposure(exp);
  db().drafts[roll.id] = { ...blankDraft(), ...lastSave.draft };
  updateRoll(roll, lastSave.prev);
  lastSave = null;
  hideToast();
  go('log');
  toast('Undone — entry restored for editing');
}

function windOn(roll) {
  const n = roll.cursor;
  const next = firstEmptyFrom(roll, n + 1);
  updateRoll(roll, { cursor: next || rollTotal(roll) + 1, pendingMulti: false });
  render();
  if (next && next !== n + 1) toast(`Frames ${pad2(n + 1)}–${pad2(next - 1)} are already logged`, { sub: `Now on Frame ${pad2(next)}` });
}

/* ---------- New roll wizard ---------- */

let wiz = null;
function freshWizard() {
  return { step: 1, format: null, filmBrand: '', filmStock: '', boxIso: '', approach: 'box', stops: 1, shootingIso: '', isoTouched: false, processingStops: 0, processingTouched: false, processingInstructions: '', cameraId: null, stockQuery: '' };
}

function viewWizard() {
  if (!wiz) wiz = (db().drafts.__wizard && { ...freshWizard(), ...db().drafts.__wizard }) || freshWizard();
  const s = wiz.step;
  const steps = `<div class="wiz-steps" aria-label="Step ${s} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>`;
  const top = `<header class="topbar"><button class="back" data-act="${s === 1 ? 'wiz-cancel' : 'wiz-back'}">${icon('back')} ${s === 1 ? 'Cancel' : 'Back'}</button><div class="grow"></div><span class="eyebrow">New roll · ${s}/5</span></header>${steps}`;
  let body = '';
  if (s === 1) {
    body = `<div class="wiz-q"><p class="eyebrow">Step 1 · Format</p><h1>What film are you loading?</h1></div>
    <div class="formats">
      ${['35mm', '120'].map((f) => `<button class="format-card" data-act="wiz-format" data-f="${f}" aria-pressed="${wiz.format === f}">
        ${formatArt(f)}<b>${f}</b><span class="muted">${FORMATS[f].capacity} frames</span></button>`).join('')}
    </div>`;
  } else if (s === 2) {
    const q = wiz.stockQuery.trim().toLowerCase();
    const list = FILM_STOCKS.filter((x) => !q || (x.brand + ' ' + x.stock).toLowerCase().includes(q));
    body = `<div class="wiz-q"><p class="eyebrow">Step 2 · Film stock</p><h1>Which film stock?</h1></div>
    <div class="stack">
      <input class="input" id="stock-q" data-wiz="stockQuery" value="${esc(wiz.stockQuery)}" placeholder="Search common stocks" autocomplete="off">
      <div class="stock-list" role="listbox" aria-label="Common film stocks">
        ${list.map((x) => `<button role="option" data-act="wiz-stock" data-brand="${esc(x.brand)}" data-stock="${esc(x.stock)}" data-iso="${x.iso}" aria-pressed="${wiz.filmBrand === x.brand && wiz.filmStock === x.stock}"><span><span class="brand">${esc(x.brand)}</span> ${esc(x.stock)}</span><span class="mono muted">ISO ${x.iso}</span></button>`).join('') || `<p class="hint" style="padding:14px">No match. Type it in below.</p>`}
      </div>
      <p class="label">Or enter it yourself</p>
      <div class="two">
        <div class="field"><label class="hint" for="w-brand">Brand</label><input class="input" id="w-brand" data-wiz="filmBrand" value="${esc(wiz.filmBrand)}" placeholder="Kodak" autocomplete="off"></div>
        <div class="field"><label class="hint" for="w-iso">Box speed (ISO)</label><input class="input mono" id="w-iso" data-wiz="boxIso" value="${esc(wiz.boxIso)}" inputmode="numeric" placeholder="400"></div>
      </div>
      <div class="field"><label class="hint" for="w-stock">Stock name</label><input class="input" id="w-stock" data-wiz="filmStock" value="${esc(wiz.filmStock)}" placeholder="Portra 400" autocomplete="off"></div>
    </div>`;
  } else if (s === 3) {
    body = `<div class="wiz-q"><p class="eyebrow">Step 3 · Exposure index</p><h1>How are you shooting this roll?</h1></div>
    <div class="stack">
      <div class="option-list">
        ${[['box', 'Box speed', `Rate it at ISO ${wiz.boxIso}, as the manufacturer intended.`],
          ['pull', 'Pull', 'Overexpose at a lower speed and develop for less time.'],
          ['push', 'Push', 'Underexpose at a higher speed and develop for longer.']]
          .map(([v, t, d]) => `<button class="option" data-act="wiz-approach" data-v="${v}" aria-pressed="${wiz.approach === v}"><b>${t}</b>${wiz.approach === v ? icon('check') : '<span></span>'}<small>${d}</small></button>`).join('')}
      </div>
      ${wiz.approach !== 'box' ? `
        <div class="field"><span class="label">${wiz.approach === 'push' ? 'Push' : 'Pull'} by how many stops?</span>
          <div class="seg">${[0.33, 0.67, 1, 1.5, 2, 3].map((v) => `<button data-act="wiz-stops" data-v="${v}" aria-pressed="${wiz.stops === v}">${fmtStops(v)}</button>`).join('')}</div>
        </div>
        <div class="field"><label class="label" for="w-ei">Shooting ISO (EI)</label>
          <input class="input mono" id="w-ei" data-wiz="shootingIso" value="${esc(wiz.shootingIso)}" inputmode="numeric">
          <span class="hint">Box speed stays recorded as ISO ${esc(wiz.boxIso)}.</span>
        </div>` : ''}
      <div class="field"><span class="label">Development</span>
        <div class="stepper"><button class="icon-btn" data-act="wiz-proc" data-d="-1" aria-label="Less development">−</button><output>${processingLabel(wiz.processingStops)}</output><button class="icon-btn" data-act="wiz-proc" data-d="1" aria-label="More development">+</button></div>
        <span class="hint">${wiz.processingStops === signedStops(wiz) ? 'Matches how you are shooting.' : 'Differs from how you are shooting.'}</span>
      </div>
      <div class="field"><label class="label" for="w-proc">Processing instructions <span class="hint">(optional)</span></label>
        <input class="input" id="w-proc" data-wiz="processingInstructions" value="${esc(wiz.processingInstructions)}" placeholder="e.g. Push +1 at the lab, stand develop in Rodinal" autocomplete="off"></div>
    </div>`;
  } else if (s === 4) {
    const cams = db().cameras.filter((c) => !c.hidden);
    body = `<div class="wiz-q"><p class="eyebrow">Step 4 · Camera</p><h1>Which camera are you using?</h1></div>
    <div class="stack">
      <select class="select input" id="w-cam" data-wiz="cameraId" aria-label="Camera" style="font-size:1.15rem;min-height:60px">
        ${cams.map((c) => `<option value="${c.id}" ${wiz.cameraId === c.id ? 'selected' : ''}>${esc(c.name)}${c.format && c.format !== wiz.format ? ` (usually ${c.format})` : ''}</option>`).join('')}
      </select>
      <p class="hint">Edit your camera list in Rolls → Settings.</p>
    </div>`;
  } else {
    const cam = getCamera(wiz.cameraId);
    body = `<div class="wiz-q"><p class="eyebrow">Step 5 · Confirm</p><h1>Ready to shoot?</h1></div>
    <div class="summary">
      <div><span class="k">Format</span><span class="v">${esc(wiz.format)} · ${FORMATS[wiz.format].capacity} frames</span></div>
      <div><span class="k">Film</span><span class="v">${esc([wiz.filmBrand, wiz.filmStock].filter(Boolean).join(' '))}</span></div>
      <div><span class="k">Box speed</span><span class="v mono">ISO ${esc(wiz.boxIso)}</span></div>
      <div><span class="k">Shooting at</span><span class="v mono">EI ${esc(wiz.shootingIso)}</span></div>
      <div><span class="k">Approach</span><span class="v">${wiz.approach === 'box' ? 'Box speed' : `${wiz.approach === 'push' ? 'Push +' : 'Pull −'}${fmtStops(wiz.stops)} stop${wiz.stops > 1 ? 's' : ''}`}</span></div>
      <div><span class="k">Development</span><span class="v">${processingLabel(wiz.processingStops)}${wiz.processingInstructions ? ' — ' + esc(wiz.processingInstructions) : ''}</span></div>
      <div><span class="k">Camera</span><span class="v">${esc(cam ? cam.name : '—')}</span></div>
    </div>`;
  }
  const canNext = wizardValid();
  const foot = s === 1 ? '' : `<div class="wiz-foot">${s === 5
    ? `<button class="btn primary big" data-act="wiz-start">${icon('film')} Start Roll</button>`
    : `<button class="btn primary big" data-act="wiz-next" ${canNext ? '' : 'disabled'}>Continue</button>`}</div>`;
  return top + body + foot;
}

const signedStops = (w) => (w.approach === 'push' ? Math.round(w.stops) : w.approach === 'pull' ? -Math.round(w.stops) : 0);
const processingLabel = (s) => (s > 0 ? `Push +${s}` : s < 0 ? `Pull −${-s}` : 'Normal');
function wizardValid() {
  if (wiz.step === 2) return !!wiz.filmStock.trim() && Number(wiz.boxIso) > 0;
  if (wiz.step === 3) return Number(wiz.shootingIso) > 0;
  if (wiz.step === 4) return !!getCamera(wiz.cameraId);
  return true;
}
function recomputeEi() {
  if (wiz.isoTouched) return;
  const box = Number(wiz.boxIso);
  const sign = wiz.approach === 'push' ? 1 : wiz.approach === 'pull' ? -1 : 0;
  wiz.shootingIso = box > 0 ? String(sign ? nearestIso(box * 2 ** (sign * wiz.stops)) : box) : '';
  if (!wiz.processingTouched) wiz.processingStops = signedStops(wiz);
}
function saveWizard() { db().drafts.__wizard = { ...wiz }; persistDraftSoon(); }

function formatArt(f) {
  // a canister for 35mm, a spool for 120
  return f === '35mm'
    ? `<svg viewBox="0 0 120 56" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="8" width="40" height="40" rx="5"/><path d="M14 8V4h28v4M14 48v4h28v-4M48 18h64v24H48"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${56 + i * 9}" y="21" width="4" height="4" rx="1"/><rect x="${56 + i * 9}" y="35" width="4" height="4" rx="1"/>`).join('')}</svg>`
    : `<svg viewBox="0 0 120 56" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 4h12M10 52h12M16 4v48"/><rect x="12" y="10" width="8" height="36"/><path d="M20 12h88v32H20"/><path d="M32 12v32M56 12v32M80 12v32" stroke-dasharray="2 3"/></svg>`;
}

/* ---------- Rolls library ---------- */

const rollFilter = { q: '', status: 'current', format: 'all', camera: 'all', month: 'all' };

function viewRolls() {
  const rolls = [...db().rolls].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const months = [...new Set(rolls.map((r) => r.startedAt.slice(0, 7)))];
  const cams = [...new Set(rolls.map((r) => r.cameraId))].map((id) => ({ id, name: getCamera(id)?.name || rolls.find((r) => r.cameraId === id).cameraName }));
  const pressed = (k, v) => `aria-pressed="${rollFilter[k] === v}"`;
  return `<header class="topbar"><div class="grow"><p class="eyebrow">Film archive</p><h1>Rolls</h1></div>
    <a class="icon-btn" href="#prefs" aria-label="Settings and backup">${icon('gear')}</a>
    <a class="btn primary" href="#new">${icon('plus')} New Roll</a></header>
  <div class="search-row">
    <input class="input" type="search" id="roll-q" data-filter="q" value="${esc(rollFilter.q)}" placeholder="Search film, camera…" autocomplete="off">
    <div class="filters" role="group" aria-label="Filter rolls">
      ${[['current', 'Current'], ['active', 'Active'], ['completed', 'Completed'], ['archived', 'Archived'], ['all', 'All']].map(([v, l]) => `<button data-act="filter" data-k="status" data-v="${v}" ${pressed('status', v)}>${l}</button>`).join('')}
    </div>
    <div class="filters" role="group" aria-label="More filters">
      ${[['all', 'Any format'], ['35mm', '35mm'], ['120', '120']].map(([v, l]) => `<button data-act="filter" data-k="format" data-v="${v}" ${pressed('format', v)}>${l}</button>`).join('')}
      <select data-filter="camera" aria-label="Camera"><option value="all">Any camera</option>${cams.map((c) => `<option value="${c.id}" ${rollFilter.camera === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select data-filter="month" aria-label="Month started"><option value="all">Any date</option>${months.map((m) => `<option value="${m}" ${rollFilter.month === m ? 'selected' : ''}>${new Date(m + '-15').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</option>`).join('')}</select>
    </div>
  </div>
  <div id="roll-results">${rollCardsHtml()}</div>`;
}

function rollCardsHtml() {
  const f = rollFilter;
  const q = f.q.trim().toLowerCase();
  const list = db().rolls
    .filter((r) => (f.status === 'all' ? true : f.status === 'current' ? r.status !== 'archived' : r.status === f.status))
    .filter((r) => f.format === 'all' || r.format === f.format)
    .filter((r) => f.camera === 'all' || r.cameraId === f.camera)
    .filter((r) => f.month === 'all' || r.startedAt.startsWith(f.month))
    .filter((r) => !q || [rollTitle(r), rollCamera(r).name, r.format, 'ei ' + r.shootingIso, r.notes].join(' ').toLowerCase().includes(q));
  // active first, then newest started
  list.sort((a, b) => (b.status === 'active') - (a.status === 'active') || b.startedAt.localeCompare(a.startedAt));
  if (!db().rolls.length) {
    return `<div class="empty">${icon('rolls')}<h2>No rolls yet</h2><p>Every roll you start appears here, ready to revisit when the scans come back.</p><a class="btn primary" href="#new">${icon('plus')} New Roll</a></div>`;
  }
  if (!list.length) return `<div class="empty"><p>No rolls match these filters.</p><button class="link" data-act="clear-filters">Clear filters</button></div>`;
  return `<div class="rolls">${list.map(rollCardHtml).join('')}</div>`;
}

function rollCardHtml(r) {
  const logged = loggedCount(r);
  const pct = Math.min(100, Math.round((logged / r.frameCapacity) * 100));
  return `<a class="roll-card" href="#roll-${r.id}">
    <div class="top"><div><p class="eyebrow">${esc(r.format)} · ${esc(rollCamera(r).name)}</p><h3>${esc(rollTitle(r))}</h3></div><span class="status ${r.status}">${r.status}</span></div>
    <div class="bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <div class="foot"><span class="mono">${pad2(logged)}/${r.frameCapacity}</span><span class="mono">EI ${r.shootingIso}${r.exposureApproach !== 'box' ? ` · ${r.exposureApproach}` : ''}</span><span>${fmtDate(r.startedAt)}</span></div>
  </a>`;
}

/* ---------- Roll detail (contact sheet) ---------- */

function viewRoll(id) {
  const roll = getRoll(id);
  if (!roll) return notFound('That roll no longer exists.');
  const frames = framesOf(roll.id);
  const maxLogged = frames.length ? frames[frames.length - 1].number : 0;
  const rows = [];
  for (let k = 1; k <= maxLogged; k++) {
    const f = frames.find((x) => x.number === k);
    rows.push(f ? frameRowHtml(roll, f) : `<a class="frame-row missing" href="#add-${roll.id}-${k}"><div class="no">${pad2(k)}</div><div class="body"><span class="subj none">Not logged · tap to add</span></div><span></span></a>`);
  }
  const cam = rollCamera(roll);
  return `<header class="topbar"><a class="back" href="#rolls">${icon('back')} Rolls</a><div class="grow"></div><a class="btn ghost" href="#edit-${roll.id}">${icon('edit')} Edit</a></header>
  <div class="stack">
    <div><p class="eyebrow">${esc(roll.format)} · ${roll.frameCapacity} frames · <span class="status ${roll.status}">${roll.status}</span></p><h1 style="margin-top:6px">${esc(rollTitle(roll))}</h1></div>
    <div class="kv">
      <div><span class="label">Camera</span><span class="v">${esc(cam.name)}</span></div>
      <div><span class="label">Frames</span><span class="v mono">${pad2(frames.length)} / ${roll.frameCapacity}${roll.extraFrames ? ` +${roll.extraFrames}` : ''}</span></div>
      <div><span class="label">Box speed</span><span class="v mono">ISO ${roll.boxIso}</span></div>
      <div><span class="label">Shot at</span><span class="v mono">${esc(exposureLine(roll))}</span></div>
      <div class="full"><span class="label">Development</span><span class="v">${esc(processingLine(roll))}</span></div>
      <div><span class="label">Started</span><span class="v">${fmtDate(roll.startedAt)}</span></div>
      <div><span class="label">Completed</span><span class="v">${fmtDate(roll.completedAt)}</span></div>
    </div>
    <div class="btn-row">
      ${roll.status === 'active' ? `<button class="btn primary" data-act="resume" data-id="${roll.id}">${icon('log')} Resume logging</button><button class="btn" data-act="roll-status" data-id="${roll.id}" data-v="completed">${icon('check')} Mark complete</button>` : ''}
      ${roll.status === 'completed' ? `<button class="btn" data-act="roll-status" data-id="${roll.id}" data-v="active">Reopen</button><button class="btn" data-act="roll-status" data-id="${roll.id}" data-v="archived">Archive</button>` : ''}
      ${roll.status === 'archived' ? `<button class="btn" data-act="roll-status" data-id="${roll.id}" data-v="completed">Unarchive</button>` : ''}
    </div>
    <section>
      <div class="section-head" style="margin-bottom:8px"><h2>Contact sheet</h2><span class="hint">${frames.length ? 'Tap a frame for details' : ''}</span></div>
      ${rows.length ? `<div class="sheet-list">${rows.join('')}</div>` : `<p class="muted">No frames logged on this roll yet.</p>`}
      ${maxLogged < rollTotal(roll) ? `<div style="margin-top:12px"><a class="link" href="#add-${roll.id}-${maxLogged + 1}">+ Log frame ${pad2(maxLogged + 1)}</a></div>` : ''}
    </section>
  </div>`;
}

function frameRowHtml(roll, f) {
  const exps = exposuresOf(f.id);
  const first = exps[0];
  const wx = [...new Set(exps.flatMap((e) => e.weather))];
  return `<a class="frame-row" href="#frame-${roll.id}-${f.number}">
    <div class="no">${pad2(f.number)}${exps.length > 1 ? `<small style="color:var(--ink)">×${exps.length} EXP</small>` : ''}</div>
    <div class="body">
      <span class="subj ${first.subject ? '' : 'none'}">${esc(first.subject || 'No description')}</span>
      <span class="set">${settingsText(first)}</span>
      ${exps.slice(1).map((e) => `<div class="sub-exp"><span class="subj ${e.subject ? '' : 'none'}" style="font-size:1rem">${esc(e.subject || 'No description')}</span><span class="set">${settingsText(e)}</span></div>`).join('')}
    </div>
    <div class="icons">${wx.slice(0, 3).map((w) => wxSvg(w, WX[w]?.label)).join('')}</div>
  </a>`;
}

/* ---------- Frame detail ---------- */

function viewFrame(rollId, n) {
  const roll = getRoll(rollId);
  if (!roll) return notFound('That roll no longer exists.');
  const frame = frameAt(roll.id, n);
  const exps = frame ? exposuresOf(frame.id) : [];
  const cam = rollCamera(roll);
  const frames = framesOf(roll.id);
  const idx = frames.findIndex((f) => f.number === n);
  const prev = frames[idx - 1], next = frames[idx + 1];
  return `<header class="topbar"><a class="back" href="#roll-${roll.id}">${icon('back')} ${esc(rollTitle(roll))}</a><div class="grow"></div>
    ${prev ? `<a class="icon-btn" href="#frame-${roll.id}-${prev.number}" aria-label="Previous logged frame">${icon('left')}</a>` : ''}
    ${next ? `<a class="icon-btn" href="#frame-${roll.id}-${next.number}" aria-label="Next logged frame">${icon('right')}</a>` : ''}</header>
  <div class="stack">
    <div style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">
      <div class="big-frame">${pad2(n)}</div>
      <div style="padding-bottom:8px"><p class="eyebrow">Frame ${n} of ${roll.frameCapacity} · ${esc(roll.format)}</p>
        ${exps.length > 1 ? `<span class="chip mx" style="margin-top:6px">${icon('multi')} ${exps.length} exposures on this frame</span>` : ''}</div>
    </div>
    <div class="kv">
      <div><span class="label">Film</span><span class="v">${esc(rollTitle(roll))}</span></div>
      <div><span class="label">Camera</span><span class="v">${esc(cam.name)}</span></div>
      <div><span class="label">Box speed</span><span class="v mono">ISO ${roll.boxIso}</span></div>
      <div><span class="label">Shot at</span><span class="v mono">${esc(exposureLine(roll))}</span></div>
    </div>
    ${exps.length ? exps.map((e) => expCardHtml(e, exps.length)).join('') : `<p class="muted">Nothing logged on this frame.</p>`}
    <a class="btn block" href="#add-${roll.id}-${n}">${icon(exps.length ? 'multi' : 'plus')} ${exps.length ? 'Add another exposure to this frame' : 'Log this frame'}</a>
  </div>`;
}

function expCardHtml(e, count) {
  return `<article class="exp-card">
    <div class="head"><h3>${count > 1 ? `Exposure ${e.sequence} of ${count}` : 'Exposure'}</h3><a class="btn ghost" href="#exp-${e.id}">${icon('edit')} Edit</a></div>
    <p class="notes" style="font-size:1.35rem">${esc(e.subject) || '<span class="muted">No description</span>'}</p>
    <div class="kv">
      <div><span class="label">Aperture</span><span class="v mono">${esc(e.aperture || '—')}</span></div>
      <div><span class="label">Shutter</span><span class="v mono">${esc(e.shutter ? (e.shutter === 'B' ? 'Bulb' : shutterLabel(e.shutter)) : '—')}</span></div>
    </div>
    ${e.weather.length ? `<div class="wx-list">${e.weather.map((w) => `<span>${wxSvg(w)}${esc(WX[w]?.label || w)}</span>`).join('')}</div>` : ''}
    ${e.notes ? `<div><p class="label" style="margin-bottom:4px">Notes</p><p class="notes">${esc(e.notes)}</p></div>` : ''}
    <p class="hint">Logged ${fmtDateTime(e.createdAt)}${e.updatedAt !== e.createdAt ? ` · edited ${fmtDateTime(e.updatedAt)}` : ''}</p>
  </article>`;
}

/* ---------- Exposure editor (edit an entry, or backfill a frame) ---------- */

function viewExposureEditor({ expId, rollId, n }) {
  let exp, roll, key, seed, title, sub;
  if (expId) {
    exp = db().exposures.find((e) => e.id === expId);
    if (!exp) return notFound('That entry no longer exists.');
    roll = getRoll(exp.rollId);
    const frame = db().frames.find((f) => f.id === exp.frameId);
    n = frame.number;
    key = 'edit:' + exp.id;
    seed = { aperture: exp.aperture, shutter: exp.shutter, weather: [...exp.weather], subject: exp.subject, notes: exp.notes, notesOpen: !!exp.notes };
    const count = exposuresOf(frame.id).length;
    title = `Edit Frame ${pad2(n)}`;
    sub = count > 1 ? `Exposure ${exp.sequence} of ${count}` : 'Exposure';
  } else {
    roll = getRoll(rollId);
    if (!roll || !(n >= 1 && n <= rollTotal(roll))) return notFound('That frame is not on this roll.');
    const frame = frameAt(roll.id, n);
    const count = frame ? exposuresOf(frame.id).length : 0;
    key = `add:${roll.id}:${n}`;
    title = count ? `Add exposure to Frame ${pad2(n)}` : `Log Frame ${pad2(n)}`;
    sub = count ? `This will be exposure ${count + 1} on the frame` : 'Backfilling a frame you missed';
  }
  const cam = rollCamera(roll);
  const draft = getDraft(key, seed);
  form = { key, draft, camera: cam, expId, rollId: roll.id, n };
  return `<header class="topbar"><button class="back" data-act="editor-cancel">${icon('back')} Cancel</button><div class="grow"></div>
    ${expId ? `<button class="btn danger" data-act="exp-delete" data-id="${expId}">Delete</button>` : ''}</header>
  <div class="wiz-q"><p class="eyebrow">${esc(rollTitle(roll))} · ${esc(sub)}</p><h1>${title}</h1></div>
  ${exposureFormHtml(draft, cam)}
  <div class="savebar"><div class="savebar-inner">
    <button class="btn primary big block" data-act="editor-save">${icon('check')} ${expId ? 'Save changes' : 'Save Frame'}</button>
    <div class="draft-status" id="draft-status"></div>
  </div></div>`;
}

/* ---------- Edit roll ---------- */

function viewEditRoll(id) {
  const roll = getRoll(id);
  if (!roll) return notFound('That roll no longer exists.');
  const cams = db().cameras;
  const maxLogged = Math.max(0, ...framesOf(roll.id).map((f) => f.number));
  const v = (k) => esc(roll[k] ?? '');
  return `<header class="topbar"><a class="back" href="#roll-${roll.id}">${icon('back')} Cancel</a></header>
  <div class="wiz-q"><p class="eyebrow">Roll details</p><h1>Edit roll</h1></div>
  <form class="stack" id="roll-form">
    <div class="field"><span class="label">Format</span>
      <select class="select input" name="format">${['35mm', '120'].map((f) => `<option value="${f}" ${roll.format === f ? 'selected' : ''} ${FORMATS[f].capacity + (roll.extraFrames || 0) < maxLogged ? 'disabled' : ''}>${f} · ${FORMATS[f].capacity} frames</option>`).join('')}</select>
      ${maxLogged > 12 ? '<span class="hint">120 is unavailable: frames beyond 12 are logged.</span>' : ''}</div>
    <div class="two"><div class="field"><label class="label" for="e-brand">Brand</label><input class="input" id="e-brand" name="filmBrand" value="${v('filmBrand')}"></div>
      <div class="field"><label class="label" for="e-box">Box ISO</label><input class="input mono" id="e-box" name="boxIso" value="${v('boxIso')}" inputmode="numeric" required></div></div>
    <div class="field"><label class="label" for="e-stock">Stock</label><input class="input" id="e-stock" name="filmStock" value="${v('filmStock')}" required></div>
    <div class="two">
      <div class="field"><label class="label" for="e-app">Approach</label><select class="select input" id="e-app" name="exposureApproach">${[['box', 'Box speed'], ['push', 'Push'], ['pull', 'Pull']].map(([k, l]) => `<option value="${k}" ${roll.exposureApproach === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label class="label" for="e-stops">Stops</label><select class="select input" id="e-stops" name="exposureStops">${[0, 0.33, 0.67, 1, 1.5, 2, 3].map((s) => `<option value="${s}" ${roll.exposureStops === s ? 'selected' : ''}>${s ? fmtStops(s) : '—'}</option>`).join('')}</select></div>
    </div>
    <div class="two">
      <div class="field"><label class="label" for="e-ei">Shooting ISO</label><input class="input mono" id="e-ei" name="shootingIso" value="${v('shootingIso')}" inputmode="numeric" required></div>
      <div class="field"><label class="label" for="e-proc">Development</label><select class="select input" id="e-proc" name="processingStops">${[-3, -2, -1, 0, 1, 2, 3].map((s) => `<option value="${s}" ${roll.processingStops === s ? 'selected' : ''}>${processingLabel(s)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label class="label" for="e-pi">Processing instructions</label><input class="input" id="e-pi" name="processingInstructions" value="${v('processingInstructions')}"></div>
    <div class="field"><label class="label" for="e-cam">Camera</label><select class="select input" id="e-cam" name="cameraId">${cams.map((c) => `<option value="${c.id}" ${roll.cameraId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="label" for="e-date">Date started</label><input class="input" type="date" id="e-date" name="startedAt" value="${roll.startedAt.slice(0, 10)}"></div>
    <div class="field"><label class="label" for="e-notes">Roll notes</label><textarea class="textarea" id="e-notes" name="notes" placeholder="Trip, lab, scan settings…">${esc(roll.notes)}</textarea></div>
    <button class="btn primary big" type="submit">Save roll details</button>
    <div class="divider"></div>
    <button class="btn danger" type="button" data-act="roll-delete" data-id="${roll.id}">Delete roll permanently</button>
  </form>`;
}

/* ---------- Search ---------- */

let searchQ = '';
function viewSearch() {
  return `<header class="topbar"><div class="grow"><p class="eyebrow">Find a photograph</p><h1>Search</h1></div></header>
  <div class="search-row"><input class="input subject" type="search" id="q" data-search value="${esc(searchQ)}" placeholder="Bellagio fountain, Portra, f/8, sunset…" autocomplete="off" enterkeyhint="search"></div>
  <div id="search-results">${searchResultsHtml()}</div>`;
}

function searchResultsHtml() {
  const terms = searchQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = db().exposures.map((e) => {
    const roll = getRoll(e.rollId);
    const frame = db().frames.find((f) => f.id === e.frameId);
    return { e, roll, frame };
  }).filter((x) => x.roll && x.frame);
  if (!all.length) return `<div class="empty">${icon('search')}<p>Logged frames will be searchable here by subject, notes, film, camera, settings or light.</p></div>`;
  let list;
  if (!terms.length) {
    list = all.sort((a, b) => b.e.createdAt.localeCompare(a.e.createdAt)).slice(0, 12);
  } else {
    list = all.filter(({ e, roll }) => {
      const hay = [e.subject, e.notes, rollTitle(roll), rollCamera(roll).name, roll.format, e.aperture, e.shutter, 'ei ' + roll.shootingIso, ...e.weather.map((w) => WX[w]?.label)].join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    }).sort((a, b) => b.e.createdAt.localeCompare(a.e.createdAt));
  }
  const head = terms.length ? `<p class="label" style="margin-bottom:4px">${list.length} ${list.length === 1 ? 'match' : 'matches'}</p>` : `<p class="label" style="margin-bottom:4px">Recently logged</p>`;
  if (!list.length) return head + `<p class="muted" style="padding:20px 0">Nothing matches “${esc(searchQ)}”.</p>`;
  return head + list.map(({ e, roll, frame }) => {
    const count = exposuresOf(frame.id).length;
    return `<a class="result" href="#frame-${roll.id}-${frame.number}">
      <span class="subj">${highlight(e.subject || 'No description', terms)}</span>
      ${e.notes ? `<span class="muted" style="font-size:.9rem">${highlight(e.notes.length > 120 ? e.notes.slice(0, 120) + '…' : e.notes, terms)}</span>` : ''}
      <span class="where"><b class="mono" style="color:var(--ink)">Frame ${pad2(frame.number)}</b>${count > 1 ? `<span class="chip mx">Exp ${e.sequence}/${count}</span>` : ''}<span>${esc(rollTitle(roll))}</span><span>·</span><span>${esc(rollCamera(roll).name)}</span></span>
      <span class="where mono"><span>${settingsText(e)}</span><span>· EI ${roll.shootingIso}</span><span class="icons">${e.weather.map((w) => wxSvg(w, WX[w]?.label)).join('')}</span><span>· ${fmtDate(e.createdAt)}</span></span>
    </a>`;
  }).join('');
}

function highlight(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

/* ---------- Settings: cameras, backup ---------- */

function viewPrefs() {
  const d = db();
  const pending = Object.keys(d.outbox).length;
  return `<header class="topbar"><a class="back" href="#rolls">${icon('back')} Rolls</a></header>
  <div class="wiz-q"><h1>Settings</h1></div>
  <div class="stack">
    <section class="stack">
      <h2>Backup</h2>
      <p class="muted">Your logbook is stored on this device only. Export a backup regularly and keep it somewhere safe (Files, iCloud Drive, Google Drive). A backup restores everything: rolls, frames, exposures and cameras.</p>
      <div class="kv">
        <div><span class="label">Rolls</span><span class="v mono">${d.rolls.length}</span></div>
        <div><span class="label">Exposures</span><span class="v mono">${d.exposures.length}</span></div>
        <div><span class="label">Last export</span><span class="v">${d.meta.lastExportAt ? fmtDateTime(d.meta.lastExportAt) : 'Never'}</span></div>
        <div><span class="label">Changes since export</span><span class="v mono">${d.meta.lastExportAt ? Object.values(d.outbox).filter((o) => o.at > d.meta.lastExportAt).length : pending}</span></div>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="export-json">Export backup (.json)</button>
        <button class="btn" data-act="export-csv">Export frames (.csv)</button>
      </div>
      <div class="btn-row">
        <label class="btn" for="import-file">Restore from backup…</label>
        <button class="btn" data-act="copy-json">Copy backup as text</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" class="sr">
      <p class="hint" id="storage-status">Checking storage…</p>
    </section>
    <div class="divider"></div>
    <section class="stack">
      <div class="section-head"><h2>Cameras</h2><button class="btn" data-act="cam-add">${icon('plus')} Add camera</button></div>
      <p class="muted">Only these shutter speeds are offered while logging. “Other” is always available for anything else.</p>
      ${d.cameras.map((c) => `<form class="cam-row" data-cam="${c.id}">
        <div class="field"><label class="label" for="cn-${c.id}">Name</label><input class="input" id="cn-${c.id}" name="name" value="${esc(c.name)}" required></div>
        <div class="field"><label class="label" for="cs-${c.id}">Shutter speeds</label>
          <input class="input mono" id="cs-${c.id}" name="shutters" value="${esc(shutterOptions(c).join(', '))}" placeholder="1/300, 1/100, 1/50, 1/25, B" autocomplete="off">
          <span class="hint">Separate with commas. Add B if it has a bulb setting.</span></div>
        <div class="two">
          <div class="field"><span class="label">Format</span><select class="select input" name="format">${['35mm', '120'].map((f) => `<option ${c.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
          <div class="field"><span class="label">In new-roll list</span><select class="select input" name="hidden"><option value="" ${!c.hidden ? 'selected' : ''}>Shown</option><option value="1" ${c.hidden ? 'selected' : ''}>Hidden</option></select></div>
        </div>
        <button class="btn" type="submit">Save camera</button>
      </form>`).join('')}
    </section>
    <div class="divider"></div>
    <section class="stack">
      <h2>Appearance</h2>
      <div class="seg">${[['', 'System'], ['light', 'Light'], ['dark', 'Darkroom']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${(localGet('filmlog:theme') || '') === v}">${l}</button>`).join('')}</div>
    </section>
    <p class="hint">Film Logbook ${APP_VERSION} · data schema v${SCHEMA_VERSION} · works offline</p>
  </div>`;
}

function notFound(msg) {
  return `<div class="empty"><h2>Not found</h2><p>${esc(msg)}</p><a class="btn" href="#rolls">Back to rolls</a></div>`;
}

/* ============================================================ feedback */

function toast(msg, { sub = '', undo = false, editId = null } = {}) {
  hideToast();
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `${icon('check')}<div class="msg">${esc(msg)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${undo ? '<button data-act="undo">Undo</button>' : ''}${editId ? `<button data-act="toast-edit" data-id="${editId}">Edit</button>` : ''}`;
  if (!document.querySelector('.savebar')) t.classList.add('low');
  document.body.appendChild(t);
  toastTimer = setTimeout(hideToast, undo ? 7000 : 3500);
}
function hideToast() {
  clearTimeout(toastTimer);
  document.querySelectorAll('.toast').forEach((t) => t.remove());
}

// In-page confirmation (native confirm() is unreliable in embedded views).
function confirmSheet({ title, body, ok, danger = false, onOk }) {
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t"><h2 id="sheet-t">${esc(title)}</h2>${body ? `<p class="muted">${body}</p>` : ''}
    <div class="btn-row"><button class="btn" data-sheet="cancel">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-sheet="ok">${esc(ok)}</button></div></div>`;
  s.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sheet]');
    if (e.target === s || (b && b.dataset.sheet === 'cancel')) closeSheet();
    else if (b && b.dataset.sheet === 'ok') { closeSheet(); onOk(); }
  });
  document.body.appendChild(s);
  s.querySelector('[data-sheet="ok"]').focus();
}
function closeSheet() { document.querySelectorAll('.scrim').forEach((s) => s.remove()); }

function rollSwitcher() {
  const cur = currentRoll();
  const list = activeRolls();
  closeSheet();
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Switch roll"><h2>Loaded rolls</h2>
    <div class="option-list">${list.map((r) => `<button class="option" data-pick="${r.id}" aria-pressed="${cur && cur.id === r.id}"><b>${esc(rollTitle(r))}</b><span class="mono muted">${pad2(loggedCount(r))}/${r.frameCapacity}</span><small>${esc(rollCamera(r).name)} · ${esc(r.format)} · EI ${r.shootingIso}</small></button>`).join('')}</div>
    <a class="btn primary big" href="#new" data-new>${icon('plus')} New Roll</a></div>`;
  s.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pick]');
    if (p) { db().meta.lastRollId = p.dataset.pick; Store.save(); closeSheet(); render(); }
    else if (e.target === s) closeSheet();
    else if (e.target.closest('[data-new]')) { wiz = null; delete db().drafts.__wizard; closeSheet(); }
  });
  document.body.appendChild(s);
}

/* ============================================================ backup */

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function backupJson() {
  const d = { ...db(), drafts: {}, exportedAt: nowIso(), app: 'film-logbook', appVersion: APP_VERSION };
  return JSON.stringify(d, null, 2);
}
function exportCsv() {
  const cols = ['roll_id', 'film', 'format', 'camera', 'box_iso', 'shooting_iso', 'approach', 'stops', 'development', 'frame', 'exposure', 'exposures_on_frame', 'aperture', 'shutter', 'weather', 'subject', 'notes', 'logged_at', 'edited_at'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(',')];
  for (const roll of db().rolls) for (const f of framesOf(roll.id)) {
    const exps = exposuresOf(f.id);
    for (const e of exps) rows.push([roll.id, rollTitle(roll), roll.format, rollCamera(roll).name, roll.boxIso, roll.shootingIso, roll.exposureApproach, roll.exposureStops, processingLine(roll), f.number, e.sequence, exps.length, e.aperture, e.shutter, e.weather.map((w) => WX[w]?.label).join('; '), e.subject, e.notes, e.createdAt, e.updatedAt].map(q).join(','));
  }
  return rows.join('\n');
}
function markExported() { db().meta.lastExportAt = nowIso(); Store.save(); }

function importBackup(text) {
  let data;
  try { data = JSON.parse(text); validateDb(data); data = migrate(data); } catch (e) { toast('Could not restore: ' + e.message); return; }
  confirmSheet({
    title: 'Replace this logbook?',
    body: `The backup has ${data.rolls.length} rolls and ${data.exposures.length} exposures. What is on this device now (${db().rolls.length} rolls, ${db().exposures.length} exposures) will be replaced. A copy of the current data is kept as the previous save.`,
    ok: 'Restore backup', danger: true,
    onOk: () => {
      delete data.exportedAt; delete data.app; delete data.appVersion;
      data.drafts = {};
      Store.db = data;
      Store.save();
      go('rolls');
      toast('Backup restored');
    },
  });
}

/* ============================================================ events */

function localGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localSet(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* ignore */ } }
function applyTheme() {
  const t = localGet('filmlog:theme');
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const roll = currentRoll();
  const d = el.dataset;
  switch (act) {
    /* exposure form */
    case 'wx': {
      const w = form.draft.weather;
      const i = w.indexOf(d.id);
      if (i >= 0) w.splice(i, 1); else w.push(d.id);
      el.setAttribute('aria-pressed', i < 0);
      const hint = el.closest('.section').querySelector('.section-head .hint');
      if (hint) hint.textContent = w.length ? w.length + ' selected' : 'Optional';
      persistDraftSoon();
      break;
    }
    case 'repeat': {
      const last = lastExposureOfRoll(getRoll(form.key));
      if (!last) break;
      Object.assign(form.draft, { aperture: last.aperture, shutter: last.shutter, weather: [...last.weather] });
      persistDraftSoon.flush();
      rerenderKeepScroll();
      break;
    }
    case 'notes-open': form.draft.notesOpen = true; persistDraftSoon(); rerenderKeepScroll(); document.getElementById('notes')?.focus(); break;
    case 'other-done': commitOther(); break;
    case 'other-cancel': form.draft.otherField = null; rerenderKeepScroll(); break;

    /* logger */
    case 'save-frame': saveFrame(); break;
    case 'undo': undoLastSave(); break;
    case 'toast-edit': hideToast(); go('exp-' + d.id); break;
    case 'wind-on': if (roll) windOn(roll); break;
    case 'start-multi': if (roll) { updateRoll(roll, { pendingMulti: true }); render(); } break;
    case 'cancel-multi': if (roll) { updateRoll(roll, { pendingMulti: false }); render(); } break;
    case 'nav-frame': if (roll) { updateRoll(roll, { cursor: Math.max(1, Math.min(rollTotal(roll) + 1, Math.min(roll.cursor, rollTotal(roll) + 1) + Number(d.d))), pendingMulti: false }); render(); } break;
    case 'goto-frame': if (roll && parseRoute().name === 'log') { updateRoll(roll, { cursor: Number(d.frame), pendingMulti: false }); render(); } break;
    case 'switch-roll': if (activeRolls().length > 1) rollSwitcher(); else { wiz = null; delete db().drafts.__wizard; go('new'); } break;
    case 'complete-roll': if (roll) { updateRoll(roll, { status: 'completed', completedAt: nowIso() }); go('roll-' + roll.id); toast('Roll marked complete'); } break;
    case 'extra-frame': if (roll) { updateRoll(roll, { extraFrames: (roll.extraFrames || 0) + 1, cursor: rollTotal(roll) + 1 }); render(); } break;

    /* wizard */
    case 'wiz-cancel': wiz = null; delete db().drafts.__wizard; Store.save(); history.length > 1 ? history.back() : go('log'); break;
    case 'wiz-back': wiz.step = Math.max(1, wiz.step - 1); saveWizard(); render(); break;
    case 'wiz-format': {
      wiz.format = d.f;
      const last = db().meta.lastCameraByFormat[d.f];
      const match = db().cameras.find((c) => !c.hidden && c.format === d.f);
      if (!wiz.cameraId || getCamera(wiz.cameraId)?.format !== d.f) wiz.cameraId = (getCamera(last) && !getCamera(last).hidden ? last : null) || match?.id || db().cameras[0]?.id;
      wiz.step = 2; saveWizard(); render(); break;
    }
    case 'wiz-stock': wiz.filmBrand = d.brand; wiz.filmStock = d.stock; wiz.boxIso = d.iso; wiz.isoTouched = false; recomputeEi(); saveWizard(); render(); break;
    case 'wiz-approach': wiz.approach = d.v; wiz.isoTouched = false; recomputeEi(); saveWizard(); render(); break;
    case 'wiz-stops': wiz.stops = Number(d.v); wiz.isoTouched = false; recomputeEi(); saveWizard(); render(); break;
    case 'wiz-proc': wiz.processingStops = Math.max(-3, Math.min(3, wiz.processingStops + Number(d.d))); wiz.processingTouched = true; saveWizard(); render(); break;
    case 'wiz-next': if (wizardValid()) { if (wiz.step === 2) recomputeEi(); wiz.step++; saveWizard(); render(); window.scrollTo(0, 0); } break;
    case 'wiz-start': {
      const r = createRoll(wiz);
      wiz = null; delete db().drafts.__wizard; Store.save();
      go('log', true);
      toast(`${rollTitle(r)} loaded`, { sub: `Frame 01 of ${r.frameCapacity} · ${rollCamera(r).name}` });
      break;
    }

    /* rolls */
    case 'filter': rollFilter[d.k] = d.v; render(); break;
    case 'clear-filters': Object.assign(rollFilter, { q: '', status: 'all', format: 'all', camera: 'all', month: 'all' }); render(); break;
    case 'resume': db().meta.lastRollId = d.id; Store.save(); go('log'); break;
    case 'roll-status': {
      const r = getRoll(d.id);
      updateRoll(r, { status: d.v, completedAt: d.v === 'active' ? null : r.completedAt || nowIso() });
      render();
      toast({ active: 'Roll reopened', completed: 'Roll marked complete', archived: 'Roll archived' }[d.v]);
      break;
    }
    case 'roll-delete': {
      const r = getRoll(d.id);
      confirmSheet({ title: 'Delete this roll?', body: `${esc(rollTitle(r))} and its ${loggedCount(r)} logged frames will be removed from this device. This cannot be undone.`, ok: 'Delete roll', danger: true,
        onOk: () => { deleteRoll(r); go('rolls'); toast('Roll deleted'); } });
      break;
    }

    /* exposure editor */
    case 'editor-save': editorSave(); break;
    case 'editor-cancel': delete db().drafts[form.key]; Store.save(); history.length > 1 ? history.back() : go('rolls'); break;
    case 'exp-delete': {
      const e = db().exposures.find((x) => x.id === d.id);
      const frame = db().frames.find((f) => f.id === e.frameId);
      confirmSheet({ title: `Delete this exposure from Frame ${pad2(frame.number)}?`, body: 'Other frames and exposures stay as they are.', ok: 'Delete exposure', danger: true,
        onOk: () => { const rid = e.rollId, n = frame.number; deleteExposure(e); delete db().drafts['edit:' + e.id]; Store.save(); go(frameAt(rid, n) ? `frame-${rid}-${n}` : `roll-${rid}`, true); toast('Exposure deleted'); } });
      break;
    }

    /* settings */
    case 'export-json': download(`film-logbook-${new Date().toISOString().slice(0, 10)}.json`, backupJson(), 'application/json'); markExported(); render(); toast('Backup exported'); break;
    case 'export-csv': download(`film-logbook-frames-${new Date().toISOString().slice(0, 10)}.csv`, exportCsv(), 'text/csv'); toast('Frames exported'); break;
    case 'copy-json': {
      const text = backupJson();
      navigator.clipboard?.writeText(text).then(() => { markExported(); render(); toast('Backup copied — paste it into a note or file'); }, () => toast('Copy was blocked here. Use Export backup instead.'));
      break;
    }
    case 'cam-add': {
      db().cameras.push({ id: newId('cam_'), name: 'New camera', format: '35mm', fastest: 1 / 1000, slowest: 1, bulb: true, minF: null, maxF: null });
      Store.save(); render();
      const inputs = document.querySelectorAll('.cam-row input[name="name"]');
      inputs[inputs.length - 1]?.select();
      break;
    }
    case 'theme': localSet('filmlog:theme', d.v); applyTheme(); render(); break;
  }
});

function rerenderKeepScroll() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.matches('select[data-field]') && form) {
    if (el.value === '__other') { form.draft.otherField = el.dataset.field; rerenderKeepScroll(); document.getElementById('other-input')?.focus(); return; }
    form.draft[el.dataset.field] = el.value;
    form.draft.otherField = null;
    persistDraftSoon.flush();
    rerenderKeepScroll();
  } else if (el.matches('select[data-wiz]')) {
    wiz[el.dataset.wiz] = el.value; saveWizard();
  } else if (el.matches('select[data-filter]')) {
    rollFilter[el.dataset.filter] = el.value; render();
  } else if (el.id === 'import-file' && el.files[0]) {
    const reader = new FileReader();
    reader.onload = () => importBackup(String(reader.result));
    reader.readAsText(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.matches('[data-field]') && el.tagName !== 'SELECT' && form) {
    form.draft[el.dataset.field] = el.value;
    setDraftStatus('Saving draft…');
    persistDraftSoon();
  } else if (el.matches('[data-wiz]') && el.tagName !== 'SELECT') {
    const k = el.dataset.wiz;
    wiz[k] = el.value;
    if (k === 'boxIso') { wiz.isoTouched = false; recomputeEi(); }
    if (k === 'shootingIso') wiz.isoTouched = true;
    if (k === 'filmStock' || k === 'filmBrand') { /* manual entry */ }
    saveWizard();
    if (k === 'stockQuery') {
      const y = window.scrollY; render(); window.scrollTo(0, y);
      const q = document.getElementById('stock-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
    } else {
      const btn = document.querySelector('[data-act="wiz-next"]');
      if (btn) btn.disabled = !wizardValid();
    }
  } else if (el.matches('[data-filter="q"]')) {
    rollFilter.q = el.value;
    document.getElementById('roll-results').innerHTML = rollCardsHtml();
  } else if (el.matches('[data-search]')) {
    searchQ = el.value;
    document.getElementById('search-results').innerHTML = searchResultsHtml();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'other-input') { ev.preventDefault(); commitOther(); }
  if (ev.key === 'Enter' && ev.target.id === 'subject') { ev.preventDefault(); ev.target.blur(); }
  if (ev.key === 'Escape') closeSheet();
});

document.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const data = Object.fromEntries(new FormData(f));
  if (f.id === 'roll-form') {
    const roll = getRoll(parseRoute().a);
    if (!data.filmStock.trim() || !(Number(data.boxIso) > 0) || !(Number(data.shootingIso) > 0)) { toast('Stock name, box ISO and shooting ISO are required'); return; }
    const cam = getCamera(data.cameraId);
    const started = data.startedAt && data.startedAt !== roll.startedAt.slice(0, 10) ? new Date(data.startedAt + 'T12:00:00').toISOString() : roll.startedAt;
    updateRoll(roll, {
      format: data.format, frameCapacity: FORMATS[data.format].capacity, filmBrand: data.filmBrand.trim(), filmStock: data.filmStock.trim(),
      boxIso: Number(data.boxIso), shootingIso: Number(data.shootingIso), exposureApproach: data.exposureApproach,
      exposureStops: data.exposureApproach === 'box' ? 0 : Number(data.exposureStops) || 1, processingStops: Number(data.processingStops),
      processingInstructions: data.processingInstructions.trim(), cameraId: data.cameraId, cameraName: cam ? cam.name : roll.cameraName,
      startedAt: started, notes: data.notes.trim(),
    });
    go('roll-' + roll.id, true);
    toast('Roll details saved');
  } else if (f.dataset.cam) {
    const cam = getCamera(f.dataset.cam);
    let speeds;
    try { speeds = parseShutterList(data.shutters); } catch (e) { toast(e.message); return; }
    if (!speeds.list.length && !speeds.bulb) { toast('Add at least one shutter speed'); return; }
    Object.assign(cam, {
      name: data.name.trim() || cam.name, format: data.format, hidden: !!data.hidden,
      shutters: speeds.list, bulb: speeds.bulb,
      fastest: speeds.list.length ? shutterSeconds(speeds.list[0]) : cam.fastest,
      slowest: speeds.list.length ? shutterSeconds(speeds.list[speeds.list.length - 1]) : cam.slowest,
    });
    db().rolls.filter((r) => r.cameraId === cam.id).forEach((r) => { r.cameraName = cam.name; });
    Store.touch('cameras', cam.id);
    Store.save();
    toast('Camera saved');
  }
});

function commitOther() {
  const input = document.getElementById('other-input');
  if (!input || !form) return;
  let v = input.value.trim();
  const field = input.dataset.other;
  if (field === 'aperture' && v && /^\d+(\.\d+)?$/.test(v)) v = 'f/' + v;
  if (field === 'aperture' && v && /^f\d/i.test(v)) v = 'f/' + v.slice(1);
  if (v) form.draft[field] = v;
  form.draft.otherField = null;
  persistDraftSoon.flush();
  rerenderKeepScroll();
}

function editorSave() {
  if (!form) return;
  const draft = form.draft;
  if (form.expId) {
    const exp = db().exposures.find((e) => e.id === form.expId);
    updateExposure(exp, draft);
    delete db().drafts[form.key]; Store.save();
    const frame = db().frames.find((f) => f.id === exp.frameId);
    go(`frame-${exp.rollId}-${frame.number}`, true);
    toast('Changes saved');
  } else {
    const roll = getRoll(form.rollId);
    const frame = frameAt(roll.id, form.n);
    try { addExposure(roll, form.n, draft, { append: !!frame }); } catch (e) { toast(e.message); return; }
    delete db().drafts[form.key]; Store.save();
    go(`frame-${roll.id}-${form.n}`, true);
    toast(`Frame ${pad2(form.n)} saved`);
  }
}

/* ============================================================ boot */

window.addEventListener('pagehide', () => persistDraftSoon.flush());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistDraftSoon.flush(); });
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { Store.load(); render(); } });
window.addEventListener('online', () => Sync.flush().catch(() => {}));

function checkStorage() {
  const el = document.getElementById('storage-status');
  if (!el) return;
  if (!navigator.storage?.persisted) { el.textContent = 'Saved in this browser’s storage.'; return; }
  navigator.storage.persisted().then((p) => {
    el.textContent = p ? 'Storage is marked persistent: the browser will not clear it to free space.' : 'Storage is not yet marked persistent. Installing the app to your home screen helps keep it safe.';
  });
}
new MutationObserver(checkStorage).observe(document.getElementById('app'), { childList: true });

Store.load();
applyTheme();
render();
try { navigator.storage?.persist?.(); } catch (e) { /* not supported */ }
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
