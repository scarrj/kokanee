# Build status

The orchestrator maintains this log. Agent reports are appended unchanged (format: `ORCHESTRATOR.md#report`).

| Card | Pilot | Full | Branch | Notes |
|---|---|---|---|---|
| WS0 foundations | done | n/a | main | runtime pinned; datums verified; DEM survey done; docs written |
| WS1 terrain | done (+qcode z15, exact readback verified) | done | main 8394a9b | 11 MB pilot tiles; lidar-MRDEM median +0.5 m, no correction; seam 3/302k flagged |
| WS2 basemap | done | done | main | full: 296 lakes, 3067 creeks, 5 glaciers dated 2021 (BC GBA_GLACIERS_SP, 30 m); 1.31 MB |
| WS3 viewer | partial | — | main | viewer works on pilot tiles (mobile verified); readout/profile await WS4; scale bar + desktop panel unverified |
| WS4 metrics | done | — | main | parity 3/3 exact; 3.5 km profile 51 ms cold / 5 ms warm |
| WS5 text | done | — | main | 41 routes seeded; pilot routes.json (r26, r34) validates in Py + JS |
| WS6 store+editor | done | — | main | 5/5 acceptance in browser pane; conflict dialog, recovery slots, GPX, publish rev bump; mobile 44px handles |
| WS7 pwa | partial | — | main | SW/offline built; browser pane blocks SW registration, so offline acceptance must run in real Chrome; index.html tags forwarded to WS3 |
| WS8 geometry | done | — | main | r26 OK (-25% vs guide, MRDEM 100%); r34 OK via Keyhole notch (low confidence); closure is a TEST polygon; r34 skin steep step open |
| WS9 QA | done (offline items need real Chrome) | — | main | check_all 8/8; 12 defects in QA.md; zoom-limits.md written |

## Gates
- **A.** DEM source and data downloads: **APPROVED by the user 2026-11-23**. Covers:
  - the recommendation in `docs/decisions/dem-source.md` (HRDEM 2017 window, MRDEM window)
  - the BC Freshwater Atlas lakes/streams/glaciers download.
- **B.** Pilot review (PC + phone): **APPROVED by the user 2026-11-23** ("Lets expand…"), with feedback: on-screen legend for aspect/slope; S aspect red; satellite layer wanted (source TBD). Phone performance numbers not yet given.
- **C.** First push to `main` / Pages deploy, and the git identity: not yet.

## Open items for the user
- The closure polygon: what is its source or extent? Not supplied, so the pilot uses a labelled test polygon.
- Git commit identity: set repo-local to `scarrj <scarrj@users.noreply.github.com>` (a non-private default); the user can change it before Gate C.
- Public vs private repo: guide text and ATES data would be republished if the repo/site is public. Decide before Gate C.

## Reports
### WS0 (orchestrator) 2026-11-23
```
CARD: WS0 foundations | SCOPE: phase0 | STATUS: done
BRANCH: main
FILES: tools/{pyproject.toml,uv.lock,smoke_runtime.py,extract_topo.py,datum_check.py,dem_survey.py,make_geo_reference.py}, docs/**, CLAUDE.md, .gitignore
ACCEPTANCE: smoke_runtime.py -> 4x PASS (GDAL 3.12.2; MRDEM COG remote read; NTv2 ca_nrc_ntv2_0)
DECISIONS: guide refs are NAD83 (H83 median ~71 m vs H27 ~266 m); vertical CGVD28->CGVD2013 ~ +0.2 m (no correction needed on that basis); DEM tiers lidar2018 > HRDEM lidar2017 > MRDEM-30
ISSUES: park core (cabin, Tanal, R. Smith, Nansen, Giegerich, N glacier) has no lidar in any catalogue -> 30 m only
```

