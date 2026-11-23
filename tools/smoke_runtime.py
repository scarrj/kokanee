"""Smoke test for the pinned geospatial runtime (Phase 0a).

Proves: (1) a lidar tile opens, (2) a remote COG window reads (MRDEM-30 via STAC),
(3) an NTv2 NAD27->NAD83 transform works with a grid, (4) a PNG writes.
Run:  uv run smoke_runtime.py      (from tools/)
"""
import os, sys, pathlib, tempfile
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
ok = True

def check(name, fn):
    global ok
    try:
        msg = fn()
        print(f"PASS {name}: {msg}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"FAIL {name}: {type(e).__name__}: {e}")

def lidar():
    import rasterio
    from rasterio.windows import Window
    p = ROOT / "1m_tif_data" / "bc_082f075_l1m_utm11_20180830.tif"
    with rasterio.open(p) as ds:
        a = ds.read(1, window=Window(8000, 8000, 64, 64))
        return f"{ds.crs.to_epsg()} {ds.width}x{ds.height} res={ds.res} sample={float(a[0,0]):.1f} gdal={rasterio.__gdal_version__}"

def remote_cog():
    import rasterio
    from rasterio.windows import from_bounds
    from pystac_client import Client
    from pyproj import Transformer
    cat = Client.open("https://datacube.services.geo.ca/stac/api/")
    items = list(cat.search(collections=["mrdem-30"], bbox=[-117.2, 49.75, -117.19, 49.76]).items())
    item = items[0]
    href = item.assets["dtm"].href
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    with rasterio.open(href) as ds:
        t = Transformer.from_crs(4326, ds.crs, always_xy=True)
        x, y = t.transform(-117.194844, 49.771692)  # cabin
        a = ds.read(1, window=from_bounds(x - 60, y - 60, x + 60, y + 60, ds.transform))
        return f"item={item.id} crs={ds.crs.to_string()[:30]} res={ds.res} cabin~{float(np.nanmean(a)):.1f} m"

def ntv2():
    import pyproj
    pyproj.network.set_network_enabled(True)
    from pyproj.transformer import TransformerGroup
    g = TransformerGroup("EPSG:26711", "EPSG:26911", always_xy=True)  # NAD27 UTM11 -> NAD83 UTM11
    best = g.transformers[0]
    x, y = best.transform(488200, 5511800)
    grids = [gr.short_name for op in (best.operations or []) for gr in op.grids]
    if not grids:
        raise RuntimeError(f"best op is not grid-based: {best.description}")
    return f"grids={grids} -> dE={x-488200:+.1f} dN={y-5511800:+.1f}"

def png():
    from PIL import Image
    p = pathlib.Path(tempfile.gettempdir()) / "kokanee_smoke.png"
    Image.fromarray((np.random.rand(16, 16, 3) * 255).astype("uint8")).save(p)
    return f"{p.stat().st_size} bytes"

for n, f in [("lidar_open", lidar), ("remote_cog", remote_cog), ("ntv2", ntv2), ("png_write", png)]:
    check(n, f)
sys.exit(0 if ok else 1)
