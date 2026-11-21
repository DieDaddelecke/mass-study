import { describe, expect, it } from 'vitest';
import { ApiCartoParcelProvider } from '../src/geo/apicarto.js';
import { BdTopoContextProvider, bdTopoUrl } from '../src/geo/bdtopo.js';
import { GeoHttp, Throttle } from '../src/geo/http.js';
import { IgnGeocodeProvider } from '../src/geo/ign-geocode.js';
import { NominatimGeocodeProvider } from '../src/geo/nominatim.js';
import { OverpassContextProvider, mapOverpass, overpassQuery } from '../src/geo/overpass.js';
import { OverpassClient } from '../src/geo/osm.js';
import { parseMeters } from '../src/geo/height.js';
import { WfsParcelProvider } from '../src/geo/wfs-parcel.js';
import { fakeFetch, fixture } from './helpers.js';

const UA = 'Kubatur-test/1.0';
const http = (f: ReturnType<typeof fakeFetch>) => new GeoHttp(f.fetch, UA);

describe('IGN geocoding', () => {
  it('maps search results', async () => {
    const f = fakeFetch([['/geocodage/search', 'palaiseau/geocode.json']]);
    const r = await new IgnGeocodeProvider(http(f)).search(
      '27 Bd Thomas Gobert 91120 Palaiseau',
      5,
    );
    expect(f.calls[0]?.url).toBe(
      'https://data.geopf.fr/geocodage/search?q=27%20Bd%20Thomas%20Gobert%2091120%20Palaiseau&limit=5',
    );
    expect(new Headers(f.calls[0]?.init?.headers).get('User-Agent')).toBe(UA);
    expect(r).toEqual([
      {
        label: '27 Boulevard Thomas Gobert 91120 Palaiseau',
        lonLat: [2.197965, 48.713064],
        kind: 'address',
        city: 'Palaiseau',
        postcode: '91120',
        score: expect.closeTo(0.693, 3) as number,
        provider: 'ign',
      },
    ]);
  });

  it('maps completion results', async () => {
    const f = fakeFetch([['/geocodage/completion', 'palaiseau/completion.json']]);
    const r = await new IgnGeocodeProvider(http(f)).complete('27 bd thomas gob', 5);
    expect(f.calls[0]?.url).toBe(
      'https://data.geopf.fr/geocodage/completion?text=27%20bd%20thomas%20gob&type=StreetAddress&maximumResponses=5',
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      label: '27 Boulevard Thomas Gobert, 91120 Palaiseau',
      lonLat: [2.197965, 48.713064],
      kind: 'address',
      postcode: '91120',
    });
    expect(r[1]).toMatchObject({ kind: 'street', city: 'Gif-sur-Yvette' });
  });
});

describe('Nominatim geocoding (synthetic fixture)', () => {
  it('maps jsonv2 results and builds the verified URL', async () => {
    const f = fakeFetch([['nominatim', 'synthetic/synthetic-nominatim.json']]);
    const r = await new NominatimGeocodeProvider(http(f), new Throttle(0)).search('Berlin', 3);
    expect(f.calls[0]?.url).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Berlin&limit=3',
    );
    expect(r[0]).toMatchObject({
      lonLat: [13.405, 52.52],
      kind: 'municipality',
      provider: 'nominatim',
    });
  });
});

describe('API Carto cadastre', () => {
  it('maps parcel 0518', async () => {
    const f = fakeFetch([['apicarto', 'palaiseau/parcel-0518.json']]);
    const p = new ApiCartoParcelProvider(http(f));
    expect(p.covers([2.197965, 48.713064])).toBe(true);
    expect(p.covers([13.4, 52.5])).toBe(false);
    const r = await p.parcelsAt([2.197965, 48.713064]);
    expect(decodeURIComponent(f.calls[0]?.url ?? '')).toBe(
      'https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[2.197965,48.713064]}',
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      ref: '914770000H0518',
      label: 'Palaiseau 0H 0518',
      officialArea: 3341,
      provider: 'apicarto',
    });
    expect(r[0]?.polygons).toHaveLength(1);
    expect(r[0]?.polygons[0]).toHaveLength(1);
    expect(r[0]?.polygons[0]?.[0]).toHaveLength(6 + 1); // 6 distinct points, closed ring
  });

  it('maps the neighbouring parcel 0519', async () => {
    const f = fakeFetch([['apicarto', 'palaiseau/parcel-0519.json']]);
    const r = await new ApiCartoParcelProvider(http(f)).parcelsAt([2.199, 48.7128]);
    expect(r[0]?.ref).toMatch(/0519$/);
  });
});

describe('generic WFS parcels (synthetic)', () => {
  const cfg = {
    id: 'synthetic',
    url: 'https://wfs.example.invalid/wfs',
    typeName: 'ave:Flurstueck',
    coverage: [6, 50, 8, 52] as [number, number, number, number],
    fields: { ref: 'flstkennz', label: ['gemarkung', 'flstnrzae'], area: 'amtlflsfl' },
  };

  it('builds a WFS 2.0 request and keeps only the parcel under the point', async () => {
    const f = fakeFetch([['wfs.example.invalid', 'synthetic/synthetic-wfs-parcels.json']]);
    const p = new WfsParcelProvider(http(f), cfg);
    expect(p.covers([7.0005, 51.0005])).toBe(true);
    expect(p.covers([2, 48])).toBe(false);
    const r = await p.parcelsAt([7.0015, 51.0005]);
    const url = f.calls[0]?.url ?? '';
    expect(url).toContain(
      'SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ave%3AFlurstueck',
    );
    expect(url).toContain('SRSNAME=EPSG:4326');
    expect(url).toContain(
      'BBOX=51.0003000,7.0013000,51.0007000,7.0017000,urn:ogc:def:crs:EPSG::4326',
    );
    expect(r).toEqual([
      {
        ref: '05123400100002______',
        label: 'Synthetisch 2',
        officialArea: 800,
        polygons: [[expect.any(Array) as unknown]],
        provider: 'wfs',
      },
    ]);
  });
});

