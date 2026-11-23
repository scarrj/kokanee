# Decision record: vertical datums of DEM sources

Status: **pilot checked** (2026-11-23). Lidar − MRDEM on stable ground at 30 m: median +0.5 m, MAD 1.4 m, no spatial trend. **No correction applied.** The lidar datum (probably CGVD28) is still unconfirmed from the LidarBC metadata. Repeat the check at full scope.

| Source | Vertical datum | Evidence |
|---|---|---|
| LidarBC 1 m DEM (2018, `bc_082f0*_l1m_utm11_20180830`) | **Probably CGVD28** (BC's established datum; GNSS heights via HTv2.0). *Not confirmed:* the GeoTIFF carries no vertical CRS keys | BC vertical reference system pages. Confirm from the LidarBC project metadata if obtainable |
| NRCan HRDEM / HRDEM Mosaic | CGVD2013 | NRCan product specification |
| NRCan MRDEM-30 | CGVD2013 | NRCan MRDEM product specification; STAC item `mrdem` (EPSG:3979) |

## Expected size of the difference
PROJ was used to transform CGVD28 (HT2_2010v70) to CGVD2013 (CGG2013n83). The result at 4 points across the bounding box:

| Point | CGVD2013 − CGVD28 |
|---|---|
| Cabin | +0.195 m |
| Cond Peak | +0.205 m |
| Robert Smith | +0.217 m |
| South end | +0.170 m |

The difference is about +0.2 m everywhere: smooth and tiny compared with MRDEM's vertical error (metres). **No datum correction will be applied for this reason alone.**

## Overlap check and correction (WS1 step 3, pilot area)
Method (`tools/build_terrain.py`, evidence in `build/residual_stats.json` and `build/residuals.png`, not committed):
lidar and MRDEM were warped to the 2 m analysis grid, block-meaned to 30 m (15 x 15 cells), and differenced **before any correction**.
Stable ground only: slope under 20 deg on the 30 m aggregate of both sources, glaciers excluded (4 polygons from
`web/data/basemap.geojson`), lakes excluded (147 dead-flat blocks). Residual = lidar minus fallback.

| Pair | Stable 30 m blocks | Median (m) | MAD (m) | Median by 2 km sub-block (m) |
|---|---|---|---|---|
| LidarBC 2018 - MRDEM | 1135 | +0.53 | 1.44 | -0.49 to +2.50 (6 sub-blocks, n >= 30) |
| HRDEM 2017 - MRDEM | 1427 | +0.39 | 1.50 | -0.70 to +2.65 |
| LidarBC 2018 - HRDEM 2017 | 1135 | 0.00 | 0.004 | 0.00 to 0.01 |

Findings:
- **The two lidar products are the same data in the pilot area** (differences are rounding level, 4 mm MAD, no sub-block or elevation trend). So there is no 2018/2017 seam and no relative offset. The ~0.2 m CGVD28 to CGVD2013 difference is therefore not visible between them either: either the local tiles are already CGVD2013 or NRCan republished them unchanged. The vertical datum of the local tiles stays *unconfirmed*, but any datum error is below the 0.2 m scale.
- **Lidar sits about 0.5 m above MRDEM** at the median, but the scatter (MAD 1.4 m) and the sub-block spread (-0.5 to +2.5 m) are much larger. The sign changes between sub-blocks, and the median by 200 m elevation band wanders (-0.11 to +1.84 m) with no monotonic trend.
- **A planar fit explains nothing:** RMS 2.345 m -> 2.328 m (0.7%), tilt under 0.2 m/km.
- The scatter is MRDEM's 30 m representation error (smoothing, canopy and Copernicus-derived blocks), not a datum shift. A constant or plane fitted on the lidar side would be extrapolated 5+ km into the park core where it cannot be checked, and would worsen the SW sub-block (-0.5 m).

**Decision (pilot): no vertical correction** (none, constant or planar) for MRDEM or either lidar product. The lidar to MRDEM step (median ~0.5 m, local spread to a few metres) is absorbed by the 150 m feather (`seam-report.md`). To be re-checked on the full bbox, where the HRDEM 2017 window extends further (west and south) and more stable ground is available.

**Residual map** (`tools/build_terrain.py --scope pilot --residual-png`): ![Lidar minus MRDEM residuals on stable ground, +/-5 m](residuals.png)
The map shows lidar minus MRDEM at 30 m on stable ground only (1427 blocks, median +0.38 m, MAD 1.5 m; the cabin and Kaslo Lake lie outside the lidar overlap, John Carter at its SW corner). Residuals are patchy and local (red clusters of +2 to +5 m on a few ridges and valley-side blocks, blue streaks along gully lines) with no regional gradient, tilt or edge-to-edge trend, which supports the "no correction" decision above: the scatter is MRDEM terrain smoothing, not a datum or planar offset.
