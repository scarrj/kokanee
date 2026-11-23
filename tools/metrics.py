"""WS4: route / point metrics from the analysis tiles. Python twin of web/js/terrain-sampler.js (+ web/js/geo.js).

Reads the same PNG tiles the browser reads (web/tiles/dem/<az>/x/y.png Terrarium, web/tiles/qcode/<az>/x/y.png
greyscale quality code), NOT the GeoTIFF, so the parity test (test_metrics_parity.mjs) is meaningful. Definitions:
docs/build/CONTRACTS.md#metrics. Any change here must be mirrored in the JS file.

    metrics.py --line "lon,lat;lon,lat;..."          metrics for one line (add --json for machine output)
    metrics.py --routes ../web/data/routes.json      writes build/route_metrics.json (descent + skin per route)
    metrics.py --fixture fixtures/metrics_fixture.json --json   per-line metrics + samples, used by the parity test
"""
import argparse
import json
import math
import os
import pathlib
import sys

import numpy as np
from PIL import Image

R_EARTH = 6371008.8
MERC_CIRC = 40075016.686
TS = 256
STEP_M = 5.0
WIN = 5


def root():
    env = os.environ.get("KOKANEE_ROOT")
    return pathlib.Path(env).resolve() if env else pathlib.Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- geo (twin of web/js/geo.js)
def haversine(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(h)))


def line_length(coords):
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def densify(coords, step=STEP_M):
    if not coords:
        return []
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine(coords[i - 1], coords[i]))
    L = cum[-1]
    if not L > 0:
        return [(coords[0][0], coords[0][1], 0.0)]
    n_full = math.floor(L / step)
    ds = [k * step for k in range(n_full + 1)]
    if L - n_full * step > 0.01:
        ds.append(L)
    out, seg = [], 0
    for d in ds:
        while seg < len(coords) - 2 and cum[seg + 1] < d:
            seg += 1
        ln = cum[seg + 1] - cum[seg]
        t = min(1.0, max(0.0, (d - cum[seg]) / ln)) if ln > 0 else 0.0
        out.append((coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * t,
                    coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * t, d))
    return out


