// editor.js [WS6] - edit mode: text fields, line / polygon vertex editing, drawing, add / delete, undo / redo.
// Contract: CONTRACTS.md#modules (editor.js), #layers (edit-vertices, edit-midpoints, edit-line are the only layers added).
/* global maplibregl */
import * as ui from './ui.js';
import { highlightRoute } from './map.js';
import * as defaultStore from './store.js';
import { confirmDialog } from './conflict-dialog.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const PALETTE = ['#d9480f', '#5f3dc4', '#1971c2', '#0c8599', '#2b8a3e', '#e8590c', '#c2255c', '#495057', '#868e96'];
const BBOX = { lonMin: -117.32, lonMax: -117.02, latMin: 49.55, latMax: 49.87 };
const COLL = { zone: 'zones', route: 'routes', poi: 'pois', area: 'areas' };
const POI_TYPES = ['hut', 'helipad', 'peak', 'pass', 'lake', 'landmark'];
const AREA_KINDS = ['closure', 'no-go', 'note'];

let map = null, store = null, on = false;
let sel = null;          // {kind, id, line}
let draw = null;         // {kind:'line'|'area', routeId, line, pts[]}
let placing = null;      // {zoneId} while the next tap sets the zone's info point
let drag = null;
let suppressClickUntil = 0;
let textCommit = false;
let dblZoomWasOn = false;
let unsub = null;
let coarse = false;
const els = {};
const handlers = {};

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function clampCoord(c) {
  const lng = Array.isArray(c) ? c[0] : c.lng, lat = Array.isArray(c) ? c[1] : c.lat;
  return [r6(clamp(lng, BBOX.lonMin, BBOX.lonMax)), r6(clamp(lat, BBOX.latMin, BBOX.latMax))];
}
const sid = () => Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 8).padEnd(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findObj = (app, kind, id) => ((app && app[COLL[kind]]) || []).find((x) => x.id === id);
const uniqueId = (app, kind, prefix) => { let id; do { id = `${prefix}${sid()}`; } while (findObj(app, kind, id)); return id; };
const toast = (m) => ui.toast(m);
const touchy = (e) => coarse || !!(e && e.originalEvent && /^touch/.test(e.originalEvent.type || ''));

// ---------------------------------------------------------------- styles + DOM
function injectStyle() {
  if (document.getElementById('kk-edit-style')) return;
  const s = document.createElement('style');
  s.id = 'kk-edit-style';
  s.textContent = `
#kk-edit{position:fixed;z-index:18;top:calc(var(--bar,52px) + 8px);left:8px;max-width:calc(100% - 64px);display:flex;flex-direction:column;gap:8px;pointer-events:none;font-family:var(--font,system-ui,sans-serif);font-size:14px}
#kk-edit > *{pointer-events:auto}
.kk-bar{background:var(--panel,#fff);color:var(--fg,#212529);border-radius:var(--radius,10px);box-shadow:0 2px 10px rgba(0,0,0,.35);padding:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.kk-bar .kk-tag{background:#ff6b00;color:#fff;font-weight:700;border-radius:6px;padding:4px 8px;letter-spacing:.04em}
.kk-b{min-height:var(--tap,44px);min-width:var(--tap,44px);padding:0 12px;border:1px solid var(--line,#dee2e6);border-radius:var(--radius,10px);background:var(--bg,#f8f9fa);color:var(--fg,#212529);font:inherit;cursor:pointer}
.kk-b:disabled{opacity:.4;cursor:default}
.kk-b.primary{background:var(--accent,#0b6ea8);color:#fff;border-color:transparent}
.kk-b.danger{color:var(--danger,#c92a2a);border-color:var(--danger,#c92a2a)}
.kk-bar select{min-height:var(--tap,44px);max-width:200px;border:1px solid var(--line,#dee2e6);border-radius:var(--radius,10px);background:var(--bg,#f8f9fa);color:var(--fg,#212529);font:inherit;padding:0 6px}
#kk-mode{font-size:13px}
#kk-mode .kk-hint{color:var(--muted,#5c636a);padding:0 4px}
#kk-panel{background:var(--panel,#fff);color:var(--fg,#212529);border-radius:var(--radius,10px);box-shadow:0 2px 10px rgba(0,0,0,.35);padding:10px 12px;width:340px;max-width:100%;max-height:calc(100vh - var(--bar,52px) - 150px);overflow:auto}
#kk-panel h3{margin:0;font-size:16px;flex:1;overflow-wrap:anywhere}
#kk-panel .kk-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
#kk-panel label{display:block;margin:8px 0 0;font-size:12px;color:var(--muted,#5c636a)}
#kk-panel input[type=text],#kk-panel input[type=number],#kk-panel input[type=date],#kk-panel textarea,#kk-panel select{display:block;width:100%;margin-top:2px;min-height:var(--tap,44px);padding:6px 8px;border:1px solid var(--line,#dee2e6);border-radius:8px;background:var(--bg,#f8f9fa);color:var(--fg,#212529);font:inherit;font-size:15px}
#kk-panel textarea{min-height:90px;resize:vertical}
#kk-panel .kk-chk{display:flex;align-items:center;gap:8px;min-height:var(--tap,44px);color:var(--fg,#212529);font-size:14px}
#kk-panel .kk-chk input{width:22px;height:22px}
#kk-panel .kk-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
#kk-panel .kk-sec{margin-top:12px;padding-top:8px;border-top:1px solid var(--line,#dee2e6);font-weight:600;font-size:13px}
#kk-panel .kk-sw{width:var(--tap,44px);height:var(--tap,44px);border-radius:50%;border:3px solid transparent;padding:0}
#kk-panel .kk-sw.on{border-color:var(--fg,#212529)}
#kk-panel .kk-muted{color:var(--muted,#5c636a);font-size:13px}
body.kk-drawing #kk-panel{display:none}
body.kk-drawing #map canvas{cursor:crosshair}
@media (max-width:767px){
  #kk-edit{right:64px}
  #kk-panel{position:fixed;left:0;right:0;bottom:0;width:auto;max-height:42vh;border-radius:var(--radius,10px) var(--radius,10px) 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
}
`;
  document.head.appendChild(s);
}

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const btn = (text, onclick, cls = '', extra = {}) => h('button', { type: 'button', class: `kk-b ${cls}`, onclick, ...extra }, text);

function buildDOM() {
  els.root = h('div', { id: 'kk-edit' });
  els.undo = btn('Undo', () => store.undo(), '', { id: 'kk-undo', title: 'Undo (Ctrl+Z)' });
  els.redo = btn('Redo', () => store.redo(), '', { id: 'kk-redo', title: 'Redo (Ctrl+Y)' });
  els.pick = h('select', { id: 'kk-pick', 'aria-label': 'Select an item to edit', onchange: onPick });
  els.bar = h('div', { class: 'kk-bar', role: 'toolbar', 'aria-label': 'Editor' },
    h('span', { class: 'kk-tag', text: 'EDIT' }), els.undo, els.redo,
    btn('+ Route', addRoute, '', { id: 'kk-add-route' }), btn('+ Zone', addZone, '', { id: 'kk-add-zone' }), btn('+ Area', () => startDrawArea(), '', { id: 'kk-add-area' }),
    els.pick, btn('Done', () => disable(), 'primary', { id: 'kk-done' }));
  els.mode = h('div', { class: 'kk-bar', id: 'kk-mode' });
  els.panel = h('div', { id: 'kk-panel', hidden: true, 'aria-label': 'Edit details' });
  els.root.append(els.bar, els.mode, els.panel);
  document.body.appendChild(els.root);
}

// ---------------------------------------------------------------- map layers (edit-* only)
function addLayers() {
  for (const id of ['edit-line', 'edit-midpoints', 'edit-vertices']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  if (!map.getLayer('edit-line')) {
    map.addLayer({ id: 'edit-line', type: 'line', source: 'edit-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff6b00', 'line-width': 4, 'line-opacity': 0.95 } });
  }
  if (!map.getLayer('edit-midpoints')) {
    map.addLayer({ id: 'edit-midpoints', type: 'circle', source: 'edit-midpoints', paint: { 'circle-radius': coarse ? 7 : 5, 'circle-color': '#ffffff', 'circle-opacity': 0.9, 'circle-stroke-color': '#ff6b00', 'circle-stroke-width': coarse ? 14 : 2, 'circle-stroke-opacity': coarse ? 0.22 : 1 } });
  }
  if (!map.getLayer('edit-vertices')) {
    // touch: 10 px radius + 12 px stroke = 44 px halo; hit testing also uses a 44 px box (see hitHandle)
    map.addLayer({ id: 'edit-vertices', type: 'circle', source: 'edit-vertices', paint: { 'circle-radius': coarse ? 10 : 7, 'circle-color': ['case', ['==', ['get', 'first'], true], '#ff6b00', '#ffffff'], 'circle-stroke-color': '#ff6b00', 'circle-stroke-width': coarse ? 12 : 3, 'circle-stroke-opacity': coarse ? 0.45 : 1 } });
  }
}
const pointF = (c, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
const lineF = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
const setSrc = (id, features) => { const s = map && map.getSource(id); if (s) s.setData({ type: 'FeatureCollection', features }); };

// geometry currently being edited: {type:'line'|'ring'|'point', coords}
function editable() {
  if (!on || !sel || !store.get()) return null;
  const o = findObj(store.get(), sel.kind, sel.id);
  if (!o) return null;
  if (sel.kind === 'route' && sel.line) { const c = o[sel.line]; return c && c.length >= 2 ? { type: 'line', coords: c } : null; }
  if (sel.kind === 'area') { const ring = (o.polygon && o.polygon[0]) || []; return ring.length >= 4 ? { type: 'ring', coords: ring.slice(0, -1) } : null; }
  if (sel.kind === 'zone') return o.info_point ? { type: 'point', coords: [o.info_point] } : null;
  if (sel.kind === 'poi') return o.coord ? { type: 'point', coords: [o.coord] } : null;
  return null;
}

function renderHandles() {
  if (!map || !on) return;
  const lines = [], verts = [], mids = [];
  if (draw) {
    if (draw.pts.length >= 2) lines.push(lineF(draw.pts));
    draw.pts.forEach((c, i) => verts.push(pointF(c, { i, first: draw.kind === 'area' && i === 0 })));
  } else {
    const ed = editable();
    if (ed) {
      const coords = drag ? drag.coords : ed.coords;
      if (ed.type === 'ring') { if (coords.length >= 2) lines.push(lineF([...coords, coords[0]])); } else if (ed.type === 'line') lines.push(lineF(coords));
      coords.forEach((c, i) => verts.push(pointF(c, { i, first: false })));
      if (ed.type !== 'point') {
        const n = ed.type === 'ring' ? coords.length : coords.length - 1;
        for (let i = 0; i < n; i++) {
          const a = coords[i], b = coords[(i + 1) % coords.length];
          mids.push(pointF([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { i }));
        }
      }
    }
  }
  setSrc('edit-line', lines); setSrc('edit-vertices', verts); setSrc('edit-midpoints', draw ? [] : mids);
}

// ---------------------------------------------------------------- hit testing
// Handles are hit-tested geometrically with map.project() (terrain-aware in MapLibre 5), not through rendered
// features, so the target is a full 44 px (22 px radius) on touch regardless of the drawn dot size.
function handleList() {
  const out = [];
  if (draw) { draw.pts.forEach((c, i) => out.push({ layer: 'vertex', i, c })); return out; }
  const ed = editable();
  if (!ed) return out;
  const coords = drag ? drag.coords : ed.coords;
  coords.forEach((c, i) => out.push({ layer: 'vertex', i, c }));
  if (ed.type !== 'point') {
    const n = ed.type === 'ring' ? coords.length : coords.length - 1;
    for (let i = 0; i < n; i++) {
      const a = coords[i], b = coords[(i + 1) % coords.length];
      out.push({ layer: 'mid', i, c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    }
  }
  return out;
}
function hitHandle(point, evt) {
  const R = touchy(evt) ? 22 : 11;
  let best = null, bd = Infinity;
  for (const h2 of handleList()) {
    const p = map.project(h2.c);
    const d = Math.hypot(p.x - point.x, p.y - point.y) + (h2.layer === 'mid' ? 6 : 0); // vertices win over nearby midpoints
    if (d <= R && d < bd) { bd = d; best = h2; }
  }
  return best ? { layer: best.layer, i: best.i } : null;
}
const PICK_LAYERS = ['zone-info', 'pois', 'routes-descent', 'routes-skin', 'areas-fill'];
function featureAt(point, evt) {
  const hb = touchy(evt) ? 22 : 12;
  const layers = PICK_LAYERS.filter((l) => map.getLayer(l));
  const feats = map.queryRenderedFeatures([[point.x - hb, point.y - hb], [point.x + hb, point.y + hb]], { layers });
  feats.sort((a, b) => PICK_LAYERS.indexOf(a.layer.id) - PICK_LAYERS.indexOf(b.layer.id));
  return feats[0] || null;
}

// ---------------------------------------------------------------- selection
function defaultLine(r) { return r.descent.length >= 2 ? 'descent' : r.skin.length >= 2 ? 'skin' : 'descent'; }

function select(kind, id, line = null) {
  const o = findObj(store.get(), kind, id);
  if (!o) { clearSel(); return; }
  sel = { kind, id, line: kind === 'route' ? (line || defaultLine(o)) : null };
  highlightRoute(kind === 'route' ? id : null);
  placing = null;
  renderHandles(); renderPanel(); renderMode(); syncPick();
}
function clearSel() {
  sel = null; highlightRoute(null);
  renderHandles(); renderPanel(); renderMode(); syncPick();
}

function focusOn() {
  const o = sel && findObj(store.get(), sel.kind, sel.id);
  if (!o) return;
  let pts = [];
  if (sel.kind === 'route') pts = [...o.descent, ...o.skin];
  else if (sel.kind === 'area') pts = o.polygon[0] || [];
  else if (sel.kind === 'zone') pts = o.info_point ? [o.info_point] : [];
  else if (sel.kind === 'poi') pts = [o.coord];
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((c) => b.extend(c));
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  map.fitBounds(b, { padding: mobile ? { top: 130, left: 30, right: 30, bottom: window.innerHeight * 0.45 } : { top: 130, left: 380, right: 60, bottom: 60 }, maxZoom: 15, duration: 800, pitch: map.getPitch() });
}

function onPick() {
  const v = els.pick.value;
  if (!v) { clearSel(); return; }
  const [kind, id] = v.split('|');
  select(kind, id); focusOn();
}

function syncPick() {
  const app = store.get();
  if (!app || !els.pick) return;
  const grp = (label, items, kind, text) => (items.length ? h('optgroup', { label }, items.map((o) => h('option', { value: `${kind}|${o.id}`, text: text(o) }))) : null);
  els.pick.replaceChildren(h('option', { value: '', text: 'Select item...' }),
    grp('Routes', app.routes, 'route', (r) => `${r.num} ${r.name}${r.descent.length < 2 && r.skin.length < 2 ? ' (no line)' : ''}`),
    grp('Zones', app.zones, 'zone', (z) => z.name), grp('Areas', app.areas, 'area', (a) => a.name), grp('POIs', app.pois, 'poi', (p) => p.name));
  els.pick.value = sel ? `${sel.kind}|${sel.id}` : '';
}

// ---------------------------------------------------------------- committing edits
function commitField(kind, id, mutate, label) {
  textCommit = true;
  let r;
  try { r = store.update((d) => { const o = findObj(d, kind, id); if (o) mutate(o, d); }, label); } finally { textCommit = false; }
  if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); renderPanel(); }
  return r;
}
function setGeom(draft, s, coords) {
  const o = findObj(draft, s.kind, s.id);
  if (!o) return;
  if (s.kind === 'route') o[s.line] = coords;
  else if (s.kind === 'area') o.polygon = [[...coords, coords[0]], ...o.polygon.slice(1)];
  else if (s.kind === 'zone') o.info_point = coords[0];
  else if (s.kind === 'poi') o.coord = coords[0];
}
function commitGeom(coords, label) {
  const s = { ...sel };
  const r = store.update((d) => setGeom(d, s, coords), label);
  if (!r.ok) toast(`Not saved: ${r.errors[0]}`);
  renderHandles();
  return r;
}

// ---------------------------------------------------------------- vertex dragging
function startDrag(h2, e) {
  const ed = editable();
  if (!ed) return;
  const coords = ed.coords.map((c) => c.slice());
  let idx = h2.i, inserted = false;
  if (h2.layer === 'mid') {
    const a = coords[h2.i], b = coords[(h2.i + 1) % coords.length];
    coords.splice(h2.i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    idx = h2.i + 1; inserted = true;
  }
  drag = { coords, idx, inserted, start: { x: e.point.x, y: e.point.y }, moved: false, touch: touchy(e), type: ed.type, timer: null };
  if (drag.touch && !inserted && ed.type !== 'point') { // long-press deletes a vertex
    drag.timer = setTimeout(() => { const i = drag && drag.idx; stopDrag(); suppressClickUntil = Date.now() + 500; if (i != null) deleteVertex(i); }, 600);
  }
  map.getCanvas().style.cursor = 'grabbing';
  map.on('mousemove', onDragMove); map.on('touchmove', onDragMove);
  map.on('mouseup', onDragEnd); map.on('touchend', onDragEnd); map.on('touchcancel', onDragEnd);
  renderHandles();
}
function stopDrag() {
  if (!drag) return;
  clearTimeout(drag.timer);
  map.off('mousemove', onDragMove); map.off('touchmove', onDragMove);
  map.off('mouseup', onDragEnd); map.off('touchend', onDragEnd); map.off('touchcancel', onDragEnd);
  map.getCanvas().style.cursor = '';
  drag = null;
}
function onDragMove(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.point.x - drag.start.x, e.point.y - drag.start.y) > (drag.touch ? 8 : 4)) { drag.moved = true; clearTimeout(drag.timer); }
  if (drag.moved) { drag.coords[drag.idx] = clampCoord(e.lngLat); renderHandles(); }
}
function onDragEnd() {
  const d = drag;
  if (!d) return;
  stopDrag();
  suppressClickUntil = Date.now() + 350;
  if (d.moved || d.inserted) {
    d.coords = d.coords.map(clampCoord);
    drag = null;
    commitGeom(d.coords, d.inserted ? 'Insert vertex' : d.type === 'point' ? 'Move point' : 'Move vertex');
  } else renderHandles();
}

async function deleteVertex(i) {
  const ed = editable();
  if (!ed || ed.type === 'point') return;
  const coords = ed.coords.map((c) => c.slice());
  if (ed.type === 'ring') {
    if (coords.length <= 3) { toast('A polygon needs at least 3 corners. Use Delete area to remove it.'); return; }
    coords.splice(i, 1); commitGeom(coords, 'Delete vertex'); return;
  }
  if (coords.length <= 2) {
    const ok = await confirmDialog({ title: 'Delete line?', message: 'A line needs at least 2 points. Deleting this vertex removes the whole line.', ok: 'Delete line', danger: true });
    if (ok) commitGeom([], `Clear ${sel.line} line`);
    return;
  }
  coords.splice(i, 1); commitGeom(coords, 'Delete vertex');
}

// ---------------------------------------------------------------- drawing
function setDrawing(v) {
  document.body.classList.toggle('kk-drawing', v);
  if (v) { dblZoomWasOn = map.doubleClickZoom.isEnabled(); map.doubleClickZoom.disable(); } else if (dblZoomWasOn) { map.doubleClickZoom.enable(); dblZoomWasOn = false; }
}
function startDrawLine(line) {
  if (!sel || sel.kind !== 'route') return;
  stopDrag(); placing = null;
  draw = { kind: 'line', routeId: sel.id, line, pts: [] };
  setDrawing(true); renderHandles(); renderMode();
}
function startDrawArea() {
  stopDrag(); placing = null;
  if (sel) { sel = null; highlightRoute(null); renderPanel(); syncPick(); }
  draw = { kind: 'area', pts: [] };
  setDrawing(true); renderHandles(); renderMode();
}
function endDraw() {
  draw = null; setDrawing(false); renderHandles(); renderMode(); renderPanel();
}
function finishDraw() {
  const d = draw;
  if (!d) return;
  if (d.kind === 'line') {
    if (d.pts.length < 2) { toast('A line needs at least 2 points'); return; }
    const r = store.update((app) => { findObj(app, 'route', d.routeId)[d.line] = d.pts.map(clampCoord); }, `Draw ${d.line} line`);
    if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); return; }
    endDraw(); select('route', d.routeId, d.line);
  } else {
    if (d.pts.length < 3) { toast('A polygon needs at least 3 corners'); return; }
    const ring = d.pts.map(clampCoord);
    if (d.replaceId) {
      const rr = store.update((app) => { findObj(app, 'area', d.replaceId).polygon = [[...ring, ring[0]]]; }, 'Redraw area');
      if (!rr.ok) { toast(`Not saved: ${rr.errors[0]}`); return; }
      endDraw(); select('area', d.replaceId); return;
    }
    const id = uniqueId(store.get(), 'area', 'a-');
    const r = store.update((app) => { app.areas.push({ id, name: 'New area', kind: 'closure', polygon: [[...ring, ring[0]]], description: '', source: '', valid_from: null, valid_to: null }); }, 'Add area');
    if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); return; }
    endDraw(); select('area', id);
  }
}
function addDrawPoint(e) {
  const hit = hitHandle(e.point, e);
  if (hit && hit.layer === 'vertex') {
    if (draw.kind === 'area' && hit.i === 0 && draw.pts.length >= 3) { finishDraw(); return; }       // tap the first corner to close
    if (draw.kind === 'line' && hit.i === draw.pts.length - 1 && draw.pts.length >= 2) { finishDraw(); return; } // tap the last point (or double-tap) to finish
    if (draw.kind === 'line' && hit.i === draw.pts.length - 1) return;
  }
  draw.pts.push(clampCoord(e.lngLat));
  renderHandles(); renderMode();
}

