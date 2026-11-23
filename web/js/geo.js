// geo.js [WS4] - geodesic + Web-Mercator helpers. Mirrored 1:1 by tools/metrics.py (keep them in sync).
export const R_EARTH = 6371008.8;                 // mean earth radius (m), used for every distance
export const MERC_CIRC = 40075016.686;            // equatorial circumference of the Web-Mercator sphere (m)
const RAD = Math.PI / 180;

/** Great-circle (haversine) distance in metres between two [lon, lat] points. */
export function haversine(a, b) {
  const p1 = a[1] * RAD, p2 = b[1] * RAD;
  const dp = p2 - p1, dl = (b[0] - a[0]) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total horizontal length (m) of a [lon, lat] polyline. */
export function lineLength(coords) {
  let L = 0;
  for (let i = 1; i < coords.length; i++) L += haversine(coords[i - 1], coords[i]);
  return L;
}

/**
 * Densify a polyline every `step` metres of geodesic distance, starting at the first vertex. The last vertex is
 * appended when more than 1 cm remains. Points between vertices are linear in lon/lat (segments are short).
 * Returns [{lon, lat, d}] with d = distance from the start (m).
 */
export function densify(coords, step = 5) {
  const out = [];
  if (!coords || coords.length === 0) return out;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const L = cum[cum.length - 1];
  if (!(L > 0)) return [{ lon: coords[0][0], lat: coords[0][1], d: 0 }];
  const nFull = Math.floor(L / step);
  const ds = [];
  for (let k = 0; k <= nFull; k++) ds.push(k * step);
  if (L - nFull * step > 0.01) ds.push(L);
  let seg = 0;
  for (const d of ds) {
    while (seg < coords.length - 2 && cum[seg + 1] < d) seg++;
    const len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / len)) : 0;
    out.push({ lon: coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * t,
               lat: coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * t, d });
  }
  return out;
}

/** World pixel coordinates (float) at zoom z for a lon/lat. Pixel (i, j) covers [i, i+1) x [j, j+1). */
export function lonLatToPixel(lon, lat, z) {
  const n = 256 * 2 ** z;
  const s = Math.sin(lat * RAD);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

/** Ground size (m) of one Web-Mercator pixel at zoom z on world pixel row j (row centre): px * cos(lat of row). */
export function cellSize(j, z) {
  const n = 256 * 2 ** z;
  const merc = Math.PI * (1 - 2 * (j + 0.5) / n);   // mercator y / R at the row centre
  return MERC_CIRC / n / Math.cosh(merc);           // cos(lat) = 1 / cosh(y / R)
}
