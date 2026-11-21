import { describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fakeFetch } from './helpers.js';

const config = loadConfig({});
const PALAISEAU_BBOX = '2.19626,48.71155,2.20034,48.71425';

function api(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  return { app: createApi(config, { fetch: f.fetch, cache: false }), calls: f.calls };
}

describe('geo routes', () => {
  it('geocodes via IGN', async () => {
    const { app } = api([['geocodage/search', 'palaiseau/geocode.json']]);
    const res = await app.request('/api/geocode?q=27%20Bd%20Thomas%20Gobert&limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { provider: string }[] };
    expect(body.results[0]?.provider).toBe('ign');
  });

  it('falls back to Nominatim when IGN finds nothing', async () => {
    const { app } = api([
      ['geocodage/search', 'synthetic/empty-features.json'],
      ['nominatim', 'synthetic/synthetic-nominatim.json'],
    ]);
    const res = await app.request('/api/geocode?q=Berlin');
    const body = (await res.json()) as { results: { provider: string }[] };
    expect(body.results[0]?.provider).toBe('nominatim');
  });

  it('autocompletes', async () => {
    const { app } = api([['geocodage/completion', 'palaiseau/completion.json']]);
    const res = await app.request('/api/geocode/complete?q=27%20bd%20thomas%20gob');
    expect(((await res.json()) as { results: unknown[] }).results).toHaveLength(2);
  });

  it('returns parcels and covered=false outside coverage', async () => {
    const { app, calls } = api([['apicarto', 'palaiseau/parcel-0518.json']]);
    const res = await app.request('/api/parcels?lon=2.197965&lat=48.713064');
    expect(await res.json()).toMatchObject({ covered: true, parcels: [{ ref: '914770000H0518' }] });
    const out = await app.request('/api/parcels?lon=13.4&lat=52.5');
    expect(await out.json()).toEqual({ parcels: [], covered: false });
    expect(calls).toHaveLength(1);
  });

  it('prefers IGN for context and falls back to OSM on failure', async () => {
    const ok = api([['wfs/ows', 'palaiseau/bdtopo-batiment.json']]);
    const r1 = await ok.app.request(`/api/context?bbox=${PALAISEAU_BBOX}`);
    expect(await r1.json()).toMatchObject({ provider: 'ign' });
    const fb = api([
      ['wfs/ows', 503],
      ['overpass-api.de', 'palaiseau/overpass.json'],
    ]);
    const r2 = await fb.app.request(`/api/context?bbox=${PALAISEAU_BBOX}`);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ provider: 'osm' });
  });

  it('uses OSM outside France', async () => {
    const { app, calls } = api([['overpass-api.de', 'palaiseau/overpass.json']]);
    const res = await app.request('/api/context?bbox=13.40,52.50,13.41,52.505');
    expect(await res.json()).toMatchObject({ provider: 'osm' });
    expect(calls.every((c) => c.url.includes('overpass'))).toBe(true);
  });

  it.each([
    '/api/geocode',
    '/api/geocode?q=%20',
    '/api/geocode?q=x&limit=0',
    '/api/geocode/complete',
    '/api/parcels?lon=2',
    '/api/parcels?lon=abc&lat=48',
    '/api/parcels?lon=200&lat=48',
    '/api/context',
    '/api/context?bbox=1,2,3',
    '/api/context?bbox=2.2,48.7,2.1,48.8',
    '/api/context?bbox=2.18,48.70,2.21,48.72',
  ])('rejects %s with 400', async (url) => {
    const { app, calls } = api([]);
    const res = await app.request(url);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'bad_request',
      message: expect.any(String) as string,
    });
    expect(calls).toHaveLength(0);
  });

  it('maps upstream failures to 502', async () => {
    const { app } = api([['apicarto', 500]]);
    const res = await app.request('/api/parcels?lon=2.197965&lat=48.713064');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream_error' });
    const ctx = api([
      ['wfs/ows', 500],
      ['overpass', 504],
    ]);
    expect((await ctx.app.request(`/api/context?bbox=${PALAISEAU_BBOX}`)).status).toBe(502);
    const geo = api([
      ['geocodage', 500],
      ['nominatim', 500],
    ]);
    expect((await geo.app.request('/api/geocode?q=x')).status).toBe(502);
  });
});