// ---------------------------------------------------------------- add / delete
function addRoute() {
  const app = store.get();
  if (!app.zones.length) { toast('Add a zone first'); return; }
  const zone = sel && sel.kind === 'zone' ? sel.id : sel && sel.kind === 'route' ? findObj(app, 'route', sel.id).zone : app.zones[0].id;
  const id = uniqueId(app, 'route', 'u-');
  const r = store.update((d) => {
    d.routes.push({ id, num: 'New', zone, name: 'New route', time: '', gain_m: null, descent_m: null, description: '', notes: '', approx: true, confidence: 'low', descent: [], skin: [] });
  }, 'Add route');
  if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); return; }
  select('route', id, 'descent');
  toast('Route added. Edit its text, then draw a descent or skin line.');
}
function addZone() {
  const app = store.get();
  const used = new Set(app.zones.map((z) => z.color.toLowerCase()));
  const color = PALETTE.find((c) => !used.has(c)) || PALETTE[app.zones.length % PALETTE.length];
  const id = uniqueId(app, 'zone', 'z-new-');
  const c = map.getCenter();
  const r = store.update((d) => { d.zones.push({ id, name: 'New zone', color, info_point: clampCoord(c), description: '', source: '' }); }, 'Add zone');
  if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); return; }
  select('zone', id);
  toast("Zone added at the map centre. Drag its 'i' button to move it.");
}
async function deleteSel() {
  if (!sel) return;
  const app = store.get(), o = findObj(app, sel.kind, sel.id);
  if (!o) return;
  const s = { ...sel };
  let message, label;
  if (s.kind === 'route') { message = `Delete route ${o.num} ${o.name} and its lines?`; label = 'Delete route'; }
  else if (s.kind === 'zone') {
    const n = app.routes.filter((r) => r.zone === s.id).length;
    message = `Delete zone ${o.name}${n ? ` and its ${n} route${n > 1 ? 's' : ''}` : ''}?`; label = 'Delete zone';
  } else if (s.kind === 'area') { message = `Delete area ${o.name}?`; label = 'Delete area'; } else return;
  const ok = await confirmDialog({ title: label, message: `${message}\nYou can undo this until you close the app.`, ok: 'Delete', danger: true });
  if (!ok) return;
  const r = store.update((d) => {
    d[COLL[s.kind]] = d[COLL[s.kind]].filter((x) => x.id !== s.id);
    if (s.kind === 'zone') d.routes = d.routes.filter((x) => x.zone !== s.id);
  }, label);
  if (!r.ok) { toast(`Not saved: ${r.errors[0]}`); return; }
  clearSel();
}
async function clearLine(line) {
  const ok = await confirmDialog({ title: `Delete ${line} line`, message: `Remove the ${line} line of this route?\nYou can undo this until you close the app.`, ok: 'Delete', danger: true });
  if (ok) { const s = { ...sel }; commitField('route', s.id, (r) => { r[line] = []; }, `Clear ${line} line`); sel.line = line; renderHandles(); renderPanel(); }
}
async function redrawLine(line) {
  const r = findObj(store.get(), 'route', sel.id);
  if (r[line].length >= 2) {
    const ok = await confirmDialog({ title: `Draw new ${line} line`, message: `This replaces the existing ${line} line (you can undo it). Continue?`, ok: 'Draw new' });
    if (!ok) return;
  }
  startDrawLine(line);
}

