# WS2 Basemap vectors + ATES
**Model:** Sonnet · **Effort:** medium · **Depends:** Gate A · **Scope:** pilot or full bbox (see WS1)

## Goal
Produce offline vector data: lakes, creeks, dated glacier outlines and the ATES layer.

## Read
- `CONTRACTS.md#layers` (ids), `#app-json` (`pois` only)
- `docs/source/geo_reference.md`

## Own
- `tools/build_basemap.py`, `tools/convert_ates.py`
- `web/data/basemap.geojson`, `web/data/ates.geojson`, `web/data/ATTRIBUTION.md`
- `content/seed/_pois.json` (POIs seeded from the ATES landmarks)

## Do not read
`topo/*.pdf`, `1m_tif_data/*`.

## Steps
1. **`convert_ates.py`.** The only card allowed to read `ates/Kokanee Glacier.kmz`. It writes `ates.geojson`, a FeatureCollection with `properties.layer` ∈ `zone | path | decision | boundary | road | landmark`:
   - zones get `class` ∈ simple/challenging/complex, taken from the folder name
   - decision points: strip the HTML description to plain text (keep line breaks and table cell text)
   - **No style colours.** WS3 styles by class with ATES colours (green `#00c853`, blue `#1e63ff`, black `#000`).
   - Record the source file's name and date in `ATTRIBUTION.md`.
2. **POIs.** Write the ATES landmarks to `content/seed/_pois.json` as App JSON `pois` (`type`: hut for the cabin, otherwise peak/pass/lake/landmark, inferred from the name).
3. **`build_basemap.py`.** Fetch from the BC Data Catalogue WFS (`openmaps.gov.bc.ca/geo/pub/wfs`, OGL-BC), clipped to the bbox:
   - FWA lakes (`WHSE_BASEMAPPING.FWA_LAKES_POLY`)
   - FWA streams (`WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP`; keep stream order ≥ 1, simplify to 5 m)
   - glaciers (`WHSE_BASEMAPPING.FWA_GLACIERS_POLY`).
   - Add `properties.kind` (lake / creek / glacier), `name` where present, and for glaciers `survey_date` (from the source metadata/attributes; otherwise "TRIM, c. 1980s–90s").
   - Simplify to keep the file under 3 MB.
4. Write attribution lines for every source into `ATTRIBUTION.md`.

## Acceptance
```
cd tools && python -m uv run convert_ates.py && python -m uv run build_basemap.py --scope pilot
```
- `ates.geojson`: 64 zones, 24 paths (Path 1–21 plus Enterprise Ridge, Grizzly and Pyramid), 6 decision points, 1 boundary, 1 road, 24 landmarks.
- `basemap.geojson` contains Kaslo Lake (a polygon around −117.1953, 49.7683) and at least one glacier with `survey_date`.
