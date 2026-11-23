"""WS8 route geometry check: profile each descent/skin on the merged analysis DEM.

Usage (from tools/):
  python -m uv run check_routes.py --seeds              # all routes in content/seed/*.json
  python -m uv run check_routes.py --routes <file>      # an App JSON file (e.g. web/data/routes.json)
  ... [--only r26,r34]                                  # limit to these route ids

Per route with a non-empty descent:
  - HARD FAIL  invalid coordinates (not [lon, lat] numbers, outside the project bbox +/-0.05 deg, >6 dp)
  - HARD FAIL  descent goes uphill overall (end elevation >= start elevation)
  - FLAG       descent vertical (start - end) outside +/-30% of the guide figure (descent_m if set, else gain_m)
  - FLAG       part of the line has no DEM coverage (outside the merged terrain)
  - FLAG       descent has a continuous stretch of >= 20 m steeper than 45 deg
Also prints the % of profile samples by quality source (0 missing, 1 lidar 2018, 2 lidar 2017, 3 MRDEM, 4 blend)
per route and overall. Exit code is 1 only on hard failures.
"""
import argparse
import glob
import json
import os
import sys
import types
from collections import Counter

import numpy as np

import terrain_probe as tp

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SEED_DIR = os.path.join(ROOT, "content", "seed")
LON_RANGE = (-117.32, -117.02)  # CONTRACTS.md#app-json rule 2
LAT_RANGE = (49.55, 49.87)
TOL = 0.30
STEP = 5           # terrain_probe profile sample spacing, m
STEEP = 45         # deg; a descent with >= STEEP_RUN_M continuous above this is flagged
STEEP_RUN_M = 20
QNAMES = {0: "missing", 1: "lidar2018", 2: "lidar2017", 3: "MRDEM", 4: "blend"}


def load_routes(args):
    if args.routes:
        with open(args.routes, encoding="utf-8") as f:
            return json.load(f).get("routes", []), args.routes
    routes = []
    for path in sorted(glob.glob(os.path.join(SEED_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            routes.extend(json.load(f).get("routes", []) or [])
    return routes, SEED_DIR


def coord_errors(line, what):
    errs = []
    if not isinstance(line, list) or (len(line) == 1):
        return [f"{what}: must be [] or >=2 points"]
    for i, c in enumerate(line):
        ok = (isinstance(c, list) and len(c) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in c))
        if not ok:
            errs.append(f"{what}[{i}]: not a [lon, lat] number pair")
            continue
        lon, lat = c
        if not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
            errs.append(f"{what}[{i}]: {c} outside project bbox")
        if round(lon, 6) != lon or round(lat, 6) != lat:
            errs.append(f"{what}[{i}]: more than 6 decimal places")
    return errs


def profile(g, line):
    p = tp.cmd_profile(g, types.SimpleNamespace(line=[tuple(c) for c in line]))
    z = np.array([np.nan if s["elev"] is None else s["elev"] for s in p["samples"]], float)
    sl = np.array([np.nan if s["slope"] is None else s["slope"] for s in p["samples"]], float)
    q = [s["quality"] for s in p["samples"]]
    return p["length_m"], z, sl, q


def pct(counter):
    n = sum(counter.values()) or 1
    return " ".join(f"{QNAMES[k]} {100 * v / n:.0f}%" for k, v in sorted(counter.items()) if v)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--seeds", action="store_true", help="check content/seed/*.json")
    src.add_argument("--routes", metavar="FILE", help="check an App JSON file")
    ap.add_argument("--only", default="", help="comma-separated route ids")
    args = ap.parse_args()

    routes, where = load_routes(args)
    if args.only:
        want = {s.strip() for s in args.only.split(",") if s.strip()}
        routes = [r for r in routes if r.get("id") in want]
    print(f"check_routes: {len(routes)} routes from {where}")

    g = tp.Grid()
    hard, flags, ok, skipped = [], [], [], []
    total_q = Counter()
    for r in routes:
        rid = r.get("id", "?")
        desc, skin = r.get("descent") or [], r.get("skin") or []
        errs = coord_errors(desc, "descent") + coord_errors(skin, "skin")
        if errs:
            hard.extend(f"{rid}: {e}" for e in errs)
            print(f"{rid:5s} FAIL  " + "; ".join(errs[:3]) + (" ..." if len(errs) > 3 else ""))
            continue
        if len(desc) < 2:
            skipped.append(rid)
            continue
        route_q = Counter()
        length, z, sl, q = profile(g, desc)
        route_q.update(q)
        msgs, status = [], "OK"
        if not np.isfinite(z[0]) or not np.isfinite(z[-1]):
            status = "FLAG"
            msgs.append("descent start/end outside DEM; vertical not checked")
        else:
            drop = z[0] - z[-1]
            if drop <= 0:
                status = "FAIL"
                msgs.append(f"descent goes uphill overall ({z[0]:.0f} -> {z[-1]:.0f} m)")
            ref_key = "descent_m" if r.get("descent_m") is not None else "gain_m"
            ref = r.get(ref_key)
            vert = f"vertical {drop:.0f} m"
            if ref:
                dev = drop / ref - 1
                vert += f" vs {ref_key} {ref:g} ({dev:+.0%})"
                if abs(dev) > TOL and status != "FAIL":
                    status = "FLAG"
                    msgs.append(f"vertical outside +/-{TOL:.0%}")
            else:
                vert += " (no guide figure)"
            run = best = 0
            for v in sl:  # longest continuous stretch above STEEP (samples are 5 m apart)
                run = run + 1 if v > STEEP else 0
                best = max(best, run)
            steep_m = best * STEP
            msgs.insert(0, f"{z[0]:.0f}->{z[-1]:.0f} m, {vert}, len {length:.0f} m, slope max {np.nanmax(sl):.0f} deg, "
                           f">{STEEP} {np.nanmean(sl > STEEP):.1%}, >=35 {int((sl >= 35).sum()) * STEP} m, "
                           f"longest >{STEEP} {steep_m} m")
            if steep_m >= STEEP_RUN_M and status == "OK":
                status = "FLAG"
                msgs.append(f"{steep_m} m continuous above {STEEP} deg")
            if np.isnan(z).any() and status == "OK":
                status = "FLAG"
                msgs.append(f"{np.isnan(z).mean():.0%} of descent has no DEM")
        if len(skin) >= 2:
            s_len, s_z, s_sl, s_q = profile(g, skin)
            route_q.update(s_q)
            if np.isfinite(s_z).any():
                dz = np.diff(s_z[np.isfinite(s_z)])
                msgs.append(f"skin +{dz[dz > 0].sum():.0f} m, len {s_len:.0f} m, {np.nanmean(s_sl > 25):.0%} >25 deg")
        else:
            msgs.append("no skin")
        total_q.update(route_q)
        msgs.append("quality: " + pct(route_q))
        print(f"{rid:5s} {status:5s} " + "; ".join(msgs))
        if status == "FAIL":
            hard.append(f"{rid}: descent goes uphill overall")
        else:
            (flags if status == "FLAG" else ok).append(rid)

    print(f"summary: {len(ok)} ok, {len(flags)} flagged{' ' + ','.join(flags) if flags else ''}, {len(hard)} hard failures, "
          f"{len(skipped)} empty descents skipped")
    if total_q:
        print("quality by source (all profiled samples): " + pct(total_q))
    if hard:
        print("HARD FAILURES:\n  " + "\n  ".join(hard))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
