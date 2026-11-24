# Contracts

These are the interfaces shared between workstreams. Change them only through the orchestrator (it bumps `schema_version` or the module API version and tells the affected cards). Agents cite sections by anchor, for example `CONTRACTS.md#app-json`.

---

## app-json
**App JSON** is the one canonical, editable content file: `web/data/routes.json`. Its JSON Schema is `web/data/routes.schema.json` (owned by WS5).

```jsonc
{
  "schema_version": 1,                 // format version; integer; bumped only by a contract change
  "content_rev": 1,                    // published content revision; integer; bumped by "Export for publishing"
  "published_at": "2026-11-23T00:00:00Z",
  "dem_version": "2026-11-pilot",      // DEM the geometry was authored against (from tiles.json)
  "zones": [{
    "id": "z-tanal",                   // stable id, kebab-case, prefix z-
    "name": "Tanal Peak Area",
    "color": "#d9480f",                // from #ui zone palette
    "info_point": [-117.19, 49.78],    // [lon, lat] for the "i" button
    "description": "…",                // plain text, paragraphs separated by \n\n
    "source": "backcountryskiingcanada.com via guide PDF"
  }],
  "routes": [{
    "id": "r01",                       // r01..r35 from the guide; si1..si6 for S&I; new ones u-<shortuuid>
    "num": "1",                        // label shown on the map (string; "S&I 1" allowed)
    "zone": "z-tanal",
    "name": "Over Easy",
    "time": "2-3 hrs",                 // free text, as printed
    "gain_m": 140,                     // guide figure or null
    "descent_m": null,                 // guide's stated descent, if any, or null
    "description": "…",                // guide text verbatim
    "notes": "",                       // editorial notes / FLAGs / user notes
    "approx": true,                    // true until a human confirms the line
    "confidence": "medium",            // low | medium | high: the author's placement confidence
    "descent": [[-117.2, 49.78], …],   // LineString coords [lon, lat], ≥2 points, or []
    "skin": [[…], …]                   // uphill/approach LineString or []
  }],
  "pois": [{ "id": "cabin", "name": "Kokanee Glacier Cabin", "type": "hut", "coord": [-117.194844, 49.771692], "description": "…" }],
  // poi.type ∈ hut | helipad | peak | pass | lake | landmark
  "areas": [{
    "id": "a-…", "name": "…", "kind": "closure",  // closure | no-go | note
    "polygon": [[[lon, lat], …]],                 // GeoJSON Polygon coords; first ring is the outer ring, closed
    "description": "…", "source": "…", "valid_from": null, "valid_to": null
  }]
}
```

**Optional top-level field:** `"pilot": true`. It appears only in files assembled with `--pilot`, which also have `content_rev: 0`.

**Validation rules.** The schema, `model.validate()` and `validate_routes.py` must all enforce exactly these:
1. Required top-level keys: `schema_version` (int ≥1), `content_rev` (int ≥0; 0 only if `pilot`), `published_at` (ISO 8601 string), `dem_version` (string, or `"none"`), `zones`, `routes`, `pois`, `areas`.
2. Coordinates are WGS84 `[lon, lat]` numbers inside the project bbox ±0.05° (lon −117.32…−117.02, lat 49.55…49.87), rounded to at most 6 decimal places. **Elevations are never stored.**
3. Ids are unique within their array and never reused. Patterns:
   - zones: `^z-[a-z0-9-]+$`
   - routes: `^(r\d{2}|si\d|u-[a-z0-9]+)$`
   - pois: `^[a-z0-9-]+$`
   - areas: `^a-[a-z0-9-]+$`
4. `routes[].zone` must exist in `zones`.
5. `descent` and `skin` are each `[]` or ≥2 points. `polygon` outer rings have ≥4 points with first = last.
6. Enums:
   - `poi.type` ∈ hut | helipad | peak | pass | lake | landmark
   - `area.kind` ∈ closure | no-go | note
   - `confidence` ∈ low | medium | high
7. `info_point` may be `null` **only** when `pilot` is true, or in seed files. A full assembly requires it for every zone that has routes.
8. Every string field is present (it may be empty); `gain_m` and `descent_m` are number or null.

