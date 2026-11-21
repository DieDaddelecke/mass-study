import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { mapCadastreFeatures } from '../src/geo/apicarto.js';
import type { ContextLayersResponse } from '../src/geo/contract.js';
import { GeoHttp, Throttle, type FetchLike } from '../src/geo/http.js';
import {
  bdTopoGreenKind,
  bdTopoRoadKind,
  geoJsonLines,
  mapBdTopoGreen,
  mapBdTopoRoads,
  mapBdTopoWater,
  mapOsmLayers,
  osmGreenKind,
  osmLevel,
  osmRoadKind,
  osmRoadWidth,
  overpassLayersQuery,
  sampleLine,
  titleCase,
} from '../src/geo/layers.js';
import { OverpassClient } from '../src/geo/osm.js';
import { tileCenter, tileCovered, validateTile, wmtsUrl } from '../src/geo/tiles.js';
import { fixture } from './helpers.js';

const raw = (f: string) => JSON.parse(fixture(`palaiseau/raw/${f}`)) as unknown;
const BBOX = '2.1962385,48.7115536,2.2003227,48.7142486';

/** Real streets + synthetic green elements, as the combined Overpass query would return them. */
function combinedOverpass(): string {
  const streets = raw('overpass-streets.json') as { elements: unknown[] };
  const green = JSON.parse(fixture('synthetic/overpass-green.json')) as { elements: unknown[] };
  return JSON.stringify({ ...streets, elements: [...streets.elements, ...green.elements] });
}

type Answer = string | number | Uint8Array | (() => string);
interface Call {
  url: string;
  init?: RequestInit;
}
function routeFetch(routes: [string, Answer][]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = routes.find(([m]) => url.includes(m));
    if (!r) return new Response('no route', { status: 404 });
    const a = r[1];
    if (typeof a === 'number') return new Response('err', { status: a });
    if (a instanceof Uint8Array) return new Response(a, { status: 200 });
    return new Response(typeof a === 'function' ? a() : fixture(a), { status: 200 });
  };
  return { fetch, calls };
}

const ALL_OK: [string, Answer][] = [
  ['troncon_de_route', 'palaiseau/raw/bdtopo-troncon_de_route.json'],
  ['zone_de_vegetation', 'palaiseau/raw/bdtopo-zone_de_vegetation.json'],
  ['BDTOPO_V3:haie', 'palaiseau/raw/bdtopo-haie.json'],
  ['surface_hydrographique', 'palaiseau/raw/bdtopo-surface_hydrographique.json'],
  ['PARCELLAIRE_EXPRESS', 'palaiseau/raw/wfs-parcellaire_express.json'],
  ['apicarto', 'palaiseau/raw/apicarto-parcelles-bbox.json'],
  ['overpass', combinedOverpass],
];

const config = loadConfig({});
const api = (routes: [string, Answer][], cfg = config, cache = false) => {
  const f = routeFetch(routes);
  return { app: createApi(cfg, { fetch: f.fetch, cache }), calls: f.calls };
};

