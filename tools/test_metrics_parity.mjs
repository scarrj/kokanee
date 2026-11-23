// WS4 parity test: web/js/terrain-sampler.js (JS) vs tools/metrics.py (Python) on tools/fixtures/metrics_fixture.json.
// Run from tools/:  node test_metrics_parity.mjs      (needs Node >= 18; Python via `python -m uv run`)
// A small PNG decoder shim stands in for createImageBitmap/OffscreenCanvas, and fetch reads web/ from disk.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..', 'web');
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'metrics_fixture.json'), 'utf8'));
const TOL_M = fixture.tolerance?.metres ?? 1, TOL_D = fixture.tolerance?.degrees ?? 0.5;

// ---------------------------------------------------------------- browser shims
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, plte = null; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; if (body[12]) throw new Error('interlaced PNG'); }
    else if (type === 'PLTE') plte = body; else if (type === 'IDAT') idat.push(body); else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('only 8-bit PNG supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), dst = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? dst[i - ch] : 0, b = up ? up[i] : 0, c = up && i >= ch ? up[i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      dst[i] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ctype === 0) r = g = b = px[i]; else if (ctype === 2) [r, g, b] = [px[3 * i], px[3 * i + 1], px[3 * i + 2]];
    else if (ctype === 3) [r, g, b] = [plte[3 * px[i]], plte[3 * px[i] + 1], plte[3 * px[i] + 2]];
    else if (ctype === 4) { r = g = b = px[2 * i]; a = px[2 * i + 1]; } else [r, g, b, a] = [px[4 * i], px[4 * i + 1], px[4 * i + 2], px[4 * i + 3]];
    data.set([r, g, b, a], 4 * i);
  }
  return { width: w, height: h, data };
}
globalThis.fetch = async (url) => {
  const p = String(url).startsWith('file:') ? fileURLToPath(url) : String(url);
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  const buf = fs.readFileSync(p);
  return { ok: true, status: 200, blob: async () => buf, json: async () => JSON.parse(buf.toString('utf8')) };
};
globalThis.createImageBitmap = async (blob) => decodePng(Buffer.from(blob));
globalThis.OffscreenCanvas = class { constructor(w, h) { this.w = w; this.h = h; }
  getContext() { const self = this; return { drawImage(b) { self.bmp = b; }, getImageData() { return { data: self.bmp.data }; } }; } };

// ---------------------------------------------------------------- run both sides
const sampler = await import(pathToFileURL(path.join(webDir, 'js', 'terrain-sampler.js')).href);
const tilesJson = JSON.parse(fs.readFileSync(path.join(webDir, 'tiles', 'tiles.json'), 'utf8'));
await sampler.initSampler(tilesJson, webDir.replace(/\\/g, '/') + '/');

