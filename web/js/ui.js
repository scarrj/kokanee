// ui.js [WS3] - header, layers drawer, side panel / bottom sheet, tap readout, toast, menu.
import { highlightRoute, flyHome, atesAt, getTiles } from './map.js';
import { initLayersMenu } from './layers-menu.js';
import { drawProfile } from './profile-chart.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

let map = null, store = null, sampler = null, editorMod = null;
const menuSections = new Map(); // section -> items
let panelRoute = null;

export function setSampler(mod) { sampler = mod; }
export function setEditor(mod) { editorMod = mod; }

const app = () => (store && store.get && store.get()) || { zones: [], routes: [], pois: [], areas: [] };

export function toast(msg, ms = 3000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// registerMenu(section, items): items = [{label, onClick}] (WS6 and WS7 use this exact shape).
// Optional per-item fields: id, title, disabled. Re-registering a section replaces its items.
export function registerMenu(section, items) {
  menuSections.set(section, items || []);
  renderMenu();
}

function renderMenu() {
  const m = $('menu'); if (!m) return;
  m.innerHTML = '';
  for (const [section, items] of menuSections) {
    const h = document.createElement('h4'); h.textContent = section; m.appendChild(h);
    for (const it of items) {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem'); b.textContent = it.label; if (it.title) b.title = it.title; if (it.disabled) b.disabled = true;
      b.addEventListener('click', () => { m.hidden = true; $('btn-menu').setAttribute('aria-expanded', 'false'); try { it.onClick && it.onClick(); } catch (e) { console.error(e); toast('Action failed'); } });
      m.appendChild(b);
    }
  }
  if (!menuSections.size) m.innerHTML = '<h4>Menu</h4><div class="muted" style="padding:6px 14px">No actions yet</div>';
}

function togglePop(id, btnId, other) {
  const el = $(id), btn = $(btnId), open = el.hidden;
  if (other) { $(other[0]).hidden = true; $(other[1]).setAttribute('aria-expanded', 'false'); }
  el.hidden = !open; btn.setAttribute('aria-expanded', String(open));
}

export function initUI(mapObj, storeObj) {
  map = mapObj; store = storeObj;
  initLayersMenu($('layers'));
  registerMenu('View', [{ label: 'Home view', onClick: flyHome }]);
  $('btn-home').addEventListener('click', flyHome);
  $('btn-layers').addEventListener('click', () => togglePop('layers', 'btn-layers', ['menu', 'btn-menu']));
  $('btn-menu').addEventListener('click', () => togglePop('menu', 'btn-menu', ['layers', 'btn-layers']));
  $('panel-close').addEventListener('click', closePanel);
  const handle = $('panel-handle');
  const flip = () => { const p = $('panel'); p.dataset.state = p.dataset.state === 'expanded' ? 'peek' : 'expanded'; };
  let y0 = null;
  handle.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
  handle.addEventListener('pointerup', (e) => {
    const p = $('panel'), dy = e.clientY - y0;
    if (Math.abs(dy) < 12) flip(); else p.dataset.state = dy < 0 ? 'expanded' : 'peek';
    y0 = null;
  });
  handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') flip(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  map.on('kokanee:pick', onPick);
  map.on('error', (e) => { if (e && e.error && !/AJAXError|404|Failed to fetch/i.test(String(e.error.message || e.error))) console.warn(e.error); });
  if (store && store.on) store.on('change', () => { if (panelRoute) openRoute(panelRoute, { silent: true }); });
}

async function onPick(e) {
  if (editorMod && editorMod.isEnabled && editorMod.isEnabled()) return; // editor owns taps
  const f = (e.features || [])[0];
  let sample = null;
  if (sampler && sampler.sample) { try { sample = await sampler.sample(e.lngLat); } catch { sample = null; } }
  if (!sample) {
    let elev = null;
    try { const z = map.queryTerrainElevation(e.lngLat); if (z != null) elev = z / (map.getTerrain() ? map.getTerrain().exaggeration || 1 : 1); } catch { /* none */ }
    sample = { elev, slope: null, aspect: null, quality: null, approximate: true };
  }
  showReadout(e.lngLat, { ...sample, ates: atesAt(e.lngLat) });
  if (f) {
    const p = f.properties || {};
    if (f.layer.id === 'zone-info') openZone(p.id);
    else if (f.layer.id === 'routes-descent' || f.layer.id === 'routes-skin') openRoute(p.id);
    else if (f.layer.id === 'pois') showInfo(p.name, (app().pois.find((x) => x.id === p.id) || {}).description || p.type);
    else if (f.layer.id === 'areas-fill') showInfo(p.name, `${p.kind}: ${(app().areas.find((x) => x.id === p.id) || {}).description || ''}`);
    else if (f.layer.id === 'ates-decision') showInfo('ATES decision point', p.description);
  }
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function showReadout(lngLat, s = {}) {
  const r = $('readout'), tj = getTiles();
  const src = tj && tj.sources && s.quality != null ? tj.sources.find((x) => x.code === s.quality) : null;
  const rows = [];
  rows.push(['Position', `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`]);
  rows.push(['Elevation', s.elev != null && Number.isFinite(s.elev) ? `${Math.round(s.elev)} m${s.approximate ? ' (display)' : ''}` : 'no data']);
  rows.push(['Slope', s.slope != null ? `${Math.round(s.slope)}°` : 'n/a']);
  rows.push(['Aspect', s.aspect != null ? `${COMPASS[Math.round(s.aspect / 45) % 8]} (${Math.round(s.aspect)}°)` : 'n/a']);
  rows.push(['ATES', s.ates ? s.ates[0].toUpperCase() + s.ates.slice(1) : 'not rated']);
  let q = 'n/a';
  if (s.quality === 0) q = 'No data';
  else if (s.quality != null) {
    q = src ? `${src.name} (${src.native_res_m} m)` : `source ${s.quality}`;
    if (s.quality === 3 || s.quality === 4) q += ' - detail smoothed';
  }
  rows.push(['Source', q]);
  r.innerHTML = `<button class="x" aria-label="Close readout">&times;</button><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  r.querySelector('.x').addEventListener('click', () => { r.hidden = true; });
  r.hidden = false;
}

function openPanel(title) {
  const p = $('panel'); $('panel-title').textContent = title; p.hidden = false; p.dataset.state = 'peek';
  document.body.classList.add('panel-open');
  $('layers').hidden = true; $('btn-layers').setAttribute('aria-expanded', 'false');
  return $('panel-body');
}
export function closePanel() {
  $('panel').hidden = true; document.body.classList.remove('panel-open'); panelRoute = null; highlightRoute(null);
}
function showInfo(title, text) {
  const b = openPanel(title || 'Info');
  b.innerHTML = String(text || '').split(/\n\n+/).map((t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
}
const paras = (t) => String(t || '').split(/\n\n+/).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join('');

function fitTo(coordsList) {
  const pts = coordsList.flat().filter((c) => Array.isArray(c));
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
  pts.forEach((c) => b.extend(c));
  const padding = isMobile() ? { top: 80, left: 30, right: 30, bottom: window.innerHeight * 0.35 } : { top: 80, left: 40, bottom: 60, right: 420 };
  map.fitBounds(b, { padding, maxZoom: 15, duration: 1000, pitch: map.getPitch() });
}

export function openZone(id) {
  const a = app(), z = a.zones.find((x) => x.id === id); if (!z) return;
  panelRoute = null; highlightRoute(null);
  const rs = a.routes.filter((r) => r.zone === id);
  const b = openPanel(z.name);
  b.innerHTML = `${paras(z.description)}<p class="muted">${esc(z.source)}</p><h3>Routes (${rs.length})</h3>
    <ul class="rlist">${rs.map((r) => `<li><button data-r="${esc(r.id)}"><span class="dot" style="background:${esc(z.color)}"></span><span><b>${esc(r.num)}</b> ${esc(r.name)}${r.approx ? ' ≈' : ''}<br><span class="muted">${esc(r.time)}</span></span></button></li>`).join('') || '<li class="muted">No routes yet</li>'}</ul>`;
  b.querySelectorAll('[data-r]').forEach((el) => el.addEventListener('click', () => openRoute(el.dataset.r)));
  fitTo(rs.length ? rs.flatMap((r) => [r.descent, r.skin]) : [[z.info_point]]);
}

const fmt = (v, u = '', d = 0) => (v == null || !Number.isFinite(v) ? '–' : `${(+v).toFixed(d)}${u}`);

export async function openRoute(id, { silent = false } = {}) {
  const a = app(), r = a.routes.find((x) => x.id === id); if (!r) return;
  const z = a.zones.find((x) => x.id === r.zone) || {};
  panelRoute = id; highlightRoute(id);
  const b = openPanel(`${r.num} ${r.name}`);
  b.innerHTML = `<p><span class="badge">${esc(z.name || r.zone)}</span>${r.approx ? '<span class="badge warn">approx line</span>' : ''}<span class="badge">confidence: ${esc(r.confidence)}</span></p>
    <table class="m"><tr><th>Guide</th><th></th></tr><tr><td>Time</td><td>${esc(r.time) || '–'}</td></tr><tr><td>Elevation gain</td><td>${fmt(r.gain_m, ' m')}</td></tr><tr><td>Descent</td><td>${fmt(r.descent_m, ' m')}</td></tr></table>
    ${paras(r.description)}${r.notes ? `<h3>Notes</h3>${paras(r.notes)}` : ''}
    <div class="btnrow"><button class="btn" id="fit-route">Zoom to route</button></div>
    <h3>Computed metrics</h3><div id="metrics" class="muted">metrics pending</div>`;
  $('fit-route').addEventListener('click', () => fitTo([r.descent, r.skin]));
  if (!silent) fitTo([r.descent, r.skin]);
  const box = $('metrics');
  if (!sampler || !sampler.profile || (r.descent.length < 2 && r.skin.length < 2)) return;
  try {
    const d = r.descent.length >= 2 ? await sampler.profile(r.descent) : null;
    const s = r.skin.length >= 2 ? await sampler.profile(r.skin) : null;
    if (panelRoute !== id) return;
    const dm = d && d.metrics, sm = s && s.metrics;
    const low = (dm && dm.low_confidence) || (sm && sm.low_confidence);
    const cov = (m) => m && m.pct_by_source ? Object.entries(m.pct_by_source).filter(([, v]) => v > 0).map(([k, v]) => `${['missing', 'lidar 2018', 'lidar 2017', 'MRDEM-30', 'blend'][k] || k} ${Math.round(v)}%`).join(', ') : '';
    box.className = '';
    box.innerHTML = `${low ? '<p><span class="badge bad">Low confidence: 30 m or missing data under this line, detail smoothed</span></p>' : ''}
      <table class="m"><tr><th>Metric</th><th>Guide</th><th>Computed</th></tr>
      <tr><td>Gain (skin)</td><td>${fmt(r.gain_m, ' m')}</td><td>${fmt(sm && sm.cum_ascent_m, ' m')}</td></tr>
      <tr><td>Descent (net drop)</td><td>${fmt(r.descent_m, ' m')}</td><td>${fmt(dm && dm.net_drop_m, ' m')}</td></tr>
      <tr><td>Descent length</td><td>–</td><td>${fmt(dm && dm.length_m, ' m')}</td></tr>
      <tr><td>Cumulative descent</td><td>–</td><td>${fmt(dm && dm.cum_descent_m, ' m')}</td></tr>
      <tr><td>Terrain slope max</td><td>–</td><td>${fmt(dm && dm.terrain_slope_max, '°')}</td></tr>
      <tr><td>Length at 30°+ / 35°+</td><td>–</td><td>${fmt(dm && dm.len_ge30_m, ' m')} / ${fmt(dm && dm.len_ge35_m, ' m')}</td></tr>
      <tr><td>Steepest pitch (along track)</td><td>–</td><td>${fmt(dm && dm.pitch_max_deg, '°')}</td></tr>
      <tr><td>Skin length</td><td>–</td><td>${fmt(sm && sm.length_m, ' m')}</td></tr></table>
      <p class="muted">Coverage: ${esc(cov(dm) || cov(sm) || 'n/a')}</p>
      ${d ? '<h3>Descent profile</h3><canvas class="profile" id="pf-d"></canvas>' : ''}${s ? '<h3>Skin profile</h3><canvas class="profile" id="pf-s"></canvas>' : ''}
      <p class="muted">Grey = no data (gap). Orange tint = 30 m fallback stretch.</p>`;
    if (d) drawProfile($('pf-d'), d.samples);
    if (s) drawProfile($('pf-s'), s.samples);
  } catch (e) { console.warn(e); box.textContent = 'metrics pending'; }
}
