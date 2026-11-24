// map.js [WS3] - MapLibre map, terrain, overlays, content layers.
// Contract: CONTRACTS.md#modules (map.js) and #layers. MapLibre / maplibre-contour are vendored globals.
/* global maplibregl, mlcontour */

export const CABIN = [-117.194844, 49.771692];
export const HOME = { center: CABIN, zoom: 13.4, pitch: 60, bearing: 200 };

// ATES colours (CONTEXT / WS3 card)
const ATES_COLORS = { simple: '#00c853', challenging: '#1e63ff', complex: '#000000' };
const EMPTY = { type: 'FeatureCollection', features: [] };
const CONTENT_SOURCES = ['routes-descent', 'routes-skin', 'zone-info', 'pois', 'areas'];

// Group definitions: used by layers-menu.js. `layers` = MapLibre layer ids driven by the group.
export const GROUP_DEFS = [
  { id: 'satellite', label: 'Satellite (Sentinel-2)', layers: ['satellite'], on: false, op: 1, legend: 'satellite' },
  { id: 'elev', label: 'Contour shading (elevation bands)', layers: ['elev-tint'], on: false, op: 0.7, legend: 'elev' },
  { id: 'aspect', label: 'Aspect', layers: ['aspect'], on: false, op: 0.7, legend: 'aspect' },
  { id: 'slope', label: 'Slope angle bands', layers: ['slope'], on: false, op: 0.75, legend: 'slope' },
  {
    id: 'ates', label: 'ATES (read-only)', layers: [], on: false, op: 0.9, legend: 'ates',
    children: [
      { id: 'ates-zones', label: 'Zones', layers: ['ates-zones'], on: true, op: 1 },
      { id: 'ates-paths', label: 'Paths and boundary', layers: ['ates-paths', 'ates-boundary', 'ates-road'], on: true, op: 1 },
      { id: 'ates-decision', label: 'Decision points', layers: ['ates-decision'], on: true, op: 1 },
    ],
  },
  { id: 'contours', label: 'Contours (20 m, 100 m labelled)', layers: ['contours', 'contours-label'], on: true, op: 1, legend: 'contours' },
  { id: 'elev-ref', label: '2,100 m reference line', layers: ['elev-ref-2100', 'elev-ref-2100-label'], on: true, op: 1, legend: 'elev-ref' },
  { id: 'hillshade', label: 'Hillshade', layers: ['hillshade'], on: true, op: 1, legend: 'hillshade' },
  { id: 'quality', label: 'Data quality (elevation source)', layers: ['quality'], on: false, op: 0.8, legend: 'quality' },
  { id: 'water', label: 'Water and glaciers', layers: ['lakes', 'creeks', 'glaciers', 'glaciers-label'], on: true, op: 1, legend: 'water' },
  { id: 'pois', label: 'POIs', layers: ['pois', 'pois-label'], on: true, op: 1, legend: 'pois' },
  { id: 'descents', label: 'Descents', layers: ['routes-descent-casing', 'routes-descent', 'routes-label'], on: true, op: 1, legend: 'descents' },
  { id: 'skin', label: 'Skin tracks', layers: ['routes-skin'], on: true, op: 1, legend: 'skin' },
  { id: 'zones', label: 'Zone info buttons', layers: ['zone-info', 'zone-info-label'], on: true, op: 1, legend: 'zones' },
  { id: 'closures', label: 'Closures and areas', layers: ['areas-fill', 'areas-line'], on: true, op: 1, legend: 'closures' },
];