describe('BD TOPO layer mapping (real fixtures)', () => {
  it('maps roads: kinds, widths, names, levels', () => {
    const roads = mapBdTopoRoads(raw('bdtopo-troncon_de_route.json'));
    expect(roads).toHaveLength(34);
    const gobert = roads.find((r) => r.name === 'Boulevard Thomas Gobert');
    expect(gobert).toMatchObject({ kind: 'tertiary', width: 5, widthEstimated: false, level: 0 });
    expect(roads.find((r) => r.name === 'Rue Jean Pacilly')).toMatchObject({
      kind: 'residential',
      width: 3,
    });
    const sentier = roads.filter((r) => r.kind === 'path');
    expect(sentier).toHaveLength(4);
    expect(sentier[0]).toMatchObject({ width: 1.5, widthEstimated: true });
    // no width, no lanes → default for kind
    expect(roads.some((r) => r.kind === 'residential' && r.widthEstimated && r.width === 5)).toBe(
      true,
    );
    // z dropped
    expect(roads.every((r) => r.line.every((p) => p.length === 2))).toBe(true);
    expect(mapBdTopoRoads(raw('bdtopo-troncon_de_route.json'), { dropTrails: true })).toHaveLength(
      30,
    );
  });

  it('maps natures, lanes, fictif, levels and multi-lines', () => {
    expect(bdTopoRoadKind('Autoroute', '1')).toBe('motorway');
    expect(bdTopoRoadKind('Type autoroutier', '1')).toBe('motorway');
    expect(bdTopoRoadKind('Bretelle', '2')).toBe('primary');
    expect(bdTopoRoadKind('Route à 2 chaussées', '3')).toBe('secondary');
    expect(bdTopoRoadKind('Rond-point', '4')).toBe('tertiary');
    expect(bdTopoRoadKind('Route empierrée', '6')).toBe('track');
    expect(bdTopoRoadKind('Escalier', '6')).toBe('path');
    expect(bdTopoRoadKind('Piste cyclable', '6')).toBe('cycleway');
    expect(bdTopoRoadKind('Bac ou liaison maritime', '6')).toBeUndefined();
    const line = (coords: number[][]) => ({ type: 'LineString', coordinates: coords });
    const r = mapBdTopoRoads({
      features: [
        {
          id: 'a',
          properties: {
            nature: 'Route à 1 chaussée',
            importance: '3',
            nombre_de_voies: 2,
            position_par_rapport_au_sol: '-1',
            nom_collaboratif_gauche: "AV DE L'EUROPE",
          },
          geometry: line([
            [0, 0, 5],
            [1, 1, 5],
          ]),
        },
        {
          id: 'b',
          properties: { nature: 'Route à 1 chaussée', fictif: true },
          geometry: line([
            [0, 0],
            [1, 1],
          ]),
        },
        {
          id: 'c',
          properties: { nature: 'Sentier', position_par_rapport_au_sol: '1' },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [0, 0],
                [1, 0],
              ],
              [
                [2, 0],
                [3, 0],
              ],
            ],
          },
        },
      ],
    });
    expect(r.map((x) => x.id)).toEqual(['ign/a', 'ign/c#0', 'ign/c#1']);
    expect(r[0]).toMatchObject({ width: 6, level: -1, kind: 'secondary', name: "Av de l'Europe" });
    expect(r[0]?.line).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(r[1]?.level).toBe(1);
    expect(geoJsonLines({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
  });

  it('title-cases upper-case names only', () => {
    expect(titleCase('R DE LA REINE BATHILDE')).toBe('R de la Reine Bathilde');
    expect(titleCase('PASS JOBIN-YVON')).toBe('Pass Jobin-Yvon');
    expect(titleCase('Rue Jean Pacilly')).toBe('Rue Jean Pacilly');
  });

  it('maps vegetation, hedges and water', () => {
    const green = mapBdTopoGreen(raw('bdtopo-zone_de_vegetation.json'));
    expect(green.map((g) => g.kind)).toEqual(['wood', 'hedge']);
    expect(green[0]?.polygons.length).toBeGreaterThan(0);
    expect(mapBdTopoGreen(raw('bdtopo-haie.json'), 'hedge')).toEqual([]);
    expect(mapBdTopoWater(raw('bdtopo-surface_hydrographique.json'))).toEqual([]);
    expect(bdTopoGreenKind('Bois')).toBe('wood');
    expect(bdTopoGreenKind('Lande ligneuse')).toBe('scrub');
    expect(bdTopoGreenKind('Vigne')).toBe('other');
    expect(bdTopoGreenKind(undefined)).toBe('other');
    const water = mapBdTopoWater({
      features: [
        {
          properties: { cleabs: 'W1' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
        },
      ],
    });
    expect(water).toEqual([
      {
        id: 'ign/W1',
        polygons: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
        source: 'ign',
      },
    ]);
  });

  it('maps cadastre features from API Carto and Parcellaire Express', () => {
    const a = mapCadastreFeatures(raw('apicarto-parcelles-bbox.json'));
    expect(a).toHaveLength(21);
    expect(a.some((p) => p.ref === '914770000H0518')).toBe(true);
    expect(a[0]).toMatchObject({
      ref: '914770000H0342',
      label: 'Palaiseau 0H 0342',
      officialArea: 5192,
    });
    const w = mapCadastreFeatures(raw('wfs-parcellaire_express.json'), 'wfs');
    expect(w.length).toBeGreaterThan(20);
    expect(w[0]?.provider).toBe('wfs');
  });
});

describe('OSM layer mapping', () => {
  const layers = mapOsmLayers(JSON.parse(combinedOverpass()));

  it('maps streets (real) with kinds, widths and levels', () => {
    const gobert = layers.roads.find((r) => r.name === 'Boulevard Thomas Gobert');
    expect(gobert).toMatchObject({ kind: 'secondary', width: 6.5, widthEstimated: false });
    expect(layers.roads.some((r) => r.kind === 'cycleway' && r.width === 3)).toBe(true);
    expect(layers.roads.some((r) => r.level === -1)).toBe(true);
    const streets = (
      raw('overpass-streets.json') as { elements: { tags: Record<string, string> }[] }
    ).elements.filter((e) => e.tags.highway || e.tags.railway);
    // highway=construction and pedestrian areas (area=yes) are skipped
    const skipped = streets.filter(
      (e) => e.tags.highway === 'construction' || e.tags.area === 'yes',
    );
    expect(skipped).toHaveLength(5);
    expect(layers.roads).toHaveLength(streets.length - skipped.length);
  });

  it('maps OSM tags', () => {
    expect(osmRoadKind({ highway: 'motorway_link' })).toBe('motorway');
    expect(osmRoadKind({ highway: 'trunk' })).toBe('primary');
    expect(osmRoadKind({ highway: 'tertiary' })).toBe('tertiary');
    expect(osmRoadKind({ highway: 'steps' })).toBe('footway');
    expect(osmRoadKind({ highway: 'track' })).toBe('track');
    expect(osmRoadKind({ highway: 'bridleway' })).toBe('path');
    expect(osmRoadKind({ highway: 'pedestrian', area: 'yes' })).toBeUndefined();
    expect(osmRoadKind({ railway: 'tram' })).toBe('tram');
    expect(osmRoadKind({ railway: 'light_rail' })).toBe('rail');
    expect(osmRoadWidth({ lanes: '2' }, 'residential')).toEqual({
      width: 6.5,
      widthEstimated: false,
    });
    expect(osmRoadWidth({ lanes: '2' }, 'footway')).toEqual({ width: 2, widthEstimated: true });
    expect(osmRoadWidth({}, 'tram')).toEqual({ width: 1.5, widthEstimated: true });
    expect(osmLevel({ bridge: 'yes' })).toBe(1);
    expect(osmLevel({ tunnel: 'yes' })).toBe(-1);
    expect(osmLevel({ tunnel: 'building_passage' })).toBe(0);
    expect(osmLevel({ layer: '2' })).toBe(1);
    expect(osmGreenKind({ landuse: 'recreation_ground' })).toBe('park');
    expect(osmGreenKind({ landuse: 'forest' })).toBe('wood');
    expect(osmGreenKind({ landuse: 'allotments' })).toBe('garden');
    expect(osmGreenKind({ landuse: 'cemetery' })).toBe('other');
    expect(osmGreenKind({ natural: 'heath' })).toBe('scrub');
    expect(osmGreenKind({ natural: 'grassland' })).toBe('grass');
    expect(osmGreenKind({ leisure: 'pitch' })).toBe('pitch');
    expect(osmGreenKind({ building: 'yes' })).toBeUndefined();
  });

  it('maps green areas incl. a multipolygon with a hole (synthetic)', () => {
    expect(layers.green.map((g) => [g.id, g.kind])).toEqual([
      ['osm/way/9200000002', 'park'],
      ['osm/way/9200000003', 'grass'],
      ['osm/relation/9300000001', 'wood'],
    ]);
    const wood = layers.green[2]!;
    expect(wood.polygons).toHaveLength(1);
    expect(wood.polygons[0]).toHaveLength(2); // outer joined from two ways + inner
    expect(wood.polygons[0]![0]).toHaveLength(5);
  });

  it('maps trees with defaults and samples tree rows every 8 m', () => {
    const t = layers.trees;
    expect(t.find((x) => x.id === 'osm/node/9100000001')).toMatchObject({
      height: 14,
      crown: 9,
      heightEstimated: false,
      leafType: 'broadleaved',
    });
    expect(t.find((x) => x.id === 'osm/node/9100000002')).toMatchObject({
      height: 10,
      crown: 6,
      heightEstimated: true,
      leafType: 'needleleaved',
    });
    const est = t.find((x) => x.id === 'osm/node/9100000003');
    expect(est?.height).toBe(6);
    expect(est?.crown).toBeCloseTo(3.6);
    const row = t.filter((x) => x.id.startsWith('osm/way/9200000001#'));
    // 0.001° lon at 48.71° ≈ 73.5 m → samples at 0, 8, …, 72 m
    expect(row).toHaveLength(10);
    expect(row[0]).toMatchObject({ height: 8, crown: 4.8, heightEstimated: false });
  });

  it('samples lines', () => {
    expect(sampleLine([], 8)).toEqual([]);
    expect(sampleLine([[0, 0]], 8)).toEqual([[0, 0]]);
    expect(
      sampleLine(
        [
          [0, 0],
          [0, 0.0001],
        ],
        8,
      ),
    ).toHaveLength(2); // ~11 m
  });

  it('maps OSM water and builds one combined query', () => {
    const w = mapOsmLayers({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { natural: 'water' },
          geometry: [
            { lon: 0, lat: 0 },
            { lon: 1, lat: 0 },
            { lon: 1, lat: 1 },
            { lon: 0, lat: 0 },
          ],
        },
        {
          type: 'way',
          id: 2,
          tags: { waterway: 'stream' },
          geometry: [
            { lon: 0, lat: 0 },
            { lon: 1, lat: 0 },
          ],
        },
      ],
    });
    expect(w.water.map((x) => x.id)).toEqual(['osm/way/1']);
    const q = overpassLayersQuery([2.19, 48.71, 2.2, 48.72]);
    expect(q).toContain('node["natural"="tree"](48.71,2.19,48.72,2.2)');
    expect(q).toContain('relation["natural"~"^(wood|scrub|grassland|heath|water)$"]');
    expect(q.endsWith('out geom;')).toBe(true);
  });
});

