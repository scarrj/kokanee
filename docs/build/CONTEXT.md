# Shared context (read once, about 1 page)

**Goal.** A 3D, offline, editable ski-touring topo for a week-long hut trip to Kokanee Glacier Cabin (Kokanee Glacier Provincial Park, near Nelson BC). It is used on a PC (for editing) and on phones in the field with no signal.

**Content.** The guide (`docs/source/topo.md`) has:
- 7 zones with 35 routes from backcountryskiingcanada.com
- 6 "Summits & Icefields" (S&I) descents
- hut info.

Each route gets a **descent** line (solid) and a **skin** (uphill/approach) line (dashed). Line placement is interpretation, so every line starts as `approx: true` and the user edits it later.

**Terrain** (see `docs/decisions/dem-source.md`). Elevation comes from three sources:
1. LidarBC 2018, 1 m
2. NRCan HRDEM lidar 2017, 1 m
3. NRCan MRDEM-30 fallback.

The **park core** (the cabin, Tanal, Robert Smith, Nansen, Giegerich and the north half of the glacier) is only **30 m** data. Detail is smoothed there, so the app must say so: the quality layer, the readout and the low-confidence badge on metrics.

**Coordinates.** App data is WGS84 `[lon, lat]`. Analysis uses EPSG:2955 (NAD83(CSRS) / UTM 11N). The guide's grid refs are NAD83 (verified). The cabin is at −117.194844, 49.771692.

**Stack**
- `web/`: index.html, `js/*.js` ES modules, style.css, `vendor/` (MapLibre GL JS v5, maplibre-contour), `data/` (routes.json, ates.geojson, basemap.geojson), `tiles/` (generated).
- Hosted at `https://scarrj.github.io/kokanee/`.
- Offline via a service worker plus `asset-manifest.json`. "Offline ready" is a state the app has *verified*.
- `tools/`: Python 3.12 via uv (rasterio, numpy, pyproj, scipy, pillow, pystac-client, shapely). Outputs go to `build/` (ignored) and `web/`.

**Glossary**

| Term | Meaning |
|---|---|
| skin track | The uphill route on climbing skins |
| descent | The ski line |
| aspect | The compass direction a slope faces |
| slope angle bands | Terrain steepness classes (27–30, 30–35, 35–40, 40–45, ≥45°) |
| ATES | Avalanche Terrain Exposure Scale zones: Simple / Challenging / Complex (green / blue / black). Shown read-only from the KMZ |
| switch over | Changing between skin and ski mode |
| S&I | Summits & Icefields 2 guidebook |
| app JSON | `web/data/routes.json`, the one editable content file |
| analysis DEM | The `dem` tiles at `analysis_zoom`. All metrics use this |
| quality code | Elevation source per pixel: 0 missing, 1 lidar 2018, 2 lidar 2017, 3 MRDEM, 4 blend |

**Pilot first.** Phase 1 builds everything for a 6 × 5 km area around the cabin and up Kokanee Glacier to the Keyhole, covering:
- the cabin
- a lidar/fallback seam
- one closure polygon
- route **r26** Cat Fish Comes Home (straightforward)
- route **r34** The Keyhole (ambiguous, approach undocumented).

Full production starts only after the user reviews the pilot.
