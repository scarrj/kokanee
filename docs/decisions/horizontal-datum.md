# Decision: horizontal datum of the guide's grid refs

**Decision: the guide's UTM refs are NAD83 (UTM zone 11N), rounded to 100 m. Use them as-is. No NAD27 shift.**
Status: verified 2026-11-23 by `tools/datum_check.py` (output in `build/datum_check.json`).

## Method
- Control points:
  - 12 BC Geographic Names (BCGNIS) features (NAD83)
  - 9 cross-checked against the ATES KMZ landmarks (WGS84)
  - 3 cross-checked against lidar summits (highest lidar cell within 120 m).
- Each guide ref was tested under H83 (printed numbers are NAD83 UTM11) and H27 (printed numbers are NAD27 UTM11, converted with the NTv2 grid `ca_nrc_ntv2_0`). At this location that shift is dE −80 m, dN +212 m.

## Results (distance from the guide ref to the control, in m)
| Guide ref | Control (BCGNIS) | H83 | H27 | Usable? |
|---|---|---|---|---|
| si1 The Battleship 488200/5511800 | The Battleship | **67** | 291 | yes (point feature) |
| si1 The Giant's Kneecap 488700/5511400 | Giants Kneecap | **115** | 284 | yes |
| si3 "north summit of Outlook Mtn" 486200/5509800 | Mount John Carter | **75** | 239 | yes. Only 38 m from the lidar summit (2611 m) |
| si5 The Pyramids 488200/5511300 | The Pyramids | **25** | 249 | yes |
| si2 Joker Lakes 490100/5513300 | Joker Lakes | 418 | 202 | no: lake-group label point, not a precise point |
| si3 "crest just above Lemon Pass" 485100/5511300 | Lemon Pass | 912 | 975 | no: a crest *near* the pass; printed as "55113°0" (garbled) |

The usable point features give a median of **~71 m under H83 vs ~266 m under H27**. H83 fits within the 100 m rounding of the refs, and H27 fails every one of them.

## How good are the control points?
| Pair | Distance |
|---|---|
| BCGNIS vs ATES (9 pairs) | 28–78 m |
| BCGNIS vs lidar summit: Cond Peak | 12 m |
| BCGNIS vs lidar summit: Esmeralda Peak | 18 m |
| BCGNIS vs lidar summit: Mount John Carter | 47 m |

So gazetteer and ATES points are good to about ±50–80 m. Where a summit is in lidar coverage, snap to the lidar summit.

## Notes for agents
- **Naming.** The guide's "north summit of Outlook Mountain" is today's **Mount John Carter** (named after 1996). Lidar puts its summit at 2611 m. The guide quotes 2,606 m in one place and 2,610 m in another.
- **Lemon Pass crest.** The ref is unreliable. Place it from the terrain near the BCGNIS Lemon Pass point instead.
- **ATES vs NAD83.** ATES (WGS84) and NAD83(CSRS) differ by about 1–2 m here, which is negligible. All app data is stored as WGS84 lon/lat.