describe('Overpass mirror fallback', () => {
  const client = (f: FetchLike, urls?: string[]) =>
    new OverpassClient(new GeoHttp(f, 'ua'), urls, new Throttle(0));

  it('tries the next mirror on 502/504/429', async () => {
    const f = routeFetch([
      ['overpass-api.de', 502],
      ['kumi.systems', 429],
      ['maps.mail.ru', 'palaiseau/raw/overpass-streets.json'],
    ]);
    const r = (await client(f.fetch).query('x')) as { elements: unknown[] };
    expect(r.elements.length).toBe(50);
    expect(f.calls.map((c) => new URL(c.url).host)).toEqual([
      'overpass-api.de',
      'overpass.kumi.systems',
      'maps.mail.ru',
    ]);
  });

  it('does not retry on 400 and throws the last error when all fail', async () => {
    const bad = routeFetch([['overpass', 400]]);
    await expect(client(bad.fetch).query('x')).rejects.toThrow('HTTP 400');
    expect(bad.calls).toHaveLength(1);
    const down = routeFetch([['', 503]]);
    await expect(client(down.fetch, ['https://a/x', 'https://b/x']).query('x')).rejects.toThrow(
      'HTTP 503',
    );
    expect(down.calls).toHaveLength(2);
    await expect(client(down.fetch, []).query('x')).rejects.toThrow('no endpoint');
  });

  it('reads OVERPASS_URLS', () => {
    expect(loadConfig({ OVERPASS_URLS: ' https://a/i , https://b/i ' }).overpassUrls).toEqual([
      'https://a/i',
      'https://b/i',
    ]);
    expect(loadConfig({}).overpassUrls[0]).toBe('https://overpass-api.de/api/interpreter');
  });
});

