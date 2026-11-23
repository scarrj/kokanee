# WS7 PWA: verified offline + Pages deploy
**Model:** Sonnet · **Effort:** medium · **Depends:** WS0 (integrates once WS3 has merged) · **Scope:** pilot, then full

## Goal
Make "Offline ready" a **verified** state, and get the app installable on iOS and Android.

## Read
`CONTRACTS.md#modules` (`offline.js`, `ui.registerMenu`), `#tiles` (`tiles.json`: `dem_version`), `#app-json` (`content_rev`).

## Own
- `web/sw.js`, `web/js/offline.js`, `web/manifest.webmanifest`, `web/icons/**`
- `tools/make_asset_manifest.py`
- `.github/workflows/pages.yml`

## Do not read
`topo/*`, `1m_tif_data/*`, `tools/build_*.py`.

## Steps
1. **`make_asset_manifest.py`.** Walk `web/` and write `web/asset-manifest.json`:
   - `{version, content_rev, dem_version, files: [{path, bytes, sha256}], total_bytes}`
   - `version` = a short hash of all the sha256s
   - exclude `sw.js` and the manifest itself.
2. **`sw.js`.**
   - **Install:** fetch `asset-manifest.json`. Precache every file into the cache `kokanee-<version>` in batches of 20, and post progress to the clients.
   - **Activate:** delete the old `kokanee-*` caches only once the new one is complete.
   - **Fetch:** cache-first for everything in the manifest. Network-first for `data/routes.json` and `asset-manifest.json`, falling back to the cache.
   - Relative paths throughout, so it works under `/kokanee/`.
3. **`offline.js`.** `initOffline()` registers `sw.js` (relative scope). `verify()`:
   - Every manifest path is in the cache with a matching `content-length` / byte count.
   - Decode one cached tile per layer (`createImageBitmap`).
   - Parse the cached `routes.json`.
   - Call `navigator.storage.persist()` and `estimate()`.
   - Badge states: **"Offline ready · rev N · DEM vX"** (all passed), "Downloading map… 63%", or "Not offline ready — N missing [Retry]".
   - Re-verify on launch, after updates and on `visibilitychange`. Show the storage used and whether it is persisted. Explain in a tooltip that iOS may evict data from sites that go unused.
4. **`manifest.webmanifest` and icons.** Name "Kokanee Topo", `start_url` "./", `display` standalone, theme colour from `#ui`, 192/512 px and maskable icons (a simple mountain glyph, generated as PNG). Include iOS `apple-touch-icon` and meta tags (a note in your report says which tags `index.html` needs; WS3 adds them).
5. **`pages.yml`.** On push to `main`: run `make_asset_manifest.py`, then upload the `web/` artifact and deploy Pages. Note the Pages URL (`https://scarrj.github.io/kokanee/`).

## Acceptance (browser pane)
1. Load the app → the badge reaches "Offline ready".
2. Delete one cached tile through DevTools/JS → reload → the badge reads "Not offline ready — 1 missing" → Retry → ready again.
3. Stop the server → reload → the app, tiles and routes all work.
4. `make_asset_manifest.py` total_bytes is reported in the pilot measurements.
