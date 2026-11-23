// App JSON model helpers. No dependencies. Mirrors tools/validate_routes.py (CONTRACTS.md#app-json rules 1-8).

const ZONE_RE = /^z-[a-z0-9-]+$/;
const ROUTE_RE = /^(r\d{2}|si\d|u-[a-z0-9]+)$/;
const POI_RE = /^[a-z0-9-]+$/;
const AREA_RE = /^a-[a-z0-9-]+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const POI_TYPES = ['hut', 'helipad', 'peak', 'pass', 'lake', 'landmark'];
const AREA_KINDS = ['closure', 'no-go', 'note'];
const CONFIDENCE = ['low', 'medium', 'high'];
const BBOX = { lonMin: -117.32, lonMax: -117.02, latMin: 49.55, latMax: 49.87 };
const ROUTE_FIELDS = ['id', 'num', 'zone', 'name', 'time', 'gain_m', 'descent_m', 'description',
  'notes', 'approx', 'confidence', 'descent', 'skin'];
const ZONE_FIELDS = ['id', 'name', 'color', 'info_point', 'description', 'source'];
const POI_FIELDS = ['id', 'name', 'type', 'coord', 'description'];
const AREA_FIELDS = ['id', 'name', 'kind', 'polygon', 'description', 'source', 'valid_from', 'valid_to'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

function checkCoord(c, where, errs) {
  if (!Array.isArray(c) || c.length !== 2 || !c.every(isNum)) {
    errs.push(`${where}: coordinate must be [lon, lat] numbers`);
    return;
  }
  const [lon, lat] = c;
  if (!(lon >= BBOX.lonMin && lon <= BBOX.lonMax && lat >= BBOX.latMin && lat <= BBOX.latMax)) {
    errs.push(`${where}: coordinate ${JSON.stringify(c)} outside project bbox`);
  }
  if (c.some((v) => Math.round(v * 1e6) / 1e6 !== v)) {
    errs.push(`${where}: coordinate ${JSON.stringify(c)} has more than 6 decimal places`);
  }
}

function checkLine(line, where, errs) {
  if (!Array.isArray(line)) { errs.push(`${where}: must be a list`); return; }
  if (line.length === 1) errs.push(`${where}: must be [] or at least 2 points`);
  line.forEach((c, i) => checkCoord(c, `${where}[${i}]`, errs));
}

function checkFields(obj, fields, where, errs) {
  for (const f of fields) if (!(f in obj)) errs.push(`${where}: missing field '${f}'`);
}

function checkUnique(items, where, errs) {
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) errs.push(`${where}: duplicate id '${it.id}'`);
    seen.add(it.id);
  }
}

// validate(app, full?) -> {ok, errors[]}. full defaults to !app.pilot.
export function validate(app, full) {
  const errs = [];
  if (full === undefined) full = !(app && app.pilot);
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    return { ok: false, errors: ['root: must be an object'] };
  }
  // Rule 1
  for (const k of ['schema_version', 'content_rev', 'published_at', 'dem_version', 'zones', 'routes', 'pois', 'areas']) {
    if (!(k in app)) errs.push(`root: missing required key '${k}'`);
  }
  if (errs.length) return { ok: false, errors: errs };
  if (!(Number.isInteger(app.schema_version) && app.schema_version >= 1)) errs.push('schema_version must be an integer >= 1');
  if (!(Number.isInteger(app.content_rev) && app.content_rev >= 0)) errs.push('content_rev must be an integer >= 0');
  if (app.content_rev === 0 && app.pilot !== true) errs.push('content_rev 0 is only allowed when pilot is true');
  if (!isStr(app.published_at)) errs.push('published_at must be a string');
  if (!isStr(app.dem_version)) errs.push('dem_version must be a string');
  for (const k of ['zones', 'routes', 'pois', 'areas']) {
    if (!Array.isArray(app[k])) errs.push(`${k} must be a list`);
  }
  if (errs.length) return { ok: false, errors: errs };

  const { zones, routes, pois, areas } = app;
  checkUnique(zones, 'zones', errs);
  checkUnique(routes, 'routes', errs);
  checkUnique(pois, 'pois', errs);
  checkUnique(areas, 'areas', errs);

  const zoneIds = new Set(zones.map((z) => z.id));
  const routedZones = new Set(routes.map((r) => r.zone));
  for (const z of zones) {
    const zid = z.id;
    if (!ZONE_RE.test(String(zid))) errs.push(`zone '${zid}': bad id`);
    checkFields(z, ZONE_FIELDS, `zone '${zid}'`, errs);
    if (z.color != null && !HEX_RE.test(String(z.color))) errs.push(`zone '${zid}': color must be #rrggbb`);
    for (const f of ['name', 'description', 'source']) {
      if (f in z && !isStr(z[f])) errs.push(`zone '${zid}': ${f} must be a string`);
    }
    // Rule 7
    if (z.info_point != null) checkCoord(z.info_point, `zone '${zid}' info_point`, errs);
    else if (full && routedZones.has(zid)) errs.push(`zone '${zid}': info_point required for a full assembly`);
  }

  for (const r of routes) {
    const rid = r.id;
    if (!ROUTE_RE.test(String(rid))) errs.push(`route '${rid}': bad id`);
    checkFields(r, ROUTE_FIELDS, `route '${rid}'`, errs);
    if (!zoneIds.has(r.zone)) errs.push(`route '${rid}': zone '${r.zone}' does not exist`); // Rule 4
    checkLine(r.descent ?? [], `route '${rid}' descent`, errs);                          // Rule 5
    checkLine(r.skin ?? [], `route '${rid}' skin`, errs);
    if (!CONFIDENCE.includes(r.confidence)) errs.push(`route '${rid}': confidence must be low|medium|high`); // Rule 6
    for (const f of ['gain_m', 'descent_m']) {                                             // Rule 8
      if (r[f] != null && !isNum(r[f])) errs.push(`route '${rid}': ${f} must be a number or null`);
    }
    for (const f of ['num', 'name', 'time', 'description', 'notes', 'zone']) {
      if (f in r && !isStr(r[f])) errs.push(`route '${rid}': ${f} must be a string`);
    }
  }

  for (const p of pois) {
    if (!POI_RE.test(String(p.id))) errs.push(`poi '${p.id}': bad id`);
    checkFields(p, POI_FIELDS, `poi '${p.id}'`, errs);
    if (!POI_TYPES.includes(p.type)) errs.push(`poi '${p.id}': type must be one of ${POI_TYPES.join('|')}`); // Rule 6
    if ('coord' in p) checkCoord(p.coord, `poi '${p.id}' coord`, errs);
  }

  for (const a of areas) {
    if (!AREA_RE.test(String(a.id))) errs.push(`area '${a.id}': bad id`);
    checkFields(a, AREA_FIELDS, `area '${a.id}'`, errs);
    if (!AREA_KINDS.includes(a.kind)) errs.push(`area '${a.id}': kind must be one of ${AREA_KINDS.join('|')}`); // Rule 6
    (a.polygon || []).forEach((ring, ri) => {
      const where = `area '${a.id}' ring ${ri}`;
      if (!Array.isArray(ring) || ring.length < 4) { errs.push(`${where}: outer ring needs at least 4 points`); return; }
      ring.forEach((c, i) => checkCoord(c, `${where}[${i}]`, errs));
      const first = ring[0], last = ring[ring.length - 1];
      if (JSON.stringify(first) !== JSON.stringify(last)) errs.push(`${where}: first and last point must match`);
    });
  }

  return { ok: errs.length === 0, errors: errs };
}

