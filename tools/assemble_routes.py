"""Assemble web/data/routes.json from content/seed/*.json (one-time, CONTRACTS.md#app-json).

Usage:
  python -m uv run assemble_routes.py [--pilot] [--force] [--only r26,r34]

--pilot   content_rev 0, "pilot": true, seeds stay in place.
          Without it: content_rev 1 and the seeds move to content/archive/.
--only    keep only these route ids, their zones, and z-hut (all pois and areas kept).
--force   overwrite an existing routes.json (backed up to build/routes.backup.<ts>.json).
"""
import argparse
import datetime as dt
import glob
import json
import os
import shutil
import sys

from validate_routes import validate

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SEED_DIR = os.path.join(ROOT, "content", "seed")
ARCHIVE_DIR = os.path.join(ROOT, "content", "archive")
OUT = os.path.join(ROOT, "web", "data", "routes.json")
TILES = os.path.join(ROOT, "web", "tiles", "tiles.json")
BUILD = os.path.join(ROOT, "build")


def load_seeds():
    zones, routes, pois, areas = [], [], [], []
    files = sorted(glob.glob(os.path.join(SEED_DIR, "*.json")))
    for path in files:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        zone = data.get("zone")  # _pois.json has no zone key, so it counts as zone null
        if zone is not None:
            zones.append(zone)
        routes.extend(data.get("routes", []) or [])
        pois.extend(data.get("pois", []) or [])
        areas.extend(data.get("areas", []) or [])
    return files, zones, routes, pois, areas


def dem_version():
    if os.path.exists(TILES):
        with open(TILES, encoding="utf-8") as f:
            return json.load(f).get("dem_version", "none")
    return "none"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pilot", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    files, zones, routes, pois, areas = load_seeds()

    if args.only:
        wanted = [s.strip() for s in args.only.split(",") if s.strip()]
        known = {r["id"] for r in routes}
        missing = [w for w in wanted if w not in known]
        if missing:
            print(f"ERROR: unknown route ids: {missing}", file=sys.stderr)
            return 1
        routes = [r for r in routes if r["id"] in set(wanted)]
        keep_zones = {r["zone"] for r in routes} | {"z-hut"}
        zones = [z for z in zones if z["id"] in keep_zones]

    app = {
        "schema_version": 1,
        "content_rev": 0 if args.pilot else 1,
        "published_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dem_version": dem_version(),
    }
    if args.pilot:
        app["pilot"] = True
    app.update({"zones": zones, "routes": routes, "pois": pois, "areas": areas})

    errs = validate(app, full=not args.pilot)
    if errs:
        for e in errs:
            print("ERROR:", e, file=sys.stderr)
        print("Assembly aborted: validation failed.", file=sys.stderr)
        return 1

    if os.path.exists(OUT):
        if not args.force:
            print(f"ERROR: {OUT} exists; rerun with --force to replace it.", file=sys.stderr)
            return 3
        os.makedirs(BUILD, exist_ok=True)
        ts = dt.datetime.now().strftime("%Y%m%d%H%M%S")
        backup = os.path.join(BUILD, f"routes.backup.{ts}.json")
        shutil.copy2(OUT, backup)
        print(f"Backed up previous routes.json to {backup}")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(app, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Wrote {OUT}: {len(zones)} zones, {len(routes)} routes, {len(pois)} pois, {len(areas)} areas")

    if not args.pilot:
        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        for path in files:
            shutil.move(path, os.path.join(ARCHIVE_DIR, os.path.basename(path)))
        print(f"Moved {len(files)} seed files to {ARCHIVE_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
