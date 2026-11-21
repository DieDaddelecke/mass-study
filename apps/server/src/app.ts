import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { ServerConfig } from './config.js';
import { ApiCartoParcelProvider } from './geo/apicarto.js';
import { BdTopoContextProvider } from './geo/bdtopo.js';
import type {
  ApiError,
  ContextLayersResponse,
  ContextResponse,
  GeocodeResponse,
  LonLat,
  ParcelsResponse,
} from './geo/contract.js';
import { type BBox, bboxCenter, bboxSizeMeters } from './geo/geometry.js';
import { FileCache, type FetchLike, GeoHttp, UpstreamError } from './geo/http.js';
import { IgnGeocodeProvider } from './geo/ign-geocode.js';
import { NominatimGeocodeProvider } from './geo/nominatim.js';
import { ContextLayersService } from './geo/layers.js';
import { OverpassClient } from './geo/osm.js';
import { OverpassContextProvider } from './geo/overpass.js';
import { ProviderRegistry } from './geo/providers.js';
import { TileProxy, isBasemap, tileCovered, validateTile } from './geo/tiles.js';
import { WfsParcelProvider } from './geo/wfs-parcel.js';

export const VERSION = '0.1.0';
/** Maximum bbox side for /api/context (m). */
export const MAX_CONTEXT_SIDE_M = 1500;

export interface ApiDeps {
  /** Upstream fetch (main.ts passes the real one; tests inject fixtures). */
  fetch?: FetchLike;
  /** Overrides the provider registry entirely. */
  registry?: ProviderRegistry;
  /** Disable the file cache (e.g. tests). */
  cache?: boolean;
}

function createHttp(config: ServerConfig, fetchFn: FetchLike, cache: boolean): GeoHttp {
  return new GeoHttp(
    fetchFn,
    config.userAgent,
    cache
      ? new FileCache(join(config.dataDir, 'cache'), config.cacheTtlDays * 86_400_000)
      : undefined,
  );
}

function createServices(config: ServerConfig, fetchFn: FetchLike, cache: boolean) {
  const http = createHttp(config, fetchFn, cache);
  const overpass = new OverpassClient(http, config.overpassUrls);
  const apicarto = new ApiCartoParcelProvider(http);
  const wfs = config.wfsParcelProviders.map((c) => new WfsParcelProvider(http, c));
  const registry = new ProviderRegistry(
    [new IgnGeocodeProvider(http), new NominatimGeocodeProvider(http)],
    [apicarto, ...wfs],
    [new BdTopoContextProvider(http), new OverpassContextProvider(overpass)],
  );
  const layers = new ContextLayersService({ http, overpass, apicarto, parcelProviders: wfs });
  const tiles = new TileProxy(
    http,
    cache ? join(config.dataDir, 'tiles') : undefined,
    config.cacheTtlDays * 86_400_000,
  );
  return { registry, layers, tiles };
}

export function createRegistry(config: ServerConfig, fetchFn: FetchLike, cache = true) {
  return createServices(config, fetchFn, cache).registry;
}

class BadRequest extends Error {}

function num(v: string | undefined, name: string): number {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  if (!Number.isFinite(n)) throw new BadRequest(`${name} must be a number`);
  return n;
}

function query(c: Context): string {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) throw new BadRequest('q is required');
  if (q.length > 200) throw new BadRequest('q is too long');
  return q;
}

function limit(c: Context, def: number): number {
  const raw = c.req.query('limit');
  if (raw === undefined) return def;
  const n = num(raw, 'limit');
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new BadRequest('limit must be 1–20');
  return n;
}

function parseBbox(raw: string | undefined): BBox {
  const parts = (raw ?? '').split(',');
  if (parts.length !== 4) throw new BadRequest('bbox must be minLon,minLat,maxLon,maxLat');
  const [a, b, c, d] = parts.map((p, i) => num(p, `bbox[${i}]`)) as BBox;
  if (a < -180 || c > 180 || b < -90 || d > 90 || a >= c || b >= d) {
    throw new BadRequest('bbox out of range or empty');
  }
  const bbox: BBox = [a, b, c, d];
  const { width, height } = bboxSizeMeters(bbox);
  if (width > MAX_CONTEXT_SIDE_M || height > MAX_CONTEXT_SIDE_M) {
    throw new BadRequest(`bbox side must not exceed ${MAX_CONTEXT_SIDE_M} m`);
  }
  return bbox;
}

