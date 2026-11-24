"""Fetch FWA lakes / streams / glaciers from the BC openmaps WFS (OGL-BC) -> web/data/basemap.geojson."""
import argparse
import json
import re
import time
from pathlib import Path

import pyproj
import requests
from shapely.geometry import mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / "cache" / "wfs"
WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs"
# lon/lat bboxes (W, S, E, N). Pilot = E 484500-490500, N 5509500-5514500 (EPSG:2955) + margin.
SCOPES = {"pilot": (-117.23, 49.73, -117.12, 49.79), "full": (-117.32, 49.55, -117.02, 49.87)}
LAYERS = {"lake": "WHSE_BASEMAPPING.FWA_LAKES_POLY", "creek": "WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP",
          "glacier": "WHSE_BASEMAPPING.GBA_GLACIERS_SP"}  # 2021 Glacier Based Area outlines (dated); FWA_GLACIERS_POLY is undated TRIM
GLACIER_DATE = "TRIM, c. 1980s\u201390s"
to_m = pyproj.Transformer.from_crs(4326, 2955, always_xy=True).transform
to_ll = pyproj.Transformer.from_crs(2955, 4326, always_xy=True).transform


def fetch(kind, bbox, scope):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{kind}_{scope}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    w, s, e, n = bbox
    feats, start = [], 0
    while True:
        params = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "pub:" + LAYERS[kind],
                  "outputFormat": "application/json", "srsName": "EPSG:4326",
                  "bbox": f"{s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326",  # lat,lon axis order
                  "count": 5000, "startIndex": start, "sortBy": "OBJECTID"}
        for attempt in range(4):
            r = requests.get(WFS, params=params, timeout=120)
            if r.ok:
                break
            time.sleep(3 * (attempt + 1))
        r.raise_for_status()
        got = r.json()["features"]
        feats += got
        if len(got) < 5000:
            break
        start += 5000
    f.write_text(json.dumps(feats), encoding="utf-8")
    return feats


def strip_z(g):
    return transform(lambda x, y, z=None: (x, y), g)


def simp(g, tol):
    g = transform(to_ll, strip_z(transform(to_m, strip_z(g))).simplify(tol, preserve_topology=True))
    return g


def rnd(o):
    if isinstance(o, float):
        return round(o, 6)
    if isinstance(o, (list, tuple)):
        return [rnd(v) for v in o]
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=SCOPES, default="pilot")
    a = ap.parse_args()
    bbox = SCOPES[a.scope]
    out, counts = [], {}
    for kind in ("lake", "creek", "glacier"):
        n = 0
        for ft in fetch(kind, bbox, a.scope):
            p = ft["properties"]
            if kind == "creek" and (p.get("STREAM_ORDER") or 0) < 1:
                continue
            g = shape(ft["geometry"])
            if g.is_empty:
                continue
            tol = {"creek": 5, "lake": 3, "glacier": 8}[kind]
            g = simp(g, tol)
            if g.is_empty:
                continue
            props = {"kind": kind}
            name = p.get("GNIS_NAME_1") if kind != "creek" else p.get("GNIS_NAME")
            if name:
                props["name"] = name
                props["order"] = p.get("STREAM_ORDER")
            if kind == "glacier":
                yr = p.get("SOURCE_YEAR")
                props["survey_date"] = (f"{yr} ({p.get('SOURCE_IMAGERY')})" if yr else GLACIER_DATE)
            geom = mapping(g)
            geom = {"type": geom["type"], "coordinates": rnd(geom["coordinates"])}
            out.append({"type": "Feature", "properties": props, "geometry": geom})
            n += 1
        counts[kind] = n
    p = ROOT / "web" / "data" / "basemap.geojson"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"type": "FeatureCollection", "features": out}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(a.scope, counts, f"{p.stat().st_size/1e6:.2f} MB")

    section = ("<!-- basemap:begin -->\n## Basemap vectors\n"
               "- Lakes and streams: BC Freshwater Atlas (FWA_LAKES_POLY, FWA_STREAM_NETWORKS_SP), BC Data Catalogue via openmaps.gov.bc.ca WFS. Contains information licensed under the "
               "Open Government Licence - British Columbia. Retrieved " + time.strftime("%Y-%m-%d") + ", clipped by bbox, "
               "geometry simplified (streams 5 m).\n"
               "- Glacier outlines: BC Glacier Based Area 2021 (WHSE_BASEMAPPING.GBA_GLACIERS_SP, SOURCE_YEAR 2021, "
               "Landsat 8 30 m / Sentinel-2 20 m), BC Data Catalogue, OGL-BC. Replaces the undated FWA_GLACIERS_POLY (TRIM-era). "
               "Outlines are coarse (30 m imagery) and shown with their survey year.\n"
               "<!-- basemap:end -->\n")
    att = ROOT / "web" / "data" / "ATTRIBUTION.md"
    txt = att.read_text(encoding="utf-8") if att.exists() else "# Data attribution\n\n"
    if "<!-- basemap:begin -->" in txt:
        txt = re.sub(r"<!-- basemap:begin -->.*?<!-- basemap:end -->\n", lambda m: section, txt, flags=re.S)
    else:
        txt += "\n" + section
    att.write_text(txt, encoding="utf-8")


if __name__ == "__main__":
    main()
