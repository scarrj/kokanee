// app.js [WS3] - bootstrap. Optional modules (store, model, terrain-sampler, offline, editor) are
// loaded with dynamic import() and degrade gracefully when missing.
import { initMap, setContent } from './map.js';
import * as ui from './ui.js';

const base = new URL('./', document.baseURI).href;
const tryImport = (p) => import(p).catch(() => null);
async function fetchJSON(u) { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } }

// local shim of CONTRACTS.md#geojson-mapping, used only when model.js is missing
function shimGeoJSON(a) {
  const zc = Object.fromEntries((a.zones || []).map((z) => [z.id, z.color]));
  const F = (geometry, properties) => ({ type: 'Feature', geometry, properties });
  const fc = (features) => ({ type: 'FeatureCollection', features });
  const line = (r, kind) => (r[kind] && r[kind].length >= 2 ? [F({ type: 'LineString', coordinates: r[kind] }, kind === 'descent'
    ? { id: r.id, num: r.num, zone: r.zone, name: r.name, color: zc[r.zone] || '#495057', approx: !!r.approx }
    : { id: r.id, num: r.num, zone: r.zone, name: r.name, color: zc[r.zone] || '#495057' })] : []);
  return {
    'routes-descent': fc((a.routes || []).flatMap((r) => line(r, 'descent'))),
    'routes-skin': fc((a.routes || []).flatMap((r) => line(r, 'skin'))),
    'zone-info': fc((a.zones || []).filter((z) => z.info_point).map((z) => F({ type: 'Point', coordinates: z.info_point }, { id: z.id, name: z.name, color: z.color }))),
    pois: fc((a.pois || []).map((p) => F({ type: 'Point', coordinates: p.coord }, { id: p.id, name: p.name, type: p.type }))),
    areas: fc((a.areas || []).map((x) => F({ type: 'Polygon', coordinates: x.polygon }, { id: x.id, name: x.name, kind: x.kind }))),
  };
}

async function main() {
  const tilesJson = await fetchJSON(`${base}tiles/tiles.json`);
  const [storeMod, modelMod, samplerMod, editorMod] = await Promise.all([
    tryImport('./store.js'), tryImport('./model.js'), tryImport('./terrain-sampler.js'), tryImport('./editor.js')]);

  let store = storeMod;
  let appData = null;
  if (store && store.load) { try { await store.load(); appData = store.get(); } catch (e) { console.warn('store.load failed', e); store = null; } }
  if (!store) {
    appData = (await fetchJSON(`${base}data/routes.json`)) || { zones: [], routes: [], pois: [], areas: [] };
    const d = appData;
    store = { get: () => d, on() {} }; // read-only shim
  }
  const toGeo = (modelMod && modelMod.toGeoJSON) || shimGeoJSON;

  const map = await initMap(document.getElementById('map'), { tilesJson, base });
  if (!tilesJson) {
    const b = document.getElementById('banner');
    b.textContent = 'Terrain tiles not found: showing a flat map without terrain, overlays or contours.';
    b.hidden = false;
  }
  setContent(toGeo(store.get()));
  if (store.on) store.on('change', () => setContent(toGeo(store.get())));

  if (samplerMod && samplerMod.initSampler && tilesJson) {
    try { await samplerMod.initSampler(tilesJson, base); ui.setSampler(samplerMod); } catch (e) { console.warn('sampler init failed', e); }
  }
  if (editorMod) ui.setEditor(editorMod);
  ui.initUI(map, store);
  window.kokanee = { map, store, ui, tilesJson };

  try {
    const off = await import('./offline.js');
    if (off.initOffline) await off.initOffline(ui);
  } catch (e) { /* offline.js missing or failed: app still works */ }

}

main().catch((e) => { console.error(e); const b = document.getElementById('banner'); b.textContent = 'Failed to start: ' + e.message; b.hidden = false; });
