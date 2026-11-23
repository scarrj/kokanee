"""Validate an App JSON file (routes.json) against CONTRACTS.md#app-json rules 1-8.

Usage: python -m uv run validate_routes.py <file>   (exit 0 = PASS, 1 = errors)
"""
import json
import re
import sys

ZONE_RE = re.compile(r"^z-[a-z0-9-]+$")
ROUTE_RE = re.compile(r"^(r\d{2}|si\d|u-[a-z0-9]+)$")
POI_RE = re.compile(r"^[a-z0-9-]+$")
AREA_RE = re.compile(r"^a-[a-z0-9-]+$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
POI_TYPES = {"hut", "helipad", "peak", "pass", "lake", "landmark"}
AREA_KINDS = {"closure", "no-go", "note"}
CONFIDENCE = {"low", "medium", "high"}
LON_MIN, LON_MAX = -117.32, -117.02
LAT_MIN, LAT_MAX = 49.55, 49.87
ROUTE_FIELDS = ["id", "num", "zone", "name", "time", "gain_m", "descent_m", "description",
                "notes", "approx", "confidence", "descent", "skin"]
ZONE_FIELDS = ["id", "name", "color", "info_point", "description", "source"]
POI_FIELDS = ["id", "name", "type", "coord", "description"]
AREA_FIELDS = ["id", "name", "kind", "polygon", "description", "source", "valid_from", "valid_to"]


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check_coord(c, where, errs):
    if not (isinstance(c, list) and len(c) == 2 and all(_is_num(x) for x in c)):
        errs.append(f"{where}: coordinate must be [lon, lat] numbers")
        return
    lon, lat = c
    if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
        errs.append(f"{where}: coordinate {c} outside project bbox")
    for v in c:
        if round(v, 6) != v:
            errs.append(f"{where}: coordinate {c} has more than 6 decimal places")
            break


def _check_line(line, where, errs):
    if not isinstance(line, list):
        errs.append(f"{where}: must be a list")
        return
    if len(line) == 1:
        errs.append(f"{where}: must be [] or at least 2 points")
    for i, c in enumerate(line):
        _check_coord(c, f"{where}[{i}]", errs)


def _check_fields(obj, fields, where, errs):
    for f in fields:
        if f not in obj:
            errs.append(f"{where}: missing field '{f}'")


def _check_unique(items, where, errs):
    seen = set()
    for it in items:
        i = it.get("id")
        if i in seen:
            errs.append(f"{where}: duplicate id '{i}'")
        seen.add(i)


def validate(app, full=None):
    """Return a list of error strings (empty = valid).

    full: True to apply full-assembly rules (info_point required for routed zones).
    Defaults to 'not app.get("pilot")'.
    """
    errs = []
    if full is None:
        full = not app.get("pilot")
    if not isinstance(app, dict):
        return ["root: must be an object"]

    # Rule 1
    for k in ["schema_version", "content_rev", "published_at", "dem_version", "zones", "routes", "pois", "areas"]:
        if k not in app:
            errs.append(f"root: missing required key '{k}'")
    if errs:
        return errs
    sv = app["schema_version"]
    if not (isinstance(sv, int) and not isinstance(sv, bool) and sv >= 1):
        errs.append("schema_version must be an integer >= 1")
    cr = app["content_rev"]
    if not (isinstance(cr, int) and not isinstance(cr, bool) and cr >= 0):
        errs.append("content_rev must be an integer >= 0")
    if cr == 0 and app.get("pilot") is not True:
        errs.append("content_rev 0 is only allowed when pilot is true")
    if not isinstance(app["published_at"], str):
        errs.append("published_at must be a string")
    if not isinstance(app["dem_version"], str):
        errs.append("dem_version must be a string")
    for k in ["zones", "routes", "pois", "areas"]:
        if not isinstance(app[k], list):
            errs.append(f"{k} must be a list")
    if errs:
        return errs

    zones, routes, pois, areas = app["zones"], app["routes"], app["pois"], app["areas"]

    # Rule 3 (ids unique, patterns)
    _check_unique(zones, "zones", errs)
    _check_unique(routes, "routes", errs)
    _check_unique(pois, "pois", errs)
    _check_unique(areas, "areas", errs)
    zone_ids = set()
    routed_zones = set()
    for z in zones:
        zid = z.get("id", "")
        if not ZONE_RE.match(str(zid)):
            errs.append(f"zone '{zid}': bad id")
        zone_ids.add(zid)
        _check_fields(z, ZONE_FIELDS, f"zone '{zid}'", errs)
        if z.get("color") is not None and not HEX_RE.match(str(z.get("color"))):
            errs.append(f"zone '{zid}': color must be #rrggbb")
        for f in ["name", "description", "source"]:
            if f in z and not isinstance(z[f], str):
                errs.append(f"zone '{zid}': {f} must be a string")
    for r in routes:
        routed_zones.add(r.get("zone"))
    for z in zones:
        zid = z.get("id")
        # Rule 7
        ip = z.get("info_point", None)
        if ip is not None:
            _check_coord(ip, f"zone '{zid}' info_point", errs)
        elif full and zid in routed_zones:
            errs.append(f"zone '{zid}': info_point required for a full assembly")

    for r in routes:
        rid = r.get("id", "")
        if not ROUTE_RE.match(str(rid)):
            errs.append(f"route '{rid}': bad id")
        _check_fields(r, ROUTE_FIELDS, f"route '{rid}'", errs)
        # Rule 4
        if r.get("zone") not in zone_ids:
            errs.append(f"route '{rid}': zone '{r.get('zone')}' does not exist")
        # Rule 5
        _check_line(r.get("descent", []), f"route '{rid}' descent", errs)
        _check_line(r.get("skin", []), f"route '{rid}' skin", errs)
        # Rule 6
        if r.get("confidence") not in CONFIDENCE:
            errs.append(f"route '{rid}': confidence must be low|medium|high")
        # Rule 8
        for f in ["gain_m", "descent_m"]:
            v = r.get(f, None)
            if v is not None and not _is_num(v):
                errs.append(f"route '{rid}': {f} must be a number or null")
        for f in ["num", "name", "time", "description", "notes", "zone"]:
            if f in r and not isinstance(r[f], str):
                errs.append(f"route '{rid}': {f} must be a string")

    for p in pois:
        pid = p.get("id", "")
        if not POI_RE.match(str(pid)):
            errs.append(f"poi '{pid}': bad id")
        _check_fields(p, POI_FIELDS, f"poi '{pid}'", errs)
        if p.get("type") not in POI_TYPES:
            errs.append(f"poi '{pid}': type must be one of {sorted(POI_TYPES)}")
        if "coord" in p:
            _check_coord(p["coord"], f"poi '{pid}' coord", errs)

    for a in areas:
        aid = a.get("id", "")
        if not AREA_RE.match(str(aid)):
            errs.append(f"area '{aid}': bad id")
        _check_fields(a, AREA_FIELDS, f"area '{aid}'", errs)
        if a.get("kind") not in AREA_KINDS:
            errs.append(f"area '{aid}': kind must be one of {sorted(AREA_KINDS)}")
        for ri, ring in enumerate(a.get("polygon", []) or []):
            where = f"area '{aid}' ring {ri}"
            if not isinstance(ring, list) or len(ring) < 4:
                errs.append(f"{where}: outer ring needs at least 4 points")
                continue
            for i, c in enumerate(ring):
                _check_coord(c, f"{where}[{i}]", errs)
            if ring[0] != ring[-1]:
                errs.append(f"{where}: first and last point must match")

    return errs


def main(argv):
    if len(argv) != 2:
        print("usage: validate_routes.py <file>", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as f:
        app = json.load(f)
    errs = validate(app)
    if errs:
        for e in errs:
            print("ERROR:", e)
        print("FAIL")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
