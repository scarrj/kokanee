"""WS10: offline Sentinel-2 L2A true-colour tiles (z10-14, 256 px JPEG) for the project bbox.

Usage:  cd tools && python -m uv run make_satellite.py [--year-span 3] [--refresh]

Steps: STAC search (Earth Search, public) -> pick the clearest/lowest-snow acquisition date by SCL
over the bbox -> windowed COG reads of B04/B03/B02 (+SCL) cached in tools/cache/sat/ -> fixed
global stretch -> reproject to Web Mercator -> JPEG tiles + web/tiles/sat/sat.json.
Display only; never used by metrics. Writes only web/tiles/sat/.
"""
import argparse
import datetime as dt
import json
import math
import pathlib
import shutil
import sys

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio import windows
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds

import terrain_common as tc

STAC_URL = "https://earth-search.aws.element84.com/v1"
ZMIN, ZMAX = 10, 14
TS = 256
R = 6378137.0
ORIGIN = math.pi * R
MARGIN_M = 2000.0      # imagery kept beyond the bbox (so edge tiles are not half empty)
FILL_RGB = (27, 31, 35)  # neutral dark fill outside the data (JPEG has no alpha)
GAMMA = 1.2
P_LO, P_HI = 2.0, 99.0  # fixed global percentiles of the mosaic (not per tile)
JPEG_Q = 80
DEFAULT_DATE = "2024-09-05"  # eyeballed vs 2024-08-31, 2025-09-05/20/25: clearest, dark lakes, 0.75% snow
BAD_SCL = (3, 8, 9, 10)  # cloud shadow, cloud medium/high prob, thin cirrus
SNOW_SCL = 11
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2")


def cache_sat() -> pathlib.Path:
    p = tc.cache_dir() / "sat"
    p.mkdir(parents=True, exist_ok=True)
    return p


def project_bbox():
    """WGS84 [w, s, e, n] from the full-scope tiles.json (falls back to the 2955 full scope)."""
    tj = tc.web_dir() / "tiles" / "tiles.json"
    if tj.exists():
        b = json.loads(tj.read_text("utf-8")).get("bounds")
        if b and all(isinstance(v, (int, float)) for v in b):
            return list(b)
    return list(transform_bounds(tc.CRS, "EPSG:4326", *tc.SCOPES["full"], densify_pts=21))


def tile_range(b3857, z):
    n = 2 ** z
    ts = 2 * ORIGIN / n
    x0 = int(math.floor((b3857[0] + ORIGIN) / ts))
    x1 = int(math.floor((b3857[2] + ORIGIN) / ts - 1e-9))
    y0 = int(math.floor((ORIGIN - b3857[3]) / ts))
    y1 = int(math.floor((ORIGIN - b3857[1]) / ts - 1e-9))
    return max(x0, 0), min(x1, n - 1), max(y0, 0), min(y1, n - 1), ts


# ---------------------------------------------------------------- scene search / choice
def search_scenes(bbox, years):
    from pystac_client import Client
    cli = Client.open(STAC_URL)
    items = {}
    for y in years:
        s = cli.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{y}-07-01/{y}-09-30",
                       query={"eo:cloud_cover": {"lt": 10}}, max_items=500)
        for it in s.items():
            items[it.id] = it
    return items


def snap(v, step, up):
    return (math.ceil if up else math.floor)(v / step) * step


def read_window(href, bounds, res, cache_key, dtype, resampling=Resampling.nearest):
    """Read `bounds` (in the asset CRS, snapped to the asset grid) boundlessly; cached as .npy."""
    f = cache_sat() / f"{cache_key}.npy"
    if f.exists():
        return np.load(f)
    with rasterio.Env(**GDAL_ENV), rasterio.open(href) as ds:
        win = windows.from_bounds(*bounds, transform=ds.transform)
        win = windows.Window(round(win.col_off), round(win.row_off), round(win.width), round(win.height))
        a = ds.read(1, window=win, boundless=True, fill_value=0)
    a = a.astype(dtype)
    np.save(f, a)
    return a


def scene_grid(bbox):
    """10 m grid in EPSG:32611 covering bbox + margin, snapped to 20 m (so SCL aligns)."""
    t = Transformer.from_crs("EPSG:4326", "EPSG:32611", always_xy=True)
    xs, ys = [], []
    for lo in (bbox[0], bbox[2]):
        for la in (bbox[1], bbox[3]):
            x, y = t.transform(lo, la)
            xs.append(x)
            ys.append(y)
    b = (snap(min(xs) - MARGIN_M, 20, False), snap(min(ys) - MARGIN_M, 20, False),
         snap(max(xs) + MARGIN_M, 20, True), snap(max(ys) + MARGIN_M, 20, True))
    return b


