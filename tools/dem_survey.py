"""Phase 0c: compare candidate DEM sources against the actual gaps.

Reads each source (window reads only, no bulk download) onto a common UTM11N grid and writes:
  docs/decisions/dem-coverage.png        coverage map of the project bbox, per source
  docs/decisions/dem-hillshade-compare.png  hillshade crops per source at 4 test sites
  build/dem_survey.json                  coverage fractions and native resolutions
Run from tools/:  uv run dem_survey.py
"""
import json, os, pathlib
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from pystac_client import Client
from PIL import Image, ImageDraw, ImageFont

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("VSI_CACHE", "TRUE")
ROOT = pathlib.Path(__file__).resolve().parent.parent
DEC = ROOT / "docs" / "decisions"; BUILD = ROOT / "build"
DEC.mkdir(parents=True, exist_ok=True); BUILD.mkdir(exist_ok=True)
CRS = "EPSG:2955"
BBOX = (480500, 5494500, 494500, 5519000)  # E0, N0, E1, N1 (UTM11N NAD83(CSRS))
LL_BBOX = [-117.27, 49.60, -117.07, 49.82]
SITES = {  # name: (E, N) centre; 2 km windows
    "Cabin / Kaslo Lake": (485970, 5513000),
    "Tanal west face": (485300, 5514600),
    "Kokanee Glacier": (489300, 5511600),
    "Western gap (Giegerich / R. Smith)": (483800, 5512600),
}

def sources():
    cat = Client.open("https://datacube.services.geo.ca/stac/api/")
    out = [("LidarBC 2018 (local, 1 m)", [str(p) for p in sorted((ROOT / "1m_tif_data").glob("*.tif"))], 1.0)]
    for col, res in [("hrdem-lidar", None), ("hrdem-mosaic-2m", 2.0), ("mrdem-30", 30.0)]:
        for it in cat.search(collections=[col], bbox=LL_BBOX).items():
            r = res or float(it.id.rsplit("-", 1)[-1].rstrip("m") or 1)
            out.append((f"NRCan {col}: {it.id}", [it.assets["dtm"].href], r))
    return out

def read_grid(paths, res, bounds, shape=None):
    """Mosaic of paths warped to a UTM grid at `res` m over bounds. NaN = no data."""
    e0, n0, e1, n1 = bounds
    w, h = shape or (int((e1 - e0) / res), int((n1 - n0) / res))
    tr = from_origin(e0, n1, (e1 - e0) / w, (n1 - n0) / h)
    acc = np.full((h, w), np.nan, dtype="float32")
    for p in paths:
        with rasterio.open(p) as src:
            nd = src.nodata if src.nodata is not None else -32767
            with WarpedVRT(src, crs=CRS, transform=tr, width=w, height=h, resampling=Resampling.bilinear,
                           src_nodata=nd, nodata=np.nan, dtype="float32") as vrt:
                a = vrt.read(1)
        a[(a < -1000) | (a > 9000)] = np.nan
        acc = np.where(np.isnan(acc), a, acc)
    return acc

def hillshade(z, res, az=315, alt=45):
    gy, gx = np.gradient(np.nan_to_num(z, nan=np.nanmean(z) if np.isfinite(z).any() else 0), res)
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    a, b = np.radians(az), np.radians(alt)
    hs = np.sin(b) * np.cos(slope) + np.cos(b) * np.sin(slope) * np.cos(a - aspect)
    img = np.clip(hs * 255, 0, 255).astype("uint8")
    rgb = np.stack([img] * 3, -1)
    rgb[np.isnan(z)] = (230, 120, 120)  # no data = pink
    return rgb

def main():
    srcs = sources()
    stats = {}
    # --- coverage at 50 m
    cov_imgs = []
    for name, paths, res in srcs:
        g = read_grid(paths, 50, BBOX)
        frac = float(np.isfinite(g).mean())
        stats[name] = {"native_res_m": res, "bbox_coverage": round(frac, 3)}
        print(f"coverage {frac:6.1%}  {name}")
        m = np.where(np.isfinite(g), 70, 235).astype("uint8")
        cov_imgs.append((name, m))
    W, H = cov_imgs[0][1].shape[1], cov_imgs[0][1].shape[0]
    pad = 24
    sheet = Image.new("RGB", (len(cov_imgs) * (W + 10) + 10, H + pad + 30), "white")
    d = ImageDraw.Draw(sheet)
    for i, (name, m) in enumerate(cov_imgs):
        x = 10 + i * (W + 10)
        sheet.paste(Image.fromarray(m).convert("RGB"), (x, pad))
        for (sn, (e, n)) in SITES.items():
            px, py = (e - BBOX[0]) / 50, (BBOX[3] - n) / 50
            d.rectangle([x + px - 20, pad + py - 20, x + px + 20, pad + py + 20], outline=(220, 0, 0), width=2)
        d.text((x, 4), name[:40], fill="black")
        d.text((x, pad + H + 4), f"{stats[name]['bbox_coverage']:.0%} of bbox, ~{stats[name]['native_res_m']:g} m", fill="black")
    sheet.save(DEC / "dem-coverage.png")
    # --- hillshade crops at 4 sites, 2 km windows, displayed at 2 m (coarse sources upsampled bilinear)
    tile = 400; res = 5.0
    sheet = Image.new("RGB", (len(srcs) * (tile + 8) + 220, len(SITES) * (tile + 8) + 30), "white")
    d = ImageDraw.Draw(sheet)
    for j, (name, paths, nres) in enumerate(srcs):
        d.text((220 + j * (tile + 8), 6), f"{name[:48]}\n(native ~{nres:g} m)", fill="black")
    for i, (sn, (e, n)) in enumerate(SITES.items()):
        d.text((6, 30 + i * (tile + 8) + tile // 2), sn, fill="black")
        b = (e - 1000, n - 1000, e + 1000, n + 1000)
        for j, (name, paths, nres) in enumerate(srcs):
            z = read_grid(paths, res, b, shape=(tile, tile))
            stats[name].setdefault("sites", {})[sn] = round(float(np.isfinite(z).mean()), 3)
            sheet.paste(Image.fromarray(hillshade(z, res)), (220 + j * (tile + 8), 30 + i * (tile + 8)))
    sheet.save(DEC / "dem-hillshade-compare.png")
    (BUILD / "dem_survey.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps(stats, indent=1))

if __name__ == "__main__":
    main()
