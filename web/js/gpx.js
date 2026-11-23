// gpx.js [WS6] - GPX 1.1 export. One <trk> per descent and per skin line, named "#num Name (descent|skin)".
// Elevations are never stored in App JSON, so track points carry no <ele>.

// strip characters that are illegal in XML 1.0, then escape the five predefined entities
const xmlText = (s) => String(s ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const pt = (c) => `<trkpt lat="${(+c[1]).toFixed(6)}" lon="${(+c[0]).toFixed(6)}"/>`;

export function trackName(route, kind) { return `#${route.num} ${route.name} (${kind})`; }

// toGPX(app, {time}) -> GPX 1.1 XML string
export function toGPX(app, { time = new Date() } = {}) {
  const zoneName = Object.fromEntries((app.zones || []).map((z) => [z.id, z.name]));
  const trks = [];
  for (const r of app.routes || []) {
    for (const kind of ['descent', 'skin']) {
      const line = r[kind];
      if (!Array.isArray(line) || line.length < 2) continue;
      const desc = [zoneName[r.zone] || r.zone, r.approx ? 'approximate line (not yet confirmed)' : 'confirmed line'].join('; ');
      trks.push(`  <trk>\n    <name>${xmlText(trackName(r, kind))}</name>\n    <desc>${xmlText(desc)}</desc>\n    <type>${kind}</type>\n    <trkseg>\n${line.map((c) => `      ${pt(c)}`).join('\n')}\n    </trkseg>\n  </trk>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Kokanee 3D Topo" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Kokanee Glacier ski routes</name>
    <time>${time.toISOString().replace(/\.\d+Z$/, 'Z')}</time>
  </metadata>
${trks.join('\n')}
</gpx>
`;
}
