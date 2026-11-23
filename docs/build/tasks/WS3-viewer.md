# WS3 Viewer: map, layers, panels, readout, mobile
**Model:** Sonnet · **Effort:** medium · **Depends:** WS0 (works before tiles exist) · **Scope:** pilot, then full

## Goal
Build the app shell and the 3D map:
- every toggleable layer, with legends and opacity sliders
- zone "i" buttons and route panels
- a tap readout
- a scale bar
- the mobile layout.

## Read
`CONTRACTS.md#layers`, `#geojson-mapping`, `#modules` (`map.js`, `ui.js`, `app.js`, and the signatures of the others), `#ui`, `#tiles` (legends and `tiles.json`).

## Own
- `web/index.html`, `web/style.css`
- `web/js/app.js`, `web/js/map.js`, `web/js/ui.js`, `web/js/layers-menu.js`, `web/js/profile-chart.js`
- `web/vendor/**` (MapLibre GL JS v5.x and maplibre-contour; pin exact versions; minified files plus licences)
- `.claude/launch.json`

## Do not read
`tools/*.py`, `topo/*`, `1m_tif_data/*`.

## Steps
1. **Vendor the libraries.** Download the pinned MapLibre GL JS 5.x (`dist/maplibre-gl.js` and `.css`) and maplibre-contour into `web/vendor/`, and record the versions in `web/vendor/VERSIONS.md`. No CDN at runtime.
2. **`map.js`.**
   - Terrain from the `dem` raster-dem (terrarium), exaggeration 1.3 by default.
   - Live hillshade.
   - Contours via maplibre-contour: 20 m, with labelled 100 m index lines.
   - Raster overlays for `elev`, `aspect`, `slope` and `quality`.
   - Vector layers from `basemap.geojson` and `ates.geojson` (style ATES by `class`: green `#00c853`, blue `#1e63ff`, black `#000`; zone fill alpha 0.35).
   - Content layers from `setContent()`.
   - `elev-ref-2100` drawn from the contour source at 2100 m, labelled "2,100 m reference".
   - `ScaleControl` (metric), `NavigationControl` with pitch, `GeolocateControl`.
   - Home view: the cabin, pitch 60, bearing 200 (looking SW toward John Carter).
   - If `tiles.json` is missing, show a flat map with a banner instead of failing.
3. **`layers-menu.js`.**
   - One row per group: a toggle, an opacity slider and a collapsible legend built from `tiles.json.legends`.
   - Groups: contour shading, aspect, slope angle bands, ATES (sub-toggles for zones, paths and decision points), contours, hillshade, data quality, water & glaciers (legend shows the glacier survey date), POIs, descents, skin tracks, closures.
   - Every legend shows "No data" (hatched) separately from "below range / transparent".
   - Persist choices in `localStorage`, with every access in try/catch.
4. **`ui.js`.**
   - Side panel on desktop and bottom sheet under 768 px.
   - `openZone` lists the zone's routes. `openRoute` shows the guide fields, notes, an "approx" badge, the guide figures next to the computed metrics (via `terrain-sampler.profile` once WS4 lands; until then show "metrics pending"), and the profile chart.
   - The profile draws a gap where quality is 0 and tints the fallback stretches.
   - Expose `registerMenu(section, items)` so WS6 and WS7 can add menu items.
5. **Tap readout.** Outside edit mode, tapping the map shows:
   - elevation, terrain slope and aspect from `terrain-sampler.sample`
   - the ATES class under the point
   - the quality source with its native resolution, plus "detail smoothed" for codes 3 and 4.
6. **`app.js` bootstrap.**
   - Fetch `tiles/tiles.json`.
   - Call `store.load()` (if WS6 hasn't landed, read `data/routes.json` directly).
   - `map.setContent(toGeoJSON(app))` (if WS5's `model.js` is missing, use a local shim).
   - `initUI`, then `initOffline` if `offline.js` exists.
7. **`.claude/launch.json`.** A `web` config: `python -m http.server 8765 --directory web`, port 8765.

## Acceptance
- Preview `web` in the browser pane with no console errors.
- Every layer toggles; opacity works; legends show.
- Mobile preset: the bottom sheet works, and every touch target is at least 44 px.
- With pilot tiles present, the 3D terrain renders and the scale bar is visible.
