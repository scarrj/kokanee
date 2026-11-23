"""WS1 terrain: merge lidar 2018 / HRDEM 2017 / MRDEM-30 onto a 2 m EPSG:2955 grid with a quality mask.

Run from tools/:  python -m uv run build_terrain.py --scope pilot [--stats-only] [--refetch]

Writes (build/): merged_dem.tif (float32, nodata -32768), source_mask.tif (uint8 quality codes),
residuals.png, residual_stats.json, build_meta.json; and docs/decisions/seam-report.md (+ .png).
Source windows are cached once in tools/cache/ (git-ignored).
"""
import argparse
import json
import os
import pathlib

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from scipy import ndimage as ndi
from PIL import Image, ImageDraw

import terrain_common as tc

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("VSI_CACHE", "TRUE")

STAC = "https://datacube.services.geo.ca/stac/api/"
LL_BBOX = [-117.27, 49.60, -117.07, 49.82]
NODATA_OUT = -32768.0
FEATHERS_M = [150, 250, 400, 600]  # tried in order until the seam QA passes
SEAM_FLAG_DEG = 8.0
BLEND_CODE_W = 0.95  # code 4 only where the fallback weight exceeds 5% (the last 5% of the ramp keeps the lidar code)
SEAM_MAX_FRAC = 0.005
# Fallback glacier box (E0, N0, E1, N1) used only when web/data/basemap.geojson has no glacier polygons.
GLACIER_BBOX = (487000, 5509000, 491500, 5513500)
GLACIER_ZMIN = 2500.0

# Vertical corrections, chosen from the residual evidence (docs/decisions/vertical-datum.md).
# Each entry adds  const_m + dE_m_per_km*(E-Ec)/1000 + dN_m_per_km*(N-Nc)/1000  to that source.
CORRECTIONS = {
    "pilot": {},
    "full": {},
}


# ---------------------------------------------------------------- fetching
def stac_hrefs():
    cache = tc.cache_dir() / "stac.json"
    if cache.exists():
        return json.loads(cache.read_text())
    from pystac_client import Client
    cat = Client.open(STAC)
    out = {}
    for it in cat.search(collections=["hrdem-lidar"], bbox=LL_BBOX).items():
        if it.id == "BC-Kootenay_Columbia_2017-1m":
            out["hrdem2017"] = it.assets["dtm"].href
    for it in cat.search(collections=["mrdem-30"], bbox=LL_BBOX).items():
        if it.id == "mrdem":
            out["mrdem"] = it.assets["dtm"].href
    assert set(out) == {"hrdem2017", "mrdem"}, out
    cache.write_text(json.dumps(out, indent=1))
    return out


