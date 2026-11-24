// layers-menu.js [WS3] - one row per layer group: toggle, opacity slider, collapsible legend.
import { GROUP_DEFS, setLayerVisible, setLayerOpacity, getLayerState, setExaggeration, getExaggeration, getMeta, getTiles } from './map.js';

const KEY = 'kokanee.layers.v1';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage unavailable */ } }

const DEF_SLOPE = [['27–30°', '#ffe066'], ['30–35°', '#ff922b'], ['35–40°', '#f03e3e'], ['40–45°', '#ae3ec9'], ['≥45°', '#343a40']];
const DEF_ASPECT = [['N', '#1971c2'], ['NE', '#12b886'], ['E', '#82c91e'], ['SE', '#fab005'], ['S', '#e03131'], ['SW', '#e64980'], ['W', '#be4bdb'], ['NW', '#7950f2']];
const DEF_QUALITY = [['No data', '#9e9e9e', true], ['LidarBC 2018 (1 m)', '#2b8a3e'], ['HRDEM lidar 2017 (1 m)', '#74b816'], ['MRDEM-30 fallback (30 m, smoothed)', '#e8590c'], ['Blend zone', '#f08c00']];

const sw = (color, cls = '') => `<span class="sw ${cls}" style="${color ? `background:${color}` : ''}"></span>`;
const li = (swatch, text) => `<div class="li">${swatch}<span>${esc(text)}</span></div>`;
const NODATA = li('<span class="sw hatch"></span>', 'No data (hatched)');
const BELOW = (t) => li('<span class="sw clear"></span>', t);

function entryLabel(e) { return e.label ?? e.sector ?? e.name ?? (e.min != null ? `${e.min}–${e.max ?? ''}` : ''); }
function fromLegend(arr, defs) {
  // code 0 = no data: always "No data" with the hatched swatch, whatever tiles.json says
  if (Array.isArray(arr) && arr.length) return arr.map((e) => (e.code === 0 ? li('<span class="sw hatch"></span>', 'No data') : li(sw(e.color), entryLabel(e)))).join('');
  return defs.map(([l, c, hatch]) => li(hatch ? '<span class="sw hatch"></span>' : sw(c), l)).join('');
}

function legendHTML(id) {
  const lg = (getTiles() && getTiles().legends) || {};
  switch (id) {
    case 'elev': return fromLegend(lg.elev, [['1400 m (valley)', '#5aa469'], ['~2100 m', '#d9c27a'], ['2900 m (alpine)', '#ffffff']]) + NODATA;
    case 'aspect': return fromLegend(lg.aspect, DEF_ASPECT) + BELOW('Transparent: slope below 10° (flat)') + NODATA;
    case 'slope': return fromLegend(lg.slope, DEF_SLOPE) + BELOW('Transparent: below 27° (below range)') + NODATA;
    case 'quality': return fromLegend(lg.quality, DEF_QUALITY) + `<div class="muted">Elevation source per pixel. Detail is smoothed where the source is 30 m.</div>`;
    case 'ates': return li(sw('#00c853'), 'Simple') + li(sw('#1e63ff'), 'Challenging') + li(sw('#000000'), 'Complex') + li('<span class="sw clear"></span>', 'Transparent: not rated') + li(sw('#fab005'), 'Decision point') + li(sw('#7048e8', 'line dash'), 'Avalanche path');
    case 'contours': return li(sw('#8d7a6a', 'line'), '20 m contour') + li(sw('#5b4636', 'line'), '100 m index (labelled)');
    case 'elev-ref': return li(sw('#d6336c', 'line dash'), '2,100 m reference (display only, not mapped treeline)');
    case 'hillshade': return '<div class="muted">Live hillshade from the DEM.</div>';
    case 'water': {
      const d = getMeta().glacierSurvey;
      return li(sw('#74c0fc'), 'Lake') + li(sw('#339af0', 'line'), 'Creek') + li(sw('#e3f2fd'), `Glacier (survey: ${d.length ? d.join(', ') : 'TRIM c. 1980s–90s'})`);
    }
    case 'pois': return li(sw('#e03131'), 'Hut') + li(sw('#343a40'), 'Peak') + li(sw('#a9712c'), 'Pass') + li(sw('#1c7ed6'), 'Lake') + li(sw('#7048e8'), 'Helipad');
    case 'descents': return li(sw('#d9480f', 'line'), 'Descent (solid, zone colour; ~ = approximate)');
    case 'skin': return li(sw('#d9480f', 'line dash'), 'Skin track (dashed)');
    case 'zones': return li(sw('#495057'), 'Zone info button');
    case 'closures': return li(sw('rgba(224,49,49,.35)'), 'Closure') + li(sw('rgba(201,42,42,.35)'), 'No-go') + li(sw('rgba(240,140,0,.35)'), 'Note');
    default: return '';
  }
}

