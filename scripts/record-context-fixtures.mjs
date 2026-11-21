#!/usr/bin/env node
/**
 * Records real geodata responses for the Palaiseau test site into
 * apps/server/test/fixtures/palaiseau/raw/ (the CI/dev container cannot reach these services).
 * Usage: node scripts/record-context-fixtures.mjs [minLon,minLat,maxLon,maxLat]
 * Node >= 22, no dependencies. Prints a summary (status, size, feature count, CORS header).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps/server/test/fixtures/palaiseau/raw');
// 150 m around 27 Bd Thomas Gobert (same box the app requests for the context).
const bbox = (process.argv[2] ?? '2.1962385,48.7115536,2.2003227,48.7142486')
  .split(',')
  .map(Number);
const [w, s, e, n] = bbox;
const UA = 'Kubatur/0.1 (massing study tool; fixture recording)';

const wfs = (typeName, extra = '') =>
  `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${typeName}` +
  `&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=2000${extra}` +
  `&BBOX=${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326`;

const bboxPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
};
const box = `${s},${w},${n},${e}`;
const overpassGreen =
  `[out:json][timeout:25];(` +
  `node["natural"="tree"](${box});way["natural"="tree_row"](${box});` +
  `way["natural"~"^(wood|scrub|grassland|heath)$"](${box});relation["natural"="wood"](${box});` +
  `way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery|allotments)$"](${box});` +
  `way["leisure"~"^(park|garden|pitch|playground)$"](${box});relation["leisure"="park"](${box});` +
  `);out geom;`;
const overpassStreets =
  `[out:json][timeout:25];(way["highway"](${box});way["railway"~"^(rail|tram|light_rail)$"](${box});` +
  `way["area:highway"](${box});way["natural"="water"](${box});way["waterway"](${box}););out geom;`;

// Web-mercator tile containing the site centre, for map-texture checks.
const z = 18;
const lon = (w + e) / 2;
const lat = (s + n) / 2;
const tx = Math.floor(((lon + 180) / 360) * 2 ** z);
const ty = Math.floor(
  ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
    2) *
    2 ** z,
);
const wmts = (layer, format, style = 'normal') =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=${style}` +
  `&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${ty}&TILECOL=${tx}&FORMAT=${format}`;

const jobs = [
  ['bdtopo-troncon_de_route.json', wfs('BDTOPO_V3:troncon_de_route')],
  ['bdtopo-zone_de_vegetation.json', wfs('BDTOPO_V3:zone_de_vegetation')],
  ['bdtopo-haie.json', wfs('BDTOPO_V3:haie')],
  ['bdtopo-equipement_de_transport.json', wfs('BDTOPO_V3:equipement_de_transport')],
  ['bdtopo-surface_hydrographique.json', wfs('BDTOPO_V3:surface_hydrographique')],
  ['wfs-parcellaire_express.json', wfs('CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle')],
  [
    'apicarto-parcelles-bbox.json',
    `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(JSON.stringify(bboxPolygon))}&_limit=1000`,
  ],
  ['overpass-green.json', 'https://overpass-api.de/api/interpreter', overpassGreen],
  ['overpass-streets.json', 'https://overpass-api.de/api/interpreter', overpassStreets],
  ['tile-planign.png', wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png')],
  ['tile-ortho.jpg', wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg')],
  ['tile-openfreemap-style.json', 'https://tiles.openfreemap.org/styles/liberty'],
];

await mkdir(outDir, { recursive: true });
const summary = {
  recordedAt: new Date().toISOString(),
  bbox,
  tile: { z, x: tx, y: ty },
  files: {},
};
for (const [file, url, body] of jobs) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': UA,
        Origin: 'http://localhost:5173',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body ? `data=${encodeURIComponent(body)}` : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const entry = {
      url: body ? `${url} (POST) ${body}` : url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      cors: res.headers.get('access-control-allow-origin'),
      bytes: buf.length,
      ms: Date.now() - started,
    };
    if (res.ok) {
      await writeFile(join(outDir, file), buf);
      if (/json/.test(entry.contentType ?? '') || file.endsWith('.json')) {
        try {
          const j = JSON.parse(buf.toString('utf8'));
          entry.count = Array.isArray(j.features)
            ? j.features.length
            : Array.isArray(j.elements)
              ? j.elements.length
              : undefined;
          const props = j.features?.[0]?.properties;
          if (props) entry.firstProperties = props;
          const tags = j.elements?.find((x) => x.tags)?.tags;
          if (tags) entry.firstTags = tags;
        } catch {
          entry.parseError = true;
        }
      }
    } else {
      entry.errorBody = buf.toString('utf8').slice(0, 400);
    }
    summary.files[file] = entry;
    console.log(
      `${file}: ${entry.status} ${entry.bytes} B${entry.count !== undefined ? `, ${entry.count} items` : ''}, CORS=${entry.cors}`,
    );
  } catch (err) {
    summary.files[file] = { url, error: String(err) };
    console.log(`${file}: ERROR ${String(err)}`);
  }
  if (url.includes('overpass')) await new Promise((r) => setTimeout(r, 2000));
}
await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outDir}`);
