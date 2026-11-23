"""WS1 terrain probe: small JSON queries on the merged analysis DEM (used by WS8).

Reads build/merged_dem.tif + build/source_mask.tif (2 m, EPSG:2955). All output is one JSON object on stdout.
Run from tools/:
  python -m uv run terrain_probe.py summit   --near lon,lat --r 300
  python -m uv run terrain_probe.py saddle   --between lon,lat lon,lat
  python -m uv run terrain_probe.py aspect   --at lon,lat --r 100
  python -m uv run terrain_probe.py profile  --line "lon,lat;lon,lat;..."
  python -m uv run terrain_probe.py fall-line --from lon,lat --max 2000
  python -m uv run terrain_probe.py lakes
Quality codes: 0 missing, 1 lidar 2018, 2 lidar 2017, 3 MRDEM, 4 blend. Elevations are metres on the analysis grid.
"""
import argparse
import heapq  # noqa: F401  (kept for readers extending the path search)
import json
import re
import sys

import numpy as np
import rasterio
from pyproj import Geod, Transformer
from scipy import ndimage as ndi

import terrain_common as tc

_TO_UTM = Transformer.from_crs("EPSG:4326", tc.CRS, always_xy=True)
_TO_LL = Transformer.from_crs(tc.CRS, "EPSG:4326", always_xy=True)
_GEOD = Geod(ellps="GRS80")


class Grid:
    def __init__(self):
        bd = tc.build_dir()
        with rasterio.open(bd / "merged_dem.tif") as s:
            z = s.read(1).astype("float32")
            self.tr = s.transform
        z[z <= -32767] = np.nan
        self.z = z
        with rasterio.open(bd / "source_mask.tif") as s:
            self.q = s.read(1)
        self.e0, self.n1 = self.tr.c, self.tr.f
        self.h, self.w = z.shape
        self._slope = None
        self._aspect = None

    def slope_aspect(self):
        if self._slope is None:
            self._slope, self._aspect = tc.horn(self.z, tc.RES)
        return self._slope, self._aspect

    def to_rc(self, e, n):
        return (self.n1 - n) / tc.RES - 0.5, (e - self.e0) / tc.RES - 0.5  # float row, col (cell centres at .0)

    def to_en(self, r, c):
        return self.e0 + (c + 0.5) * tc.RES, self.n1 - (r + 0.5) * tc.RES

    def inside(self, r, c):
        return (r >= 0) & (c >= 0) & (r <= self.h - 1) & (c <= self.w - 1)

    def sample(self, arr, e, n, order=1):
        r, c = self.to_rc(np.atleast_1d(e), np.atleast_1d(n))
        ok = self.inside(r, c)
        out = np.full(r.shape, np.nan)
        if ok.any():
            a = np.where(np.isfinite(arr), arr, np.nan)
            out[ok] = ndi.map_coordinates(a, [r[ok], c[ok]], order=order, mode="nearest", cval=np.nan)
        return out

    def quality_at(self, e, n):
        r, c = self.to_rc(np.atleast_1d(e), np.atleast_1d(n))
        ok = self.inside(r, c)
        out = np.zeros(r.shape, dtype=int)
        out[ok] = self.q[np.rint(r[ok]).astype(int), np.rint(c[ok]).astype(int)]
        return out


def ll_arg(s):
    s = s.lstrip("@").strip()
    lon, lat = (float(v) for v in s.split(","))
    return lon, lat


def line_arg(s):
    return [ll_arg(p) for p in s.lstrip("@").split(";") if p.strip()]


def fix_negative_args(argv):
    """argparse treats '-117.1,49.7' as an option; prefix coordinate-like tokens with '@' (stripped by ll_arg)."""
    pat = re.compile(r"^-\d[\d.,;\- ]*$")
    return [("@" + a) if pat.match(a) else a for a in argv]


def rnd(v, n=2):
    return None if v is None or not np.isfinite(v) else round(float(v), n)