// ---------------------------------------------------------------- panel
function field(label, value, onCommit, { multiline = false, type = 'text', options = null, attrs = {} } = {}) {
  let input;
  if (options) {
    input = h('select', {}, options.map((o) => h('option', { value: o.value ?? o, text: o.label ?? o })));
    input.value = value ?? '';
  } else if (multiline) { input = h('textarea', { rows: 4 }); input.value = value ?? ''; } else { input = h('input', { type, ...attrs }); input.value = value ?? ''; }
  input.addEventListener('change', () => onCommit(input.value, input));
  return h('label', {}, label, input);
}
const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const dateOrNull = (v) => (v ? v : null);

function lineRow(r, line) {
  const n = r[line].length;
  const active = sel.line === line && n >= 2;
  return h('div', {},
    h('div', { class: 'kk-muted', text: `${line === 'descent' ? 'Descent' : 'Skin'} line: ${n >= 2 ? `${n} points` : 'none'}${active ? ' (editing)' : ''}` }),
    h('div', { class: 'kk-row' },
      n >= 2 ? btn('Edit', () => { sel.line = line; renderHandles(); renderPanel(); }, active ? 'primary' : '') : null,
      btn(n >= 2 ? 'Draw new' : 'Draw', () => redrawLine(line)),
      n >= 2 ? btn('Delete', () => clearLine(line), 'danger') : null));
}