### WS2 basemap (pilot)
```
CARD: WS2 basemap | SCOPE: pilot | STATUS: done
FILES: tools/convert_ates.py, tools/build_basemap.py, web/data/{ates,basemap}.geojson, web/data/ATTRIBUTION.md, content/seed/_pois.json
ACCEPTANCE: convert_ates + build_basemap --scope pilot -> pass (ates 64/24/6/1/1/24; basemap 75 lakes incl Kaslo, 330 creeks, 4 glaciers; 0.32 MB)
DECISIONS: path names normalised "Path 1.0"->"Path 1"; creeks carry `order`; FWA glaciers undated -> survey_date "TRIM, c. 1980s-90s"; 24 POIs from ATES
ISSUES: none (WS3: style ATES by class+layer)
```

### WS5 text (pilot)
```
CARD: WS5 text | SCOPE: pilot | STATUS: done
FILES: content/seed/z-*.json (9), web/data/routes.schema.json, web/js/model.js, tools/{assemble_routes,validate_routes}.py, tools/test_model.mjs, web/data/routes.json
ACCEPTANCE: assemble --pilot --only r26,r34 -> ok; validate_routes PASS; test_model.mjs PASS
DECISIONS: si3 FLAG attached to si3; z-si description written; S&I names authored; z-hut info_point may stay null (no routes)
ISSUES: none
```
### WS7 pwa (pilot)
```
CARD: WS7 pwa | SCOPE: pilot | STATUS: partial
FILES: web/sw.js, web/js/offline.js, web/manifest.webmanifest, web/icons/*, tools/make_asset_manifest.py, .github/workflows/pages.yml
ACCEPTANCE: manifest script pass; verify()/retry() pass in scratch page; SW syntax only (browser pane refuses SW registration)
DECISIONS: per-version cache with __complete marker; routes.json byte check skipped (network-first); #offline-badge bottom-left; registerMenu items {label,onClick}; theme #0b3c5d
ISSUES: WS3 must add head tags + initOffline (forwarded); Pages source must be "GitHub Actions"; offline acceptance needs real Chrome on localhost
```

### WS3 viewer (pilot)
```
CARD: WS3 viewer | SCOPE: pilot | STATUS: partial
FILES: web/index.html, web/style.css, web/js/{app,map,ui,layers-menu,profile-chart}.js, web/vendor/*, .claude/launch.json
ACCEPTANCE: mobile preset: 3D terrain, layers drawer, route panel, toggles OK; 44px targets except WS7 Retry (41x28); only optional-module 404s
DECISIONS: MapLibre 5.24.1, maplibre-contour 0.2.0, vendored Noto Sans glyphs; scale bottom-right; route-highlight under lines; extra ids routes-descent-casing, zone-info-label, pois-label, route-highlight-skin, elev-ref-2100-label; window.kokanee debug
ISSUES: sampler shape {elev,slope,aspect,quality}, profile samples {d,elev,quality} (to WS4); editor menu via ui.registerMenu('edit') (to WS6); DEM no-data spike -> contract changed to nearest fill (to WS1); WS7 Retry button <44px
```

### WS1 terrain (pilot)
```
CARD: WS1 terrain | SCOPE: pilot | STATUS: done
FILES: tools/{build_terrain,make_tiles,terrain_probe,terrain_common}.py, web/tiles/** (11 MB), docs/decisions/{seam-report.md,.png,vertical-datum.md}
ACCEPTANCE: build+tiles pass; John Carter summit 2610.33 m q1; Tanal aspect q3 (100% MRDEM)
DECISIONS: DEM nearest-filled, missing only in quality; lidar2017==lidar2018 in pilot (no seam); lidar-MRDEM median +0.5 m MAD 1.4 m no trend -> no correction; feather 150 m; seam QA 3/302,518 flagged; slope/aspect Horn on mercator grid*cos(lat)
SIZES MB z10..16: dem .01/.03/.11/.38/1.37/4.86/-; quality .00/.00/.01/.01/.03/.07/.19; slope .00/.01/.02/.06/.15/.45/1.22; aspect .00/.01/.02/.05/.14/.36/.93; elev .00/.01/.01/.02/.05/.12/.27 (total 10.97)
ISSUES: quality B-channel unreadable after alpha premultiply -> contract adds opaque qcode/ tiles (WS1 follow-up); vertical-datum status line fixed by orchestrator
```

