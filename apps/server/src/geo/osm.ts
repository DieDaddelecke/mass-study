import type { LonLat, LonLatRings } from './contract.js';
import { closeRing, isRecord, joinIntoRings, pointInRing } from './geometry.js';
import { type GeoHttp, Throttle, UpstreamError } from './http.js';

/** Shared helpers for Overpass `out geom` responses (buildings and context layers). */

export type Tags = Record<string, string>;

export function readTags(v: unknown): Tags {
  const out: Tags = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
}

export function readGeom(v: unknown): LonLat[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p: unknown): LonLat[] =>
    isRecord(p) && typeof p.lon === 'number' && typeof p.lat === 'number' ? [[p.lon, p.lat]] : [],
  );
}

/** Builds polygons from multipolygon members: joins open ways, assigns inners to outers. */
export function relationPolygons(members: unknown): LonLatRings[] {
  if (!Array.isArray(members)) return [];
  const outerLines: LonLat[][] = [];
  const innerLines: LonLat[][] = [];
  for (const m of members) {
    if (!isRecord(m) || m.type !== 'way') continue;
    const g = readGeom(m.geometry);
    if (g.length < 2) continue;
    (m.role === 'inner' ? innerLines : outerLines).push(g);
  }
  const outers = joinIntoRings(outerLines);
  const inners = joinIntoRings(innerLines);
  const polys: LonLatRings[] = outers.map((o) => [o]);
  for (const inner of inners) {
    const probe = inner[0];
    const host = probe && polys.find((p) => p[0] && pointInRing(probe, p[0]));
    if (host) host.push(inner);
  }
  return polys;
}

/** Polygons of an area element: closed way or multipolygon relation. */
export function elementPolygons(e: Record<string, unknown>): LonLatRings[] {
  if (e.type === 'way') {
    const ring = closeRing(readGeom(e.geometry));
    return ring.length >= 4 ? [[ring]] : [];
  }
  if (e.type === 'relation') return relationPolygons(e.members);
  return [];
}

export function overpassElements(data: unknown): Record<string, unknown>[] {
  const elements = isRecord(data) && Array.isArray(data.elements) ? data.elements : [];
  return elements.filter(isRecord);
}

export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Status codes on which the next Overpass mirror is tried. */
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/**
 * Overpass client: one throttled POST per query, trying mirrors in order on 429/502/503/504
 * (or network failure). Shared by the buildings and the context-layer providers.
 */
export class OverpassClient {
  constructor(
    private readonly http: GeoHttp,
    readonly urls: string[] = OVERPASS_URLS,
    private readonly throttle = new Throttle(1000),
  ) {}

  async query(q: string): Promise<unknown> {
    let lastError: unknown = new UpstreamError('overpass: no endpoint configured', 'overpass');
    for (const url of this.urls) {
      try {
        return await this.http.getJson(url, {
          method: 'POST',
          body: `data=${encodeURIComponent(q)}`,
          contentType: 'application/x-www-form-urlencoded',
          upstream: 'overpass',
          throttle: this.throttle,
        });
      } catch (err) {
        lastError = err;
        const retry =
          err instanceof UpstreamError &&
          (err.status === undefined || RETRY_STATUS.has(err.status));
        if (!retry) throw err;
      }
    }
    throw lastError;
  }
}