def pt_info(g, e, n):
    lon, lat = _TO_LL.transform(e, n)
    z = g.sample(g.z, e, n)[0]
    return {"lon": round(lon, 6), "lat": round(lat, 6), "E": round(float(e), 1), "N": round(float(n), 1),
            "elev": rnd(z), "quality": int(g.quality_at(e, n)[0])}


def disc(g, e, n, r_m):
    """Slices and mask of the cells within r_m of (e, n)."""
    r0, c0 = g.to_rc(e, n)
    k = int(np.ceil(r_m / tc.RES)) + 1
    r_lo, r_hi = max(int(r0) - k, 0), min(int(r0) + k + 1, g.h)
    c_lo, c_hi = max(int(c0) - k, 0), min(int(c0) + k + 1, g.w)
    rr, cc = np.mgrid[r_lo:r_hi, c_lo:c_hi]
    m = (np.hypot(rr - r0, cc - c0) * tc.RES) <= r_m
    return (slice(r_lo, r_hi), slice(c_lo, c_hi)), m


# ---------------------------------------------------------------- commands
def cmd_summit(g, a):
    e, n = _TO_UTM.transform(*a.near)
    sl, m = disc(g, e, n, a.r)
    z = np.where(m, g.z[sl], np.nan)
    if not np.isfinite(z).any():
        return {"error": "no data within radius"}
    i = np.nanargmax(z)
    r, c = np.unravel_index(i, z.shape)
    ee, nn = g.to_en(sl[0].start + r, sl[1].start + c)
    out = pt_info(g, ee, nn)
    out.update(cmd="summit", search_r_m=a.r)
    out["elev"] = rnd(g.z[sl[0].start + r, sl[1].start + c])
    out["quality"] = int(g.q[sl[0].start + r, sl[1].start + c])
    return out


