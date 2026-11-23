# WS4 Metrics: terrain sampler (JS) + metrics.py with parity
**Model:** Sonnet · **Effort:** high · **Depends:** WS1 (`tiles.json` + pilot tiles) · **Scope:** pilot, then full re-run

## Goal
Compute the route and point metrics exactly as `CONTRACTS.md#metrics` defines them, identically in the browser and in Python.

## Read
`CONTRACTS.md#metrics`, `#tiles` (Terrarium decoding, the quality B channel, `analysis_zoom`), `#modules` (`terrain-sampler.js`).

## Own
- `web/js/terrain-sampler.js`, `web/js/geo.js` (geodesic helpers)
- `tools/metrics.py`, `tools/fixtures/metrics_fixture.json`, `tools/test_metrics_parity.mjs`

## Do not read
`topo/*`, `1m_tif_data/*`, `web/js/map.js` internals.

## Steps
1. **`terrain-sampler.js`.**
   - Fetch the `dem` and `quality` tiles at `analysis_zoom` through `fetch` (they're cached by the service worker), and decode them with `createImageBitmap` + `OffscreenCanvas`. Fall back to a canvas where `OffscreenCanvas` is missing.
   - LRU cache of 64 tiles.
   - Bilinear elevation; Horn's slope and aspect from a 3×3 neighbourhood (handle tile edges); nearest-neighbour quality.
2. **`profile(coords)`.**
   - Densify geodesically every 5 m. Compute all the metrics; exclude code-0 samples. Return `{samples[], metrics}`.
   - Performance budget: under 150 ms for a 3 km line on a mid-range phone, once tiles are cached.
3. **`tools/metrics.py`.** The same algorithm, reading the same PNG tiles from `web/tiles/` (not the GeoTIFF), so the parity test is meaningful. CLI:
   ```
   metrics.py --line "lon,lat;..."
   metrics.py --routes ../web/data/routes.json
   ```
   The second form writes `build/route_metrics.json`.
4. **Fixture.** Three lines in the pilot area: one fully on lidar, one fully on MRDEM, one crossing the seam. `test_metrics_parity.mjs` (Node 26) imports `web/js/terrain-sampler.js` with a Node PNG decoder shim and compares against `metrics.py --json`. They must agree within 1 m and 0.5°.

## Acceptance
```
cd tools && python -m uv run metrics.py --line "-117.1949,49.7717;-117.1925,49.7403"
node test_metrics_parity.mjs     # PASS 3/3
```
- In the app, the readout and route panel show the metrics, and the low-confidence badge appears on the MRDEM line.