function renderPanel() {
  const p = els.panel;
  if (!p) return;
  const app = store.get();
  const o = sel && findObj(app, sel.kind, sel.id);
  if (!sel || !o) { p.hidden = true; p.replaceChildren(); return; }
  const top = p.scrollTop;
  const { kind, id } = sel;
  const set = (key, parse = (v) => v) => (v) => commitField(kind, id, (x) => { x[key] = parse(v); }, `Edit ${kind} ${id} ${key}`);
  const kids = [];
  const titleText = { route: `Route ${o.num} ${o.name}`, zone: `Zone ${o.name}`, poi: `POI ${o.name}`, area: `Area ${o.name}` }[kind];
  kids.push(h('div', { class: 'kk-head' }, h('h3', { id: 'kk-title', text: titleText }), btn('×', () => clearSel(), '', { 'aria-label': 'Deselect' })));
  if (kind === 'route') {
    kids.push(field('Label on map', o.num, set('num')), field('Name', o.name, set('name')),
      field('Zone', o.zone, set('zone'), { options: app.zones.map((z) => ({ value: z.id, label: z.name })) }),
      field('Time (as printed)', o.time, set('time')),
      field('Elevation gain (m)', o.gain_m, set('gain_m', numOrNull), { type: 'number', attrs: { inputmode: 'decimal', step: 'any' } }),
      field('Descent (m, guide figure)', o.descent_m, set('descent_m', numOrNull), { type: 'number', attrs: { inputmode: 'decimal', step: 'any' } }),
      field('Description', o.description, set('description'), { multiline: true }),
      field('Notes', o.notes, set('notes'), { multiline: true }),
      field('Placement confidence', o.confidence, set('confidence'), { options: ['low', 'medium', 'high'] }));
    const chk = h('input', { type: 'checkbox' }); chk.checked = !!o.approx;
    chk.addEventListener('change', () => commitField(kind, id, (x) => { x.approx = chk.checked; }, `Edit route ${id} approx`));
    kids.push(h('label', { class: 'kk-chk' }, chk, 'Line is approximate (not yet confirmed)'));
    kids.push(h('div', { class: 'kk-sec', text: 'Lines' }), lineRow(o, 'descent'), lineRow(o, 'skin'),
      h('div', { class: 'kk-muted', text: 'Drag a vertex to move it. Tap or drag a small midpoint dot to add a vertex. Right-click or long-press a vertex to delete it.' }),
      h('div', { class: 'kk-row' }, btn('Delete route', deleteSel, 'danger', { id: 'kk-del' })));
  } else if (kind === 'zone') {
    kids.push(field('Name', o.name, set('name')));
    const sw = h('div', { class: 'kk-row' }, PALETTE.map((c) => h('button', { type: 'button', class: `kk-sw${c.toLowerCase() === o.color.toLowerCase() ? ' on' : ''}`, style: `background:${c}`, 'aria-label': `Colour ${c}`, onclick: () => commitField(kind, id, (x) => { x.color = c; }, `Edit zone ${id} color`) })));
    kids.push(h('label', {}, 'Colour'), sw,
      field('Description', o.description, set('description'), { multiline: true }), field('Source', o.source, set('source')),
      h('div', { class: 'kk-sec', text: "Info ('i') button" }),
      h('div', { class: 'kk-muted', text: o.info_point ? 'Drag the button on the map, or tap Place and then tap the map.' : 'No info button yet. Tap Place, then tap the map.' }),
      h('div', { class: 'kk-row' }, btn('Place on map', () => { placing = { zoneId: id }; renderMode(); toast('Tap the map to place the info button'); })),
      h('div', { class: 'kk-row' }, btn('Delete zone', deleteSel, 'danger', { id: 'kk-del' })));
  } else if (kind === 'poi') {
    kids.push(field('Name', o.name, set('name')), field('Type', o.type, set('type'), { options: POI_TYPES }),
      field('Description', o.description, set('description'), { multiline: true }),
      h('div', { class: 'kk-muted', text: `Position ${o.coord[1].toFixed(5)}, ${o.coord[0].toFixed(5)}. Drag its handle on the map to move it.` }));
  } else if (kind === 'area') {
    kids.push(field('Name', o.name, set('name')), field('Kind', o.kind, set('kind'), { options: AREA_KINDS }),
      field('Description', o.description, set('description'), { multiline: true }), field('Source', o.source, set('source')),
      field('Valid from', o.valid_from, set('valid_from', dateOrNull), { type: 'date' }), field('Valid to', o.valid_to, set('valid_to', dateOrNull), { type: 'date' }),
      h('div', { class: 'kk-muted', text: 'Drag a corner to move it. Tap or drag a midpoint dot to add a corner. Right-click or long-press a corner to delete it.' }),
      h('div', { class: 'kk-row' }, btn('Draw new outline', async () => {
        const ok = await confirmDialog({ title: 'Redraw outline', message: 'Draw the polygon again? Your text edits are kept. The old outline is replaced when you finish (undo is available).', ok: 'Redraw' });
        if (ok) redrawArea(id);
      }), btn('Delete area', deleteSel, 'danger', { id: 'kk-del' })));
  }
  p.replaceChildren(...kids);
  p.hidden = false;
  p.scrollTop = top;
}