def cmd_saddle(g, a):
    (e1, n1), (e2, n2) = (_TO_UTM.transform(*p) for p in a.between)
    pad = 400.0
    r1, c1 = g.to_rc(e1, n1)
    r2, c2 = g.to_rc(e2, n2)
    k = int(pad / tc.RES)
    ro, co = max(int(min(r1, r2)) - k, 0), max(int(min(c1, c2)) - k, 0)
    re_, ce = min(int(max(r1, r2)) + k, g.h), min(int(max(c1, c2)) + k, g.w)
    step = 1
    while ((re_ - ro) // step) * ((ce - co) // step) > 3_000_000:
        step += 1
    z = g.z[ro:re_:step, co:ce:step]
    a_rc = (int(round((r1 - ro) / step)), int(round((c1 - co) / step)))
    b_rc = (int(round((r2 - ro) / step)), int(round((c2 - co) / step)))
    for p in (a_rc, b_rc):
        if not (0 <= p[0] < z.shape[0] and 0 <= p[1] < z.shape[1]) or not np.isfinite(z[p]):
            return {"error": "endpoint outside data"}
    zf = np.where(np.isfinite(z), z, -1e9)
    lv = np.unique(np.round(zf[np.isfinite(z)], 1))
    lo, hi = 0, len(lv) - 1  # largest level t such that a and b are connected within {z >= t}

    def connected(t):
        lab, _ = ndi.label(zf >= t)
        return lab[a_rc] != 0 and lab[a_rc] == lab[b_rc]

    if not connected(lv[0]):
        return {"error": "endpoints not connected"}
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if connected(lv[mid]):
            lo = mid
        else:
            hi = mid - 1
    t = float(lv[lo])
    lab, _ = ndi.label(zf >= t)
    comp = lab == lab[a_rc]
    cand = np.argwhere(comp & (zf >= t) & (zf < t + 0.1))
    best = cand[0]
    for rc in cand[:60]:
        mask = comp.copy()
        mask[tuple(rc)] = False
        l2, _ = ndi.label(mask)
        if l2[a_rc] == 0 or l2[a_rc] != l2[b_rc]:
            best = rc
            break
    ee, nn = g.to_en(ro + best[0] * step, co + best[1] * step)
    out = pt_info(g, ee, nn)
    out.update(cmd="saddle", approx=True, note="lowest point on the path between the endpoints that maximises the minimum elevation", grid_step_m=step * tc.RES)
    return out


def cmd_aspect(g, a):
    e, n = _TO_UTM.transform(*a.at)
    sl, m = disc(g, e, n, a.r)
    s, asp = g.slope_aspect()
    ss, aa, qq = s[sl][m], asp[sl][m], g.q[sl][m]
    ok = np.isfinite(ss) & np.isfinite(aa)
    if not ok.any():
        return {"error": "no data within radius"}
    w = np.where(ok, ss, 0)
    sx = np.sum(w[ok] * np.sin(np.radians(aa[ok])))
    sy = np.sum(w[ok] * np.cos(np.radians(aa[ok])))
    mean_asp = float(np.degrees(np.arctan2(sx, sy)) % 360)
    sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    pct = {int(k): round(float((qq == k).mean()) * 100, 1) for k in range(5)}
    out = pt_info(g, e, n)
    out.update(cmd="aspect", r_m=a.r, aspect_deg=rnd(mean_asp, 1), aspect_sector=sectors[int(((mean_asp + 22.5) % 360) // 45)],
               slope_mean_deg=rnd(np.nanmean(ss), 1), slope_max_deg=rnd(np.nanmax(ss), 1),
               aspect_resultant_len=rnd(np.hypot(sx, sy) / max(w[ok].sum(), 1e-9), 3), pct_by_source=pct)
    return out


def cmd_profile(g, a):
    pts = [_TO_UTM.transform(*p) for p in a.line]
    lls = a.line
    samples, s_tot = [], 0.0
    for i in range(len(pts) - 1):
        _, _, d = _GEOD.inv(lls[i][0], lls[i][1], lls[i + 1][0], lls[i + 1][1])
        n = max(int(np.ceil(d / 5.0)), 1)
        for j in range(n):
            f = j / n
            samples.append((s_tot + f * d, pts[i][0] + f * (pts[i + 1][0] - pts[i][0]), pts[i][1] + f * (pts[i + 1][1] - pts[i][1])))
        s_tot += d
    samples.append((s_tot, *pts[-1]))
    s = np.array([x[0] for x in samples]); E = np.array([x[1] for x in samples]); N = np.array([x[2] for x in samples])
    z = g.sample(g.z, E, N)
    sl = g.sample(g.slope_aspect()[0], E, N)
    q = g.quality_at(E, N)
    lon, lat = _TO_LL.transform(E, N)
    rows = [{"s_m": round(float(s[i]), 1), "lon": round(float(lon[i]), 6), "lat": round(float(lat[i]), 6),
             "elev": rnd(z[i]), "slope": rnd(sl[i], 1), "quality": int(q[i])} for i in range(len(s))]
    return {"cmd": "profile", "step_m": 5, "length_m": round(float(s_tot), 1), "n": len(rows), "samples": rows}


def cmd_fall_line(g, a):
    e, n = _TO_UTM.transform(*a.from_)
    zs = ndi.gaussian_filter(np.where(np.isfinite(g.z), g.z, np.nanmean(g.z)), 2.0)  # 4 m smoothing removes pit noise
    zs = np.where(np.isfinite(g.z), zs, np.nan)
    gy, gx = np.gradient(np.where(np.isfinite(zs), zs, np.nanmean(zs)), tc.RES)  # gy: +south (row), gx: +east
    path, length, step, stall = [], 0.0, 4.0, 0
    pe, pn = e, n
    dprev = None
    while length < a.max:
        r, c = g.to_rc(pe, pn)
        if not g.inside(r, c) or not np.isfinite(g.sample(g.z, pe, pn)[0]):
            break
        z = g.sample(g.z, pe, pn)[0]
        path.append((pe, pn, z, length))
        dzdx = ndi.map_coordinates(gx, [[r], [c]], order=1, mode="nearest")[0]
        dzdy_south = ndi.map_coordinates(gy, [[r], [c]], order=1, mode="nearest")[0]
        d = np.array([-dzdx, +dzdy_south])  # (east, north) downhill direction: -grad; row increases southward
        mag = np.hypot(*d)
        if mag < np.tan(np.radians(0.5)):
            stall += 1
            if stall > 5 or dprev is None:
                break
            d = dprev
        else:
            stall = 0
            d = d / mag
            if dprev is not None:  # light momentum so the line keeps going across tiny flats
                d = 0.7 * d + 0.3 * dprev
                d = d / np.hypot(*d)
        dprev = d
        pe, pn = pe + d[0] * step, pn + d[1] * step
        length += step
    # thin to ~10 m, always keep the last point
    keep = [p for i, p in enumerate(path) if i % 3 == 0] + ([path[-1]] if path else [])
    coords = []
    for pe_, pn_, z_, s_ in keep:
        lon, lat = _TO_LL.transform(pe_, pn_)
        coords.append([round(lon, 6), round(lat, 6), rnd(z_)])
    end = path[-1] if path else None
    return {"cmd": "fall-line", "length_m": round(length, 1), "drop_m": rnd(path[0][2] - path[-1][2]) if path else None,
            "ended": "max length" if length >= a.max else "flat/edge/no data", "coords": coords,
            "end_quality": int(g.quality_at(end[0], end[1])[0]) if end else None}


def cmd_lakes(g, a):
    s, _ = g.slope_aspect()
    flat = np.isfinite(s) & (s < 1.0)
    lab, n = ndi.label(flat)
    if n == 0:
        return {"cmd": "lakes", "lakes": []}
    sizes = ndi.sum(flat, lab, index=np.arange(1, n + 1))
    out = []
    for i in np.where(sizes * tc.RES ** 2 >= 3000)[0] + 1:
        comp = lab == i
        zc = g.z[comp]
        lo, hi = np.percentile(zc, [5, 95])
        if hi - lo > 1.5:
            continue  # not dead flat: a bench or glacier surface, not a water surface
        ring = ndi.binary_dilation(comp, iterations=4) & ~ndi.binary_dilation(comp, iterations=1)
        zr = g.z[ring]
        zr = zr[np.isfinite(zr)]
        level = float(np.median(zc))
        if zr.size == 0 or np.mean(zr >= level - 0.5) < 0.9:
            continue  # not a basin: ground falls away on at least one side
        rr, cc = np.nonzero(comp)
        ee, nn = g.to_en(rr.mean(), cc.mean())
        lon, lat = _TO_LL.transform(ee, nn)
        qc = np.bincount(g.q[comp], minlength=5)
        out.append({"lon": round(lon, 6), "lat": round(lat, 6), "elev": rnd(level), "area_m2": int(comp.sum() * tc.RES ** 2),
                    "flat_range_m": rnd(hi - lo), "quality": int(np.argmax(qc)), "kind": "flat basin (lake candidate)"})
    out.sort(key=lambda d: -d["area_m2"])
    return {"cmd": "lakes", "n": len(out), "lakes": out}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("summit"); p.add_argument("--near", type=ll_arg, required=True); p.add_argument("--r", type=float, default=300)
    p = sub.add_parser("saddle"); p.add_argument("--between", type=ll_arg, nargs=2, required=True)
    p = sub.add_parser("aspect"); p.add_argument("--at", type=ll_arg, required=True); p.add_argument("--r", type=float, default=100)
    p = sub.add_parser("profile"); p.add_argument("--line", type=line_arg, required=True)
    p = sub.add_parser("fall-line"); p.add_argument("--from", dest="from_", type=ll_arg, required=True); p.add_argument("--max", type=float, default=2000)
    sub.add_parser("lakes")
    a = ap.parse_args(fix_negative_args(sys.argv[1:]))
    g = Grid()
    fn = {"summit": cmd_summit, "saddle": cmd_saddle, "aspect": cmd_aspect, "profile": cmd_profile,
          "fall-line": cmd_fall_line, "lakes": cmd_lakes}[a.cmd]
    print(json.dumps(fn(g, a)))


if __name__ == "__main__":
    main()
