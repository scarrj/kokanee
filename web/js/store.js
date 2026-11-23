// store.js [WS6] - editable App JSON: IndexedDB `kokanee` (stores `local`, `recovery`), undo/redo, revisions,
// conflicts, validated import, recovery slots, JSON / GPX export. Contract: CONTRACTS.md#app-json, #modules.
import { validate, diff } from './model.js';
import { toGPX } from './gpx.js';
import { openConflictDialog, confirmDialog, messageDialog, summaryHTML } from './conflict-dialog.js';

const DB_NAME = 'kokanee';
const DB_VERSION = 1;
const MAX_UNDO = 100;
const MAX_SLOTS = 5;
const SAVE_MS = 500;
const SUPPORTED_SCHEMA = 1;
const PUBLISHED_URL = new URL('../data/routes.json', import.meta.url).href;

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- IndexedDB (memory fallback)
let dbp = null;
let persistent = true;
const mem = { local: null, recovery: [] };

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('local')) db.createObjectStore('local');
      if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' });
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('indexedDB blocked'));
  });
  dbp.catch(() => { persistent = false; });
  return dbp;
}

// run fn(objectStore) -> IDBRequest inside one transaction; resolves with the request result
async function idb(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    let rq;
    try { rq = fn(t.objectStore(storeName)); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(rq ? rq.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

async function readLocal() {
  try { return (await idb('local', 'readonly', (s) => s.get('current'))) || null; } catch { persistent = false; return mem.local ? clone(mem.local) : null; }
}
async function writeLocal(rec) {
  mem.local = clone(rec);
  try { await idb('local', 'readwrite', (s) => s.put(rec, 'current')); } catch (e) { persistent = false; console.warn('store: local save failed', e); }
}
async function allSlots() {
  let list;
  try { list = (await idb('recovery', 'readonly', (s) => s.getAll())) || []; } catch { list = mem.recovery.map(clone); }
  return list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)); // newest first
}

// ---------------------------------------------------------------- state
let published = null;       // last published App JSON seen from the network/cache (null if never reachable)
let current = null;         // the working App JSON (always replaced, never mutated)
let baseRev = 0;            // published content_rev that the local edits are based on
let base = null;            // published App JSON at that revision (for conflict summaries)
let dirty = false;
let modifiedAt = null;
let undoStack = [];
let redoStack = [];
let saveTimer = null;
let savePending = null;
let conflictPromise = null;
let slotMeta = [];
const listeners = new Map();

export function on(evt, cb) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(cb);
  return () => off(evt, cb);
}
export function off(evt, cb) { const s = listeners.get(evt); if (s) s.delete(cb); }
function emit(evt, payload = {}) {
  for (const cb of [...(listeners.get(evt) || [])]) { try { cb(payload); } catch (e) { console.error(e); } }
}

// ---------------------------------------------------------------- persistence
function record() { return { base_rev: baseRev, data: current, modified_at: modifiedAt, dirty, base }; }
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; savePending = saveNow(); }, SAVE_MS);
}
async function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!current) return;
  await writeLocal(record());
  emit('saved', { dirty });
}
export async function flush() { if (saveTimer) await saveNow(); else if (savePending) await savePending; }
function touch() { modifiedAt = nowIso(); scheduleSave(); }

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) saveNow(); });
}

// ---------------------------------------------------------------- recovery slots
async function addSlot(reason, data) {
  const slot = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created_at: nowIso(), reason, data: clone(data) };
  mem.recovery.push(slot);
  mem.recovery.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  while (mem.recovery.length > MAX_SLOTS) mem.recovery.shift();
  try {
    await idb('recovery', 'readwrite', (s) => s.put(slot));
    const list = await allSlots();
    for (const old of list.slice(MAX_SLOTS)) await idb('recovery', 'readwrite', (s) => s.delete(old.id)); // oldest dropped first
  } catch (e) { persistent = false; console.warn('store: recovery save failed', e); }
  await refreshSlots();
  return slot;
}
async function refreshSlots() {
  slotMeta = (await allSlots()).map(({ id, created_at, reason }) => ({ id, created_at, reason }));
  emit('recovery', { slots: slotMeta });
}
// recoverySlots() -> Promise<[{id, created_at, reason, data}]> newest first
export async function recoverySlots() { return allSlots(); }
export function recoverySlotMeta() { return slotMeta.slice(); }