describe('GET /api/context/layers', () => {
  it('returns all layers from the recorded fixtures', async () => {
    const { app, calls } = api(ALL_OK);
    const res = await app.request(`/api/context/layers?bbox=${BBOX}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextLayersResponse;
    expect(body.errors).toBeUndefined();
    expect(body.providers).toEqual({
      roads: 'ign',
      green: 'ign',
      trees: 'osm',
      water: 'ign',
      parcels: 'apicarto',
    });
    // BD TOPO trails dropped, OSM footways/cycleways/paths added
    expect(body.roads.filter((r) => r.source === 'ign')).toHaveLength(30);
    const osm = body.roads.filter((r) => r.source === 'osm');
    expect(osm.length).toBeGreaterThan(10);
    expect(osm.every((r) => ['footway', 'cycleway', 'path', 'rail', 'tram'].includes(r.kind))).toBe(
      true,
    );
    expect(body.green.map((g) => g.source)).toContain('osm');
    expect(body.trees.length).toBe(14);
    expect(body.parcels).toHaveLength(21);
    // exactly one Overpass POST, PARCELLAIRE_EXPRESS not needed
    expect(calls.filter((c) => c.url.includes('overpass'))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('PARCELLAIRE_EXPRESS'))).toBe(false);
    const apicarto = calls.find((c) => c.url.includes('apicarto'))!.url;
    expect(decodeURIComponent(apicarto)).toContain('"type":"Polygon"');
    expect(apicarto).toContain('_limit=1000');
  });

  it('degrades per layer and falls back to Parcellaire Express', async () => {
    const { app } = api([
      ['troncon_de_route', 503],
      ['zone_de_vegetation', 'palaiseau/raw/bdtopo-zone_de_vegetation.json'],
      ['BDTOPO_V3:haie', 'palaiseau/raw/bdtopo-haie.json'],
      ['surface_hydrographique', 'palaiseau/raw/bdtopo-surface_hydrographique.json'],
      ['PARCELLAIRE_EXPRESS', 'palaiseau/raw/wfs-parcellaire_express.json'],
      ['apicarto', 500],
      ['overpass', combinedOverpass],
    ]);
    const body = (await (
      await app.request(`/api/context/layers?bbox=${BBOX}`)
    ).json()) as ContextLayersResponse;
    // roads fall back to all OSM roads
    expect(body.providers.roads).toBe('osm');
    expect(body.roads.some((r) => r.kind === 'secondary')).toBe(true);
    expect(body.errors).toEqual([{ layer: 'roads', message: 'ign-wfs: HTTP 503' }]);
    expect(body.providers.parcels).toBe('ign');
    expect(body.parcels.length).toBeGreaterThan(20);
  });

  it('answers 200 with empty layers and errors when every upstream fails', async () => {
    const { app } = api([['', 503]]);
    const res = await app.request(`/api/context/layers?bbox=${BBOX}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ContextLayersResponse;
    expect(body).toMatchObject({
      roads: [],
      green: [],
      trees: [],
      water: [],
      parcels: [],
      providers: {},
    });
    expect(body.errors?.filter((e) => e.layer === 'green')).toHaveLength(2); // 2× ign-wfs merged
    expect(new Set(body.errors?.map((e) => e.layer))).toEqual(
      new Set(['roads', 'green', 'trees', 'water', 'parcels']),
    );
  });

  it('uses OSM only outside France and generic WFS parcels when configured', async () => {
    const cfg = loadConfig({
      PARCEL_WFS: JSON.stringify([
        {
          id: 'de',
          url: 'https://wfs.example/de',
          typeName: 'x:fl',
          coverage: [13, 52, 14, 53],
          fields: { ref: 'flstkennz' },
        },
      ]),
    });
    const { app, calls } = api(
      [
        ['wfs.example', 'synthetic/synthetic-wfs-parcels.json'],
        ['overpass', combinedOverpass],
      ],
      cfg,
    );
    const body = (await (
      await app.request('/api/context/layers?bbox=13.40,52.50,13.41,52.505')
    ).json()) as ContextLayersResponse;
    expect(body.providers).toEqual({ roads: 'osm', green: 'osm', trees: 'osm', water: 'osm' });
    expect(body.roads.some((r) => r.kind === 'service')).toBe(true);
    expect(body.parcels.length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes('data.geopf.fr') || c.url.includes('apicarto'))).toBe(
      false,
    );
    expect(calls.find((c) => c.url.includes('wfs.example'))?.url).toContain(
      'BBOX=52.5000000,13.4000000',
    );
  });

  it('validates the bbox', async () => {
    const { app } = api([]);
    expect((await app.request('/api/context/layers')).status).toBe(400);
    expect((await app.request('/api/context/layers?bbox=2,48,2.1,48.1')).status).toBe(400);
    expect((await app.request('/api/context/layers?bbox=2.2,48.7,2.1,48.8')).status).toBe(400);
  });
});

