// profile-chart.js [WS3] - elevation profile on a canvas.
// Gaps where quality is 0 (never interpolated); fallback stretches (quality 3, 4) tinted.
// Tolerant of sample shape: {d|dist|dist_m|s, elev|z, quality|q}.
export function drawProfile(canvas, samples, { height = 150 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.body);
  const fg = css.color;
  ctx.clearRect(0, 0, w, height);
  const pts = (samples || []).map((s, i) => ({
    d: s.d ?? s.dist ?? s.dist_m ?? s.s ?? i * 5,
    z: s.elev ?? s.z ?? s.e ?? null,
    q: s.quality ?? s.q ?? 1,
  }));
  const ok = (p) => p.q !== 0 && p.z != null && Number.isFinite(p.z) && p.z > -1000;
  const valid = pts.filter(ok);
  if (pts.length < 2 || !valid.length) {
    ctx.fillStyle = fg; ctx.font = '13px sans-serif'; ctx.fillText('No profile data', 10, 24);
    return;
  }
  const L = 44, R = 8, T = 8, B = 22;
  const dmax = pts[pts.length - 1].d || 1;
  let zmin = Math.min(...valid.map((p) => p.z)), zmax = Math.max(...valid.map((p) => p.z));
  const pad = Math.max(10, (zmax - zmin) * 0.08); zmin -= pad; zmax += pad;
  const X = (d) => L + (d / dmax) * (w - L - R);
  const Y = (z) => T + (1 - (z - zmin) / (zmax - zmin)) * (height - T - B);
  // bands: tint fallback, hatch gaps
  const band = (i0, i1, fill) => { ctx.fillStyle = fill; ctx.fillRect(X(pts[i0].d), T, Math.max(1, X(pts[i1].d) - X(pts[i0].d)), height - T - B); };
  let i = 0;
  while (i < pts.length) {
    const q = pts[i].q; let j = i;
    while (j + 1 < pts.length && ((pts[j + 1].q === 0) === (q === 0)) && ((pts[j + 1].q >= 3) === (q >= 3))) j++;
    if (q === 0) band(i, j, 'rgba(158,158,158,.45)');
    else if (q >= 3) band(i, j, 'rgba(232,89,12,.18)');
    i = j + 1;
  }
  // axes
  ctx.strokeStyle = 'rgba(128,128,128,.4)'; ctx.fillStyle = fg; ctx.font = '11px sans-serif'; ctx.lineWidth = 1;
  const zstep = niceStep((zmax - zmin) / 4);
  for (let z = Math.ceil(zmin / zstep) * zstep; z <= zmax; z += zstep) {
    ctx.beginPath(); ctx.moveTo(L, Y(z)); ctx.lineTo(w - R, Y(z)); ctx.stroke();
    ctx.fillText(String(Math.round(z)), 4, Y(z) + 4);
  }
  const dstep = niceStep(dmax / 5);
  for (let d = 0; d <= dmax; d += dstep) ctx.fillText(dstep >= 1000 || d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m', X(d) - 10, height - 6);
  // line with gaps
  ctx.strokeStyle = '#0b6ea8'; ctx.lineWidth = 2; ctx.beginPath();
  let pen = false;
  for (const p of pts) {
    if (!ok(p)) { pen = false; continue; }
    if (!pen) { ctx.moveTo(X(p.d), Y(p.z)); pen = true; } else ctx.lineTo(X(p.d), Y(p.z));
  }
  ctx.stroke();
}
function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / e;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e;
}
