# Decision record: vertical datums of DEM sources

Status: **partly confirmed**. The overlap/residual check (WS1 step 1b) is still to come.

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

## Still to do (WS1 1b)
1. Compare the lidar (aggregated to 30 m) with the fallback, on stable ground only: slope under 20°, outside glaciers and lakes.
2. Report the median offset, then map the residuals by sub-region.
3. Pick the correction after inspecting the residuals: none, a constant, or a planar fit.
4. Record the choice here.