describe('GET /api/tiles', () => {
  const T = { z: 18, x: 132672, y: 90343 };
  const png = new Uint8Array(
    readFileSync(join(import.meta.dirname, 'fixtures/palaiseau/raw/tile-planign.png')),
  );
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('validates and builds WMTS URLs', () => {
    expect(wmtsUrl({ basemap: 'plan', ...T })).toBe(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=18&TILEROW=90343&TILECOL=132672&FORMAT=image/png',
    );
    expect(validateTile(9, 0, 0)).toMatch(/^z/);
    expect(validateTile(20, 0, 0)).toMatch(/^z/);
    expect(validateTile(10, 1024, 0)).toMatch(/^x/);
    expect(validateTile(10, 0, -1)).toMatch(/^y/);
    expect(validateTile(18, T.x, T.y)).toBeUndefined();
    const [lon, lat] = tileCenter(T.z, T.x, T.y);
    expect(lon).toBeCloseTo(2.1983, 3);
    expect(lat).toBeCloseTo(48.7129, 3);
    expect(tileCovered(T.z, T.x, T.y)).toBe(true);
  });

  it('proxies, caches on disk and serves the second request from cache', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kubatur-tiles-'));
    dirs.push(dataDir);
    const ortho = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const { app, calls } = api(
      [
        ['PLANIGNV2', png],
        ['ORTHOPHOTOS', ortho],
      ],
      loadConfig({ DATA_DIR: dataDir }),
      true,
    );
    const r1 = await app.request(`/api/tiles/plan/${T.z}/${T.x}/${T.y}`);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('content-type')).toBe('image/png');
    expect(r1.headers.get('cache-control')).toBe('public, max-age=604800');
    expect(r1.headers.get('x-cache')).toBe('MISS');
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(png);
    const r2 = await app.request(`/api/tiles/plan/${T.z}/${T.x}/${T.y}`);
    expect(r2.headers.get('x-cache')).toBe('HIT');
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(png);
    expect(calls).toHaveLength(1);
    const r3 = await app.request(`/api/tiles/ortho/${T.z}/${T.x}/${T.y}.jpg`);
    expect(r3.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await r3.arrayBuffer())).toEqual(ortho);
    expect(calls[1]?.url).toContain('LAYER=ORTHOIMAGERY.ORTHOPHOTOS');
  });

  it('rejects bad layers / addresses, 404s outside France and on upstream 404', async () => {
    const { app, calls } = api([['wmts', 404]]);
    expect((await app.request(`/api/tiles/osm/${T.z}/${T.x}/${T.y}`)).status).toBe(400);
    expect((await app.request(`/api/tiles/plan/9/1/1`)).status).toBe(400);
    expect((await app.request(`/api/tiles/plan/18/abc/1`)).status).toBe(400);
    expect((await app.request(`/api/tiles/plan/18/${2 ** 18}/1`)).status).toBe(400);
    expect((await app.request(`/api/tiles/plan/12/2200/1343`)).status).toBe(404); // Berlin
    expect(calls).toHaveLength(0);
    expect((await app.request(`/api/tiles/plan/${T.z}/${T.x}/${T.y}`)).status).toBe(404);
    const down = api([['wmts', 503]]);
    expect((await down.app.request(`/api/tiles/plan/${T.z}/${T.x}/${T.y}`)).status).toBe(502);
  });
});
