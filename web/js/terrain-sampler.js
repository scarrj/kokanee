// terrain-sampler.js [WS4] - samples the analysis DEM (dem tiles at analysis_zoom) and the quality-code tiles (qcode/).
// Metric definitions: docs/build/CONTRACTS.md#metrics. tools/metrics.py is the line-by-line Python twin (parity test:
// tools/test_metrics_parity.mjs). Never uses map.queryTerrainElevation.
import { densify, lonLatToPixel, cellSize, lineLength } from './geo.js';

const TS = 256;
const STEP_M = 5;          // densify step
const WIN = 5;             // 5 samples = 20 m window (smoothing, slope runs, pitch)
const CACHE_MAX = 64;      // LRU size in tiles (dem + qcode together)

let cfg = { base: './', z: 15, demVersion: null, loaded: false };
const cache = new Map();   // key -> Promise<Float32Array|Uint8Array|null>   (Map order = LRU order)

export function initSampler(tilesJson, baseUrl = './') {
  const z = tilesJson && tilesJson.analysis_zoom;
  if (!Number.isInteger(z)) throw new Error('tiles.json has no analysis_zoom');
  if (tilesJson.layers && !tilesJson.layers.qcode) console.warn('terrain-sampler: tiles.json.layers.qcode missing, trying qcode tiles anyway');
  cfg = { base: baseUrl && !baseUrl.endsWith('/') ? baseUrl + '/' : (baseUrl || ''), z, demVersion: tilesJson.dem_version ?? null, loaded: true };
  cache.clear();
  return Promise.resolve(true);
}

// ---------------------------------------------------------------- tile loading
async function decodePNG(blob) {
  let w, h, data;
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    w = bmp.width; h = bmp.height;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    data = ctx.getImageData(0, 0, w, h).data;
    if (bmp.close) bmp.close();
  } else {                                    // old browsers: <img> + canvas
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      w = img.naturalWidth; h = img.naturalHeight;
      const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      data = ctx.getImageData(0, 0, w, h).data;
    } finally { URL.revokeObjectURL(url); }
  }
  if (w !== TS || h !== TS) throw new Error(`unexpected tile size ${w}x${h}`);
  return data;
}

async function loadTile(layer, x, y) {
  const url = `${cfg.base}tiles/${layer}/${cfg.z}/${x}/${y}.png`;
  const r = await fetch(url);
  if (r.status === 404) return null;           // outside the data footprint
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const px = await decodePNG(await r.blob());
  if (layer === 'dem') {                        // Terrarium: R*256 + G + B/256 - 32768
    const out = new Float32Array(TS * TS);
    for (let i = 0; i < TS * TS; i++) out[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
    return out;
  }
  const out = new Uint8Array(TS * TS);          // qcode: opaque greyscale, value = code
  for (let i = 0; i < TS * TS; i++) out[i] = px[4 * i];
  return out;
}

function getTile(layer, x, y) {
  const key = `${layer}/${cfg.z}/${x}/${y}`;
  let p = cache.get(key);
  if (p) { cache.delete(key); cache.set(key, p); return p; }
  p = loadTile(layer, x, y);
  cache.set(key, p);
  p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

/** Load every tile (dem + qcode) covering the given world-pixel rectangle; returns sync accessors. */
async function prepare(pxMin, pyMin, pxMax, pyMax) {
  const x0 = Math.floor(pxMin / TS), x1 = Math.floor(pxMax / TS), y0 = Math.floor(pyMin / TS), y1 = Math.floor(pyMax / TS);
  const dem = new Map(), qc = new Map(), jobs = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const k = tx + ',' + ty;
    jobs.push(getTile('dem', tx, ty).then((t) => dem.set(k, t)), getTile('qcode', tx, ty).then((t) => qc.set(k, t)));
  }
  await Promise.all(jobs);                      // local Maps keep the tiles alive even if the LRU evicts them
  const at = (m, i, j) => {
    const tx = Math.floor(i / TS), ty = Math.floor(j / TS);
    const t = m.get(tx + ',' + ty);
    return t ? t[(j - ty * TS) * TS + (i - tx * TS)] : undefined;
  };
  // elevation of integer pixel (i, j): NaN where the tile does not exist
  const z = (i, j) => { const v = at(dem, i, j); return v === undefined ? NaN : v; };
  const code = (i, j) => { const v = at(qc, i, j); return v === undefined ? 0 : v; };
  return { z, code };
}

// ---------------------------------------------------------------- point computation (twin of metrics.py:point_at)
function pointAt(g, lon, lat) {
  const Z = cfg.z;
  const [px, py] = lonLatToPixel(lon, lat, Z);
  const ci = Math.floor(px), cj = Math.floor(py);
  const quality = g.code(ci, cj);
  // bilinear elevation between pixel centres; NaN corners are dropped and the weights renormalised
  const fx = px - 0.5, fy = py - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
  let sw = 0, sz = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const v = g.z(i0 + di, j0 + dj);
    if (!Number.isNaN(v)) { sw += w; sz += w * v; }
  }
  const elev = sw > 0 ? sz / sw : NaN;
  // Horn 3x3 on the cell containing the point; NaN neighbours take the centre value (as tools/terrain_common.horn)
  let slope = NaN, aspect = NaN;
  const c = g.z(ci, cj);
  if (!Number.isNaN(c)) {
    const nb = (di, dj) => { const v = g.z(ci + di, cj + dj); return Number.isNaN(v) ? c : v; };
    const a = nb(-1, -1), b = nb(0, -1), cc = nb(1, -1), d = nb(-1, 0), f = nb(1, 0), gg = nb(-1, 1), h = nb(0, 1), i = nb(1, 1);
    const cs = cellSize(cj, Z);
    const dzdx = ((cc + 2 * f + i) - (a + 2 * d + gg)) / (8 * cs);
    const dzdy = ((a + 2 * b + cc) - (gg + 2 * h + i)) / (8 * cs);
    const m = Math.hypot(dzdx, dzdy);
    slope = Math.atan(m) / Math.PI * 180;
    if (m >= 1e-9) aspect = (((Math.atan2(-dzdx, -dzdy) / Math.PI * 180) % 360) + 360) % 360;
  }
  return { elev, slope, aspect, quality };
}

