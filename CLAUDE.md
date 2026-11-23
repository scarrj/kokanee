# Kokanee Glacier 3D ski topo

An offline PWA (PC and phone) showing a 3D map of the ski terrain around Kokanee Glacier Cabin, BC. It has zone info buttons, editable descent and skin lines for the routes in the guide, toggleable terrain layers (contour shading, aspect, slope angle bands, ATES, data quality), and DEM-derived route metrics. Static site in `web/` (plain ES modules + vendored MapLibre), deployed to GitHub Pages. Python tooling in `tools/` (uv, Python 3.12, rasterio).

## Hard rules for every agent
- **Never open** `topo/*.pdf`, `1m_tif_data/*`, `20m_contour/*` or `ates/*.kmz` directly. Use `docs/source/topo.md`, `docs/source/geo_reference.md`, and the CLIs in `tools/`. The exception is the card that owns a converter.
- Edit **only** the files listed under *Own* in your task card. If you need a change elsewhere, say so in your report.
- Interfaces live in `docs/build/CONTRACTS.md`. Follow them exactly. Don't redefine them in your files.
- Python: run with `cd tools && python -m uv run <script>` (the env is pinned in `tools/pyproject.toml` and `uv.lock`).
- Never commit large data or anything in `build/`. Don't push. Only the orchestrator merges or pushes.
- Reply with the report format in `docs/build/ORCHESTRATOR.md#report` (10 lines max, no code dumps).

## Where things are
- Orchestration: `docs/build/ORCHESTRATOR.md`. Status: `docs/build/STATUS.md`.
- Background: `docs/build/CONTEXT.md`. Contracts: `docs/build/CONTRACTS.md`.
- Your task: `docs/build/tasks/WS*.md`.
- Decisions (datums, DEM source, zoom limits): `docs/decisions/`.