export async function restore(slotId) {
  const slot = (await allSlots()).find((s) => s.id === slotId);
  if (!slot) return { ok: false, errors: ['Recovery slot not found'] };
  const v = validate(slot.data);
  if (!v.ok) return { ok: false, errors: v.errors };
  replaceCurrent(clone(slot.data), `restore ${slot.reason} slot`);
  return { ok: true, errors: [] };
}

// ---------------------------------------------------------------- load
async function fetchPublished() {
  try {
    const r = await fetch(PUBLISHED_URL, { cache: 'no-store' }); // network first (the service worker is network-first too)
    if (r.ok) return await r.json();
  } catch { /* offline: fall through to the cache */ }
  try {
    if (typeof caches !== 'undefined') {
      const hit = await caches.match(PUBLISHED_URL, { ignoreSearch: true });
      if (hit) return await hit.json();
    }
  } catch { /* no cache */ }
  return null;
}

function adopt(data, rev, isDirty, baseData) {
  current = clone(data); baseRev = rev; base = baseData ? clone(baseData) : null; dirty = isDirty;
  undoStack = []; redoStack = [];
  modifiedAt = nowIso();
}

// load({published?}) - `published` is a test hook that replaces the network fetch.
export async function load(opts = {}) {
  clearTimeout(saveTimer); saveTimer = null;
  const pub = opts.published !== undefined ? opts.published : await fetchPublished();
  published = pub;
  let rec = await readLocal();
  if (rec && !(rec.data && validate(rec.data).ok)) {
    if (rec.data) await addSlot('reset', rec.data); // keep an unreadable/invalid local copy for inspection
    rec = null;
  }
  await refreshSlots();
  if (!pub && !rec) throw new Error('routes.json is unavailable and there is no local copy');

  let conflict = null;
  if (!rec) {
    adopt(pub, pub.content_rev, false, pub);
  } else if (!pub) {
    adopt(rec.data, rec.base_rev, !!rec.dirty, rec.base); // offline: keep working on the local copy
    modifiedAt = rec.modified_at || modifiedAt;
  } else if (!rec.dirty || diffEmpty(pub, rec.data)) {
    adopt(pub, pub.content_rev, false, pub); // nothing of mine to lose: silently take published
  } else if (pub.content_rev > rec.base_rev) {
    adopt(rec.data, rec.base_rev, true, rec.base); // show mine while the dialog is open
    modifiedAt = rec.modified_at || modifiedAt;
    conflict = rec;
  } else {
    adopt(rec.data, rec.base_rev, true, rec.base);
    modifiedAt = rec.modified_at || modifiedAt;
  }
  await saveNow();
  emit('change', { reason: 'load', label: 'load' });
  if (conflict) startConflict(pub, conflict);
  return current;
}

function diffEmpty(a, b) { const d = diff(a, b); return !d.added.length && !d.changed.length && !d.removed.length; }

// conflictPending() -> Promise that resolves with 'mine' | 'published' once the dialog was answered, or null
export function conflictPending() { return conflictPromise; }

function startConflict(pub, rec) {
  conflictPromise = (async () => {
    let choice;
    for (;;) {
      choice = await openConflictDialog({ published: pub, local: current, base: rec.base || null, baseRev: rec.base_rev });
      if (choice === 'export') { downloadFile('routes-mine.json', JSON.stringify(current, null, 2), 'application/json'); continue; }
      break;
    }
    if (choice === 'published') {
      await addSlot('take-published', current);
      adopt(pub, pub.content_rev, false, pub);
    } else { // keep mine: rebase onto the published revision
      baseRev = pub.content_rev; base = clone(pub);
      current = { ...current, content_rev: pub.content_rev };
      dirty = true;
    }
    modifiedAt = nowIso();
    await saveNow();
    emit('change', { reason: choice === 'published' ? 'take-published' : 'rebase', label: choice });
    conflictPromise = null;
    return choice;
  })();
  return conflictPromise;
}