### WS4 metrics (pilot)
```
CARD: WS4 metrics | SCOPE: pilot | STATUS: done
FILES: web/js/{terrain-sampler,geo}.js, tools/metrics.py, tools/fixtures/metrics_fixture.json, tools/test_metrics_parity.mjs
ACCEPTANCE: metrics.py cabin->John Carter 3496 m, ascent 653 m, slope max 35.1, low_confidence; parity PASS 3/3 (0.000 m / 0.000 deg); browser profile 51 ms cold, 5 ms warm
DECISIONS: haversine R=6371008.8; Horn per containing cell; smoothing over valid samples only; gaps never bridged; len_ge* half-spacing weights; max metrics over 5-sample windows; pct keys "0".."4"
ISSUES: tiles.json qcode (already present, stale read); manifest must include geo.js/terrain-sampler.js/qcode (auto via make_asset_manifest); stray dev servers on :8765; rerun metrics --routes after WS8
```

### WS8 geometry (pilot)
```
CARD: WS8 geometry | SCOPE: pilot | STATUS: done
BRANCH: shared checkout (main), nothing committed
FILES: content/seed/z-longer-tours.json (r34), content/seed/z-john-carter.json (r26), content/seed/z-pilot-areas.json, tools/check_routes.py
ACCEPTANCE: check_routes.py --seeds -> pass. r34 2713->1965 m, 748 m vs 800 (-7%), max 47 deg, 0.2% >45, longest >45 5 m; r26 max 35 deg. Orchestrator: assemble --pilot --only r26,r34 + validate (Py+JS) PASS; metrics --routes written
DECISIONS: r34 descent found by least-slope path search, crosses the Keyhole notch floor ~489,040/5,510,720 (~70 m SE of the ATES point), then SW/W bowl to Kokanee Lake SE shore; skin ends at 489,130/5,510,800. check_routes flags (not fails) any >=20 m stretch over 45 deg
ISSUES: r34 skin has a short steep step ~487,900/5,511,650 (lidar max 71 deg, 0.5% >45); return Kokanee Lake -> cabin only in notes, not drawn
```

### WS6 store+editor (pilot)
```
CARD: WS6 store-editor | SCOPE: pilot | STATUS: done
BRANCH: n/a (shared checkout, not committed)
FILES: web/js/store.js, web/js/editor.js, web/js/conflict-dialog.js, web/js/gpx.js
ACCEPTANCE: browser pane 5/5 pass: drawn line + note persist after reload; bad import rejected, no slot; valid import -> "import" slot, restore OK; conflict dialog (dirty base_rev 1 vs published 2) lists both sides, 3 actions work; GPX 4 named tracks. Also vertex drag/insert/delete, zone i drag, area draw, add/delete route, undo/redo, publish (content_rev+1), reset, mobile layout
DECISIONS: non-dirty local always takes published; dirty==published treated clean; local record adds `base`; load() never blocks boot (store.conflictPending()); load({published}) test hook; recoverySlots() async; restore() does not snapshot; hit-test via map.project(); publish export leaves local state unchanged; menus 'edit' (toggle) and 'data' (exports/import/GPX/reset/Restore:<slot>)
ISSUES: map.js initMap can hang on style.load when the pane is not rendering (suggest timeout, WS3); no app.js/ui.js changes needed; browser pane SW registration error (WS7, known); preview "web" port confusion (8765 serving tiles/)
```