// ---- on-screen legend (aspect / slope) ----
const LKEY = 'kokanee.legend.collapsed';
const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let legendEl = null, legendSync = null;
function legendCollapsed() { try { return localStorage.getItem(LKEY) === '1'; } catch { return false; } }
function setLegendCollapsed(v) { try { localStorage.setItem(LKEY, v ? '1' : '0'); } catch { /* ignore */ } }

function roseSVG() {
  const lg = getTiles()?.legends?.aspect;
  const cols = {};
  for (const [l, c] of DEF_ASPECT) cols[l] = c;
  if (Array.isArray(lg)) for (const e of lg) if (e.sector && e.color) cols[e.sector] = e.color;
  const R = 40, C = 44, pt = (a, r) => [(C + r * Math.sin(a * Math.PI / 180)).toFixed(1), (C - r * Math.cos(a * Math.PI / 180)).toFixed(1)];
  let paths = '';
  SECTORS.forEach((n, i) => {
    const a0 = i * 45 - 22.5, a1 = i * 45 + 22.5, p0 = pt(a0, R), p1 = pt(a1, R);
    paths += `<path d="M${C} ${C}L${p0}A${R} ${R} 0 0 1 ${p1}Z" fill="${esc(cols[n])}" stroke="#fff" stroke-width="1"/>`;
  });
  const lab = (t, x, y) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">${t}</text>`;
  return `<svg class="rose" viewBox="0 0 88 88" width="84" height="84" role="img" aria-label="Aspect compass: N ${cols.N}, S ${cols.S}">${paths}${lab('N', 44, 7)}${lab('E', 83, 47)}${lab('S', 44, 87)}${lab('W', 5, 47)}</svg>`;
}

function slopeRow() {
  const lg = getTiles()?.legends?.slope;
  const items = Array.isArray(lg) && lg.length ? lg.filter((e) => e.code !== 0).map((e) => [entryLabel(e), e.color]) : DEF_SLOPE;
  return `<div class="ol-slope">${items.map(([l, c]) => `<span class="ol-s"><span class="sw" style="background:${esc(c)}"></span><span>${esc(l)}</span></span>`).join('')}</div>`;
}