// redraw outline of an existing area: draw a new polygon, then swap it in
function redrawArea(id) {
  stopDrag(); placing = null;
  draw = { kind: 'area', pts: [], replaceId: id };
  setDrawing(true); renderHandles(); renderMode();
}

function renderMode() {
  const m = els.mode;
  if (!m) return;
  m.replaceChildren();
  if (draw) {
    const what = draw.kind === 'line' ? `Drawing ${draw.line} line` : 'Drawing polygon';
    const hint = draw.kind === 'line' ? 'Tap to add points. Tap the last point or double-tap to finish.' : 'Tap corners. Tap the first corner to close.';
    m.append(h('span', { class: 'kk-hint', text: `${what}: ${draw.pts.length} point${draw.pts.length === 1 ? '' : 's'}. ${hint}` }),
      btn('Finish', finishDraw, 'primary', { id: 'kk-finish' }), btn('Undo point', () => { draw.pts.pop(); renderHandles(); renderMode(); }), btn('Cancel', endDraw));
    m.hidden = false;
  } else if (placing) {
    m.append(h('span', { class: 'kk-hint', text: "Tap the map to place the zone's info button." }), btn('Cancel', () => { placing = null; renderMode(); }));
    m.hidden = false;
  } else {
    m.append(h('span', { class: 'kk-hint', text: sel ? 'Editing. Tap empty map to deselect.' : 'Tap a route, zone button, POI or area, or choose from the list.' }));
    m.hidden = false;
  }
}