### WS9 QA (pilot)
```
CARD: WS9 QA | SCOPE: pilot | STATUS: done (offline items NOT RUN, need real Chrome)
BRANCH: shared checkout (main), nothing committed
FILES: tools/check_all.py, docs/build/QA.md, docs/decisions/zoom-limits.md
ACCEPTANCE: check_all.py -> 8/8 pass; pane desktop+mobile: layers/legends, ATES, readout source, aspect JC N 343-347, Tanal WSW 242, editor/import/conflict/recovery/publish/GPX pass; quality mask 0 missing
MEASUREMENTS: tiles MB z10..16 .02/.05/.17/.53/1.74/5.89/2.61; pack z15 10.5 MB, current 13.1, z16 DEM ~30; profile 3.1 km 66 ms cold/3 ms warm; frame 20.7 ms desktop / 11.9 ms mobile preset (PC GPU)
DECISIONS: recommend DEM/analysis z15, drop z16 overlays, maxZoom 17, minZoom ~11, maxBounds = tile bounds + margin
ISSUES: 12 defects in QA.md (WS3 x6 incl. medium no maxBounds; WS7 x2; WS1 x1; WS8 x1); badge stuck at 0% in pane; need make_asset_manifest before Chrome run
```

### Fix loop (pilot), orchestrator 2026-11-23
```
QA defects 1-10 fixed and committed: WS1 residual map (patchy, no trend); WS3 x6 (camera limits + kdem edge-extended DEM + outside-mask, mobile badge/scale, per-line coverage, No data legend, style wait, glyph); WS7 Retry 44px + SW-never-installs fallback; WS8 r34 skin re-routed (max 71 -> 38 deg; new stretch on MRDEM only, flagged in notes)
Found by orchestrator in pane, fixed (WS7): verify() percent-encoding mismatch (fonts with spaces never "ready"); SW overwrote per-version manifest; new deploys never re-precached -> sw.js?v=<manifest version>. WS3: offline starts before map; style wait no longer resolves early
Offline acceptance (pane, SW now registers): clean -> Offline ready; new version -> new cache, old deleted; one tile deleted -> 1 missing -> Retry -> ready; empty cache -> Retry rebuilds; server stopped -> reload renders terrain/routes/badge, z12-16.5 pans with 0 errors
Still open: phone measurements (user); zoom-limit decision (drop z16 overlays?); closure extent; return Kokanee Lake -> cabin not drawn
```

### Phase 2 start, orchestrator 2026-11-23
```
User supplied lidar_data/Kokanee_DEM_* (0.75 arcsec, 0.5x0.5 deg, EPSG:2955 + WGS84 copies). Not lidar: CDEM-like. vs lidar on pilot overlap (30 m blocks, n=7969): RMSE 8.9 m, p95 18.5 m, slope RMSE 4.8 deg; MRDEM-30: 5.1 m, 10.2 m, 2.3 deg -> not used; git-ignored
CONTRACTS: aspect palette S=red; on-screen legend (#ui); all tile layers z10-15 (no z16 overlays), camera z11-17
Wave 1 launched: WS1 full (Sonnet high), WS2 full (Sonnet medium), WS3 on-screen legend (Sonnet medium). WS8 fan-out waits for WS1 merged_dem
Open for user: satellite source; closure extent; pilot edits to export (if any); r34 skin MRDEM stretch; Kokanee Lake -> cabin return line; phone numbers
```

### WS2 basemap (full)
```
CARD: WS2 basemap | SCOPE: full | STATUS: done
FILES: tools/build_basemap.py, web/data/basemap.geojson, web/data/ATTRIBUTION.md
ACCEPTANCE: convert_ates (64/24/6/1/1/24) + build_basemap --scope full -> pass; 296 lakes, 3067 creeks (order>=1, 5 m simplify), 5 glaciers; 1.31 MB
DECISIONS: glaciers from WHSE_BASEMAPPING.GBA_GLACIERS_SP (BC Glacier Based Area, OGL-BC), SOURCE_YEAR 2021 (Landsat 8 30 m / Sentinel-2 20 m); survey_date "2021 (Landsat 8 30m, Sentinel-2 20m)"; TRIM fallback kept only for missing years; 1985 layer GBA_GLACIERS_HISTORICAL_SP exists (unused). _pois.json ids unchanged
ISSUES: outlines are coarse (30 m)
```