export function refreshOnMapLegend() {
  if (!legendEl) {
    legendEl = document.createElement('div');
    legendEl.id = 'onmap-legend';
    document.body.appendChild(legendEl);
    // mobile: the tap readout stacks below the legend strip (CSS var --lg-off)
    const sync = () => {
      const off = !legendEl.hidden && getComputedStyle(legendEl).display !== 'none' && matchMedia('(max-width:767px)').matches ? Math.round(legendEl.getBoundingClientRect().height) + 6 : 0;
      document.body.style.setProperty('--lg-off', off + 'px');
    };
    legendSync = sync;
    if (window.ResizeObserver) new ResizeObserver(sync).observe(legendEl);
    window.addEventListener('resize', sync);
    legendEl.addEventListener('click', (e) => {
      if (!e.target.closest('.ol-toggle')) return;
      setLegendCollapsed(!legendCollapsed()); refreshOnMapLegend();
    });
  }
  const ls = getLayerState();
  const vis = (id) => !!(ls && ls[id] && ls[id].visible);
  const asp = vis('aspect'), slo = vis('slope');
  legendEl.hidden = !(asp || slo);
  if (legendEl.hidden) { legendSync(); return; }
  const col = legendCollapsed();
  legendEl.classList.toggle('collapsed', col);
  const names = [asp && 'Aspect', slo && 'Slope'].filter(Boolean).join(' + ');
  let body = '';
  if (!col) {
    if (asp) body += `<div class="ol-blk"><div class="ol-t">Aspect (slope faces)</div>${roseSVG()}<div class="muted ol-n">Clear: under 10° (flat)</div></div>`;
    if (slo) body += `<div class="ol-blk"><div class="ol-t">Slope angle</div>${slopeRow()}<div class="muted ol-n">Clear: under 27°</div></div>`;
    body += `<div class="ol-blk ol-nd"><span class="sw hatch"></span><span>No data</span></div>`;
  }
  legendEl.innerHTML = `<button class="ol-toggle" aria-expanded="${!col}" aria-label="${col ? 'Show' : 'Hide'} legend: ${names}"><span>${names} legend</span><span class="ol-chev" aria-hidden="true">${col ? '&#9650;' : '&#9660;'}</span></button><div class="ol-body">${body}</div>`;
  legendSync();
}

function row(g, saved, child) {
  const st = saved[g.id] || {};
  const on = st.on ?? g.on, op = st.op ?? g.op ?? 1;
  const el = document.createElement('div');
  el.className = 'lrow' + (child ? ' child' : '');
  const legend = g.legend ? legendHTML(g.legend) : '';
  el.innerHTML = `<div class="lhead"><label><input type="checkbox" ${on ? 'checked' : ''}><span>${esc(g.label)}</span></label>${legend ? '<button class="lg-btn" aria-expanded="false" title="Legend" aria-label="Legend">&#9432;</button>' : ''}</div>
    <input type="range" min="0" max="1" step="0.05" value="${op}" aria-label="${esc(g.label)} opacity">${legend ? `<div class="legend" hidden>${legend}</div>` : ''}`;
  const cb = el.querySelector('input[type=checkbox]'), rg = el.querySelector('input[type=range]');
  const persist = () => { saved[g.id] = { on: cb.checked, op: +rg.value }; save(saved); };
  cb.addEventListener('change', () => { setLayerVisible(g.id, cb.checked); persist(); refreshOnMapLegend(); });
  rg.addEventListener('input', () => { setLayerOpacity(g.id, +rg.value); persist(); });
  const btn = el.querySelector('.lg-btn');
  if (btn) btn.addEventListener('click', () => {
    const lgEl = el.querySelector('.legend'); lgEl.hidden = !lgEl.hidden; btn.setAttribute('aria-expanded', String(!lgEl.hidden));
  });
  setLayerVisible(g.id, on); setLayerOpacity(g.id, op);
  return el;
}

export function initLayersMenu(container) {
  const saved = load();
  container.innerHTML = '<h3 style="margin:8px 0">Layers</h3>';
  for (const g of GROUP_DEFS) {
    container.appendChild(row(g, saved, false));
    for (const c of g.children || []) container.appendChild(row(c, saved, true));
  }
  const ex = document.createElement('div');
  ex.className = 'lrow';
  const exv = saved.__exag ?? getExaggeration();
  ex.innerHTML = `<div class="lhead"><span>Terrain exaggeration: <b>${(+exv).toFixed(1)}×</b></span></div><input type="range" min="1" max="2.5" step="0.1" value="${exv}" aria-label="Terrain exaggeration">`;
  const r = ex.querySelector('input'), b = ex.querySelector('b');
  setExaggeration(exv);
  r.addEventListener('input', () => { setExaggeration(+r.value); b.textContent = (+r.value).toFixed(1) + '×'; saved.__exag = +r.value; save(saved); });
  container.appendChild(ex);
  const rs = document.createElement('button');
  rs.className = 'btn'; rs.style.margin = '12px 0'; rs.textContent = 'Reset layers to defaults';
  rs.addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } initLayersMenu(container); });
  container.appendChild(rs);
  refreshOnMapLegend();
  return { getLayerState };
}