/** HTTP app without the static file handler (testable without a file system). */
export function createApi(config: ServerConfig, deps: ApiDeps = {}): Hono {
  const app = new Hono();
  const services = createServices(
    config,
    deps.fetch ?? ((u, i) => fetch(u, i)),
    deps.cache ?? true,
  );
  const registry = deps.registry ?? services.registry;
  if (config.allowedOrigins.length) app.use('/api/*', cors({ origin: config.allowedOrigins }));
  app.get('/api/health', (c) => c.json({ ok: true, version: VERSION }));

  app.get('/api/geocode', async (c) => {
    const body: GeocodeResponse = { results: await registry.geocode(query(c), limit(c, 5)) };
    return c.json(body);
  });

  app.get('/api/geocode/complete', async (c) => {
    const body: GeocodeResponse = { results: await registry.complete(query(c), limit(c, 5)) };
    return c.json(body);
  });

  app.get('/api/parcels', async (c) => {
    const lon = num(c.req.query('lon'), 'lon');
    const lat = num(c.req.query('lat'), 'lat');
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
      throw new BadRequest('lon/lat out of range');
    const lonLat: LonLat = [lon, lat];
    const provider = registry.parcelProviderFor(lonLat);
    const body: ParcelsResponse = provider
      ? { parcels: await provider.parcelsAt(lonLat), covered: true }
      : { parcels: [], covered: false };
    return c.json(body);
  });

  app.get('/api/context', async (c) => {
    const bbox = parseBbox(c.req.query('bbox'));
    const r = await registry.contextAt(bbox, bboxCenter(bbox));
    const body: ContextResponse = { buildings: r.buildings, provider: r.provider };
    return c.json(body);
  });

  app.get('/api/context/layers', async (c) => {
    const bbox = parseBbox(c.req.query('bbox'));
    const body: ContextLayersResponse = await services.layers.layers(bbox);
    return c.json(body);
  });

  app.get('/api/tiles/:basemap/:z/:x/:y', async (c) => {
    const basemap = c.req.param('basemap');
    if (!isBasemap(basemap)) throw new BadRequest('basemap must be plan or ortho');
    const int = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
    const z = int(c.req.param('z'));
    const x = int(c.req.param('x'));
    const y = int(c.req.param('y').replace(/\.(png|jpe?g)$/, ''));
    const invalid = validateTile(z, x, y);
    if (invalid) throw new BadRequest(invalid);
    if (!tileCovered(z, x, y))
      return c.json<ApiError>({ error: 'not_found', message: 'tile outside coverage' }, 404);
    try {
      const t = await services.tiles.tile({ basemap, z, x, y });
      return c.body(t.bytes as Uint8Array<ArrayBuffer>, 200, {
        'Content-Type': t.contentType,
        'Cache-Control': 'public, max-age=604800',
        'X-Cache': t.cached ? 'HIT' : 'MISS',
      });
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404)
        return c.json<ApiError>({ error: 'not_found', message: 'tile not available' }, 404);
      throw err;
    }
  });

  app.onError((err, c) => {
    if (err instanceof BadRequest) {
      return c.json<ApiError>({ error: 'bad_request', message: err.message }, 400);
    }
    if (err instanceof UpstreamError) {
      const rateLimited = err.status === 429;
      return c.json<ApiError>(
        { error: rateLimited ? 'rate_limited' : 'upstream_error', message: err.message },
        rateLimited ? 429 : 502,
      );
    }
    console.error(err);
    return c.json<ApiError>({ error: 'upstream_error', message: 'internal error' }, 502);
  });
  app.notFound((c) =>
    c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('Not found', 404),
  );
  return app;
}