def bbox_mask(bbox, gb, res):
    """Boolean mask (rows north-first) of pixels inside the bbox at resolution res."""
    w, h = int(round((gb[2] - gb[0]) / res)), int(round((gb[3] - gb[1]) / res))
    tr = from_origin(gb[0], gb[3], res, res)
    t = Transformer.from_crs("EPSG:32611", "EPSG:4326", always_xy=True)
    cols = np.arange(w) + 0.5
    rows = np.arange(h) + 0.5
    X = gb[0] + cols * res
    Y = gb[3] - rows * res
    XX, YY = np.meshgrid(X, Y)
    lo, la = t.transform(XX, YY)
    return (lo >= bbox[0]) & (lo <= bbox[2]) & (la >= bbox[1]) & (la <= bbox[3])


def scl_for(item, gb):
    return read_window(item.assets["scl"].href, gb, 20, f"{item.id}_scl", "uint8")


def evaluate_dates(items, gb, inside20):
    by_date = {}
    for it in items.values():
        by_date.setdefault(it.datetime.date().isoformat(), []).append(it)
    out = []
    for d, its in sorted(by_date.items()):
        scl = None
        for it in its:
            a = scl_for(it, gb)
            scl = a if scl is None else np.where(scl == 0, a, scl)
        v = scl[inside20]
        n = v.size
        cover = float((v != 0).mean())
        bad = float(np.isin(v, BAD_SCL).mean())
        snow = float((v == SNOW_SCL).mean())
        out.append(dict(date=d, items=its, cover=cover, bad=bad, snow=snow))
        print(f"  {d} scenes={[i.id.split('_')[1] for i in its]} cover={cover*100:.2f}% "
              f"cloud/shadow={bad*100:.3f}% snow={snow*100:.2f}% (n={n})")
    return out


def pick(cands):
    ok = [c for c in cands if c["cover"] >= 0.995]
    if not ok:
        raise SystemExit("no date covers the bbox; widen the search")
    # lowest cloud/shadow first, then lowest snow; slight preference for dates later in the season
    return sorted(ok, key=lambda c: (round(c["bad"] * 100, 1), c["snow"], c["date"]))


def load_mosaic(cand, gb):
    """RGB reflectance (float32 0-1, 3xHxW at 10 m) + valid mask + bad mask for one date."""
    w, h = int(round((gb[2] - gb[0]) / 10)), int(round((gb[3] - gb[1]) / 10))
    rgb = np.zeros((3, h, w), dtype="float32")
    valid = np.zeros((h, w), dtype=bool)
    bad = np.zeros((h, w), dtype=bool)
    for it in cand["items"]:
        bands = []
        for k in ("red", "green", "blue"):
            bands.append(read_window(it.assets[k].href, gb, 10, f"{it.id}_{k}", "uint16"))
        dn = np.stack(bands)
        ok = (dn > 0).all(axis=0)
        scl20 = scl_for(it, gb)
        scl = np.repeat(np.repeat(scl20, 2, axis=0), 2, axis=1)[:h, :w]
        # Earth Search flags scenes whose +1000 BOA offset is already removed from the DN
        off = 0.0 if it.properties.get("earthsearch:boa_offset_applied") else -0.1
        refl = np.clip(dn.astype("float32") * 0.0001 + off, 0, None)
        take = ok & ~valid
        rgb[:, take] = refl[:, take]
        bad[take] = np.isin(scl[take], BAD_SCL)
        valid |= ok
        del dn, refl
    return rgb, valid, bad


# ---------------------------------------------------------------- tiling
def stretch(rgb, valid, bad):
    sample = rgb[:, valid & ~bad][:, ::7]
    lo = float(np.percentile(sample, P_LO))
    hi = float(np.percentile(sample, P_HI))
    return lo, hi