def lonlat_to_pixel(lon, lat, z):
    n = 256 * 2 ** z
    s = math.sin(math.radians(lat))
    return (lon + 180) / 360 * n, (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n


def cell_size(j, z):
    """Ground size of a Web-Mercator pixel on row j: px * cos(lat of the row centre) (matches make_tiles.py)."""
    n = 256 * 2 ** z
    merc = math.pi * (1 - 2 * (j + 0.5) / n)
    return MERC_CIRC / n / math.cosh(merc)


# ---------------------------------------------------------------- tiles
class Grid:
    """Lazy tile cache for the analysis zoom. z(i, j) -> elevation (nan where the tile is missing); code(i, j) -> 0-4."""

    def __init__(self, tiles_dir=None):
        self.dir = pathlib.Path(tiles_dir) if tiles_dir else root() / "web" / "tiles"
        tj = json.loads((self.dir / "tiles.json").read_text(encoding="utf-8"))
        self.zoom = tj["analysis_zoom"]
        self.dem_version = tj.get("dem_version")
        self._dem, self._qc = {}, {}

    def _load(self, layer, tx, ty):
        p = self.dir / layer / str(self.zoom) / str(tx) / f"{ty}.png"
        if not p.exists():
            return None
        a = np.asarray(Image.open(p))
        if layer == "dem":
            a = a.astype("float64")
            return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        return a if a.ndim == 2 else a[..., 0]

    def _tile(self, cache, layer, tx, ty):
        k = (tx, ty)
        if k not in cache:
            cache[k] = self._load(layer, tx, ty)
        return cache[k]

    def z(self, i, j):
        tx, ty = i // TS, j // TS
        t = self._tile(self._dem, "dem", tx, ty)
        return math.nan if t is None else float(t[j - ty * TS, i - tx * TS])

    def code(self, i, j):
        tx, ty = i // TS, j // TS
        t = self._tile(self._qc, "qcode", tx, ty)
        return 0 if t is None else int(t[j - ty * TS, i - tx * TS])


def point_at(g, lon, lat):
    """Twin of pointAt() in terrain-sampler.js. Returns (elev, slope, aspect, quality); nan where undefined."""
    Z = g.zoom
    px, py = lonlat_to_pixel(lon, lat, Z)
    ci, cj = math.floor(px), math.floor(py)
    quality = g.code(ci, cj)
    fx, fy = px - 0.5, py - 0.5
    i0, j0 = math.floor(fx), math.floor(fy)
    tx, ty = fx - i0, fy - j0
    sw = sz = 0.0
    for di, dj, w in ((0, 0, (1 - tx) * (1 - ty)), (1, 0, tx * (1 - ty)), (0, 1, (1 - tx) * ty), (1, 1, tx * ty)):
        v = g.z(i0 + di, j0 + dj)
        if not math.isnan(v):
            sw += w
            sz += w * v
    elev = sz / sw if sw > 0 else math.nan
    slope = aspect = math.nan
    c = g.z(ci, cj)
    if not math.isnan(c):
        def nb(di, dj):
            v = g.z(ci + di, cj + dj)
            return c if math.isnan(v) else v
        a, b, cc = nb(-1, -1), nb(0, -1), nb(1, -1)
        d, f = nb(-1, 0), nb(1, 0)
        gg, h, i = nb(-1, 1), nb(0, 1), nb(1, 1)
        cs = cell_size(cj, Z)
        dzdx = ((cc + 2 * f + i) - (a + 2 * d + gg)) / (8 * cs)
        dzdy = ((a + 2 * b + cc) - (gg + 2 * h + i)) / (8 * cs)
        m = math.hypot(dzdx, dzdy)
        slope = math.degrees(math.atan(m))
        if m >= 1e-9:
            aspect = math.degrees(math.atan2(-dzdx, -dzdy)) % 360.0
    return elev, slope, aspect, quality


def sample_point(g, lon, lat):
    """-> {elev, slope, aspect, quality}; code-0 cells give None for elev/slope/aspect."""
    elev, slope, aspect, q = point_at(g, lon, lat)
    ok = q != 0 and math.isfinite(elev)
    return {"elev": elev if ok else None, "slope": slope if ok and math.isfinite(slope) else None,
            "aspect": aspect if ok and math.isfinite(aspect) else None, "quality": q}


def profile(g, coords):
    pts = densify(coords)
    samples = []
    for lon, lat, d in pts:
        elev, slope, _, q = point_at(g, lon, lat)
        ok = q != 0 and math.isfinite(elev) and math.isfinite(slope)
        samples.append({"d": d, "elev": elev if ok else None, "slope": slope if ok else None, "quality": q})
    return samples, compute_metrics(samples, line_length(coords), g.dem_version)


# ---------------------------------------------------------------- metrics (twin of computeMetrics())
def compute_metrics(samples, length_m, dem_version=None):
    n = len(samples)
    ok = [s["elev"] is not None and s["quality"] != 0 for s in samples]
    z = [s["elev"] for s in samples]
    d = [s["d"] for s in samples]
    pct = {str(k): 0.0 for k in range(5)}
    for s in samples:
        if str(s["quality"]) in pct:
            pct[str(s["quality"])] += 100 / n
    sm = [None] * n
    for i in range(n):
        if not ok[i]:
            continue
        tot, c = 0.0, 0
        for j in range(max(0, i - 2), min(n - 1, i + 2) + 1):
            if ok[j]:
                tot += z[j]
                c += 1
        sm[i] = tot / c
    asc = desc = 0.0
    for i in range(n - 1):
        if ok[i] and ok[i + 1]:
            st = sm[i + 1] - sm[i]
            if st > 0:
                asc += st
            else:
                desc -= st
    valid_idx = [i for i in range(n) if ok[i]]
    ge30 = ge35 = 0.0
    for i in valid_idx:
        if n < 2:
            w = 0.0
        elif i == 0:
            w = (d[1] - d[0]) / 2
        elif i == n - 1:
            w = (d[n - 1] - d[n - 2]) / 2
        else:
            w = (d[i + 1] - d[i - 1]) / 2
        if samples[i]["slope"] >= 30:
            ge30 += w
        if samples[i]["slope"] >= 35:
            ge35 += w
    slope_max = pitch_max = None
    for i in range(n - WIN + 1):
        if not all(ok[i:i + WIN]):
            continue
        mn = min(samples[j]["slope"] for j in range(i, i + WIN))
        if slope_max is None or mn > slope_max:
            slope_max = mn
        p = math.degrees(math.atan(abs(z[i + WIN - 1] - z[i]) / (d[i + WIN - 1] - d[i])))
        if pitch_max is None or p > pitch_max:
            pitch_max = p
    have = bool(valid_idx)
    return {
        "length_m": length_m,
        "net_drop_m": z[valid_idx[0]] - z[valid_idx[-1]] if have else None,
        "cum_descent_m": desc if have else None,
        "cum_ascent_m": asc if have else None,
        "terrain_slope_max": slope_max,
        "len_ge30_m": ge30,
        "len_ge35_m": ge35,
        "pitch_max_deg": pitch_max,
        "pct_by_source": pct,
        "low_confidence": True if n == 0 else (pct["0"] + pct["3"] + pct["4"]) > 25,
        "dem_version": dem_version,
    }


# ---------------------------------------------------------------- CLI
def parse_line(s):
    return [[float(v) for v in pair.split(",")] for pair in s.split(";") if pair.strip()]


def summary(m):
    pct = ", ".join(f"{k}:{v:.0f}%" for k, v in m["pct_by_source"].items() if v > 0)

    def f(v, u=""):
        return "n/a" if v is None else f"{v:.1f}{u}"
    return (f"length {f(m['length_m'], ' m')} | net drop {f(m['net_drop_m'], ' m')} | cum descent {f(m['cum_descent_m'], ' m')} | "
            f"cum ascent {f(m['cum_ascent_m'], ' m')}\n"
            f"terrain slope max {f(m['terrain_slope_max'], ' deg')} | >=30 {f(m['len_ge30_m'], ' m')} | >=35 {f(m['len_ge35_m'], ' m')} | "
            f"pitch max {f(m['pitch_max_deg'], ' deg')}\n"
            f"coverage {pct} | low_confidence {m['low_confidence']} | dem {m['dem_version']}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--line", help='"lon,lat;lon,lat;..."')
    ap.add_argument("--routes", help="routes.json; writes build/route_metrics.json")
    ap.add_argument("--fixture", help="fixture JSON (parity test)")
    ap.add_argument("--json", action="store_true", help="machine-readable output on stdout")
    ap.add_argument("--tiles", help="tiles dir (default web/tiles)")
    ap.add_argument("--out", help="output path for --routes (default build/route_metrics.json)")
    argv = sys.argv[1:]
    for k in range(len(argv) - 1):          # "--line -117.1,49.7;..." starts with "-": glue it as --line=VALUE
        if argv[k] == "--line":
            argv[k:k + 2] = ["--line=" + argv[k + 1]]
            break
    a = ap.parse_args(argv)
    g = Grid(a.tiles)

    if a.line:
        samples, m = profile(g, parse_line(a.line))
        if a.json:
            print(json.dumps({"metrics": m, "samples": samples}))
        else:
            print(summary(m))
    elif a.fixture:
        fx = json.loads(pathlib.Path(a.fixture).read_text(encoding="utf-8"))
        res = {}
        for ln in fx["lines"]:
            samples, m = profile(g, ln["coords"])
            res[ln["name"]] = {"metrics": m, "samples": samples}
        pts = {pt["name"]: sample_point(g, *pt["lonlat"]) for pt in fx.get("points", [])}
        print(json.dumps({"lines": res, "points": pts}))
    elif a.routes:
        app = json.loads(pathlib.Path(a.routes).read_text(encoding="utf-8"))
        out = {}
        for r in app["routes"]:
            e = {}
            for kind in ("descent", "skin"):
                e[kind] = profile(g, r[kind])[1] if len(r.get(kind) or []) >= 2 else None
            out[r["id"]] = e
            if not a.json:
                print(f"{r['id']} {r['name']}")
                for kind in ("descent", "skin"):
                    if e[kind]:
                        print(f"  {kind}: " + summary(e[kind]).replace("\n", "\n    "))
        dest = pathlib.Path(a.out) if a.out else root() / "build" / "route_metrics.json"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps({"dem_version": g.dem_version, "analysis_zoom": g.zoom, "routes": out}, indent=1), encoding="utf-8")
        print(f"wrote {dest}", file=sys.stderr if a.json else sys.stdout)
    else:
        ap.error("give --line, --routes or --fixture")


if __name__ == "__main__":
    main()