describe('BD TOPO context', () => {
  const bbox: [number, number, number, number] = [2.19626, 48.71155, 2.20034, 48.71425];

  it('uses the verified URL with lat,lon BBOX', () => {
    expect(bdTopoUrl(bbox)).toBe(
      'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=1000&BBOX=48.71155,2.19626,48.71425,2.20034,urn:ogc:def:crs:EPSG::4326',
    );
  });

  it('applies the height rule and keeps holes', async () => {
    const f = fakeFetch([['wfs/ows', 'palaiseau/bdtopo-batiment.json']]);
    const r = await new BdTopoContextProvider(http(f)).buildings(bbox);
    const byId = new Map(r.map((b) => [b.id, b]));
    expect(r).toHaveLength(6);
    expect(byId.get('ign/batiment.20566124')).toMatchObject({ height: 9, heightEstimated: true });
    expect(byId.get('ign/batiment.11041193')).toMatchObject({
      height: 10.7,
      levels: 1,
      heightEstimated: false,
    });
    expect(byId.get('ign/batiment.16296576')).toMatchObject({ height: 16.8, source: 'ign' });
    const holed = byId.get('ign/batiment.16296570');
    expect(holed?.polygons[0]).toHaveLength(3);
    expect(byId.get('ign/batiment.20839390')?.underConstruction).toBe(true);
    for (const b of r)
      for (const poly of b.polygons)
        for (const ring of poly) for (const pt of ring) expect(pt).toHaveLength(2);
  });
});

describe('Overpass context', () => {
  const data: unknown = JSON.parse(fixture('palaiseau/overpass.json'));

  it('builds the verified query', () => {
    expect(overpassQuery([2.19626, 48.71155, 2.20034, 48.71425])).toBe(
      '[out:json][timeout:25];(way["building"](48.71155,2.19626,48.71425,2.20034);relation["building"](48.71155,2.19626,48.71425,2.20034);way["building:part"](48.71155,2.19626,48.71425,2.20034););out geom;',
    );
  });

  it('maps heights, relations and construction state', () => {
    const r = mapOverpass(data);
    const byId = new Map(r.map((b) => [b.id, b]));
    expect(byId.get('osm/way/626590677')).toMatchObject({
      height: 15,
      levels: 5,
      heightEstimated: false,
      name: 'All Suites Study Paris Saclay',
    });
    expect(byId.get('osm/way/626590681')).toMatchObject({ height: 20, name: 'Le Next' });
    expect(byId.get('osm/way/626590682')).toMatchObject({
      underConstruction: true,
      height: 9,
      heightEstimated: true,
    });
    const rel = byId.get('osm/relation/9962706');
    expect(rel?.height).toBe(9); // 3 levels + 0 roof levels
    expect(rel?.polygons).toHaveLength(1);
    expect(rel?.polygons[0]).toHaveLength(3); // outer + 2 holes
    expect(byId.get('osm/way/1171634509')).toMatchObject({ height: 6, levels: 2 });
  });

  it('drops a building containing a building:part centroid, joins open member ways', () => {
    const sq = (x0: number, y0: number, s: number) => [
      { lon: x0, lat: y0 },
      { lon: x0 + s, lat: y0 },
      { lon: x0 + s, lat: y0 + s },
      { lon: x0, lat: y0 + s },
      { lon: x0, lat: y0 },
    ];
    const outer = sq(0, 0, 1);
    const r = mapOverpass({
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes', height: '20 m' }, geometry: sq(0, 0, 1) },
        {
          type: 'way',
          id: 2,
          tags: { 'building:part': 'yes', min_height: '3' },
          geometry: sq(0.2, 0.2, 0.3),
        },
        {
          type: 'relation',
          id: 3,
          tags: { building: 'yes', type: 'multipolygon' },
          members: [
            {
              type: 'way',
              role: 'outer',
              geometry: outer.slice(0, 3).map((p) => ({ lon: p.lon + 5, lat: p.lat })),
            },
            {
              type: 'way',
              role: 'outer',
              geometry: outer.slice(2).map((p) => ({ lon: p.lon + 5, lat: p.lat })),
            },
          ],
        },
      ],
    });
    expect(r.map((b) => b.id)).toEqual(['osm/way/2', 'osm/relation/3']);
    expect(r[0]?.baseHeight).toBe(3);
    expect(r[1]?.polygons[0]?.[0]).toHaveLength(5);
  });

  it('posts the query with UA', async () => {
    const f = fakeFetch([['overpass-api.de', 'palaiseau/overpass.json']]);
    const r = await new OverpassContextProvider(
      new OverpassClient(http(f), undefined, new Throttle(0)),
    ).buildings([2.19, 48.71, 2.2, 48.72]);
    expect(r.length).toBeGreaterThan(0);
    expect(f.calls[0]?.url).toBe('https://overpass-api.de/api/interpreter');
    expect(f.calls[0]?.init?.method).toBe('POST');
    expect(String(f.calls[0]?.init?.body)).toMatch(/^data=%5Bout%3Ajson%5D/);
  });

  it('parses heights', () => {
    expect(parseMeters('20')).toBe(20);
    expect(parseMeters('20 m')).toBe(20);
    expect(parseMeters('12,5m')).toBe(12.5);
    expect(parseMeters('60 ft')).toBeUndefined();
  });
});