// ---------------------------------------------------------------- read / edit
export function get() { return current; }
export function isDirty() { return dirty; }
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function getPublished() { return published; }
export function getState() {
  return { dirty, baseRev, publishedRev: published ? published.content_rev : null, canUndo: canUndo(), canRedo: canRedo(), persistent, modifiedAt, undoDepth: undoStack.length };
}

// update(fn, label) -> {ok, changed, errors}. fn(draft) mutates the draft (or returns a replacement).
export function update(fn, label = 'edit') {
  if (!current) return { ok: false, changed: false, errors: ['store not loaded'] };
  const draft = clone(current);
  let next;
  try { const r = fn(draft); next = r && typeof r === 'object' ? r : draft; } catch (e) { return { ok: false, changed: false, errors: [String((e && e.message) || e)] }; }
  if (same(next, current)) return { ok: true, changed: false, errors: [] };
  const v = validate(next);
  if (!v.ok) { emit('invalid', { label, errors: v.errors }); return { ok: false, changed: false, errors: v.errors }; }
  commit(next, label, 'update');
  return { ok: true, changed: true, errors: [] };
}

function commit(next, label, reason) {
  undoStack.push({ label, data: current });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
  current = next; dirty = true;
  touch();
  emit('change', { label, reason });
}
function replaceCurrent(next, label) { commit(next, label, 'replace'); }

export function undo() {
  if (!undoStack.length) return false;
  const e = undoStack.pop();
  redoStack.push({ label: e.label, data: current });
  current = e.data; dirty = true; touch();
  emit('change', { label: e.label, reason: 'undo' });
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  const e = redoStack.pop();
  undoStack.push({ label: e.label, data: current });
  current = e.data; dirty = true; touch();
  emit('change', { label: e.label, reason: 'redo' });
  return true;
}

// ---------------------------------------------------------------- reset
// reset() -> {ok}. Snapshots the current state into recovery, then returns to the published data.
export async function reset() {
  if (!published) return { ok: false, errors: ['The published routes.json could not be loaded (offline?)'] };
  await addSlot('reset', current);
  adopt(published, published.content_rev, false, published);
  await saveNow();
  emit('change', { label: 'reset', reason: 'reset' });
  return { ok: true, errors: [] };
}

// ---------------------------------------------------------------- download helpers
export function downloadFile(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

const stamp = () => nowIso().replace(/[:T]/g, '-').slice(0, 16);

// exportJSON({publish}) -> {ok, content_rev?}. publish: bumps content_rev, sets published_at, reminds to commit + push.
export async function exportJSON({ publish = false } = {}) {
  if (!current) return { ok: false, errors: ['store not loaded'] };
  const out = clone(current);
  if (publish) {
    out.content_rev = (published ? published.content_rev : baseRev) + 1;
    out.published_at = nowIso().replace(/\.\d+Z$/, 'Z');
  }
  const v = validate(out);
  if (!v.ok) {
    await messageDialog({ title: 'Cannot export', html: `<p>The data is not valid:</p><ul class="kk-err">${v.errors.slice(0, 10).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` });
    return { ok: false, errors: v.errors };
  }
  downloadFile('routes.json', `${JSON.stringify(out, null, 2)}\n`, 'application/json');
  if (publish) {
    await messageDialog({
      title: 'Export for publishing',
      html: `<p>Downloaded <b>routes.json</b> with <b>content_rev ${out.content_rev}</b>.</p><p>To publish it for everyone: replace <code>web/data/routes.json</code> in the repository with this file, commit it and push. Devices pick it up the next time they open the app with a connection.</p><p>Your local edits stay in the app until then.</p>`,
    });
  }
  return { ok: true, content_rev: out.content_rev };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// exportGPX() -> GPX string (also downloaded)
export function exportGPX() {
  if (!current) return null;
  const xml = toGPX(current);
  downloadFile('kokanee-routes.gpx', xml, 'application/gpx+xml');
  return xml;
}

// ---------------------------------------------------------------- import
// importJSON(file) -> {ok, errors?, cancelled?}. file: File | Blob | JSON string | object.
export async function importJSON(file) {
  if (!current) return { ok: false, errors: ['store not loaded'] };
  let parsed;
  try {
    if (typeof file === 'string') parsed = JSON.parse(file);
    else if (file && typeof file.text === 'function') parsed = JSON.parse(await file.text());
    else parsed = file;
  } catch (e) {
    await messageDialog({ title: 'Import rejected', message: `The file is not valid JSON (${e.message}).\nNothing was changed.` });
    return { ok: false, errors: ['not valid JSON'] };
  }
  const v = validate(parsed);
  const errors = v.errors.slice();
  if (parsed && typeof parsed === 'object' && parsed.schema_version > SUPPORTED_SCHEMA) errors.unshift(`schema_version ${parsed.schema_version} is newer than this app supports (${SUPPORTED_SCHEMA})`);
  if (errors.length) {
    await messageDialog({
      title: 'Import rejected',
      html: `<p>The file is not valid App JSON. <b>Nothing was changed.</b></p><ul class="kk-err">${errors.slice(0, 12).map((e) => `<li>${esc(e)}</li>`).join('')}${errors.length > 12 ? `<li>and ${errors.length - 12} more</li>` : ''}</ul>`,
    });
    return { ok: false, errors };
  }
  const ok = await confirmDialog({
    title: 'Import routes.json', ok: 'Import and replace',
    html: `${summaryHTML(diff(current, parsed), [current, parsed])}<p class="kk-muted">A recovery copy of your current data is saved first.</p>`,
  });
  if (!ok) return { ok: false, cancelled: true, errors: [] };
  await addSlot('import', current);
  replaceCurrent(clone(parsed), 'import');
  return { ok: true, errors: [] };
}

function pickFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json'; inp.style.display = 'none';
    inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.appendChild(inp); inp.click();
  });
}

