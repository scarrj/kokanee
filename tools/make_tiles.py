"""WS1: write XYZ 256 px PNG tiles (dem Terrarium, quality, slope, aspect, elev) + web/tiles/tiles.json.

Run from tools/:  python -m uv run make_tiles.py --scope pilot
Reads build/merged_dem.tif and build/source_mask.tif (from build_terrain.py).

Slope/aspect are Horn 3x3 on the Web-Mercator elevation grid of the *same zoom* (so at z15 they are computed on
exactly what the `dem` tiles decode to; ground cell = mercator pixel * cos(lat of the row)).
"""
import argparse
import datetime
import json
import math
import pathlib
import shutil

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from PIL import Image
from scipy import ndimage as ndi

import terrain_common as tc

R = 6378137.0
ORIGIN = math.pi * R  # 20037508.342789244
TS = 256
ANALYSIS_ZOOM = 15
ZOOMS = {"pilot": {"dem": range(10, 16), "overlay": range(10, 17)},
         "full": {"dem": range(10, 16), "overlay": range(10, 17)}}

HATCH_RGB = (0x9e, 0x9e, 0x9e)
HATCH_ALPHA = 160
SLOPE_ALPHA, ASPECT_ALPHA, ELEV_ALPHA = 150, 130, 110

SLOPE_BANDS = [(27, 30, "#ffe066"), (30, 35, "#ff922b"), (35, 40, "#f03e3e"), (40, 45, "#ae3ec9"), (45, 90, "#343a40")]
ASPECT_SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
ASPECT_COLORS = ["#4263eb", "#15aabf", "#40c057", "#c0d62b", "#f59f00", "#f03e3e", "#cc5de8", "#7048e8"]
QUALITY = [  # code, label, colour, alpha
    (0, "missing", "#9e9e9e", 200),
    (1, "LidarBC 2018 (1 m)", "#2b8a3e", 90),
    (2, "HRDEM lidar 2017 (1 m)", "#74b816", 90),
    (3, "MRDEM-30 fallback (30 m)", "#e8590c", 120),
    (4, "blend zone", "#f08c00", 140),
]
ELEV_MIN, ELEV_STEP, ELEV_N = 1400, 100, 16  # bands 1400-1500 ... 2800-2900; outside values clamp to the end bands
ELEV_ANCHORS = [(1400, "#2b8a3e"), (1800, "#a9c23f"), (2100, "#dcc77c"), (2400, "#b08968"), (2700, "#d9d4cf"), (2900, "#ffffff")]
SOURCES = [
    {"code": 1, "name": "LidarBC 2018", "native_res_m": 1, "vertical": "CGVD28 (probable)"},
    {"code": 2, "name": "NRCan HRDEM lidar 2017 (BC-Kootenay_Columbia)", "native_res_m": 1, "vertical": "CGVD2013"},
    {"code": 3, "name": "NRCan MRDEM-30", "native_res_m": 30, "vertical": "CGVD2013"},
    {"code": 4, "name": "Blend (150 m feather, MRDEM to lidar)", "native_res_m": None, "vertical": "mixed"},
]


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def elev_colors():
    cols = []
    for i in range(ELEV_N):
        z = ELEV_MIN + (i + 0.5) * ELEV_STEP
        for (z0, c0), (z1, c1) in zip(ELEV_ANCHORS[:-1], ELEV_ANCHORS[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / (z1 - z0)
                a, b = np.array(hex_rgb(c0)), np.array(hex_rgb(c1))
                cols.append(tuple(int(round(v)) for v in a + (b - a) * t))
                break
    return cols


def to_hex(rgb):
    return "#%02x%02x%02x" % tuple(rgb)


# ---------------------------------------------------------------- tile grid
def tile_range(bounds_3857, z):
    n = 2 ** z
    ts = 2 * ORIGIN / n
    x0 = int(math.floor((bounds_3857[0] + ORIGIN) / ts))
    x1 = int(math.floor((bounds_3857[2] + ORIGIN) / ts - 1e-9))
    y0 = int(math.floor((ORIGIN - bounds_3857[3]) / ts))
    y1 = int(math.floor((ORIGIN - bounds_3857[1]) / ts - 1e-9))
    return max(x0, 0), min(x1, n - 1), max(y0, 0), min(y1, n - 1), ts


def hatch_mask(h, w):
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx + yy) % 8) < 3