const py = spawnSync('python', ['-m', 'uv', 'run', 'metrics.py', '--fixture', 'fixtures/metrics_fixture.json', '--json'],
  { cwd: here, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (py.status !== 0) { console.error('metrics.py failed:\n' + py.stderr); process.exit(2); }
const ref = JSON.parse(py.stdout);

let pass = 0; const fails = [];
const near = (a, b, tol) => (a === null && b === null) || (a !== null && b !== null && Math.abs(a - b) <= tol);
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// metric -> tolerance kind
const KIND = { length_m: 'm', net_drop_m: 'm', cum_descent_m: 'm', cum_ascent_m: 'm', len_ge30_m: 'm', len_ge35_m: 'm',
  terrain_slope_max: 'deg', pitch_max_deg: 'deg' };
let maxM = 0, maxD = 0, worst = {};

for (const line of fixture.lines) {
  const errs = [];
  const js = await sampler.profile(line.coords), r = ref.lines[line.name];
  for (const [k, kind] of Object.entries(KIND)) {
    const a = js.metrics[k], b = r.metrics[k];
    if (a === null || b === null) { if (a !== b) errs.push(`${k}: js ${a} vs py ${b}`); continue; }
    const diff = Math.abs(a - b);
    if (kind === 'm') maxM = Math.max(maxM, diff); else maxD = Math.max(maxD, diff);
    if (diff > (kind === 'm' ? TOL_M : TOL_D)) errs.push(`${k}: js ${a.toFixed(2)} vs py ${b.toFixed(2)}`);
  }
  for (const c of ['0', '1', '2', '3', '4']) if (!near(js.metrics.pct_by_source[c], r.metrics.pct_by_source[c], 0.01)) errs.push(`pct_by_source[${c}]`);
  if (js.metrics.low_confidence !== r.metrics.low_confidence) errs.push('low_confidence');
  if (js.metrics.dem_version !== r.metrics.dem_version) errs.push('dem_version');
  if (js.samples.length !== r.samples.length) errs.push(`sample count ${js.samples.length} vs ${r.samples.length}`);
  else {
    let se = 0, ss = 0, sq = 0, sd = 0;
    js.samples.forEach((s, i) => { const t = r.samples[i];
      if (s.quality !== t.quality) sq++;
      if (!near(s.elev, t.elev, TOL_M)) se++; else if (s.elev !== null) maxM = Math.max(maxM, Math.abs(s.elev - t.elev));
      if (!near(s.slope, t.slope, TOL_D)) ss++; else if (s.slope !== null) maxD = Math.max(maxD, Math.abs(s.slope - t.slope));
      if (Math.abs(s.d - t.d) > TOL_M) sd++; });
    if (se || ss || sq || sd) errs.push(`samples differ: elev ${se}, slope ${ss}, quality ${sq}, d ${sd}`);
  }
  const srcs = Object.entries(js.metrics.pct_by_source).filter(([, v]) => v > 0).map(([k]) => +k).sort().join(',');
  const want = [...line.expect_sources].sort().join(',');
  if (srcs !== want) errs.push(`expected sources ${want}, got ${srcs}`);
  if (errs.length) fails.push(`${line.name}: ${errs.join('; ')}`); else { pass++; console.log(`  ok   ${line.name} (${js.samples.length} samples, sources ${srcs}, low_confidence ${js.metrics.low_confidence})`); }
}

// point samples (adds aspect)
let ptOk = 0;
for (const pt of fixture.points ?? []) {
  const a = await sampler.sample({ lng: pt.lonlat[0], lat: pt.lonlat[1] }), b = ref.points[pt.name];
  const bad = !near(a.elev, b.elev, TOL_M) || !near(a.slope, b.slope, TOL_D) || a.quality !== b.quality
    || (a.aspect === null) !== (b.aspect === null) || (a.aspect !== null && angDiff(a.aspect, b.aspect) > TOL_D);
  if (bad) fails.push(`point ${pt.name}: js ${JSON.stringify(a)} vs py ${JSON.stringify(b)}`); else ptOk++;
}
console.log(`  points ${ptOk}/${(fixture.points ?? []).length} (elev/slope/aspect/quality)`);

// synthetic checks of gap handling (expected values worked out by hand)
{
  const S = (elev, q = 1, slope = 10) => ({ d: 0, elev, slope, quality: elev === null ? 0 : q });
  const mk = (arr) => arr.map((e, i) => ({ ...S(e), d: i * 5 }));
  const m = sampler.computeMetrics(mk([100, 100, 100, 100, 100, null, null, 200, 200, 200, 200, 200]), 55, 'x').valueOf();
  const ok = m.pct_by_source['0'] > 16.6 && m.pct_by_source['0'] < 16.7 && m.low_confidence === false
    && Math.abs(m.net_drop_m - -100) < 1e-9 && m.cum_ascent_m === 0 && m.cum_descent_m === 0   // the 100 m jump sits in the gap: never bridged
    && m.terrain_slope_max === 10 && m.pitch_max_deg === 0;
  if (!ok) fails.push('synthetic gap test: ' + JSON.stringify(m)); else console.log('  ok   synthetic gap handling');
}

console.log(`max diff: ${maxM.toFixed(3)} m, ${maxD.toFixed(3)} deg`);
if (fails.length) { console.log(`FAIL ${pass}/${fixture.lines.length}`); for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log(`PASS ${pass}/${fixture.lines.length}`);
