"""Shared helpers for the terrain tools (WS1): paths, grids, Horn slope/aspect.

Paths: root() honours the env var KOKANEE_ROOT (used when a card runs in a git worktree),
falling back to the repo root (the parent of tools/).
"""
import os
import pathlib

import numpy as np
from rasterio.transform import from_origin

CRS = "EPSG:2955"  # NAD83(CSRS) / UTM 11N, the analysis CRS
RES = 2.0          # analysis grid resolution, m

# (E0, N0, E1, N1) in EPSG:2955
SCOPES = {
    "pilot": (484500, 5509500, 490500, 5514500),
    "full": (480500, 5494500, 494500, 5519000),
}

# Quality codes (CONTRACTS.md#tiles)
Q_MISSING, Q_LIDAR2018, Q_LIDAR2017, Q_MRDEM, Q_BLEND = 0, 1, 2, 3, 4


def root() -> pathlib.Path:
    env = os.environ.get("KOKANEE_ROOT")
    if env:
        return pathlib.Path(env).resolve()
    return pathlib.Path(__file__).resolve().parent.parent


def build_dir() -> pathlib.Path:
    p = root() / "build"
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_dir() -> pathlib.Path:
    p = root() / "tools" / "cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def web_dir() -> pathlib.Path:
    return root() / "web"


def decisions_dir() -> pathlib.Path:
    p = root() / "docs" / "decisions"
    p.mkdir(parents=True, exist_ok=True)
    return p


def grid_for(scope: str):
    """(bounds, transform, width, height) of the 2 m analysis grid for a scope."""
    e0, n0, e1, n1 = SCOPES[scope]
    w, h = int(round((e1 - e0) / RES)), int(round((n1 - n0) / RES))
    return (e0, n0, e1, n1), from_origin(e0, n1, RES, RES), w, h


def horn(z, cell, strip=512):
    """Horn 3x3 slope (deg) and aspect (deg clockwise from N, direction the slope FACES, i.e. downslope).

    z: 2-D float array, row 0 = north, NaN = missing. cell: ground cell size in m, scalar or a
    per-row 1-D array (len == z.shape[0]). Neighbours that are NaN are replaced by the centre value
    (as GDAL does at edges); a NaN centre gives NaN. Returns (slope, aspect) float32.
    Aspect is NaN where slope == 0 (flat).
    """
    h, w = z.shape
    slope = np.full((h, w), np.nan, dtype="float32")
    aspect = np.full((h, w), np.nan, dtype="float32")
    cell = np.broadcast_to(np.asarray(cell, dtype="float64"), (h,)) if np.ndim(cell) == 0 else np.asarray(cell, dtype="float64")
    zp = np.pad(z.astype("float32"), 1, mode="edge")
    for r0 in range(0, h, strip):
        r1 = min(h, r0 + strip)
        blk = zp[r0:r1 + 2]  # rows r0-1 .. r1 (padded index)
        c = blk[1:-1, 1:-1]

        def nb(dy, dx):
            a = blk[1 + dy:1 + dy + (r1 - r0), 1 + dx:1 + dx + w]
            return np.where(np.isnan(a), c, a)

        a, b, cc = nb(-1, -1), nb(-1, 0), nb(-1, 1)
        d, f = nb(0, -1), nb(0, 1)
        g, hh, i = nb(1, -1), nb(1, 0), nb(1, 1)
        cs = cell[r0:r1, None]
        dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cs)
        dzdy = ((a + 2 * b + cc) - (g + 2 * hh + i)) / (8 * cs)
        s = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
        asp = np.degrees(np.arctan2(-dzdx, -dzdy)) % 360.0
        asp = np.where(np.hypot(dzdx, dzdy) < 1e-9, np.nan, asp)
        bad = np.isnan(c)
        s[bad] = np.nan
        asp[bad] = np.nan
        slope[r0:r1] = s
        aspect[r0:r1] = asp
    return slope, aspect


def block_mean(a, k, min_frac=0.9):
    """Mean over k x k blocks (crops the remainder). NaN unless >= min_frac of the block is finite."""
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    ok = np.isfinite(b)
    n = ok.sum(axis=(1, 3))
    s = np.where(ok, b, 0).sum(axis=(1, 3), dtype="float64")
    out = np.where(n >= min_frac * k * k, s / np.maximum(n, 1), np.nan)
    return out.astype("float32")
