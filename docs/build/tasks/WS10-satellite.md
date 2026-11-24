# WS10 Satellite: offline Sentinel-2 imagery tiles
**Model:** Sonnet · **Effort:** high · **Depends:** WS0 runtime · **Scope:** full bbox only
**Approved by the user 2026-11-24** ("Sentinel-2 offline"): this covers the Sentinel-2 L2A download.

## Goal
One cloud-free, late-summer, true-colour Sentinel-2 mosaic of the project bbox, tiled for offline use as a toggleable layer.

## Read
- `CONTRACTS.md#tiles` (the **Satellite imagery** bullet and the bbox), `#layers`
- `docs/build/CONTEXT.md` (bbox)

## Own
- `tools/make_satellite.py` (new), `tools/cache/sat/` (git-ignored)
- `web/tiles/sat/**` including `web/tiles/sat/sat.json`
- `web/data/ATTRIBUTION.md`: append a Sentinel-2 section only

## Do not
- Touch `web/tiles/tiles.json` or other tile layers (WS1 owns them). Check (read only) that `make_tiles.py` would not delete `web/tiles/sat/`; if it would, say so in ISSUES.
- Use any imagery source other than Copernicus Sentinel-2.

## Steps
1. Search the Earth Search STAC (`https://earth-search.aws.element84.com/v1`, collection `sentinel-2-l2a`; public, no account) for scenes intersecting the bbox, July–September of the last 3 years, `eo:cloud_cover` < 10.
2. Choose the clearest, lowest-snow scene (check the SCL band over the bbox: cloud, shadow and snow fractions). Mosaic a second scene only if needed to fill clouds. Record the scene ids and dates.
3. Read B04/B03/B02 windows (COGs, windowed reads; cache under `tools/cache/sat/`), build true colour with a fixed stretch (e.g. 2–98% percentiles, gamma ~1.2), with no per-tile normalisation, so tiles match.
4. Reproject to Web Mercator and cut 256 px JPEG tiles, z10–14, inside the bbox (bilinear for downsampled zooms). Write `sat.json` per the contract.
5. Report the size per zoom and total MB.

## Acceptance
```
cd tools && python -m uv run make_satellite.py
python -m uv run make_asset_manifest.py ../web
python -m uv run check_all.py --quick
```
- Spot-check by viewing 3 tiles: around the cabin and Kaslo Lake, Kokanee Glacier, and a forested valley. Natural colour, no seams between tiles, and lakes look dark.