const lonLatOf = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.lng ?? p.lon, p.lat]);

/** sample(lngLat) -> {elev, slope, aspect, quality}. Code-0 (missing) cells give null elev/slope/aspect. */
export async function sample(lngLat) {
  if (!cfg.loaded) throw new Error('sampler not initialised');
  const [lon, lat] = lonLatOf(lngLat);
  const [px, py] = lonLatToPixel(lon, lat, cfg.z);
  const g = await prepare(px - 2, py - 2, px + 2, py + 2);
  const s = pointAt(g, lon, lat);
  const ok = s.quality !== 0 && Number.isFinite(s.elev);
  return { elev: ok ? s.elev : null, slope: ok && Number.isFinite(s.slope) ? s.slope : null,
           aspect: ok && Number.isFinite(s.aspect) ? s.aspect : null, quality: s.quality };
}

/** profile(coords) -> {samples: [{d, elev, slope, quality}], metrics}. coords = [[lon, lat], ...]. */
export async function profile(coords) {
  if (!cfg.loaded) throw new Error('sampler not initialised');
  const pts = densify(coords, STEP_M);
  if (!pts.length) return { samples: [], metrics: computeMetrics([], 0, cfg.demVersion) };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const [px, py] = lonLatToPixel(p.lon, p.lat, cfg.z);
    x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
  }
  const g = await prepare(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
  const samples = pts.map((p) => {
    const s = pointAt(g, p.lon, p.lat);
    const ok = s.quality !== 0 && Number.isFinite(s.elev) && Number.isFinite(s.slope);
    return { d: p.d, elev: ok ? s.elev : null, slope: ok ? s.slope : null, quality: s.quality };
  });
  return { samples, metrics: computeMetrics(samples, lineLength(coords), cfg.demVersion) };
}

// ---------------------------------------------------------------- metrics (twin of metrics.py:compute_metrics)
/**
 * samples: [{d, elev|null, slope|null, quality}]; a sample is valid iff elev !== null (quality 0 => null).
 * All statistics ignore invalid samples; gaps are never bridged (no step, window or run spans one).
 */
export function computeMetrics(samples, lengthM, demVersion = null) {
  const n = samples.length;
  const ok = samples.map((s) => s.elev !== null && s.elev !== undefined && s.quality !== 0);
  const z = samples.map((s) => s.elev), d = samples.map((s) => s.d);
  const pct = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of samples) if (s.quality in pct) pct[s.quality] += 100 / n;
  // 20 m centred moving average over valid samples in index window i-2..i+2 (truncated at ends and gaps)
  const sm = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (ok[j]) { s += z[j]; c++; }
    sm[i] = s / c;
  }
  let asc = 0, desc = 0;
  for (let i = 0; i + 1 < n; i++) if (ok[i] && ok[i + 1]) { const st = sm[i + 1] - sm[i]; if (st > 0) asc += st; else desc -= st; }
  const first = ok.indexOf(true), last = ok.lastIndexOf(true);
  let ge30 = 0, ge35 = 0;
  for (let i = 0; i < n; i++) {                 // each sample owns half of each adjacent interval
    if (!ok[i]) continue;
    const w = n < 2 ? 0 : i === 0 ? (d[1] - d[0]) / 2 : i === n - 1 ? (d[n - 1] - d[n - 2]) / 2 : (d[i + 1] - d[i - 1]) / 2;
    if (samples[i].slope >= 30) ge30 += w;
    if (samples[i].slope >= 35) ge35 += w;
  }
  let slopeMax = null, pitchMax = null;
  for (let i = 0; i + WIN - 1 < n; i++) {       // windows of 5 consecutive valid samples (20 m)
    let all = true, mn = Infinity;
    for (let j = i; j < i + WIN; j++) { if (!ok[j]) { all = false; break; } mn = Math.min(mn, samples[j].slope); }
    if (!all) continue;
    if (slopeMax === null || mn > slopeMax) slopeMax = mn;
    const p = Math.atan(Math.abs(z[i + WIN - 1] - z[i]) / (d[i + WIN - 1] - d[i])) / Math.PI * 180;
    if (pitchMax === null || p > pitchMax) pitchMax = p;
  }
  return {
    length_m: lengthM,
    net_drop_m: first >= 0 ? z[first] - z[last] : null,
    cum_descent_m: first >= 0 ? desc : null,
    cum_ascent_m: first >= 0 ? asc : null,
    terrain_slope_max: slopeMax,
    len_ge30_m: ge30,
    len_ge35_m: ge35,
    pitch_max_deg: pitchMax,
    pct_by_source: pct,
    low_confidence: n === 0 ? true : pct[0] + pct[3] + pct[4] > 25,
    dem_version: demVersion,
  };
}
