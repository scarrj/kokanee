# Seam report (WS1 step 5)

Scope: **pilot**. Written by `tools/build_terrain.py`. Image: `seam-report.png`.

The blend band (code 4) is the part of the feather where the fallback weight exceeds 5% (the ramp runs on the lidar side of the lidar edge, 0 at the edge to 1 at the feather distance).
Test: in the blend band, a cell is **flagged** if the merged slope exceeds
max(lidar slope, MRDEM slope) + 8 deg (Horn 3x3 on the 2 m grid). The feather is widened until fewer than
0.5% of band cells are flagged.

| Feather (m) | Band cells | Flagged | Flagged % |
|---|---|---|---|
| 150 | 302518 | 3 | 0.001% |

**Chosen feather: 150 m** (302518 band cells, 3 flagged = 0.001%).

Worst locations (largest excess over the source slopes):

| E | N | lon, lat | excess (deg) |
|---|---|---|---|
| 487785 | 5511933 | -117.16961, 49.75976 | 9.7 |
| 488881 | 5511013 | -117.15437, 49.75150 | 8.6 |

Source mix of the merged grid (% of cells by quality code): {0: 0.0, 1: 24.69, 2: 0.0, 3: 71.28, 4: 4.03}.

Residual statistics (lidar vs MRDEM at 30 m, stable ground) are in `vertical-datum.md` and `build/residual_stats.json`.

<!-- tile-sizes:pilot -->
## Tile sizes (pilot, MB per layer per zoom; tile count in brackets)

| Layer | z10 | z11 | z12 | z13 | z14 | z15 | z16 | total |
|---|---|---|---|---|---|---|---|---|
| dem | 0.01 MB (1) | 0.03 MB (1) | 0.11 MB (4) | 0.38 MB (9) | 1.37 MB (25) | 4.86 MB (72) | - | 6.75 MB |
| quality | 0.00 MB (1) | 0.00 MB (1) | 0.01 MB (4) | 0.01 MB (9) | 0.03 MB (25) | 0.07 MB (72) | 0.19 MB (224) | 0.31 MB |
| qcode | - | - | - | - | - | 0.03 MB (72) | - | 0.03 MB |
| slope | 0.00 MB (1) | 0.01 MB (1) | 0.02 MB (4) | 0.06 MB (9) | 0.15 MB (25) | 0.45 MB (72) | 1.22 MB (224) | 1.92 MB |
| aspect | 0.00 MB (1) | 0.01 MB (1) | 0.02 MB (4) | 0.05 MB (9) | 0.14 MB (25) | 0.36 MB (72) | 0.93 MB (224) | 1.51 MB |
| elev | 0.00 MB (1) | 0.01 MB (1) | 0.01 MB (4) | 0.02 MB (9) | 0.05 MB (25) | 0.12 MB (72) | 0.27 MB (224) | 0.48 MB |

Total 11.00 MB. Written by `tools/make_tiles.py`.
<!-- /tile-sizes -->