function updateButtons() {
  if (!els.undo) return;
  els.undo.disabled = !store.canUndo(); els.redo.disabled = !store.canRedo();
}

// ---------------------------------------------------------------- store + map events
function onStoreChange() {
  if (!on) return;
  updateButtons();
  const app = store.get();
  if (sel && !findObj(app, sel.kind, sel.id)) { clearSel(); return; }
  syncPick();
  if (textCommit) { const t = document.getElementById('kk-title'); const o = sel && findObj(app, sel.kind, sel.id); if (t && o) t.textContent = { route: `Route ${o.num} ${o.name}`, zone: `Zone ${o.name}`, poi: `POI ${o.name}`, area: `Area ${o.name}` }[sel.kind]; renderHandles(); return; }
  renderHandles(); renderPanel();
}

function onDown(e) {
  if (!on || draw || placing) return;
  if (e.points && e.points.length > 1) return; // multi-touch: let the map handle pinch / rotate
  if (e.originalEvent && (e.originalEvent.button === 2 || e.originalEvent.ctrlKey)) return; // right-click is for deleting
  const hit = hitHandle(e.point, e);
  if (hit) { e.preventDefault(); startDrag(hit, e); return; }
  // dragging a zone's 'i' button directly
  const f = featureAt(e.point, e);
  if (f && f.layer.id === 'zone-info') {
    e.preventDefault();
    select('zone', f.properties.id);
    startDrag({ layer: 'vertex', i: 0 }, e);
  }
}