### WS1 terrain (full)
```
CARD: WS1 terrain | SCOPE: full | STATUS: done (resumed once after an API rate limit)
FILES: tools/make_tiles.py, web/tiles/** (96.95 MB), docs/decisions/{vertical-datum.md,residuals.png,seam-report.md,seam-report.png}
ACCEPTANCE: build_terrain + make_tiles --scope full exit 0; John Carter 2610.33 m q1; Tanal aspect SW q3; check_all --quick 7/7
SOURCES: lidar2018 44.24%, hrdem2017 14.31%, MRDEM 39.57%, blend 1.87%, missing 0; seam 32/1,601,330 flagged (150 m feather)
TILES MB: dem 77.63 (z15 56.14), slope 9.44, aspect 7.27, elev 1.65, quality 0.71, qcode 0.25; 608 z15 tiles per layer
DECISIONS: z10-15 all layers; aspect S=red; residuals lidar-MRDEM +0.78 m MAD 1.47 (n=37,904), HRDEM-MRDEM +0.98 MAD 1.52; lidar2018==hrdem2017; planar tilt <=0.07 m/km -> NO correction
ISSUES: lidar-MRDEM median rises with elevation (-0.5 m at 1300 m -> +2.5 m at 2700 m; MRDEM clips summits): MRDEM-only park-core summits may read 1-2.5 m low. Tiles (97 MB) are committed to git: revisit (LFS or release asset) before Gate C
```

### WS8 z-si (full)
```
CARD: WS8 geometry z-si | SCOPE: full | STATUS: done
FILES: content/seed/z-si.json, build/geometry/z-si.md
ACCEPTANCE: check_routes --seeds pass; si1 591/600 (-1%), si2 801/800, si3 584 (null; fits "s50" as 550), si4 262/250 (+5%), si5 484 (null); skins <1% >35 deg; 63-100% MRDEM
DECISIONS: least-cost paths on 10 m resample; si3 ends at Kokanee Pass = DEM low point 486805/5511705 (BCGNIS point 870 m S on 46 deg slope, not used); S&I "Lemon Pass" = col by Sapphire Lakes; shared skins si5 -> si1 -> si2; confidence si1-3 medium, si4-6 low; info_point 487350/5511150
ISSUES: si6 deliberately no line (list of ski summits); si4 one representative line (Giegerich alternative noted); si2 skin onto upper glacier S of Giant's Kneecap needs user check
```

### WS8 z-tanal (full)
```
CARD: WS8 geometry z-tanal | SCOPE: full | STATUS: done
FILES: content/seed/z-tanal.json, build/geometry/z-tanal.md
ACCEPTANCE: check_routes --seeds pass; r01 -2%, r02 +2%, r05 -18%, r06 +2%; r03 +88% / r04 +38% FLAG (gain_m is from the cabin; descents end at Tanal Lake ~175 m below the cabin); all 100% MRDEM-30
DECISIONS: Tanal Peak = 2259 m DEM summit -117.198731,49.784409 (2337 m point N rejected); S saddle 2091 m; W ridge 2100 m point -117.203525,49.784743; Tanal Lake ~1789 m; r01-r04 share one skin cabin -> Happy Valley -> saddle; r06 skin = r05 skin; r06 descent_m 140 (guide text); confidence r03-r05 medium, r01/r02/r06 low; info_point -117.19518,49.782355
ISSUES: return legs (r01-r04 back to Enterprise Pass, r06 exit) only in notes (one skin line per route)
```