// ---------------------------------------------------------------- menu (section 'data')
let uiMod = null;
const toast = (m) => { try { uiMod && uiMod.toast(m); } catch { /* ignore */ } };

async function menuImport() {
  const f = await pickFile();
  if (!f) return;
  const r = await importJSON(f);
  if (r.ok) toast('Imported. The previous data is in a recovery slot (Menu > Data).');
}
async function menuReset() {
  const ok = await confirmDialog({
    title: 'Reset to published', danger: true, ok: 'Reset',
    message: 'Discard your local edits and go back to the published routes.json?\nA recovery copy of your edits is saved first.',
  });
  if (!ok) return;
  const r = await reset();
  toast(r.ok ? 'Reset to published data' : r.errors[0]);
}
async function menuRestore(slot) {
  const ok = await confirmDialog({
    title: 'Restore recovery copy', danger: true, ok: 'Restore',
    message: `Replace your current data with the copy from ${new Date(slot.created_at).toLocaleString()} (${slot.reason})?\nYou can Undo this in the editor until you close the app.`,
  });
  if (!ok) return;
  const r = await restore(slot.id);
  toast(r.ok ? 'Recovery copy restored' : r.errors[0]);
}

function registerDataMenu() {
  if (!uiMod || !uiMod.registerMenu) return;
  const items = [
    { label: 'Export routes.json (my edits)', onClick: () => { exportJSON(); } },
    { label: 'Export for publishing...', onClick: () => { exportJSON({ publish: true }); } },
    { label: 'Import routes.json...', onClick: menuImport },
    { label: 'Export GPX', onClick: () => { exportGPX(); } },
    { label: 'Reset to published...', onClick: menuReset },
  ];
  if (!slotMeta.length) items.push({ label: 'Recovery copies: none', disabled: true, onClick() {} });
  for (const s of slotMeta) {
    items.push({ label: `Restore: ${new Date(s.created_at).toLocaleString()} (${s.reason})`, title: 'Restore this recovery copy', onClick: () => allSlots().then((l) => { const f = l.find((x) => x.id === s.id); if (f) menuRestore(f); }) });
  }
  uiMod.registerMenu('data', items);
}

if (typeof document !== 'undefined') {
  import('./ui.js').then((m) => {
    uiMod = m;
    registerDataMenu();
    on('recovery', registerDataMenu);
    if (current && dirty) toast('Showing your local edits (not published yet).');
  }).catch((e) => console.warn('store: menu not registered', e));
}