// opacity properties per layer type (the slider multiplies the base value)
const OPACITY_PROPS = {
  raster: ['raster-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  hillshade: ['hillshade-exaggeration'],
};

let map = null;
let tiles = null;
let baseUrl = '';
let exaggeration = 1.3;
let atesData = EMPTY;
let meta = { glacierSurvey: [] };
let sat = null; // sat.json (null when the satellite tiles are absent)
const SAT_HILLSHADE_FACTOR = 0.6; // hillshade is eased back while satellite is visible (saved slider values untouched)
const flat = {}; // groupId -> {visible, opacity}
const baseOpacity = {}; // layerId -> {prop: base}
const parentOf = {};
const state = {};

function flatGroups() {
  const out = [];
  for (const g of GROUP_DEFS) { out.push(g); for (const c of g.children || []) { out.push(c); parentOf[c.id] = g.id; } }
  return out;
}
const ALL_GROUPS = flatGroups();
for (const g of ALL_GROUPS) state[g.id] = { visible: g.on, opacity: 1 };

async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function rememberOpacity(layer) {
  const props = OPACITY_PROPS[layer.type] || [];
  const base = {};
  for (const p of props) {
    if (layer.type === 'symbol' && layer.paint && layer.paint[p] === undefined) base[p] = 1;
    else base[p] = (layer.paint && layer.paint[p] !== undefined) ? layer.paint[p] : (p === 'hillshade-exaggeration' ? 0.5 : 1);
  }
  baseOpacity[layer.id] = base;
}

function add(layer, beforeId) {
  if (layer.source && !map.getSource(layer.source)) return;
  rememberOpacity(layer);
  map.addLayer(layer, beforeId);
}

function tileUrl(name) { return `${baseUrl}tiles/${name}/{z}/{x}/{y}.png`; }

function addRasterOverlay(id, name, opacity, resampling) {
  const info = tiles && tiles.layers && tiles.layers[name];
  if (!info) return;
  map.addSource(id, {
    type: 'raster', tiles: [tileUrl(name)], tileSize: 256,
    minzoom: info.minzoom ?? 0, maxzoom: info.maxzoom ?? 15,
    ...(tiles.bounds ? { bounds: tiles.bounds } : {}),
  });
  add({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-resampling': resampling, 'raster-fade-duration': 0 } });
}

function atesColorExpr() {
  return ['match', ['downcase', ['to-string', ['coalesce', ['get', 'class'], '']]],
    'simple', ATES_COLORS.simple, 'challenging', ATES_COLORS.challenging, 'complex', ATES_COLORS.complex, '#888888'];
}

// bounds [w,s,e,n] grown by marginM metres on every side
function paddedBounds(b, marginM) {
  const dLat = marginM / 111320, dLng = marginM / (111320 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180));
  return [[b[0] - dLng, b[1] - dLat], [b[2] + dLng, b[3] + dLat]];
}

// DEM protocol: tiles outside the DEM bounds are replaced by a copy of the nearest edge pixels, so
// terrain continues flat-extruded instead of dropping to 0 m (which draws tall walls/streaks).
const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
let demProtocolDone = false;
function registerDemProtocol(bounds) {
  if (demProtocolDone) return;
  demProtocolDone = true;
  maplibregl.addProtocol('kdem', async (params, abortController) => {
    const m = /^kdem:\/\/(.*)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(params.url);
    const fetchTile = async (z, x, y) => {
      const r = await fetch(`${m[1]}/${z}/${x}/${y}.png`, { signal: abortController && abortController.signal });
      if (!r.ok) throw new Error(`DEM tile ${z}/${x}/${y}: ${r.status}`);
      return r.arrayBuffer();
    };
    if (!m) throw new Error('bad kdem url');
    const z = +m[2], x = +m[3], y = +m[4];
    const x0 = lon2x(bounds[0], z), x1 = lon2x(bounds[2], z), y0 = lat2y(bounds[3], z), y1 = lat2y(bounds[1], z);
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return { data: await fetchTile(z, x, y) };
    const cx = Math.min(x1, Math.max(x0, x)), cy = Math.min(y1, Math.max(y0, y));
    const bmp = await createImageBitmap(new Blob([await fetchTile(z, cx, cy)], { type: 'image/png' }));
    const W = bmp.width, H = bmp.height;
    const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const sx = x < x0 ? 0 : x > x1 ? W - 1 : 0, sw = x < x0 || x > x1 ? 1 : W;
    const sy = y < y0 ? 0 : y > y1 ? H - 1 : 0, sh = y < y0 || y > y1 ? 1 : H;
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    return { data: await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer() };
  });
}

export async function initMap(el, { tilesJson = null, base = null } = {}) {
  tiles = tilesJson;
  baseUrl = base || new URL('./', document.baseURI).href;
  const hasTiles = !!(tiles && tiles.layers && tiles.layers.dem);
  map = new maplibregl.Map({
    container: el,
    style: {
      version: 8,
      glyphs: `${baseUrl}vendor/fonts/{fontstack}/{range}.pbf`,
      sources: {},
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9ecef' } }],
    },
    center: HOME.center, zoom: hasTiles ? HOME.zoom : 12.5,
    pitch: hasTiles ? HOME.pitch : 0, bearing: hasTiles ? HOME.bearing : 0,
    maxPitch: 85, maxZoom: 17, minZoom: 11,
    ...(hasTiles && tiles.bounds ? { maxBounds: paddedBounds(tiles.bounds, 2000) } : {}),
    attributionControl: { compact: true },
    canvasContextAttributes: { antialias: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-right');
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 140 }), 'bottom-right');

  const [ates, basemap, satJson] = await Promise.all([fetchJSON(`${baseUrl}data/ates.geojson`), fetchJSON(`${baseUrl}data/basemap.geojson`), fetchJSON(`${baseUrl}tiles/sat/sat.json`)]);
  sat = satJson && typeof satJson === 'object' && Number.isFinite(satJson.maxzoom) ? satJson : null;
  atesData = ates || EMPTY;
  const basemapData = basemap || EMPTY;
  const dates = new Set();
  for (const f of basemapData.features) if (f.properties && f.properties.kind === 'glacier' && f.properties.survey_date) dates.add(String(f.properties.survey_date));
  meta.glacierSurvey = [...dates];

  await new Promise((res) => {
    if (map.isStyleLoaded()) { res(); return; }
    const t = setTimeout(() => console.error('initMap: style still not loaded after 10 s; still waiting'), 10000);
    map.once('style.load', () => { clearTimeout(t); res(); });
  });

  // ---- sources
  if (hasTiles) {
    const dem = tiles.layers.dem;
    let demTiles = tileUrl('dem');
    if (tiles.bounds && typeof OffscreenCanvas !== 'undefined' && maplibregl.addProtocol) { registerDemProtocol(tiles.bounds); demTiles = `kdem://${baseUrl}tiles/dem/{z}/{x}/{y}.png`; }
    map.addSource('dem', {
      type: 'raster-dem', tiles: [demTiles], tileSize: 256, encoding: dem.encoding || 'terrarium',
      minzoom: dem.minzoom ?? 10, maxzoom: dem.maxzoom ?? 15,
    });
    try {
      const demSource = new mlcontour.DemSource({ url: tileUrl('dem'), encoding: dem.encoding || 'terrarium', maxzoom: dem.maxzoom ?? 15, worker: true });
      demSource.setupMaplibre(maplibregl);
      const cUrl = demSource.contourProtocolUrl({
        multiplier: 1,
        thresholds: { 8: [200, 1000], 10: [100, 500], 12: [100, 500], 13: [20, 100] },
        contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1,
      });
      map.addSource('contours', { type: 'vector', tiles: [cUrl], minzoom: 8, maxzoom: dem.maxzoom ?? 15, ...(tiles.bounds ? { bounds: tiles.bounds } : {}) });
    } catch (e) { console.warn('contours unavailable', e); }
  }
  map.addSource('basemap', { type: 'geojson', data: basemapData });
  map.addSource('ates', { type: 'geojson', data: atesData });
  for (const s of CONTENT_SOURCES) map.addSource(s, { type: 'geojson', data: EMPTY });

  // ---- layers, bottom to top (CONTRACTS.md#layers default draw order)
  rememberOpacity({ id: 'bg', type: 'background', paint: {} });
  if (sat) {
    // display-only Sentinel-2 imagery (10 m); overzoomed above sat.maxzoom
    map.addSource('satellite', {
      type: 'raster', tiles: [`${baseUrl}tiles/sat/{z}/{x}/{y}.jpg`], tileSize: 256,
      minzoom: sat.minzoom ?? 10, maxzoom: sat.maxzoom,
      ...(Array.isArray(sat.bounds) ? { bounds: sat.bounds } : {}),
      ...(sat.attribution ? { attribution: sat.attribution } : {}),
    });
    add({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } });
  }
  if (hasTiles) {
    addRasterOverlay('elev-tint', 'elev', 0.7, 'linear');
    add({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': '#2b2b3a', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#44445a' } });
    addRasterOverlay('aspect', 'aspect', 0.7, 'nearest');
    addRasterOverlay('slope', 'slope', 0.75, 'nearest');
    addRasterOverlay('quality', 'quality', 0.8, 'nearest');
  }
  if (hasTiles && tiles.bounds) {
    // flat mask outside the DEM bounds: hides hillshade shading on the edge-extended terrain
    const [w, so, e, n] = tiles.bounds;
    map.addSource('outside-mask', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], [[w, so], [w, n], [e, n], [e, so], [w, so]]] } } });
    add({ id: 'outside-mask', type: 'fill', source: 'outside-mask', paint: { 'fill-color': '#e9ecef', 'fill-opacity': 1, 'fill-antialias': false } });
  }
  add({ id: 'lakes', type: 'fill', source: 'basemap', filter: ['==', ['get', 'kind'], 'lake'], paint: { 'fill-color': '#74c0fc', 'fill-opacity': 0.7, 'fill-outline-color': '#1c7ed6' } });
  add({ id: 'creeks', type: 'line', source: 'basemap', filter: ['==', ['get', 'kind'], 'creek'], paint: { 'line-color': '#339af0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.8], 'line-opacity': 0.9 } });
  add({ id: 'glaciers', type: 'fill', source: 'basemap', filter: ['==', ['get', 'kind'], 'glacier'], paint: { 'fill-color': '#e3f2fd', 'fill-opacity': 0.45, 'fill-outline-color': '#4dabf7' } });
  add({ id: 'glaciers-label', type: 'symbol', source: 'basemap', filter: ['==', ['get', 'kind'], 'glacier'], minzoom: 11,
    layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': false },
    paint: { 'text-color': '#1864ab', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
  if (map.getSource('contours')) {
    add({ id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'level'], 1, '#5b4636', '#8d7a6a'], 'line-width': ['match', ['get', 'level'], 1, 1.2, 0.5], 'line-opacity': 0.85 } });
    add({ id: 'contours-label', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0], minzoom: 12,
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-max-angle': 30 },
      paint: { 'text-color': '#4a3728', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
    add({ id: 'elev-ref-2100', type: 'line', source: 'contours', 'source-layer': 'contours', filter: ['==', ['get', 'ele'], 2100],
      paint: { 'line-color': '#d6336c', 'line-width': 2.2, 'line-dasharray': [3, 2], 'line-opacity': 0.95 } });
    add({ id: 'elev-ref-2100-label', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['==', ['get', 'ele'], 2100], minzoom: 11,
      layout: { 'symbol-placement': 'line', 'text-field': '2,100 m reference', 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-spacing': 350 },
      paint: { 'text-color': '#a61e4d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
  }
  add({ id: 'ates-zones', type: 'fill', source: 'ates', filter: ['==', ['get', 'layer'], 'zone'], paint: { 'fill-color': atesColorExpr(), 'fill-opacity': 0.35, 'fill-outline-color': 'rgba(0,0,0,0.25)' } });
  add({ id: 'ates-paths', type: 'line', source: 'ates', filter: ['==', ['get', 'layer'], 'path'], paint: { 'line-color': '#7048e8', 'line-width': 2, 'line-dasharray': [4, 2] } });
  add({ id: 'ates-boundary', type: 'line', source: 'ates', filter: ['==', ['get', 'layer'], 'boundary'], paint: { 'line-color': '#495057', 'line-width': 1.5, 'line-dasharray': [6, 3] } });
  add({ id: 'ates-road', type: 'line', source: 'ates', filter: ['==', ['get', 'layer'], 'road'], paint: { 'line-color': '#868e96', 'line-width': 2 } });
  add({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['match', ['get', 'kind'], 'closure', '#e03131', 'no-go', '#c92a2a', '#f08c00'], 'fill-opacity': 0.25 } });
  add({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['match', ['get', 'kind'], 'closure', '#e03131', 'no-go', '#c92a2a', '#f08c00'], 'line-width': 2.5, 'line-dasharray': [3, 2] } });
  // highlight sits UNDER the route lines (CONTRACTS.md#ui "underneath the line")
  add({ id: 'route-highlight', type: 'line', source: 'routes-descent', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
  add({ id: 'route-highlight-skin', type: 'line', source: 'routes-skin', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
  add({ id: 'routes-skin', type: 'line', source: 'routes-skin', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 2] } });
  add({ id: 'routes-descent-casing', type: 'line', source: 'routes-descent', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
  add({ id: 'routes-descent', type: 'line', source: 'routes-descent', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
  add({ id: 'routes-label', type: 'symbol', source: 'routes-descent',
    layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'num']], ['case', ['==', ['get', 'approx'], true], '~', '']], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'symbol-spacing': 300 },
    paint: { 'text-color': '#212529', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
  const poiColor = ['match', ['get', 'type'], 'hut', '#e03131', 'helipad', '#7048e8', 'peak', '#343a40', 'pass', '#a9712c', 'lake', '#1c7ed6', '#495057'];
  add({ id: 'pois', type: 'circle', source: 'pois', paint: { 'circle-radius': ['match', ['get', 'type'], 'hut', 8, 5], 'circle-color': poiColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  add({ id: 'pois-label', type: 'symbol', source: 'pois', minzoom: 11,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#212529', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
  add({ id: 'ates-decision', type: 'circle', source: 'ates', filter: ['==', ['get', 'layer'], 'decision'], paint: { 'circle-radius': 7, 'circle-color': '#fab005', 'circle-stroke-color': '#212529', 'circle-stroke-width': 2 } });
  add({ id: 'zone-info', type: 'circle', source: 'zone-info', paint: { 'circle-radius': 12, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 } });
  add({ id: 'zone-info-label', type: 'symbol', source: 'zone-info',
    layout: { 'text-field': 'i', 'text-font': ['Noto Sans Regular'], 'text-size': 15, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' } });

  // ---- terrain
  if (hasTiles) map.setTerrain({ source: 'dem', exaggeration });

  // ---- apply default group state
  for (const g of ALL_GROUPS) applyGroup(g.id);

  // ---- picking
  const pickLayers = ['zone-info', 'routes-descent', 'routes-skin', 'pois', 'areas-fill', 'ates-decision'];
  map.on('click', (e) => {
    const p = e.point;
    const layers = pickLayers.filter((l) => map.getLayer(l));
    const features = map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]], { layers });
    map.fire('kokanee:pick', { lngLat: e.lngLat, point: p, features });
  });
  for (const l of ['zone-info', 'routes-descent', 'routes-skin', 'pois', 'ates-decision']) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }
  map.__kokaneeHasTiles = hasTiles;
  return map;
}

function groupById(id) { return ALL_GROUPS.find((g) => g.id === id); }

function applyGroup(id) {
  const g = groupById(id);
  if (!g || !map) return;
  const par = parentOf[id] ? state[parentOf[id]] : null;
  const visible = state[id].visible && (par ? par.visible : true);
  let op = state[id].opacity * (par ? par.opacity : 1);
  if (id === 'hillshade' && satVisible()) op *= SAT_HILLSHADE_FACTOR;
  for (const lid of g.layers) {
    if (!map.getLayer(lid)) continue;
    map.setLayoutProperty(lid, 'visibility', visible ? 'visible' : 'none');
    const base = baseOpacity[lid] || {};
    for (const [prop, b] of Object.entries(base)) {
      const paintProp = prop === 'hillshade-exaggeration' ? prop : prop;
      map.setPaintProperty(lid, paintProp, Math.min(1, b * op));
    }
  }
  for (const c of g.children || []) applyGroup(c.id);
}

function satVisible() { return !!(sat && state.satellite.visible); }

export function setLayerVisible(groupId, bool) {
  if (!state[groupId]) return;
  state[groupId].visible = !!bool;
  applyGroup(groupId);
  if (groupId === 'satellite') applyGroup('hillshade');
}

export function setLayerOpacity(groupId, v) {
  if (!state[groupId]) return;
  state[groupId].opacity = Math.max(0, Math.min(1, +v));
  applyGroup(groupId);
}

export function getSat() { return sat; }

export function getLayerState() {
  const out = {};
  for (const id of Object.keys(state)) out[id] = { visible: state[id].visible, opacity: state[id].opacity };
  return out;
}

export function setExaggeration(v) {
  exaggeration = +v;
  if (map && map.getSource('dem')) map.setTerrain({ source: 'dem', exaggeration });
}
export function getExaggeration() { return exaggeration; }

export function setContent(fc) {
  if (!map || !fc) return;
  for (const s of CONTENT_SOURCES) {
    const src = map.getSource(s);
    if (src && fc[s]) src.setData(fc[s]);
  }
}

export function highlightRoute(id) {
  if (!map) return;
  const f = ['==', ['get', 'id'], id || ''];
  for (const l of ['route-highlight', 'route-highlight-skin']) if (map.getLayer(l)) map.setFilter(l, f);
}

export function flyHome() {
  if (!map) return;
  const flatMap = !map.__kokaneeHasTiles;
  map.flyTo({ center: HOME.center, zoom: flatMap ? 12.5 : HOME.zoom, pitch: flatMap ? 0 : HOME.pitch, bearing: flatMap ? 0 : HOME.bearing, duration: 1500 });
}

export function getMeta() { return meta; }
export function getTiles() { return tiles; }

// ATES class under a point (point-in-polygon on the loaded zones; most severe wins)
export function atesAt(lngLat) {
  const rank = { simple: 1, challenging: 2, complex: 3 };
  let best = null;
  const x = lngLat.lng, y = lngLat.lat;
  for (const f of atesData.features) {
    const p = f.properties || {};
    if (p.layer !== 'zone' || !f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      if (inRing(poly[0], x, y) && !poly.slice(1).some((h) => inRing(h, x, y))) {
        const c = String(p.class || '').toLowerCase();
        if (!best || (rank[c] || 0) > (rank[best] || 0)) best = c;
      }
    }
  }
  return best;
}
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
