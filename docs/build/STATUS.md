# Build status

The orchestrator maintains this log. Agent reports are appended unchanged (format: `ORCHESTRATOR.md#report`).

| Card | Pilot | Full | Branch | Notes |
|---|---|---|---|---|
| WS0 foundations | done | n/a | main | runtime pinned; datums verified; DEM survey done; docs written |
| WS1 terrain | running | — | | |
| WS2 basemap | running | — | | |
| WS3 viewer | running | — | | |
| WS4 metrics | blocked by WS1 | — | | |
| WS5 text | running | — | | |
| WS6 store+editor | blocked by WS3, WS5 | — | | |
| WS7 pwa | running | — | | |
| WS8 geometry | blocked by WS1, WS5 | — | | |
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
