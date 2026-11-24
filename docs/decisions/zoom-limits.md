# Zoom limits (pilot measurements)

Status: **pilot and full scope measured 2026-11-23** (WS9). Full-scope numbers are in the section at the end.
Pilot area: bbox -117.2153..-117.1319 / 49.7378..49.7829, about 6.1 x 5.0 km (30.5 km2).

## Bytes per layer per zoom (MB, recomputed from `web/tiles` on disk; matches WS1)

| Layer | z10 | z11 | z12 | z13 | z14 | z15 | z16 | total |
|---|---|---|---|---|---|---|---|---|
| dem | 0.01 | 0.03 | 0.11 | 0.38 | 1.37 | 4.86 | not built | 6.75 |
| quality | 0.00 | 0.00 | 0.01 | 0.01 | 0.03 | 0.07 | 0.19 | 0.31 |
| qcode | - | - | - | - | - | 0.03 | - | 0.03 |
| slope | 0.00 | 0.01 | 0.02 | 0.06 | 0.16 | 0.45 | 1.22 | 1.92 |
| aspect | 0.00 | 0.01 | 0.02 | 0.05 | 0.14 | 0.36 | 0.93 | 1.51 |
| elev | 0.00 | 0.00 | 0.01 | 0.02 | 0.05 | 0.12 | 0.27 | 0.48 |
| **all** | 0.02 | 0.05 | 0.17 | 0.53 | 1.74 | 5.89 | 2.61 | 11.00 |

Tile counts per layer: 1, 1, 4, 9, 25, 72, 224 (z10..z16). The DEM grows about 3.55x per zoom (z14 to z15), so the other layers' z16 cost is small (0.19-1.22 MB) but a z16 DEM is not.

## Pack totals (everything in `web/`, from the asset manifest generator: 1,562 files, 13.08 MB today)

Non-tile files (vendor 1.28 MB, data 0.64 MB, js 0.14 MB, other) = 2.08 MB.

| Option | Tiles | Whole pack |
|---|---|---|
| **maxzoom 15 everywhere** (drop the z16 overlays) | 8.39 MB | **10.5 MB** |
| current build: DEM/qcode z15, overlays z16 | 11.00 MB | 13.1 MB |
| **maxzoom 16 everywhere** (z16 DEM estimated 4.86 x 3.55 = ~17.3 MB, up to ~19 MB) | ~28.3 MB | **~30.4 MB** |

Scaling: z15 costs about 0.28 MB per km2 for all layers (0.16 MB/km2 of it DEM). At full scope multiply the tile part by (full area / 30.5 km2); the app files stay at about 2 MB. z16 DEM would be about 0.57 MB/km2 more.

## Resolution argument

Pixel size at lat 49.77: z15 = 3.1 m, z16 = 1.5 m. 71% of the pilot cells are 30 m MRDEM and 4% blend (see `seam-report.md`), so z15 already oversamples the park core 10x and z16 adds no information there. Only the 25% lidar area could use z16, and the analysis DEM (`analysis_zoom` 15) is what every metric reads, so a z16 DEM would not change any number.

## Performance (browser pane, a PC GPU: NOT a phone)

- `profile()` for a 3.1 km line (617 samples): 66 ms on the first call after page load, 3 ms warm. WS4 measured 51 ms cold for 3.5 km. Fine on a phone even at 5x slower.
- Frame cost with 3D terrain + slope + aspect on, bearing sweep, measured as synchronous `map.redraw()` + `readPixels` over 120 frames (the pane does not run requestAnimationFrame unless it is rendering, so a 5 s rAF run was not possible):
  - desktop 1280x668 (dpr 1): mean 20.7 ms, p95 25.3 ms, max 27.5 ms, about 48 fps equivalent
  - mobile preset 375x812 (dpr 2, canvas 750x1520): mean 11.9 ms, p95 15.4 ms, max 18.7 ms, about 84 fps equivalent
  - tiles were still loading on the desktop run (`loaded()` false), so treat as indicative. A real phone GPU will be slower: **ask the user for phone numbers** (rotate with terrain + slope + aspect on, note stutter).

## Recommendation

1. `analysis_zoom` and DEM maxzoom stay **15**. Do not build a z16 DEM (+17 MB for no extra information in 75% of the area, and metrics ignore it).
2. Drop the z16 overlays (slope, aspect, elev, quality): saves 2.6 MB (20% of the pilot pack) and lets MapLibre overscale z15 (set source maxzoom 15; the map can stay zoomable to 17). If sharper slope shading over the lidar patch is wanted later, build z16 for slope only (1.22 MB) there.
3. Pack target: pilot about 10.5 MB; full scope = 2 MB + 0.28 MB/km2 x area. Check this against the phone's free storage and the iOS cache budget before the full build.
4. Cap the map: `maxZoom` 17 (z15 tiles overscaled twice is already blurry), `minZoom` 11 and `maxBounds` = tile bounds plus a margin. Today minZoom 8 / maxZoom 18 / no maxBounds, so panning or zooming out shows extruded streaks beyond the DEM edge (see QA.md defect).
5. Revisit after phone numbers: if the phone drops under about 30 fps with terrain + 2 overlays, reduce `pixelRatio` on touch devices or drop terrain exaggeration/hillshade first, not zoom.


## Full scope (measured 2026-11-23)

Full bbox -117.2711..-117.0761 / 49.6028..49.8234 (about 14.2 x 24.5 km, 350 km2), tiles z10-15 for every layer (no z16).
- Pack: `web/asset-manifest.json` total_bytes = **100,253,176 B (100.3 MB, shown as 102 MB in the badge, 4,822 files)**. This is about 9.5x the pilot 10.5 MB pack, close to the 2 MB + 0.28 MB/km2 estimate (about 100 MB).
- Precache on localhost in real Chrome, cold: 30 s download + 4 s verify = **34 s to "Offline ready"**. On a phone over the hut-trip network, scale by bandwidth (100 MB at 20 Mbit/s is about 40 s, at 5 Mbit/s about 3 min). One missing tile re-verify + Retry: 5.5 s.
- Frame cost (terrain + aspect + slope, pitch 60, PC GPU): desktop mean 13-14 ms, mobile preset 11-12 ms. `profile()` of the longest route (r35 skin, about 9 km, 1,809 samples): 138 ms cold, 94 ms warm.
- Camera limits are in: maxBounds = tile bounds + 2 km, minZoom 11, maxZoom 17; no edge streaks at pitch 60-70.

Recommendation (current):
1. Keep maxzoom 15 for all layers and `analysis_zoom` 15. A z16 DEM would add about 200 MB at full scope for no information over the 30 m park core.
2. 100 MB is fine for Android Chrome and desktop. On iOS, Safari may evict site storage unless the app is added to the Home Screen: the user should do Add to Home Screen, open it once with signal, and look for "Offline ready" with "persisted". If iOS evicts it, the lever is to drop the elev/quality overlays from the precache (about 12% of tiles) or to cut z15 from the outermost 2 km, not to lower the analysis zoom.
3. Still open: phone frame rate (ask the user to rotate with terrain + slope + aspect on; below about 30 fps, lower pixelRatio on touch devices first).
