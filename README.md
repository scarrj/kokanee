# Kokanee Glacier 3D ski topo

An offline 3D map of the ski touring around Kokanee Glacier Cabin (Kokanee Glacier Provincial Park, BC), for PC and phone.

**Status:** Phase 0 (foundations) is complete. The build runs in phases with multiple agents; see [docs/build/ORCHESTRATOR.md](docs/build/ORCHESTRATOR.md) and [docs/build/STATUS.md](docs/build/STATUS.md).

## Layout
| Path | Contents |
|---|---|
| `web/` | The static PWA, published to GitHub Pages |
| `tools/` | Python tooling (terrain, basemap, routes, checks), pinned with uv |
| `content/seed/` | One-time route authoring fragments. After assembly, the only editable content is `web/data/routes.json` |
| `docs/build/` | Agent orchestration, contracts and task cards |
| `docs/decisions/` | Datum, DEM-source and zoom-limit decisions, with evidence |
| `docs/source/` | Guide text and geographic reference, extracted once |

Not committed (large or third-party originals): `1m_tif_data/`, `20m_contour/`, `topo/*.pdf`, `ates/*.kmz`, `build/`, `tools/cache/`.

## Tooling
```powershell
python -m pip install --user uv
cd tools
python -m uv sync
python -m uv run smoke_runtime.py
```

## Editing workflow (once the app exists)
1. **Edit:** in the app on the PC (Edit mode). Edits save locally on that device.
2. **Publish:** Menu → Export for publishing → replace `web/data/routes.json` → commit and push.
3. **Update phones:** they offer the new revision next time they're online. If a phone has its own unsaved edits, it shows a conflict dialog instead of overwriting them.
