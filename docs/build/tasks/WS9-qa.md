# WS9 QA: checks, browser runs, pilot measurements
**Model:** Sonnet · **Effort:** medium · **Depends:** everything merged for the scope · **Scope:** pilot, then full

## Goal
Verify the whole app against the plan, file defects back to the owning cards, and (in the pilot) measure the size and performance numbers that set the zoom limits.

## Read
- `CONTRACTS.md` (all of it: you are checking compliance)
- the Verification section of the approved plan (copied into `docs/build/QA.md`)
- `docs/build/STATUS.md`.

## Own
`tools/check_all.py`, `docs/build/QA.md` (results and defect list), `docs/decisions/zoom-limits.md` (pilot measurements).

## Do not read
`topo/*`, `1m_tif_data/*`.

## Steps
1. **`check_all.py [--quick]`.** Runs:
   - `smoke_runtime.py`
   - `validate_routes.py`
   - `check_routes.py`
   - the metrics parity test
   - a `tiles.json` schema check
   - asset manifest freshness
   - an id/contract lint (layer ids used in `web/js` are a subset of `#layers`).
2. **Browser pane, desktop and the mobile preset** (`.claude/launch.json` `web` config). Go through the QA.md checklist:
   - layers and legends (No data vs low-angle)
   - aspect spot-checks: Tanal W face = W, John Carter N side = N
   - ATES sub-toggles
   - readout shows the source
   - the editor flows and conflict/import/recovery
   - the offline badge, including the delete-one-file test and the server-stopped test
   - the scale bar
   - touch targets at least 44 px.
3. **Pilot measurements:**
   - bytes per layer per zoom (from WS1's report and the asset manifest)
   - the total pack at max zoom 15 and at 16
   - `profile()` time for a 3 km line
   - frame rate while rotating with terrain + 2 overlays (desktop pane measurement; ask the user for phone numbers).
   - Write `zoom-limits.md` with a recommendation.
4. **Defects.** One line each in QA.md: `[WSn] severity — symptom — repro`. The orchestrator routes them.

## Acceptance
- `python -m uv run check_all.py` passes.
- The QA.md checklist is fully ticked, or every failure is a defect line.
- `zoom-limits.md` exists (pilot).