def terrarium(z):
    v = np.where(np.isfinite(z), z + 32768.0, 0.0)
    r = np.floor(v / 256.0)
    g = np.floor(v - r * 256.0)
    b = np.floor((v - np.floor(v)) * 256.0)
    rgb = np.stack([r, g, b], -1).astype("uint8")
    rgb[~np.isfinite(z)] = 0
    return rgb


def classify_overlay(layer, z, slope, aspect, qual, ecols):
    h, w = z.shape
    rgba = np.zeros((h, w, 4), dtype="uint8")
    miss = ~np.isfinite(z)
    if layer == "slope":
        idx = np.digitize(np.nan_to_num(slope, nan=0), [27, 30, 35, 40, 45])  # 0 = <27
        for i, (_, _, c) in enumerate(SLOPE_BANDS, start=1):
            m = idx == i
            rgba[m, :3] = hex_rgb(c)
            rgba[m, 3] = SLOPE_ALPHA
    elif layer == "aspect":
        sec = (((np.nan_to_num(aspect, nan=0) + 22.5) % 360) // 45).astype(int)
        ok = np.isfinite(aspect) & (slope >= 10)
        for i, c in enumerate(ASPECT_COLORS):
            m = ok & (sec == i)
            rgba[m, :3] = hex_rgb(c)
            rgba[m, 3] = ASPECT_ALPHA
    elif layer == "elev":
        idx = np.clip(np.floor((np.nan_to_num(z, nan=ELEV_MIN) - ELEV_MIN) / ELEV_STEP), 0, ELEV_N - 1).astype(int)
        lut = np.array(ecols, dtype="uint8")
        rgba[..., :3] = lut[idx]
        rgba[..., 3] = ELEV_ALPHA
    elif layer == "quality":
        for code, _, c, a in QUALITY:
            m = qual == code
            rgba[m, :3] = hex_rgb(c)
            rgba[m, 3] = a
        rgba[..., 2] = qual  # exact code 0-4 in B (the contract's read-back channel)
        miss = qual == 0
    hm = hatch_mask(h, w)
    if layer == "quality":
        rgba[miss & ~hm, 3] = 0
        rgba[miss, 0], rgba[miss, 1] = HATCH_RGB[0], HATCH_RGB[1]
    else:
        rgba[miss] = 0
        sel = miss & hm
        rgba[sel, :3] = HATCH_RGB
        rgba[sel, 3] = HATCH_ALPHA
    return rgba


def save_png(arr, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path, optimize=True)
    return path.stat().st_size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=list(tc.SCOPES), default="pilot")
    a = ap.parse_args()
    scope = a.scope
    bd = tc.build_dir()
    out_root = tc.web_dir() / "tiles"
    zooms = ZOOMS[scope]

    with rasterio.open(bd / "merged_dem.tif") as s:
        dem = s.read(1).astype("float32")
        dem[dem <= -32768 + 1] = np.nan
        src_tr = s.transform
    with rasterio.open(bd / "source_mask.tif") as s:
        qm = s.read(1)
    bounds = tc.SCOPES[scope]
    b3857 = transform_bounds(tc.CRS, "EPSG:3857", *bounds, densify_pts=21)
    wgs = transform_bounds(tc.CRS, "EPSG:4326", *bounds, densify_pts=21)
    ecols = elev_colors()

    for layer in ("dem", "quality", "slope", "aspect", "elev"):
        shutil.rmtree(out_root / layer, ignore_errors=True)

    sizes = {}  # layer -> zoom -> [bytes, tiles]
    for z in sorted(set(zooms["dem"]) | set(zooms["overlay"])):
        x0, x1, y0, y1, ts = tile_range(b3857, z)
        px = ts / TS
        W, H = (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS
        tr = from_origin(-ORIGIN + x0 * ts, ORIGIN - y0 * ts, px, px)
        res_e = Resampling.bilinear if z >= ANALYSIS_ZOOM else Resampling.average
        res_q = Resampling.nearest if z >= ANALYSIS_ZOOM else Resampling.mode
        zm = np.full((H, W), np.nan, dtype="float32")
        reproject(dem, zm, src_transform=src_tr, src_crs=tc.CRS, src_nodata=np.nan, dst_transform=tr,
                  dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=res_e, num_threads=4)
        qm3 = np.zeros((H, W), dtype="uint8")
        reproject(qm, qm3, src_transform=src_tr, src_crs=tc.CRS, dst_transform=tr, dst_crs="EPSG:3857",
                  src_nodata=None, dst_nodata=0, resampling=res_q, num_threads=4)
        qm3[~np.isfinite(zm)] = 0  # no elevation = missing, whatever the mask says
        # DEM tiles never carry no-data (it spikes the MapLibre terrain mesh): missing cells take the nearest valid
        # elevation. Missingness lives only in the quality tile (code 0). Overlays still hatch code-0 cells.
        zfill = zm
        if np.isnan(zm).any():
            idx = ndi.distance_transform_edt(np.isnan(zm), return_distances=False, return_indices=True)
            zfill = zm[idx[0], idx[1]]
        do_overlay = z in zooms["overlay"]
        slope = aspect = None
        if do_overlay:
            ymid = ORIGIN - y0 * ts - (np.arange(H) + 0.5) * px
            cell = px * np.cos(np.arctan(np.sinh(ymid / R)))
            slope, aspect = tc.horn(zm, cell)
        for ty in range(y0, y1 + 1):
            for tx in range(x0, x1 + 1):
                sl = (slice((ty - y0) * TS, (ty - y0 + 1) * TS), slice((tx - x0) * TS, (tx - x0 + 1) * TS))
                zt = zm[sl]
                if not np.isfinite(zt).any():
                    continue  # tile entirely outside the data: not written (404 = transparent)
                if z in zooms["dem"]:
                    n = save_png(terrarium(zfill[sl]), out_root / "dem" / str(z) / str(tx) / f"{ty}.png")
                    s_ = sizes.setdefault("dem", {}).setdefault(z, [0, 0]); s_[0] += n; s_[1] += 1
                if do_overlay:
                    for layer in ("quality", "slope", "aspect", "elev"):
                        rgba = classify_overlay(layer, zt, slope[sl], aspect[sl], qm3[sl], ecols)
                        n = save_png(rgba, out_root / layer / str(z) / str(tx) / f"{ty}.png")
                        s_ = sizes.setdefault(layer, {}).setdefault(z, [0, 0]); s_[0] += n; s_[1] += 1
        print(f"z{z}: tiles x{x0}-{x1} y{y0}-{y1}", {l: sizes[l][z][1] for l in sizes if z in sizes[l]})

    # ---- manifest
    meta = json.loads((bd / "build_meta.json").read_text())
    ver = f"{datetime.date.today():%Y-%m}-{scope}"
    dz, oz = zooms["dem"], zooms["overlay"]
    slope_leg = [{"min": lo, "max": hi if hi < 90 else None, "color": c,
                  "label": f"{lo}–{hi}°" if hi < 90 else f"≥{lo}°"} for lo, hi, c in SLOPE_BANDS]
    elev_leg = []
    for i, c in enumerate(ecols):
        lo, hi = ELEV_MIN + i * ELEV_STEP, ELEV_MIN + (i + 1) * ELEV_STEP
        elev_leg.append({"min": None if i == 0 else lo, "max": None if i == ELEV_N - 1 else hi, "color": to_hex(c),
                         "label": f"<{hi:,} m" if i == 0 else (f"≥{lo:,} m" if i == ELEV_N - 1 else f"{lo:,}–{hi:,} m")})
    tiles_json = {
        "dem_version": ver,
        "bounds": [round(v, 6) for v in wgs],
        "layers": {
            "dem": {"minzoom": min(dz), "maxzoom": max(dz), "encoding": "terrarium"},
            "quality": {"minzoom": min(oz), "maxzoom": max(oz), "encoding": "rgba", "code_channel": "B"},
            "slope": {"minzoom": min(oz), "maxzoom": max(oz), "encoding": "rgba"},
            "aspect": {"minzoom": min(oz), "maxzoom": max(oz), "encoding": "rgba"},
            "elev": {"minzoom": min(oz), "maxzoom": max(oz), "encoding": "rgba"},
        },
        "analysis_zoom": ANALYSIS_ZOOM,
        "legends": {
            "slope": slope_leg,
            "aspect": [{"sector": s, "color": c} for s, c in zip(ASPECT_SECTORS, ASPECT_COLORS)],
            "elev": elev_leg,
            "quality": [{"code": c, "label": l, "color": col, "alpha": al} for c, l, col, al in QUALITY],
            "nodata": {"color": to_hex(HATCH_RGB), "alpha": HATCH_ALPHA, "pattern": "hatch-45", "label": "No data"},
            "clear": {"slope": "<27°", "aspect": "slope <10° (flat)"},
        },
        "sources": [dict(s) for s in SOURCES],
        "grid": {"crs": tc.CRS, "res_m": tc.RES, "bounds_2955": list(bounds), "feather_m": meta["feather_m"],
                 "tile_slope": "Horn 3x3 on the Web-Mercator grid of the same zoom; ground cell = mercator px * cos(lat)"},
    }
    tiles_json["sources"][3]["name"] = f"Blend ({meta['feather_m']} m feather, MRDEM to lidar)"
    (out_root / "tiles.json").write_text(json.dumps(tiles_json, indent=1, ensure_ascii=False), encoding="utf-8")

    # ---- sizes
    table = {l: {str(z): {"bytes": v[0], "tiles": v[1], "mb": round(v[0] / 1e6, 3)} for z, v in sorted(zs.items())} for l, zs in sizes.items()}
    (bd / "tile_sizes.json").write_text(json.dumps(table, indent=1))
    zs_all = sorted({int(z) for l in table.values() for z in l})
    lines = ["| Layer | " + " | ".join(f"z{z}" for z in zs_all) + " | total |", "|---|" + "---|" * (len(zs_all) + 1)]
    for l in ("dem", "quality", "slope", "aspect", "elev"):
        cells = []
        for z in zs_all:
            e = table.get(l, {}).get(str(z))
            cells.append(f"{e['mb']:.2f} MB ({e['tiles']})" if e else "-")
        tot = sum(e["bytes"] for e in table.get(l, {}).values()) / 1e6
        lines.append(f"| {l} | " + " | ".join(cells) + f" | {tot:.2f} MB |")
    grand = sum(e["bytes"] for l in table.values() for e in l.values()) / 1e6
    section = (f"<!-- tile-sizes:{scope} -->\n## Tile sizes ({scope}, MB per layer per zoom; tile count in brackets)\n\n"
               + "\n".join(lines) + f"\n\nTotal {grand:.2f} MB. Written by `tools/make_tiles.py`.\n<!-- /tile-sizes -->\n")
    rp = tc.decisions_dir() / "seam-report.md"
    txt = rp.read_text(encoding="utf-8") if rp.exists() else ""
    if "<!-- tile-sizes:" in txt:
        pre = txt[:txt.index("<!-- tile-sizes:")]
        post = txt[txt.index("<!-- /tile-sizes -->") + len("<!-- /tile-sizes -->\n"):]
        txt = pre + section + post
    else:
        txt = txt.rstrip("\n") + "\n\n" + section
    rp.write_text(txt, encoding="utf-8")
    print("\n".join(lines)); print(f"total {grand:.2f} MB; version {ver}")


if __name__ == "__main__":
    main()