def fetch_window(href, bounds, buffer_m, dst, chunk=2048):
    """Copy the window of a remote COG covering bounds(+buffer) (EPSG:2955) to a local tiled GeoTIFF."""
    e0, n0, e1, n1 = bounds
    b = (e0 - buffer_m, n0 - buffer_m, e1 + buffer_m, n1 + buffer_m)
    with rasterio.open(href) as src:
        l, bt, r, t = transform_bounds(tc.CRS, src.crs, *b, densify_pts=21)
        win = from_bounds(l, bt, r, t, src.transform).round_offsets(op="floor").round_lengths(op="ceil")
        win = win.intersection(Window(0, 0, src.width, src.height))
        prof = dict(driver="GTiff", dtype="float32", count=1, crs=src.crs, nodata=src.nodata,
                    width=int(win.width), height=int(win.height), transform=src.window_transform(win),
                    tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=3, BIGTIFF="IF_SAFER")
        print(f"  fetching {pathlib.Path(href).name}: {int(win.width)} x {int(win.height)} px -> {dst}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(".part")
        with rasterio.open(tmp, "w", **prof) as out:
            for r0 in range(0, int(win.height), chunk):
                h = min(chunk, int(win.height) - r0)
                w_ = Window(win.col_off, win.row_off + r0, win.width, h)
                out.write(src.read(1, window=w_), 1, window=Window(0, r0, int(win.width), h))
        os.replace(tmp, dst)


def ensure_cache(scope, refetch=False):
    bounds = tc.SCOPES[scope]
    cd = tc.cache_dir()
    h = cd / "hrdem2017" / f"{scope}.tif"
    m = cd / "mrdem" / f"{scope}.tif"
    if refetch or not (h.exists() and m.exists()):
        hrefs = stac_hrefs()
        if refetch or not h.exists():
            fetch_window(hrefs["hrdem2017"], bounds, 300, h)
        if refetch or not m.exists():
            fetch_window(hrefs["mrdem"], bounds, 1500, m)
    return h, m


# ---------------------------------------------------------------- warping
def warp(path, transform, w, h, resampling):
    dst = np.full((h, w), np.nan, dtype="float32")
    with rasterio.open(path) as src:
        nd = src.nodata if src.nodata is not None else -32767
        reproject(rasterio.band(src, 1), dst, src_nodata=nd, dst_nodata=np.nan, dst_transform=transform,
                  dst_crs=tc.CRS, resampling=resampling, num_threads=4, init_dest_nodata=True)
    dst[(dst < -1000) | (dst > 9000)] = np.nan
    return dst


def load_sources(scope, refetch=False):
    bounds, tr, w, h = tc.grid_for(scope)
    hr, mr = ensure_cache(scope, refetch)
    l18 = np.full((h, w), np.nan, dtype="float32")
    e0, n0, e1, n1 = bounds
    for p in sorted((tc.root() / "1m_tif_data").glob("*.tif")):
        with rasterio.open(p) as s:
            b = s.bounds
        if b.right < e0 or b.left > e1 or b.top < n0 or b.bottom > n1:
            continue
        a = warp(p, tr, w, h, Resampling.bilinear)
        l18 = np.where(np.isnan(l18), a, l18)
    l17 = warp(hr, tr, w, h, Resampling.bilinear)
    mrd = warp(mr, tr, w, h, Resampling.cubic)
    return bounds, tr, w, h, l18, l17, mrd


def apply_corr(arr, corr, bounds, tr):
    if not corr:
        return arr
    e0, n0, e1, n1 = bounds
    h, w = arr.shape
    E = e0 + (np.arange(w) + 0.5) * tc.RES
    N = n1 - (np.arange(h) + 0.5) * tc.RES
    off = (corr.get("const_m", 0.0)
           + corr.get("dE_m_per_km", 0.0) * (E[None, :] - (e0 + e1) / 2) / 1000.0
           + corr.get("dN_m_per_km", 0.0) * (N[:, None] - (n0 + n1) / 2) / 1000.0)
    return (arr + off).astype("float32")


# ---------------------------------------------------------------- overlap / residual check
def glacier_mask(bounds, tr, w, h):
    """True on glacier ice: basemap.geojson glacier polygons if available, else z>2500 m in GLACIER_BBOX (caller)."""
    f = tc.web_dir() / "data" / "basemap.geojson"
    if not f.exists():
        return None, "elevation rule (no basemap.geojson): z>2,500 m inside the glacier bbox"
    try:
        from shapely.geometry import shape
        from shapely.ops import transform as shp_transform
        from pyproj import Transformer
        from rasterio.features import rasterize
        gj = json.loads(f.read_text(encoding="utf-8"))
        t = Transformer.from_crs("EPSG:4326", tc.CRS, always_xy=True).transform
        geoms = []
        for ft in gj.get("features", []):
            props = " ".join(str(v) for v in (ft.get("properties") or {}).values()).lower()
            if "glacier" in props and ft.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon"):
                geoms.append(shp_transform(t, shape(ft["geometry"])))
        if not geoms:
            return None, "elevation rule (basemap.geojson has no glacier polygons)"
        m = rasterize([(g, 1) for g in geoms], out_shape=(h, w), transform=tr, fill=0, dtype="uint8").astype(bool)
        return m, f"basemap.geojson glacier polygons ({len(geoms)})"
    except Exception as e:  # noqa: BLE001
        return None, f"elevation rule (basemap.geojson unreadable: {e})"


def stable_mask(l_blk, m_blk, lstd_blk, bounds, tr, w, h, k):
    """Blocks usable for the datum check: slope<20 deg on the 30 m aggregate, no glacier, no lake."""
    z = np.where(np.isfinite(l_blk), l_blk, m_blk)
    s_l, _ = tc.horn(np.where(np.isfinite(l_blk), l_blk, np.nan), k * tc.RES)
    s_m, _ = tc.horn(m_blk, k * tc.RES)
    ok = np.isfinite(l_blk) & np.isfinite(m_blk) & (s_l < 20) & (s_m < 20)
    # lakes: dead-flat lidar surface (std over the 30 m block < 0.25 m)
    lake = np.isfinite(lstd_blk) & (lstd_blk < 0.25) & (s_l < 3)
    ok &= ~lake
    gm, note = glacier_mask(bounds, tr, w, h)
    bh, bw = ok.shape
    if gm is not None:
        g = gm[:bh * k, :bw * k].reshape(bh, k, bw, k).mean(axis=(1, 3)) > 0.1
    else:
        e0, n0, e1, n1 = bounds
        E = e0 + (np.arange(bw) + 0.5) * k * tc.RES
        N = n1 - (np.arange(bh) + 0.5) * k * tc.RES
        gb = tc.SCOPES  # noqa: F841
        inb = ((E[None, :] >= GLACIER_BBOX[0]) & (E[None, :] <= GLACIER_BBOX[2])
               & (N[:, None] >= GLACIER_BBOX[1]) & (N[:, None] <= GLACIER_BBOX[3]))
        g = inb & (z > GLACIER_ZMIN)
    ok &= ~g
    return ok, {"glacier_rule": note, "lake_blocks": int(lake.sum()), "glacier_blocks": int(g.sum())}


def block_std(a, k):
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    return np.nanstd(b, axis=(1, 3)).astype("float32")


def mad(x):
    return float(np.median(np.abs(x - np.median(x))))


def overlap_stats(l18, l17, mrd, bounds, tr, w, h, tag):
    k = 15  # 15 x 2 m = 30 m
    e0, n0, e1, n1 = bounds
    b18, b17, bm = (tc.block_mean(a, k) for a in (l18, l17, mrd))
    lid = np.where(np.isfinite(l18), l18, l17)
    bl = tc.block_mean(lid, k)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        lstd = block_std(lid, k)
    stable, info = stable_mask(bl, bm, lstd, bounds, tr, w, h, k)
    bh, bw = bm.shape
    pairs = {"lidar2018_minus_mrdem": (b18, bm), "lidar2017_minus_mrdem": (b17, bm),
             "lidar2018_minus_lidar2017": (b18, b17)}
    out = {"tag": tag, "block_m": k * tc.RES, **info, "pairs": {}}
    resid = {}
    E = e0 + (np.arange(bw) + 0.5) * k * tc.RES
    N = n1 - (np.arange(bh) + 0.5) * k * tc.RES
    for name, (a, b) in pairs.items():
        d = a - b
        m = stable & np.isfinite(d)
        resid[name] = (d, m)
        entry = {"n_blocks": int(m.sum())}
        if m.sum() >= 30:
            x = d[m]
            entry.update(median_m=round(float(np.median(x)), 3), mad_m=round(mad(x), 3),
                         p10_p90_m=[round(float(np.percentile(x, 10)), 2), round(float(np.percentile(x, 90)), 2)])
            sub = {}
            ci = ((E - e0) // 2000).astype(int)
            ri = ((n1 - N) // 2000).astype(int)
            for r in range(ri.max() + 1):
                for c in range(ci.max() + 1):
                    mm = m & (ri[:, None] == r) & (ci[None, :] == c)
                    if mm.sum() >= 30:
                        sub[f"E{int(e0 + 2000 * c)}_N{int(n1 - 2000 * r)}"] = {"n": int(mm.sum()), "median_m": round(float(np.median(d[mm])), 2)}
            entry["median_by_2km_block"] = sub
            # dependence on elevation and a planar trend (least squares on block centres)
            zz = np.where(np.isfinite(bl), bl, bm)[m]
            bins = {}
            for z0 in range(1200, 3000, 200):
                mm = (zz >= z0) & (zz < z0 + 200)
                if mm.sum() >= 30:
                    bins[f"{z0}-{z0 + 200}"] = {"n": int(mm.sum()), "median_m": round(float(np.median(x[mm])), 2)}
            entry["median_by_elev_200m"] = bins
            EE, NN = np.meshgrid(E, N)
            A = np.c_[np.ones(m.sum()), (EE[m] - (e0 + e1) / 2) / 1000, (NN[m] - (n0 + n1) / 2) / 1000]
            coef, *_ = np.linalg.lstsq(A, x, rcond=None)
            entry["planar_fit"] = {"const_m": round(float(coef[0]), 3), "dE_m_per_km": round(float(coef[1]), 3),
                                   "dN_m_per_km": round(float(coef[2]), 3),
                                   "rms_after_m": round(float(np.sqrt(np.mean((x - A @ coef) ** 2))), 3),
                                   "rms_before_m": round(float(np.sqrt(np.mean((x - np.median(x)) ** 2))), 3)}
            # slope-dependence: the fallback is a coarse DTM, so also show unstable ground for contrast
            allm = np.isfinite(d)
            out_extra = d[allm & ~stable]
            if out_extra.size >= 30:
                entry["median_steep_or_excluded_m"] = round(float(np.median(out_extra)), 2)
                entry["n_steep_or_excluded"] = int(out_extra.size)
        out["pairs"][name] = entry
    return out, resid, stable


def diverging(d, vmax=10.0):
    t = np.clip(d / vmax, -1, 1)
    rgb = np.empty(d.shape + (3,), dtype="uint8")
    pos = t >= 0
    rgb[..., 0] = np.where(pos, 255, 255 * (1 + t)).astype("uint8")
    rgb[..., 1] = np.where(pos, 255 * (1 - t), 255 * (1 + t)).astype("uint8")
    rgb[..., 2] = np.where(pos, 255 * (1 - t), 255).astype("uint8")
    return rgb


def residual_png(resid, stable, stats, path, scale=3, vmax=10.0):
    panels = []
    for name, (d, m) in resid.items():
        has = np.isfinite(d)
        img = np.full(d.shape + (3,), 255, dtype="uint8")
        img[has & ~m] = (205, 205, 205)  # overlap but excluded (steep / glacier / lake)
        img[m] = diverging(d[m], vmax)
        im = Image.fromarray(img).resize((d.shape[1] * scale, d.shape[0] * scale), Image.NEAREST)
        panels.append((name, im))
    W = sum(p.width for _, p in panels) + 10 * (len(panels) + 1)
    H = panels[0][1].height + 80
    sheet = Image.new("RGB", (W, H), "white")
    dr = ImageDraw.Draw(sheet)
    x = 10
    for name, im in panels:
        e = stats["pairs"][name]
        dr.text((x, 6), name.replace("_", " "), fill="black")
        med = e.get("median_m")
        dr.text((x, 22), f"stable blocks {e['n_blocks']}  median {med} m  MAD {e.get('mad_m')} m", fill="black")
        sheet.paste(im, (x, 40))
        x += im.width + 10
    for i in range(200):  # colour bar
        v = (i / 199 * 2 - 1) * vmax
        sheet.paste(Image.fromarray(diverging(np.array([[v]]), vmax)).resize((2, 10)), (10 + i * 2, H - 24))
    dr.text((10, H - 38), f"-{vmax:g} m (blue) ... 0 (white) ... +{vmax:g} m (red); grey = overlap but not stable ground; white = no overlap", fill="black")
    sheet.save(path)


# ---------------------------------------------------------------- merge + seam QA
def merge(l18, l17, mrd, feather_m):
    valid = np.isfinite(l18) | np.isfinite(l17)
    lid = np.where(np.isfinite(l18), l18, l17)
    lsrc = np.where(np.isfinite(l18), tc.Q_LIDAR2018, tc.Q_LIDAR2017).astype("uint8")
    d = ndi.distance_transform_edt(valid) * tc.RES  # distance to the nearest non-lidar cell
    wgt = np.clip(d / feather_m, 0, 1).astype("float32")
    mfin = np.isfinite(mrd)
    wgt = np.where(mfin, wgt, 1.0)
    merged = np.where(valid, np.where(mfin, wgt * lid + (1 - wgt) * np.where(mfin, mrd, 0), lid), mrd).astype("float32")
    code = np.where(valid, np.where(wgt < BLEND_CODE_W, tc.Q_BLEND, lsrc), np.where(mfin, tc.Q_MRDEM, tc.Q_MISSING)).astype("uint8")
    return merged, code, wgt


def seam_qa(l18, l17, mrd, merged, code):
    lid = np.where(np.isfinite(l18), l18, l17)
    s_m, _ = tc.horn(merged, tc.RES)
    s_l, _ = tc.horn(lid, tc.RES)
    s_r, _ = tc.horn(mrd, tc.RES)
    band = code == tc.Q_BLEND
    ref = np.fmax(np.nan_to_num(s_l, nan=0.0), np.nan_to_num(s_r, nan=0.0))
    excess = np.where(band, s_m - ref, np.nan)
    flagged = band & (excess > SEAM_FLAG_DEG)
    return band, flagged, excess, s_m


def write_tifs(scope, bounds, tr, merged, code):
    bd = tc.build_dir()
    prof = dict(driver="GTiff", width=merged.shape[1], height=merged.shape[0], count=1, crs=tc.CRS, transform=tr,
                tiled=True, blockxsize=256, blockysize=256, compress="deflate")
    out = np.where(np.isfinite(merged), merged, NODATA_OUT).astype("float32")
    with rasterio.open(bd / "merged_dem.tif", "w", dtype="float32", nodata=NODATA_OUT, predictor=3, **prof) as d:
        d.write(out, 1)
    with rasterio.open(bd / "source_mask.tif", "w", dtype="uint8", predictor=2, **prof) as d:
        d.write(code, 1)


def hill(z, res=tc.RES):
    s, a = tc.horn(z, res)
    az, alt = np.radians(315), np.radians(45)
    sr = np.radians(np.nan_to_num(s))
    ar = np.radians(np.nan_to_num(a))
    # aspect here is the downslope direction; the surface normal azimuth is the same
    hs = np.sin(alt) * np.cos(sr) + np.cos(alt) * np.sin(sr) * np.cos(az - ar)
    return np.clip(hs * 255, 0, 255).astype("uint8")


def seam_png(path, bounds, merged, l18, l17, mrd, code, flagged, excess, worst):
    e0, n0, e1, n1 = bounds
    hs = hill(merged)
    rgb = np.stack([hs] * 3, -1).astype("float32")
    band = code == tc.Q_BLEND
    rgb[band] = rgb[band] * 0.6 + np.array([240, 140, 0]) * 0.4
    fl = ndi.binary_dilation(flagged, iterations=2)
    rgb[fl] = (230, 20, 20)
    rgb[code == tc.Q_MISSING] = (230, 120, 120)
    over = Image.fromarray(rgb.astype("uint8")).resize((rgb.shape[1] // 2, rgb.shape[0] // 2), Image.LANCZOS)
    crops = []
    lid = np.where(np.isfinite(l18), l18, l17)
    for (r, c, _) in worst[:2]:
        r0, c0 = int(np.clip(r - 100, 0, merged.shape[0] - 200)), int(np.clip(c - 100, 0, merged.shape[1] - 200))
        row = []
        for z in (lid, merged, mrd):
            row.append(Image.fromarray(hill(np.nan_to_num(z[r0:r0 + 200, c0:c0 + 200], nan=np.nanmean(z)))).convert("RGB").resize((300, 300), Image.NEAREST))
        crops.append(row)
    W = max(over.width, 900) + 20
    H = over.height + 40 + 320 * len(crops)
    sheet = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(sheet)
    d.text((10, 6), "Hillshade of merged DEM. Orange = blend band (code 4). Red = cells flagged (slope > max(source slopes)+8 deg). Pink = no data", fill="black")
    sheet.paste(over, (10, 30))
    y = over.height + 40
    for row, (r, c, ex) in zip(crops, worst[:2]):
        d.text((10, y), f"worst location E{e0 + c * tc.RES:.0f} N{n1 - r * tc.RES:.0f} (+{ex:.1f} deg): lidar only | merged | MRDEM only (200 px = 400 m)", fill="black")
        for i, im in enumerate(row):
            sheet.paste(im, (10 + i * 310, y + 16))
        y += 320
    sheet.save(path)


def report_md(path, scope, tried, chosen, band_cells, flagged_n, worst, bounds, tr, extra):
    from pyproj import Transformer
    inv = Transformer.from_crs(tc.CRS, "EPSG:4326", always_xy=True)
    e0, n0, e1, n1 = bounds
    lines = [
        "# Seam report (WS1 step 5)", "",
        f"Scope: **{scope}**. Written by `tools/build_terrain.py`. Image: `seam-report.png`.", "",
        f"The blend band (code 4) is the part of the feather where the fallback weight exceeds {1 - BLEND_CODE_W:.0%} (the ramp runs on the lidar side of the lidar edge, 0 at the edge to 1 at the feather distance).",
        "Test: in the blend band, a cell is **flagged** if the merged slope exceeds",
        f"max(lidar slope, MRDEM slope) + {SEAM_FLAG_DEG:g} deg (Horn 3x3 on the 2 m grid). The feather is widened until fewer than",
        f"{SEAM_MAX_FRAC:.1%} of band cells are flagged.", "",
        "| Feather (m) | Band cells | Flagged | Flagged % |", "|---|---|---|---|",
    ]
    for f, nb, nf in tried:
        lines.append(f"| {f} | {nb} | {nf} | {nf / max(nb, 1):.3%} |")
    lines += ["", f"**Chosen feather: {chosen} m** ({band_cells} band cells, {flagged_n} flagged = {flagged_n / max(band_cells, 1):.3%}).", ""]
    if worst:
        lines += ["Worst locations (largest excess over the source slopes):", "", "| E | N | lon, lat | excess (deg) |", "|---|---|---|---|"]
        for r, c, ex in worst[:8]:
            e, n = e0 + (c + 0.5) * tc.RES, n1 - (r + 0.5) * tc.RES
            lo, la = inv.transform(e, n)
            lines.append(f"| {e:.0f} | {n:.0f} | {lo:.5f}, {la:.5f} | {ex:.1f} |")
    lines += ["", *extra, ""]
    pathlib.Path(path).write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=list(tc.SCOPES), default="pilot")
    ap.add_argument("--stats-only", action="store_true", help="stop after the overlap/residual check (no correction applied)")
    ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--no-correction", action="store_true")
    a = ap.parse_args()
    scope = a.scope
    bd = tc.build_dir()
    bounds, tr, w, h, l18, l17, mrd = load_sources(scope, a.refetch)
    print(f"grid {w} x {h} @ {tc.RES} m; coverage lidar2018 {np.isfinite(l18).mean():.1%}, hrdem2017 {np.isfinite(l17).mean():.1%}, mrdem {np.isfinite(mrd).mean():.1%}")

    st0, resid, stable = overlap_stats(l18, l17, mrd, bounds, tr, w, h, "before correction")
    residual_png(resid, stable, st0, bd / "residuals.png")
    stats = {"before": st0}
    (bd / "residual_stats.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps({k: {kk: (vv if kk not in ("median_by_2km_block", "median_by_elev_200m") else vv) for kk, vv in v.items()} for k, v in st0["pairs"].items()}, indent=1))
    if a.stats_only:
        return

    corr = {} if a.no_correction else CORRECTIONS.get(scope, {})
    if corr.get("mrdem"):
        mrd = apply_corr(mrd, corr["mrdem"], bounds, tr)
    if corr.get("lidar2017"):
        l17 = apply_corr(l17, corr["lidar2017"], bounds, tr)
    if corr.get("lidar2018"):
        l18 = apply_corr(l18, corr["lidar2018"], bounds, tr)
    if corr:
        st1, resid1, stable1 = overlap_stats(l18, l17, mrd, bounds, tr, w, h, "after correction")
        stats["after"] = st1
        residual_png(resid1, stable1, st1, bd / "residuals_after.png")
    stats["correction"] = corr
    (bd / "residual_stats.json").write_text(json.dumps(stats, indent=1))

    tried, chosen = [], None
    for f in FEATHERS_M:
        merged, code, wgt = merge(l18, l17, mrd, f)
        band, flagged, excess, s_m = seam_qa(l18, l17, mrd, merged, code)
        tried.append((f, int(band.sum()), int(flagged.sum())))
        print(f"feather {f} m: band {band.sum()} cells, flagged {flagged.sum()} ({flagged.sum() / max(band.sum(), 1):.3%})")
        chosen = f
        if flagged.sum() <= SEAM_MAX_FRAC * max(band.sum(), 1):
            break
    exc = np.where(flagged, excess, -np.inf)
    idx = np.argsort(exc, axis=None)[::-1][: 200]
    worst, taken = [], []
    for i in idx:
        r, c = np.unravel_index(i, exc.shape)
        if not np.isfinite(exc[r, c]):
            break
        if all(abs(r - r2) + abs(c - c2) > 50 for r2, c2, _ in taken):
            taken.append((r, c, float(exc[r, c])))
    worst = taken
    if not worst and band.any():  # nothing flagged: show the largest (unflagged) excess instead
        i = np.nanargmax(np.where(band, excess, -np.inf))
        r, c = np.unravel_index(i, excess.shape)
        worst = [(r, c, float(excess[r, c]))]
    dec = tc.decisions_dir()
    seam_png(dec / "seam-report.png", bounds, merged, l18, l17, mrd, code, flagged, excess, worst)
    pct = {int(q): round(float((code == q).mean()) * 100, 2) for q in range(5)}
    extra = [f"Source mix of the merged grid (% of cells by quality code): {pct}.",
             "", "Residual statistics (lidar vs MRDEM at 30 m, stable ground) are in `vertical-datum.md` and `build/residual_stats.json`."]
    report_md(dec / "seam-report.md", scope, tried, chosen, int(band.sum()), int(flagged.sum()), worst, bounds, tr, extra)

    write_tifs(scope, bounds, tr, merged, code)
    meta = {"scope": scope, "bounds_2955": bounds, "res_m": tc.RES, "feather_m": chosen, "correction": corr,
            "pct_by_code": pct, "seam_tried": tried}
    (bd / "build_meta.json").write_text(json.dumps(meta, indent=1))
    print("wrote build/merged_dem.tif, build/source_mask.tif;", json.dumps(meta))


if __name__ == "__main__":
    main()
