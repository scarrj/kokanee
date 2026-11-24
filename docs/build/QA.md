# QA checklist and defects (owned by WS9)

Pilot run 2026-11-23, browser pane on a PC (desktop 1280x720 and mobile preset 375x812), plus `tools/check_all.py`. Legend: [x] pass, [~] pass with a note, [ ] not run, FAIL = see defect.

Automated: `cd tools && python -m uv run check_all.py` passes 8/8 (smoke_runtime, validate_routes, check_routes, metrics parity 3/3, model tests, tiles.json schema, asset-manifest freshness, layer-id lint). `--quick` skips the network smoke test. The manifest check proves the generator runs on a copy of `web/`; `web/asset-manifest.json` itself is built by CI and is not on disk locally (run `python tools/make_asset_manifest.py web` before the Chrome offline run).

## Checklist (from the approved plan's Verification section)
- [x] Runtime: `smoke_runtime.py` passes in the pinned env
- [x] Datums: residual table present (`docs/decisions/horizontal-datum.md`, 14 table rows); vertical record lists every source (LidarBC probable CGVD28 unconfirmed, HRDEM and MRDEM CGVD2013)
- [x] DEM: coverage map and hillshade comparison exist (`dem-coverage.png`, `dem-hillshade-compare.png`); not re-reviewed visually by WS9
- [~] DEM: residual map inspected before the correction: only the residual statistics table exists (median +0.5 m, MAD 1.4 m); no residual map image is saved (defect 1)
- [~] DEM: seam report shows no artificial steep bands: 3 of 302,518 band cells flagged (0.001%, worst +9.7 deg). Report numbers only; `seam-report.png` not re-viewed
- [x] DEM: quality mask covers the whole bbox: 1,200 grid samples over the bounds, 0 with code 0 (298 lidar 2018, 855 MRDEM, 47 blend)
- [x] Routes: `check_routes.py` passes; r34 gets a >=20 m steep flag only as a warning; % by source printed (lidar2018 31%, MRDEM 64%, blend 5%)
- [x] Metrics: Python and JS parity 3/3, exact (0.000 m / 0.000 deg)
- [x] Layers: all 17 group toggles work (map layer visibility flips and restores) and each opacity slider changes the paint opacity; legends for contour shading, aspect, slope carry "No data (hatched)" plus a separate "Transparent: below range" row
- [~] Layers: the quality legend lists "missing" with a plain grey swatch, not "No data" and not hatched (defect 6)
- [~] Aspect spot-check: Tanal W face. East shore of Tanal Lake, 150-600 m east: slope 34-36 deg, aspect 240-243 (WSW, which falls in the SW sector), and it agrees with a finite-difference downslope of 236-242. Reads WSW, not due W. Tanal Peak itself is outside the pilot bbox (north edge 49.7829). MRDEM 30 m data
- [x] Aspect spot-check: John Carter N side: 60-100 m north of the lidar summit (2609 m) aspect 343-347 (N), slope 29-30, finite-difference downslope 344-345
- [x] ATES sub-toggles: Zones, Paths and boundary, Decision points each toggle only their own layers (`ates-zones`; `ates-paths`+`ates-boundary`+`ates-road`; `ates-decision`); parent toggles all. Decision-point text not visually inspected at close zoom
- [x] Tap readout shows elevation, slope, aspect, ATES class and "NRCan MRDEM-30 (30 m) - detail smoothed" for the source
- [~] Route panel: guide figures beside computed metrics, low-confidence banner, profile charts present. The r34 banner is triggered by the skin line (72% MRDEM) while the coverage line below it shows the descent only (lidar 94%, blend 6%) (defect 5). Profile gaps not exercised (no code-0 samples on either route)
- [x] Editor: text edit, vertex add/delete, undo/redo, bad-coordinate edit rejected by validation, autosave across reload (edit survived a reload), editor toolbar and select are all >=44 px on mobile. Vertex drag, draw line and draw polygon by pointer were not re-run (WS6 reported them in its own run)
- [x] Import: invalid file rejected with a dialog listing the schema errors; no recovery slot created
- [x] Import: valid file shows a diff (0 added, 2 changed, 0 removed, names the routes), then creates an "import" slot holding the pre-import data; restore brought the old data back
- [x] Conflict dialog when published rev (5, injected via `load({published})`) is newer than local base_rev (0) and local is dirty; shows both sides; "Take published" applied and created a "take-published" slot. Other two buttons not re-run
- [x] Reset snapshots first ("reset" slot held the pre-reset edit; local returned to published, not dirty)
- [x] Publish export bumps `content_rev`: dialog reports "content_rev 1" from 0; local stays at 0. The downloaded file itself was not inspected
- [x] GPX parses: 4 tracks (#26 and #34, descent and skin), 87 track points, no parser error
- [ ] Offline: badge "Offline ready" only after verify: NOT RUN: needs real Chrome. In the pane the badge sits at "Downloading map... 0%" forever (SW registration never resolves), see defect 3. Forcing a verify gives "Not offline ready" with a Retry button (correct not-ready state)
- [ ] Offline: deleting one cached file gives "Not offline ready": NOT RUN: needs real Chrome
- [ ] Offline: with the server stopped, a reload still works: NOT RUN: needs real Chrome
- [~] Mobile preset (375x812): bottom sheet works (peek, route content), no control under 44 px in main bar, map controls, layers drawer, menu, route panel or edit toolbar; scale bar visible (bottom right of the map, but its lower edge is partly under the open bottom sheet) (defect 4). The only sub-44 control is the offline badge Retry button, 41x28 (defect 2)
- [ ] Phone: pack size and performance recorded; airplane-mode test after Add to Home Screen: NOT RUN: needs the user's phone. Pack size and PC frame costs are in `docs/decisions/zoom-limits.md`

## Pilot measurements (full numbers in `docs/decisions/zoom-limits.md`)
- Pack: 10.5 MB at maxzoom 15 everywhere, 13.1 MB today (overlays to z16), about 30 MB with a z16 DEM.
- `profile()` 3.1 km line: 66 ms first call, 3 ms warm.
- Frame cost, terrain + slope + aspect, in the pane (PC GPU, not a phone): desktop 20.7 ms mean (about 48 fps), mobile preset 11.9 ms mean (about 84 fps).

## Defects
<!-- [WSn] severity: symptom (repro) -->
1. [WS1] low: no residual map image saved, so "residual map inspected before the correction" can only be checked from stats (see `docs/decisions/vertical-datum.md`; `ls docs/decisions/*.png` shows coverage, hillshade compare and seam only)
2. [WS7] low: offline Retry button is 41x28 px, under the 44 px target (mobile preset 375x812, Menu > Re-verify offline data, badge turns "Not offline ready", measure `#offline-badge button`)
3. [WS7] low: when the service worker never installs (browser pane) the badge stays "Downloading map... 0%" indefinitely instead of a not-ready state; `register()` never resolves or rejects (load the app in the pane, wait, badge never changes). Suggest a timeout that emits `missing`
4. [WS3] low: on mobile the offline badge (fixed bottom-left, z-index 50) covers the first rows of the open bottom sheet, and the bottom-right scale bar is half hidden behind the sheet (375x812, open any route, look at the bottom edge)
5. [WS3] low: route panel shows one coverage line (descent only) under a low-confidence banner that can come from the skin line (r34: banner with "Coverage: lidar 2018 94%, blend 6%"; skin is 72% MRDEM). Show both lines or say which one triggered it
6. [WS3] low: quality legend entry for code 0 reads "missing" with a plain grey swatch (taken from `tiles.json` legend), not "No data" with the hatched swatch used by the other legends
7. [WS3] medium: no `maxBounds`, `minZoom` 8 and `maxZoom` 18: panning or tilting beyond the DEM bounds shows tall extruded streaks and walls where there is no terrain tile (home view at pitch 60 already shows them at the top and right edge). Suggest `maxBounds` = tile bounds plus margin, `minZoom` ~11, `maxZoom` 17 (see zoom-limits.md)
8. [WS3] low: `initMap` hangs on style load when the pane is not rendering (WS6 report). Seen again: after a reload `window.kokanee` stays undefined until a screenshot forces a frame, and rAF never fires. A timeout (WS6 asked for one) would not fix the pane quirk but would stop a real stall hiding behind it
9. [WS3] low: `vendor/fonts/Noto Sans Regular/8704-8959.pbf` returns 404 (glyph range for the approximately-equal sign); MapLibre falls back to local rendering (console warning on every load)
10. [WS8] low: confirmed: r34 skin has a steep step near 487,900 / 5,511,650 (lidar max 71 deg, 0.5% over 45 deg); not re-measured
11. [WS9 note, orchestrator] the browser origin localhost:8765 had a leftover Cache Storage entry `kokanee-ce5697d63d16` from WS7's scratch page (10-file manifest, mentions `tiles/dem/1/0/0.png`). WS9 deleted it so verify() reports "nothing cached yet". Before the real-Chrome offline run, run `python tools/make_asset_manifest.py web` (no `web/asset-manifest.json` exists locally) and use a clean profile
12. [WS3/WS6, info] the viewport 0x0 / dormant-map behaviour of the pane makes long `await`s in scripts hang until a screenshot is taken; automated browser checks should poll with short calls


## Full run (2026-11-23, full bbox, routes.json in review mode: 9 zones, 41 routes)
Automated: `check_all.py` 8/8 pass (4,822 files in the manifest). Browser pane desktop 1280x720 and mobile preset 375x812; the offline run used real Chrome because the pane cannot register a service worker (see defect 14).

- [x] Zones: all 9 info panels open with a description and the right route count (Giegerich 3, Hut 0, John Carter 11, Longer Tours 2, Nansen 6, Pyramid 5, Robert Smith 2, S&I 6, Tanal 6; matches the data). Hut panel shows text and no route list.
- [x] Routes: all 41 opened programmatically. 40 show guide cards, descent and skin profile charts, the low-confidence banner and one coverage line for the descent and one for the skin (pilot defect 5 is fixed). No NaN or undefined values. si6 (Summit ski options) has no lines or profile by design, 4 cards only.
- [x] Camera limits: maxBounds = tile bounds + 2 km, minZoom 11 (clamps to about 11.8 at this viewport), maxZoom 17 (19 clamps to 16.9). Pitch 60-70 at the W, N, S edges and the NE corner: terrain fades to the flat mask with no streaks or walls (pilot defect 7 is fixed).
- [x] Legend desktop: on-map legend shows when an overlay is on (aspect rose + slope bands + "No data"), bottom-left above the offline badge, collapsible, hidden when no overlay is on.
- [~] Legend mobile: legend sits top-left under the header and does not overlap map controls, but a tap readout appears at the same spot and fully covers it (defect 13).
- [x] Aspect, new palette: a south-facing slope (49.7525, -117.218; sampler slope 40, aspect 178-191) renders red/pink; N is blue, E green, SE amber on the rose. Not re-checked on glacier lidar.
- [x] Offline (real Chrome, localhost): first load to "Offline ready" 34 s (30 s download of 4,822 files / 100.3 MB, 4 s verify; localhost disk speed, so a phone on the real network will be slower). Badge reads "Offline ready - rev 0 - DEM v2026-11-full - 102 MB". Deleting `tiles/dem/12/713/1392.png` then Menu > Re-verify gives "Not offline ready - 1 missing" with Retry; Retry took 5.5 s and returns to ready, the tile is back in the cache. Server-stopped reload not run. Calling `offline.verify()` directly does not update the badge (only the run/retry paths emit), expected.
- [x] Frame cost, terrain + aspect + slope, pitch 60, bearing sweep, `map.redraw()` + `readPixels`, 90 frames at cabin / north (49.805) / south (49.63) at z13.5: desktop 1280x668 mean 14.3 / 14.4 / 13.3 ms (p95 33 / 23 / 28 ms); mobile preset 375x812 dpr 2 mean 11.9 / 10.9 / 10.6 ms (p95 20 / 17 / 22 ms). PC GPU only; phone numbers still needed.
- [x] `profile()` r35 skin (79 vertices, 1,809 samples, about 9 km): 138 ms cold, 94 ms warm (the pilot 3 km line took 66 / 3 ms).
- [~] Slow first paint: after a jump to z15.5 with terrain on the map is blank for 2 s (Chrome) to several seconds (pane) while z15 tiles decode (defect 15).

### Full defects
13. [WS3] medium - mobile: the on-map legend and the tap readout occupy the same top-left spot (8,58) and the readout hides the legend entirely - 375x812, turn on Aspect, tap the map
14. [WS7] low - the browser pane (localhost and 127.0.0.1) cannot register the service worker ("An unknown error occurred when fetching the script"), so the offline badge stays in a not-ready state there and offline needs real Chrome; pilot defect 3 (no timeout) now shows as a failed register in the console - open the app in the pane, console
15. [WS3] low - after a long camera jump at pitch 50 and z15.5 the whole map is blank for 2-8 s (nothing, not even basemap lines, until DEM tiles decode with terrain on); with terrain off it paints at once - jumpTo({zoom:15.5}) with terrain on
16. [WS3] low - Hut panel shows a "Routes (0)" style empty state and no routes; confirm this is intended - open the Hut and access info button
