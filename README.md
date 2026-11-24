# Kokanee Glacier 3D ski topo

An offline 3D map of the ski touring around Kokanee Glacier Cabin (Kokanee Glacier Provincial Park, BC), for PC and phone.

**Status:** full build complete (9 zones, 41 routes, full ATES area); awaiting first deploy. Build history: [docs/build/ORCHESTRATOR.md](docs/build/ORCHESTRATOR.md) and [docs/build/STATUS.md](docs/build/STATUS.md).

## Layout
| Path | Contents |
|---|---|
| `web/` | The static PWA, published to GitHub Pages |
| `tools/` | Python tooling (terrain, basemap, routes, checks), pinned with uv |
| `content/archive/` | The one-time route authoring fragments, archived after assembly. The only editable content is `web/data/routes.json` |
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

## Editing workflow
`web/data/routes.json` is the only editable content (assembled once, `content_rev` 1; the seed files are archived in `content/archive/` and never merged again).

1. **Edit on one device, normally the PC.** Use Menu → Edit. Edits autosave in that browser only: they don't sync between devices or browsers, and clearing site data deletes them.
2. **Back up as you go.** Menu → Data → *Export routes.json (my edits)* downloads a copy. *Import routes.json…* restores it on any device, and the last 5 recovery copies sit at the bottom of the Data menu.
3. **Publish.** Menu → Data → *Export for publishing…* downloads `routes.json` with the next `content_rev`. Replace `web/data/routes.json` in the repository with it, then commit and push. No git on hand? On github.com open `web/data/` → *Add file → Upload files*, drop the file in, and commit to `main`.
4. **Deploy happens automatically.** Each push to `main` runs `.github/workflows/pages.yml`, which rebuilds the asset manifest and publishes `web/` to https://scarrj.github.io/kokanee/.
5. **Phones update.** The next time a phone opens the app with a connection, it takes the new routes and downloads only the changed files, not the whole map pack. A phone with its own unpublished edits shows a conflict dialog (keep mine / take published / export mine first) instead of overwriting them.

Before a trip: open the app on each phone with a connection, wait for **Offline ready · rev N**, and check that N matches the revision you published.

## Tiles
`web/tiles/` (about 100 MB: terrain z10–15, overlays, Sentinel-2 imagery) is committed to git because Pages serves it from the repository. Route edits never touch it. It only changes when terrain or imagery is rebuilt (`tools/make_tiles.py`, `tools/make_satellite.py`), and each rebuild adds roughly its own size to the git history, so rebuild only when needed.