function onClick(e) {
  if (!on || Date.now() < suppressClickUntil) return;
  if (draw) { addDrawPoint(e); return; }
  if (placing) {
    const z = placing.zoneId; placing = null;
    commitField('zone', z, (o) => { o.info_point = clampCoord(e.lngLat); }, 'Place info button');
    renderMode(); renderHandles(); renderPanel();
    return;
  }
  if (hitHandle(e.point, e)) return;
  const f = featureAt(e.point, e);
  if (!f) { clearSel(); return; }
  const lid = f.layer.id, p = f.properties;
  if (lid === 'zone-info') select('zone', p.id);
  else if (lid === 'pois') select('poi', p.id);
  else if (lid === 'routes-descent') select('route', p.id, 'descent');
  else if (lid === 'routes-skin') select('route', p.id, 'skin');
  else if (lid === 'areas-fill') select('area', p.id);
}

// Right-click: listen on the canvas DOM event (MapLibre's own 'contextmenu' event can be swallowed after a drag).
function onContext(ev) {
  if (!on || draw) return;
  const r = map.getCanvas().getBoundingClientRect();
  const hit = hitHandle({ x: ev.clientX - r.left, y: ev.clientY - r.top }, { originalEvent: ev });
  if (hit && hit.layer === 'vertex') { ev.preventDefault(); deleteVertex(hit.i); }
}