const lineFeature = (coords, props) =>
  coords && coords.length >= 2 ? { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } } : null;

// toGeoJSON(app) -> { 'routes-descent', 'routes-skin', 'zone-info', 'pois', 'areas' } FeatureCollections.
export function toGeoJSON(app) {
  const colorOf = Object.fromEntries((app.zones || []).map((z) => [z.id, z.color]));
  const fc = (features) => ({ type: 'FeatureCollection', features: features.filter(Boolean) });
  const routes = app.routes || [];
  return {
    'routes-descent': fc(routes.map((r) => lineFeature(r.descent, {
      id: r.id, num: r.num, zone: r.zone, name: r.name, color: colorOf[r.zone], approx: r.approx,
    }))),
    'routes-skin': fc(routes.map((r) => lineFeature(r.skin, {
      id: r.id, num: r.num, zone: r.zone, name: r.name, color: colorOf[r.zone],
    }))),
    'zone-info': fc((app.zones || []).filter((z) => z.info_point).map((z) => ({
      type: 'Feature',
      properties: { id: z.id, name: z.name, color: z.color },
      geometry: { type: 'Point', coordinates: z.info_point },
    }))),
    pois: fc((app.pois || []).map((p) => ({
      type: 'Feature',
      properties: { id: p.id, name: p.name, type: p.type },
      geometry: { type: 'Point', coordinates: p.coord },
    }))),
    areas: fc((app.areas || []).map((a) => ({
      type: 'Feature',
      properties: { id: a.id, name: a.name, kind: a.kind },
      geometry: { type: 'Polygon', coordinates: a.polygon },
    }))),
  };
}

// diff(a, b) -> {added[], changed[], removed[]}; items are {kind, id}. kind: zone|route|poi|area.
export function diff(a, b) {
  const out = { added: [], changed: [], removed: [] };
  const sets = [
    ['zone', a.zones || [], b.zones || []],
    ['route', a.routes || [], b.routes || []],
    ['poi', a.pois || [], b.pois || []],
    ['area', a.areas || [], b.areas || []],
  ];
  const canon = (v) => JSON.stringify(v, (k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val).sort().reduce((o, key) => (o[key] = val[key], o), {})
      : val);
  for (const [kind, before, after] of sets) {
    const bMap = new Map(before.map((x) => [x.id, x]));
    const aMap = new Map(after.map((x) => [x.id, x]));
    for (const [id, x] of aMap) {
      if (!bMap.has(id)) out.added.push({ kind, id });
      else if (canon(bMap.get(id)) !== canon(x)) out.changed.push({ kind, id });
    }
    for (const id of bMap.keys()) if (!aMap.has(id)) out.removed.push({ kind, id });
  }
  return out;
}
