# WS0 Foundations (orchestrator, Opus). **Done in Phase 0**

Recorded so it can be re-run. All outputs exist.

| Output | Producer |
|---|---|
| Pinned runtime (`tools/pyproject.toml`, `uv.lock`) | `tools/smoke_runtime.py` (4 checks) |
| `docs/source/topo.md` | `tools/extract_topo.py` (needs `--with pypdf`) |
| `docs/source/geo_reference.md` | `tools/make_geo_reference.py` (inputs `build/bcgnis.json`, `build/datum_check.json`, `build/dem_survey.json`) |
| `docs/decisions/horizontal-datum.md` | `tools/datum_check.py` |
| `docs/decisions/vertical-datum.md`, `docs/decisions/dem-source.md` (+ PNGs) | `tools/dem_survey.py` |
| `CLAUDE.md` and `docs/build/*` | written by hand |

## Acceptance
```
cd tools && python -m uv run smoke_runtime.py      # 4x PASS
```
