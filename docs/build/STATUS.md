# Build status

The orchestrator maintains this log. Agent reports are appended unchanged (format: `ORCHESTRATOR.md#report`).

| Card | Pilot | Full | Branch | Notes |
|---|---|---|---|---|
| WS0 foundations | done | n/a | main | runtime pinned; datums verified; DEM survey done; docs written |
| WS1 terrain | done (+qcode z15, exact readback verified) | — | main ecfd90b | 11 MB pilot tiles; lidar-MRDEM median +0.5 m, no correction; seam 3/302k flagged |
| WS2 basemap | done | — | main 6636953 | 64 zones/24 paths/6 decisions; 75 lakes, 330 creeks, 4 glaciers (undated: TRIM fallback) |
| WS3 viewer | partial | — | main | viewer works on pilot tiles (mobile verified); readout/profile await WS4; scale bar + desktop panel unverified |
| WS4 metrics | done | — | main | parity 3/3 exact; 3.5 km profile 51 ms cold / 5 ms warm |
| WS5 text | done | — | main | 41 routes seeded; pilot routes.json (r26, r34) validates in Py + JS |
| WS6 store+editor | running | — | | |
| WS7 pwa | partial | — | main | SW/offline built; browser pane blocks SW registration, so offline acceptance must run in real Chrome; index.html tags forwarded to WS3 |
| WS8 geometry | done | — | main | r26 OK (-25% vs guide, MRDEM 100%); r34 OK via Keyhole notch (low confidence); closure is a TEST polygon; r34 skin steep step open |
| WS9 QA | blocked | — | | |

## Gates
- **A.** DEM source and data downloads: **APPROVED by the user 2026-11-23**. Covers:
  - the recommendation in `docs/decisions/dem-source.md` (HRDEM 2017 window, MRDEM window)
  - the BC Freshwater Atlas lakes/streams/glaciers download.
- **B.** Pilot review (PC + phone): not yet.
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