def apply_stretch(rgb, lo, hi):
    x = np.clip((rgb - lo) / (hi - lo), 0, 1)
    return np.power(x, 1.0 / GAMMA).astype("float32")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year-span", type=int, default=3)
    ap.add_argument("--date", default=DEFAULT_DATE,
                    help="acquisition date YYYY-MM-DD (must be in the search result); '' = best SCL score. "
                         "Default is the visually QA'd choice: 2025-09-20 scores best on SCL but has "
                         "valley haze/fog that SCL misses.")
    a = ap.parse_args()

    bbox = project_bbox()
    print("bbox", bbox)
    this_year = dt.date.today().year
    years = list(range(this_year - a.year_span + 1, this_year + 1))
    items = search_scenes(bbox, years)
    print(f"{len(items)} candidate scenes (cloud<10%, Jul-Sep {years[0]}-{years[-1]})")
    gb = scene_grid(bbox)
    print("source grid EPSG:32611", gb)
    inside20 = bbox_mask(bbox, gb, 20)
    cands = evaluate_dates(items, gb, inside20)
    ranked = pick(cands)
    if a.date:
        ranked = [c for c in ranked if c["date"] == a.date] or ranked
    best = ranked[0]
    print("chosen:", best["date"], [i.id for i in best["items"]],
          f"cloud/shadow {best['bad']*100:.3f}% snow {best['snow']*100:.2f}%")
    rgb, valid, bad = load_mosaic(best, gb)
    used = list(best["items"])
    inside10 = bbox_mask(bbox, gb, 10)
    badfrac = float((bad & inside10).sum() / inside10.sum())
    if badfrac > 0.002 and len(ranked) > 1:  # fill clouds from the next-best date
        alt = ranked[1]
        rgb2, valid2, bad2 = load_mosaic(alt, gb)
        fix = (bad | ~valid) & valid2 & ~bad2
        rgb[:, fix] = rgb2[:, fix]
        valid |= fix
        bad = (bad & ~fix)
        used += list(alt["items"])
        print("filled", int(fix.sum()), "px from", alt["date"])
    dates = sorted({i.datetime.date().isoformat() for i in used})
    date_str = dates[0] if len(dates) == 1 else f"{dates[0]}/{dates[-1]}"
    lo, hi = stretch(rgb, valid, bad)
    print(f"fixed stretch: reflectance {lo:.4f}..{hi:.4f}, gamma {GAMMA}")
    img = apply_stretch(rgb, lo, hi)
    del rgb
    src_tr = from_origin(gb[0], gb[3], 10, 10)

    out = tc.web_dir() / "tiles" / "sat"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True, exist_ok=True)

    b3857 = transform_bounds("EPSG:4326", "EPSG:3857", *bbox, densify_pts=21)
    sizes = {}
    fill = np.array(FILL_RGB, dtype="float32").reshape(3, 1, 1) / 255.0
    for z in range(ZMIN, ZMAX + 1):
        x0, x1, y0, y1, ts = tile_range(b3857, z)
        px = ts / TS
        W, H = (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS
        tr = from_origin(-ORIGIN + x0 * ts, ORIGIN - y0 * ts, px, px)
        res = Resampling.bilinear if z >= ZMAX else Resampling.average
        dst = np.zeros((3, H, W), dtype="float32")
        reproject(img, dst, src_transform=src_tr, src_crs="EPSG:32611", dst_transform=tr,
                  dst_crs="EPSG:3857", resampling=res, num_threads=4)
        vm = np.zeros((1, H, W), dtype="float32")
        reproject(valid.astype("float32")[None], vm, src_transform=src_tr, src_crs="EPSG:32611",
                  dst_transform=tr, dst_crs="EPSG:3857", resampling=Resampling.bilinear, num_threads=4)
        m = np.clip(vm * 1.0, 0, 1)
        # blend toward the fill where data is missing; fully-covered pixels are unchanged
        dst = np.where(m > 0.999, dst, dst * m + fill * (1 - m))
        arr = np.clip(np.rint(dst * 255), 0, 255).astype("uint8").transpose(1, 2, 0)
        zb, zn = 0, 0
        for ty in range(y0, y1 + 1):
            for tx in range(x0, x1 + 1):
                t = arr[(ty - y0) * TS:(ty - y0 + 1) * TS, (tx - x0) * TS:(tx - x0 + 1) * TS]
                d = out / str(z) / str(tx)
                d.mkdir(parents=True, exist_ok=True)
                p = d / f"{ty}.jpg"
                Image.fromarray(t, "RGB").save(p, "JPEG", quality=JPEG_Q, optimize=True)
                zb += p.stat().st_size
                zn += 1
        sizes[z] = (zn, zb)
        print(f"z{z}: {zn} tiles, {zb/1e6:.2f} MB")

    meta = {"minzoom": ZMIN, "maxzoom": ZMAX, "bounds": [round(v, 6) for v in bbox],
            "date": date_str, "scenes": [i.id for i in used],
            "attribution": f"Contains modified Copernicus Sentinel data {dates[0][:4]}"}
    (out / "sat.json").write_text(json.dumps(meta, indent=1) + "\n", "utf-8")
    tot = sum(b for _, b in sizes.values())
    print(f"total {sum(n for n, _ in sizes.values())} tiles, {tot/1e6:.2f} MB; sat.json written")
    ATTR = tc.web_dir() / "data" / "ATTRIBUTION.md"
    update_attribution(ATTR, meta)


def update_attribution(path, meta):
    begin, end = "<!-- sentinel2:begin -->", "<!-- sentinel2:end -->"
    block = (f"{begin}\n## Satellite imagery (Sentinel-2)\n"
             f"- {meta['attribution']}. Sentinel-2 L2A (B04/B03/B02, 10 m) via Element 84 Earth Search "
             f"(public STAC/COGs), acquisition {meta['date']}, scenes {', '.join(meta['scenes'])}. "
             f"Fixed true-colour stretch, resampled to Web Mercator JPEG tiles z{meta['minzoom']}-{meta['maxzoom']}. "
             f"Display only (not used for any metric). Copernicus Sentinel data is free and open.\n{end}\n")
    txt = path.read_text("utf-8") if path.exists() else "# Data attribution\n\n"
    if begin in txt and end in txt:
        i, j = txt.index(begin), txt.index(end) + len(end)
        txt = txt[:i] + block.rstrip("\n") + txt[j:]
    else:
        txt = txt.rstrip("\n") + "\n\n" + block
    path.write_text(txt, "utf-8")


if __name__ == "__main__":
    sys.exit(main())
