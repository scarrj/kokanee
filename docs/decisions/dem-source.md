# Decision: DEM sources (Phase 0c survey)

Status: **recommendation, awaiting user approval (gate)**. Evidence:
- `dem-coverage.png`
- `dem-hillshade-compare.png`
- `build/dem_survey.json`
- the script `tools/dem_survey.py`.

Every candidate was read with window reads onto UTM 11N over the project bbox, E 480,500–494,500 × N 5,494,500–5,519,000.

## Survey results
| Source | Native res. | Vertical datum | Bbox coverage | Cabin / Kaslo | Tanal W face | Kokanee Glacier | West gap (Giegerich / R. Smith) |
|---|---|---|---|---|---|---|---|
| LidarBC 2018, local tiles (`1m_tif_data/`) | 1 m | probably CGVD28 (see vertical-datum.md) | 45% | 0% | 0% | 14% | 0% |
| NRCan `hrdem-lidar` BC-Kootenay_Columbia_2017 | 1 m | CGVD2013 | 60% | 0% | 0% | 21% | 0% |
| NRCan `hrdem-lidar` BC-East_Kootenay_2017 | 1 m | CGVD2013 | 0% (catalogue bbox only) | 0% | 0% | 0% | 0% |
| NRCan `hrdem-mosaic-2m` (2_3) | 2 m | CGVD2013 | 60% (same lidar as above) | 0% | 0% | 21% | 0% |
| NRCan `mrdem-30` DTM | 30 m | CGVD2013 | **100%** | 100% | 100% | 100% | 100% |
| AWS Terrain Tiles | varies; CDEM-derived in Canada | mixed | not tested | | | | |

**Main finding:** no lidar in NRCan's catalogue covers the park core. That core is the cabin, Kaslo Lake, Tanal, Enterprise Pass, the north half of Kokanee Glacier, Joker Lakes, and the whole western gap. The 2017 and 2018 flights both stop at the same boundary. In those areas the only option found is **MRDEM-30**.

What the hillshade comparison shows:
- **MRDEM** shows the main landforms. It smooths gullies, cliff bands and short pitches, and there are some blocky/striped artefacts on the glacier (part of MRDEM comes from Copernicus WorldDEM-30).
- **Lidar** is far more detailed wherever it exists.

## Recommendation
Use three source tiers, in priority order. The quality codes are in `CONTRACTS.md#tiles`.
1. **LidarBC 2018 local 1 m** (code 1). It is the primary source wherever it has data.
2. **NRCan HRDEM lidar, BC-Kootenay_Columbia_2017 1 m DTM** (code 2). It fills where (1) is missing: mainly south and west of the local tiles, including part of the Outlook Creek / Lemon Pass approach. Only a window for the bbox is read.
3. **NRCan MRDEM-30 DTM** (code 3). This is the fallback everywhere else, including the cabin area and most of the Tanal, Robert Smith, Nansen and Giegerich routes.
- **Rejected:** AWS Terrain Tiles. In Canada they're derived from CDEM, which MRDEM supersedes, and their resolution varies by area.

## Consequences
- **Most routes near the cabin will sit on 30 m terrain.** Their metrics get the "Low confidence: coarse terrain" badge (`CONTRACTS.md#metrics`). The slope angle bands and aspect layers will look smooth there, and the quality layer shows exactly where.
- There are two seams to blend and check (WS1 steps 1b and 1c):
  - lidar → MRDEM (around the core hole)
  - lidar 2018 ↔ lidar 2017 (where the flights meet; a small offset is expected).
- Download size: an MRDEM window of about 0.5 MB plus an HRDEM 1 m window of about 100–200 MB. Both are cached in `tools/cache/` and never committed.

## What could improve it later
- **Another LidarBC flight over the park core** (newer than 2018) that isn't yet in NRCan's catalogue. The user can check the LidarBC portal. Any new tile dropped into `1m_tif_data/` is picked up by the build as tier 1.
- **BC TRIM / CDED 1:20k DEM** (about 25 m, built from contours). Not tested. It is unlikely to beat MRDEM in the alpine.
