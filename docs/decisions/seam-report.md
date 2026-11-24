# Seam report (WS1 step 5)

Scope: **full**. Written by `tools/build_terrain.py`. Image: `seam-report.png`.

The blend band (code 4) is the part of the feather where the fallback weight exceeds 5% (the ramp runs on the lidar side of the lidar edge, 0 at the edge to 1 at the feather distance).
Test: in the blend band, a cell is **flagged** if the merged slope exceeds
max(lidar slope, MRDEM slope) + 8 deg (Horn 3x3 on the 2 m grid). The feather is widened until fewer than
0.5% of band cells are flagged.

| Feather (m) | Band cells | Flagged | Flagged % |
|---|---|---|---|
| 150 | 1601330 | 32 | 0.002% |

**Chosen feather: 150 m** (1601330 band cells, 32 flagged = 0.002%).

Worst locations (largest excess over the source slopes):

| E | N | lon, lat | excess (deg) |
|---|---|---|---|
| 482249 | 5504375 | -117.24613, 49.69164 | 10.4 |
| 483561 | 5503509 | -117.22790, 49.68389 | 9.7 |
| 491115 | 5518275 | -117.12352, 49.81686 | 9.5 |
| 483503 | 5503671 | -117.22871, 49.68534 | 9.4 |
| 491361 | 5512729 | -117.11998, 49.76698 | 9.2 |
| 487785 | 5511933 | -117.16961, 49.75976 | 8.5 |
| 489983 | 5516331 | -117.13921, 49.79935 | 8.3 |
| 488881 | 5511013 | -117.15437, 49.75150 | 8.2 |

Source mix of the merged grid (% of cells by quality code): {0: 0.0, 1: 44.24, 2: 14.31, 3: 39.57, 4: 1.87}.

Residual statistics (lidar vs MRDEM at 30 m, stable ground) are in `vertical-datum.md` and `build/residual_stats.json`.

<!-- tile-sizes:full -->
## Tile sizes (full, MB per layer per zoom; tile count in brackets)

| Layer | z10 | z11 | z12 | z13 | z14 | z15 | total |
|---|---|---|---|---|---|---|---|
| dem | 0.09 MB (2) | 0.32 MB (6) | 1.17 MB (15) | 4.32 MB (45) | 15.59 MB (160) | 56.14 MB (608) | 77.63 MB |
| quality | 0.00 MB (2) | 0.01 MB (6) | 0.02 MB (15) | 0.05 MB (45) | 0.14 MB (160) | 0.49 MB (608) | 0.71 MB |
| qcode | - | - | - | - | - | 0.25 MB (608) | 0.25 MB |
| slope | 0.02 MB (2) | 0.06 MB (6) | 0.20 MB (15) | 0.63 MB (45) | 2.00 MB (160) | 6.53 MB (608) | 9.44 MB |
| aspect | 0.02 MB (2) | 0.06 MB (6) | 0.18 MB (15) | 0.52 MB (45) | 1.59 MB (160) | 4.90 MB (608) | 7.27 MB |
| elev | 0.01 MB (2) | 0.04 MB (6) | 0.08 MB (15) | 0.17 MB (45) | 0.39 MB (160) | 0.96 MB (608) | 1.65 MB |

Total 96.95 MB. Written by `tools/make_tiles.py`.
<!-- /tile-sizes -->
