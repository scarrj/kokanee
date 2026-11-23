# WS1 Terrain: merge, quality mask, tiles
**Model:** Sonnet · **Effort:** high · **Depends:** Gate A · **Scope:** pilot = bbox E 484,500–490,500, N 5,509,500–5,514,500; full = project bbox

## Goal
Build the merged analysis DEM with a per-pixel source/quality mask, check the seams honestly, and write every terrain tile layer plus `tiles.json`.

## Read
- `CONTRACTS.md#tiles`, `#metrics` (slope definition only)
- `docs/decisions/dem-source.md`, `docs/decisions/vertical-datum.md`
- `docs/source/geo_reference.md` (bbox section)
- `tools/dem_survey.py`: reuse its `read_grid` and STAC lookup patterns.

## Own
- `tools/build_terrain.py`, `tools/make_tiles.py`, `tools/terrain_probe.py`, `tools/terrain_common.py`
- `tools/cache/` (downloaded windows, git-ignored)
- `web/tiles/**`
- `docs/decisions/vertical-datum.md` ("Still to do" section only)
- `docs/decisions/seam-report.md`

## Do not read
`topo/*.pdf`, `ates/*`, `web/js/*`.

## Steps
1. **`build_terrain.py --scope pilot|full`.**
   - Fetch the source windows once into `tools/cache/`:
     - HRDEM `BC-Kootenay_Columbia_2017-1m` DTM, via STAC `hrdem-lidar`
     - MRDEM `mrdem` DTM, via STAC `mrdem-30`.
   - Warp all sources to EPSG:2955 on a 2 m analysis grid (bilinear for lidar; cubic for MRDEM to avoid facets).
2. **Quality code per cell** (0 missing, 1 lidar2018, 2 lidar2017, 3 MRDEM, 4 blend). Write it to `build/source_mask.tif` (uint8).
3. **Overlap check before any correction.**
   - Use stable ground only: slope under 20° on the 30 m aggregate, excluding glaciers (if `web/data/basemap.geojson` exists; otherwise exclude above 2,500 m on the glacier bbox) and lakes (flat areas with no lidar).
   - Difference the sources at **30 m** (block-mean the lidar to 30 m).
   - Write `build/residuals.png` (a diverging map) plus stats: median, MAD, and median by 2 km sub-block.
   - Then choose a correction (none, constant, or planar) and record it with its evidence in `vertical-datum.md`. Do the same check for lidar2018 vs lidar2017.
4. **Blend.** Feather fallback → lidar over 150 m with a distance-weighted ramp. Set code 4 in the band.
5. **Seam QA.** Compare the slope in the blend band against both sources. Flag cells where the band's slope exceeds max(source slopes) + 8°. Write `docs/decisions/seam-report.md` with counts, worst locations and a PNG. Widen the feather if more than 0.5% of band cells are flagged.
6. **`make_tiles.py`.**
   - Write XYZ 256 px tiles for `dem` (Terrarium), `quality`, `slope`, `aspect` and `elev`, as specified in `#tiles`.
   - Pilot zoom range: z10–16 for overlays and z10–15 for dem. Report the size per layer per zoom; it feeds `zoom-limits.md`.
   - Missing data is written as specified (DEM `0,0,0`; overlays hatched).
   - Write `web/tiles/tiles.json` with `dem_version` = `YYYY-MM-<scope>` and the legends.
7. **`terrain_probe.py` CLI** (used by WS8). It reads `build/merged_dem.tif` plus the mask, and outputs JSON:
   - `summit --near lon,lat --r 300` → the highest point, with elev and quality
   - `saddle --between lon,lat lon,lat` → the lowest point on the max-elevation path (approximate)
   - `aspect --at lon,lat --r 100` → mean aspect and slope
   - `profile --line "lon,lat;lon,lat;..."` → samples every 5 m (elev, slope, quality)
   - `fall-line --from lon,lat --max 2000` → a steepest-descent polyline
   - `lakes` → flat no-data/low-slope basins with centroid and elevation.

## Acceptance
```
cd tools && python -m uv run build_terrain.py --scope pilot && python -m uv run make_tiles.py --scope pilot
python -m uv run terrain_probe.py summit --near -117.1925,49.7403 --r 300   # Mount John Carter: elev 2611 ±3, quality 1
python -m uv run terrain_probe.py aspect --at -117.209,49.781 --r 150        # Tanal area: reports quality 3
```
- `web/tiles/tiles.json` validates against `#tiles`.
- `seam-report.md` exists, and the residual stats are recorded.
- The report includes MB per layer per zoom.