function onKey(e) {
  if (!on) return;
  const tag = (e.target && e.target.tagName) || '';
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && !typing && (k === 'z' || k === 'y')) {
    e.preventDefault();
    if (k === 'y' || (k === 'z' && e.shiftKey)) store.redo(); else store.undo();
    return;
  }
  if (e.key === 'Escape') {
    if (document.querySelector('dialog[open]')) return;
    if (draw) endDraw(); else if (placing) { placing = null; renderMode(); } else if (sel) clearSel();
  } else if (e.key === 'Enter' && draw && !typing) finishDraw();
  else if (e.key === 'Backspace' && draw && !typing) { e.preventDefault(); draw.pts.pop(); renderHandles(); renderMode(); }
}

// ---------------------------------------------------------------- public API
export function isEnabled() { return on; }

export function enable(mapObj, storeObj) {
  if (on) return true;
  map = mapObj || (window.kokanee && window.kokanee.map);
  store = storeObj && storeObj.update ? storeObj : defaultStore;
  if (!map || !store || !store.get || !store.get()) { toast('Editor: map or data not ready'); return false; }
  coarse = window.matchMedia('(pointer: coarse)').matches;
  injectStyle();
  on = true;
  try { ui.closePanel(); } catch { /* ignore */ }
  const r = document.getElementById('readout'); if (r) r.hidden = true;
  buildDOM(); addLayers();
  handlers.down = onDown; handlers.click = onClick; handlers.ctx = onContext; handlers.key = onKey;
  map.on('mousedown', onDown); map.on('touchstart', onDown); map.on('click', onClick); map.getCanvas().addEventListener('contextmenu', onContext);
  document.addEventListener('keydown', onKey);
  unsub = store.on('change', onStoreChange);
  syncPick(); renderMode(); renderPanel(); updateButtons();
  registerMenu();
  toast('Edit mode on');
  return true;
}

export function disable() {
  if (!on) return;
  stopDrag();
  if (draw) { draw = null; setDrawing(false); }
  placing = null;
  on = false;
  map.off('mousedown', onDown); map.off('touchstart', onDown); map.off('click', onClick); map.getCanvas().removeEventListener('contextmenu', onContext);
  document.removeEventListener('keydown', onKey);
  if (unsub) { unsub(); unsub = null; }
  for (const id of ['edit-line', 'edit-vertices', 'edit-midpoints']) setSrc(id, []);
  highlightRoute(null);
  sel = null;
  if (els.root) els.root.remove();
  for (const k of Object.keys(els)) delete els[k];
  registerMenu();
  toast('Edit mode off');
}

function registerMenu() {
  ui.registerMenu('edit', [
    { label: on ? 'Stop editing' : 'Start editing', onClick: () => { if (on) disable(); else enable(); } },
  ]);
}
registerMenu();