**Where the values come from at assembly:**
- `published_at`: the time of assembly.
- `dem_version`: `web/tiles/tiles.json` if it exists, otherwise `"none"`.
- Seed files are `content/seed/<zone-id>.json` = `{zone, routes, pois, areas}`. The exception is `content/seed/_pois.json` = `{pois}`, owned by WS2. A seed with `"zone": null` contributes only its pois and areas (for example WS8's `z-pilot-areas.json`).
- **Local-edit record (IndexedDB, store `local`, key `current`):** `{ base_rev, data: <App JSON>, modified_at, dirty }`.
- **Recovery slots (store `recovery`):** up to 5 `{ id, created_at, reason: "import" | "reset" | "take-published", data }`. The oldest is dropped first.
- **Assembly happens once.** `tools/assemble_routes.py` builds `routes.json` from `content/seed/*.json` (each file holds one zone object plus its routes, pois and areas). It refuses to run if `routes.json` exists unless given `--force`, and it then backs up to `build/routes.backup.<ts>.json`. After a **full** assembly (no `--pilot`) the seeds move to `content/archive/`. A pilot assembly leaves the seeds in place.

## geojson-mapping
`toGeoJSON(app)` lives in `web/js/model.js`. Its output is derived and never stored. It produces these FeatureCollections:

| Source id | Geometry | Properties |
|---|---|---|
| `routes-descent` | LineString | `id, num, zone, name, color, approx` |
| `routes-skin` | LineString | `id, num, zone, name, color` |
| `zone-info` | Point at `info_point` | `id, name, color` |
| `pois` | Point | `id, name, type` |
| `areas` | Polygon | `id, name, kind` |

Empty lines (fewer than 2 points) are skipped.

## tiles
- **Location and scheme:** `web/tiles/<layer>/{z}/{x}/{y}.png`. XYZ (Web Mercator, Google scheme), 256 px, PNG.
- **Zoom range (full, per `docs/decisions/zoom-limits.md`):** every tile layer z10–15; no z16 overlays. Map camera minZoom 11, maxZoom 17 (overzoom).
- **Manifest:** `web/tiles/tiles.json`:

```jsonc
{ "dem_version": "2026-11-pilot", "bounds": [w, s, e, n],
  "layers": { "dem": {"minzoom":10,"maxzoom":15,"encoding":"terrarium"},
              "quality": {...}, "slope": {...}, "aspect": {...}, "elev": {...} },
  "analysis_zoom": 15,
  "legends": { "slope": [{"min":27,"max":30,"color":"#…","label":"27–30°"}, …],
               "aspect": [{"sector":"N","color":"#…"}, …], "elev": [...], "quality": [...] },
  "sources": [{"code":1,"name":"LidarBC 2018","native_res_m":1,"vertical":"CGVD28 (probable)"}, …] }
```

- **DEM (Terrarium):** `elev = R*256 + G + B/256 − 32768`. Missing cells (quality code 0) are **filled with the nearest valid elevation** (distance-transform fill), so the 3D mesh never spikes. Whether a cell is missing comes only from the `quality` tile (code 0). Metrics exclude those samples, and the overlays hatch them.
- **Quality codes** (also the `quality` tile colours):

| Code | Meaning | Colour | Alpha |
|---|---|---|---|
| 0 | missing | `#9e9e9e` (hatched) | 200 |
| 1 | LidarBC 2018 (1 m) | `#2b8a3e` | 90 |
| 2 | HRDEM lidar 2017 (1 m) | `#74b816` | 90 |
| 3 | MRDEM-30 fallback | `#e8590c` | 120 |
| 4 | blend zone | `#f08c00` | 140 |

  The `quality` tile is **display only**: its colours are semi-transparent, and canvas decoding premultiplies alpha, so its channels cannot be read back reliably.
- **Quality code tiles (`qcode/`)**, for analysis:
  - opaque 8-bit greyscale PNG at `analysis_zoom` only
  - pixel value = quality code 0–4, exactly
  - the sampler reads the code from these tiles.
  - `tiles.json.layers.qcode = {minzoom: A, maxzoom: A, encoding: "gray-code"}`.
- **Slope/aspect grid.** Slope and aspect use Horn's method on the Web-Mercator pixel grid of the zoom concerned, with cell size = `40075016.686 / (256·2^z) · cos(lat of the row)` metres. Aspect is the direction the slope faces, in degrees clockwise from N. The sampler (WS4) must use the same cell size at `analysis_zoom`.
- **Satellite imagery** (user request 2026-11-24, WS10): `web/tiles/sat/{z}/{x}/{y}.jpg`, z10–14, 256 px JPEG (quality ~80), Sentinel-2 L2A true colour (B04/B03/B02, 10 m), one cloud-free late-summer mosaic clipped to the project bbox, transparent nowhere (no alpha; outside the data is not written). Own manifest `web/tiles/sat/sat.json` (NOT in `tiles.json`, which WS1 owns): `{"minzoom":10,"maxzoom":14,"bounds":[w,s,e,n],"date":"YYYY-MM-DD"|"YYYY-MM-DD/YYYY-MM-DD","scenes":[ids],"attribution":"Contains modified Copernicus Sentinel data <year>"}`. Display only: never used by metrics.
- **Slope angle bands:** Horn's 3×3 slope on the analysis grid.
  - Classes: <27 transparent, 27–30, 30–35, 35–40, 40–45, ≥45°.
  - Use the standard avalanche palette: yellow `#ffe066` → orange `#ff922b` → red `#f03e3e` → purple `#ae3ec9` → black/grey `#343a40`.
- **Aspect:** 8 sectors centred on N, NE, …, NW, on a colour wheel with **S = red** (user request, 2026-11-23). Slope <10° is transparent. Palette: N `#1971c2`, NE `#12b886`, E `#82c91e`, SE `#fab005`, S `#e03131`, SW `#e64980`, W `#be4bdb`, NW `#7950f2`.
- **Elev (contour shading):** 100 m hypsometric bands, ~1400–2900 m, valley green to alpine white.
- **No-data in every overlay:** a hatched grey pattern (diagonal 45°, `#9e9e9e`, alpha 160). It must be distinct from transparent/low-angle, and the legends show both.
- **Display only:** a reference line at **2,100 m**, labelled "2,100 m reference (not mapped treeline)".

## layers
These are the fixed MapLibre ids. Sources and layers share names where it's 1:1.

| Group | Ids |
|---|---|
| Base | `bg`, `satellite` (raster, from `sat.json`; default off), `hillshade`, `contours` (+`contours-label`), `elev-ref-2100` |
| Terrain overlays | `elev-tint`, `aspect`, `slope`, `quality` |
| Basemap vectors | `lakes`, `creeks`, `glaciers` (+`glaciers-label`) |
| ATES | `ates-zones`, `ates-paths`, `ates-decision`, `ates-boundary`, `ates-road` |
| Content | `areas-fill`, `areas-line`, `routes-skin`, `routes-descent`, `route-highlight`, `routes-label`, `zone-info`, `pois` |
| Editor (WS6 only) | `edit-vertices`, `edit-midpoints`, `edit-line` |
| Auxiliary (added by WS3) | `routes-descent-casing`, `route-highlight-skin`, `zone-info-label`, `pois-label`, `elev-ref-2100-label`, `outside-mask` (flat fill outside the tile bounds; the display-only `kdem://` protocol edge-extends DEM tiles there, while the sampler reads the plain tiles) |

The terrain source is `dem` (raster-dem, encoding `terrarium`).

**Default draw order** (bottom to top):
1. `bg`
2. `satellite`
3. `elev-tint`
4. `hillshade`
5. `aspect`
6. `slope`
7. `quality`
8. `lakes`
9. `creeks`
10. `glaciers`
11. `contours`
12. `elev-ref-2100`
13. `ates-zones`
14. `ates-paths`
15. `ates-boundary`
16. `ates-road`
17. `areas-fill`
18. `areas-line`
19. `routes-skin`
20. `routes-descent`
21. `route-highlight`
22. `routes-label`
23. `pois`
24. `ates-decision`
25. `zone-info`

## metrics
These definitions are implemented identically in `web/js/terrain-sampler.js` and `tools/metrics.py` (WS4). Parity is tested with `tools/fixtures/metrics_fixture.json`: results must agree within 1 m and 0.5°.

- **Source.** Sample only the **analysis DEM**: the `dem` tiles at `tiles.json.analysis_zoom`, decoded directly.
  - Never use `map.queryTerrainElevation` (it includes exaggeration and LOD effects).
  - Exaggeration is a display setting only.
- **Densify:** every 5 m along the line (geodesic). **Elevation:** bilinear. **Quality:** nearest-neighbour from the `quality` B channel.
- **Profile smoothing:** a 20 m centred moving average (5 samples). It is used only for the cumulative numbers.
- **Length:** horizontal geodesic length (m).
- **Net drop:** `z(start) − z(end)`, raw samples.
- **Cumulative descent / ascent:** the sum of the negative / positive steps in the *smoothed* profile.
- **Terrain slope (under the track):** Horn's 3×3 on the analysis grid at each sample. This is the same definition as the slope angle bands.
  - Reported as `terrain_slope_max`: the maximum over runs of at least 20 m (the max of the 20 m running minimum).
  - Also reported: `len_ge30_m` and `len_ge35_m`.
- **Along-track grade:** `atan(|Δz| / Δs)` over a 20 m window, reported as `pitch_max_deg`. It is never mixed with terrain slope.
- **Coverage:** `pct_by_source` (codes 0–4).
  - `low_confidence = (pct[0] + pct[3] + pct[4]) > 25%`.
  - Samples with code 0 are excluded from every statistic and drawn as gaps in the profile, never interpolated.
- **Output object:** `{length_m, net_drop_m, cum_descent_m, cum_ascent_m, terrain_slope_max, len_ge30_m, len_ge35_m, pitch_max_deg, pct_by_source, low_confidence, dem_version}`.
- The guide's figures are shown beside the computed ones and never overwritten.

## modules
These are ES modules under `web/js/`, with no build step. Each module's owner is in brackets. A module may only call the exported API of another.

- `map.js` [WS3]
  - `initMap(el, {tilesJson}) → Promise<map>`
  - `setLayerVisible(groupId, bool)`, `setLayerOpacity(groupId, 0..1)`, `getLayerState()`
  - `setContent(featureCollections)`
  - `highlightRoute(id|null)`
  - `flyHome()`
  - events: `map.on('kokanee:pick', {lngLat, features})`
- `ui.js` [WS3]
  - `initUI(map, store)`, `openZone(id)`, `openRoute(id)`, `closePanel()`
  - `showReadout(lngLat, sample)`
  - `toast(msg)`
  - `registerMenu(section, items)`: WS6 and WS7 add menu items here
- `model.js` [WS5]: `toGeoJSON(app)`, `validate(app) → {ok, errors[]}`, `diff(a, b) → {added[], changed[], removed[]}` keyed by kind and id
- `terrain-sampler.js` [WS4]
  - `initSampler(tilesJson, baseUrl)`
  - `sample(lngLat) → {elev, slope, aspect, quality}`
  - `profile(coords) → {samples[], metrics}`
- `store.js` [WS6]
  - `load()`, `get()`, `update(fn, label)`, `undo()`, `redo()`
  - `exportJSON({publish})`, `importJSON(file)`, `reset()`, `recoverySlots()`, `restore(slotId)`, `exportGPX()`
  - `on('change', cb)`
- `editor.js` [WS6]: `enable(map, store)`, `disable()`, `isEnabled()`
- `offline.js` [WS7]: `initOffline(ui)`, `verify() → {ready, missing, bytes, persisted}`, `on('status', cb)`
- `app.js` [WS3]: the bootstrap. It loads `tiles.json` and `routes.json` through `store.load()` and wires the modules together.

## ui
- **Breakpoint:** under 768 px wide is "mobile", which uses a bottom sheet (peek height 30%, expandable). Otherwise a 380 px right-hand side panel.
- **Tokens:** CSS custom properties in `web/style.css` `:root`:
  - `--bg`, `--fg`, `--panel`, `--accent`, `--danger`, `--radius: 10px`
  - `--tap: 44px` (minimum touch target)
  - a system font stack
  - dark mode via `prefers-color-scheme`.
- **Zone palette** (in this order):

| Zone | Colour |
|---|---|
| z-tanal | `#d9480f` |
| z-robert-smith | `#5f3dc4` |
| z-nansen | `#1971c2` |
| z-giegerich | `#0c8599` |
| z-john-carter | `#2b8a3e` |
| z-pyramid | `#e8590c` |
| z-longer-tours | `#c2255c` |
| z-si (Summits & Icefields) | `#495057` |
| z-hut (hut info) | `#868e96` |

- **Line styles:**
  - Descent: solid, 4 px, zone colour, with a white 1.5 px casing.
  - Skin: dashed `[2, 2]`, 3 px.
  - Highlight: 8 px, `#fff` at 0.9 alpha underneath the line.
  - `approx: true` routes: label suffix "≈".
- **Legends:** a swatch and label for each class, always including "No data" (hatched) as distinct from "transparent = below range".
- **On-screen legend** (user request, 2026-11-23): while `aspect` or `slope` is visible, a compact legend card stays on the map (not only inside the layers menu), one block per active layer, built from `tiles.json.legends`. Aspect is drawn as a small 8-sector compass rose. Desktop: bottom-left above the offline badge. Mobile (<768 px): a compact strip under the header, hidden while the bottom sheet is expanded. It must not cover the map controls or the scale bar.
