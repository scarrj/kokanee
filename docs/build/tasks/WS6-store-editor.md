# WS6 Store + editor
**Model:** Sonnet · **Effort:** high · **Depends:** WS3 + WS5 merged · **Scope:** pilot (complete feature set), full (fixes only)

## Goal
Make App JSON safely editable on the device: local edits, revisions, conflicts, validated import, recovery slots, the editing tools themselves, and GPX/JSON export.

## Read
`CONTRACTS.md#app-json` (rules, local-edit record, recovery slots), `#modules` (`store.js`, `editor.js`, `ui.js`, `model.js`), `#layers` (the `edit-*` ids).

## Own
`web/js/store.js`, `web/js/editor.js`, `web/js/conflict-dialog.js`, `web/js/gpx.js`.

## Do not read
`tools/*`, tiles, `topo/*`.

## Steps
1. **`store.js` (IndexedDB `kokanee`, stores `local` and `recovery`).**
   - `load()`:
     1. Fetch the published `data/routes.json` (network first; cache if offline).
     2. Read the `local` record.
     3. Decide:
        - no local record → use published
        - local not dirty and published newer → silently take published
        - **local dirty and `published.content_rev > local.base_rev`** → open the conflict dialog.
   - `update(fn, label)`: apply on a deep copy, `validate()`, push to the undo stack (max 100), mark dirty, autosave (debounced 500 ms), emit `change`.
2. **`conflict-dialog.js`.**
   - Use `model.diff(published, local)` to summarise added/changed/removed per route, zone and area on each side.
   - Choices: **Keep mine** (rebase: set `base_rev` to published, keep the data), **Take published** (snapshot mine to recovery first), **Export mine first** (download, then ask again).
3. **`importJSON(file)`.**
   1. Parse, then `validate()`. Invalid → show the errors and **save nothing**.
   2. Show a diff summary and confirm.
   3. Snapshot the current state to recovery.
   4. Replace and mark dirty.
4. **`reset()`:** snapshot, then go back to published. **`recoverySlots()` / `restore(id)`:** listed in the menu, with timestamp and reason.
5. **`exportJSON({publish})`:** download `routes.json`. With `publish: true`, bump `content_rev`, set `published_at`, and remind the user to commit it to `web/data/` and push.
6. **`gpx.js`:** one `<trk>` per descent and per skin line, named "#num Name (descent|skin)".
7. **`editor.js`** (edit mode toggle via `ui.registerMenu`):
   - Edit the text fields of the selected route, zone, POI or area.
   - Lines: drag a vertex; tap a midpoint to insert; long-press (touch) or right-click to delete a vertex; draw a new descent or skin line for the selected route.
   - Areas: draw a polygon (tap vertices, then tap the first to close); edit it the same way.
   - Add or delete routes, zones and areas (deleting asks for confirmation). Drag a zone's "i" button.
   - Undo and redo buttons, plus Ctrl+Z / Ctrl+Y.
   - Every vertex handle is at least 44 px on touch. Use the `edit-*` layers only.

## Acceptance (browser pane)
1. Edit a pilot route line and its text → reload → the edit persists.
2. Import a file with a missing `zone` reference → it is rejected and nothing changes.
3. Import a valid file → a recovery slot appears → restore it.
4. Simulate published `content_rev` 2 while local is dirty at `base_rev` 1 → the conflict dialog lists the differences.
5. Exported GPX opens in a GPX validator / parses as XML.
