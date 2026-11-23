# QA checklist and defects (owned by WS9)

## Checklist (from the approved plan's Verification section)
- [ ] Runtime: `smoke_runtime.py` passes in the pinned env
- [ ] Datums: residual table present (`docs/decisions/horizontal-datum.md`); vertical record lists every source
- [ ] DEM: coverage map and hillshade comparison reviewed
- [ ] DEM: residual map inspected before the correction
- [ ] DEM: seam report shows no artificial steep bands
- [ ] DEM: quality mask covers the whole bbox
- [ ] Routes: `check_routes.py` passes; every descent loses elevation; vertical within ±30% or flagged; % by source printed
- [ ] Metrics: Python ↔ JS parity within 1 m / 0.5°
- [ ] Layers: every toggle, opacity slider and legend works; "No data" is distinct from low-angle/transparent
- [ ] Aspect spot-check: Tanal W face reads W
- [ ] Aspect spot-check: John Carter N side reads N
- [ ] ATES sub-toggles (zones, paths, decision points); decision point text readable
- [ ] Tap readout shows elevation, slope, aspect, ATES class, and the data source with its resolution
- [ ] Route panel: guide figures beside computed metrics; low-confidence badge on coarse routes; profile gaps where data is missing
- [ ] Editor: text edit, vertex drag/add/delete, draw line, draw polygon, add/delete, undo/redo, autosave across reload
- [ ] Import: invalid file rejected with nothing saved
- [ ] Import: valid file shows a diff, then creates a recovery slot; restore works
- [ ] Conflict dialog when published rev is newer than local base_rev and local is dirty
- [ ] Reset snapshots first
- [ ] Publish export bumps `content_rev`
- [ ] GPX parses
- [ ] Offline: badge "Offline ready" only after verify
- [ ] Offline: deleting one cached file → "Not offline ready"
- [ ] Offline: with the server stopped, a reload still works
- [ ] Mobile preset: bottom sheet, touch targets ≥ 44 px, scale bar visible
- [ ] Phone: pack size and performance recorded; works in airplane mode after Add to Home Screen

## Defects
<!-- [WSn] severity: symptom (repro) -->
