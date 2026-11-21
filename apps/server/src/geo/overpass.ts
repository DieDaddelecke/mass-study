import type { ContextBuildingLonLat, LonLat, LonLatRings } from './contract.js';
import {
  type BBox,
  closeRing,
  isRecord,
  joinIntoRings,
  pointInPolygon,
  pointInRing,
  ringCentroid,
} from './geometry.js';
import { parseCount, parseMeters, resolveHeight } from './height.js';
import { Throttle, type GeoHttp } from './http.js';
import type { ContextProvider } from './providers.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export function overpassQuery(b: BBox): string {
  const [w, s, e, n] = b;
  const box = `${s},${w},${n},${e}`;
  return `[out:json][timeout:25];(way["building"](${box});relation["building"](${box});way["building:part"](${box}););out geom;`;
}

type Tags = Record<string, string>;

function readTags(v: unknown): Tags {
  const out: Tags = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
}

function readGeom(v: unknown): LonLat[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p: unknown): LonLat[] =>
    isRecord(p) && typeof p.lon === 'number' && typeof p.lat === 'number' ? [[p.lon, p.lat]] : [],
  );
}

/** Builds polygons from multipolygon members: joins open ways, assigns inners to outers. */
function relationPolygons(members: unknown): LonLatRings[] {
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

interface Candidate {
  building: ContextBuildingLonLat;
  isPart: boolean;
}

/** Maps an Overpass `out geom` response to context buildings (height rule, part de-duplication). */
export function mapOverpass(data: unknown): ContextBuildingLonLat[] {
  const elements = isRecord(data) && Array.isArray(data.elements) ? data.elements : [];
  const candidates: Candidate[] = [];
  for (const e of elements) {
    if (!isRecord(e) || (e.type !== 'way' && e.type !== 'relation')) continue;
    const tags = readTags(e.tags);
    const isPart = !!tags['building:part'] && tags['building:part'] !== 'no';
    const isBuilding = !!tags.building && tags.building !== 'no';
    if (!isPart && !isBuilding) continue;
    let polygons: LonLatRings[];
    if (e.type === 'way') {
      const ring = closeRing(readGeom(e.geometry));
      polygons = ring.length >= 4 ? [[ring]] : [];
    } else {
      polygons = relationPolygons(e.members);
    }
    if (!polygons.length) continue;

    const bl = parseCount(tags['building:levels']);
    const rl = parseCount(tags['roof:levels']);
    const levels = bl !== undefined ? bl + (rl ?? 0) : undefined;
    const b: ContextBuildingLonLat = {
      id: `osm/${e.type}/${String(e.id)}`,
      polygons,
      ...resolveHeight(parseMeters(tags.height), levels),
      source: 'osm',
    };
    const minHeight = parseMeters(tags.min_height);
    if (minHeight !== undefined && minHeight > 0) b.baseHeight = minHeight;
    if (levels !== undefined && levels > 0) b.levels = levels;
    if (tags.name) b.name = tags.name;
    if (tags.building === 'construction') b.underConstruction = true;
    candidates.push({ building: b, isPart });
  }

  const partCentroids = candidates
    .filter((c) => c.isPart)
    .flatMap((c) => c.building.polygons.flatMap((p) => (p[0] ? [ringCentroid(p[0])] : [])));
  return candidates
    .filter(
      (c) =>
        c.isPart ||
        !partCentroids.some((pt) => c.building.polygons.some((poly) => pointInPolygon(pt, poly))),
    )
    .map((c) => c.building);
}

/** OSM buildings via Overpass (worldwide; fallback in France). */
export class OverpassContextProvider implements ContextProvider {
  readonly id = 'osm' as const;
  constructor(
    private readonly http: GeoHttp,
    private readonly throttle = new Throttle(1000),
    private readonly url = OVERPASS_URL,
  ) {}

  covers(): boolean {
    return true;
  }

  async buildings(bbox: BBox): Promise<ContextBuildingLonLat[]> {
    const data = await this.http.getJson(this.url, {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
      contentType: 'application/x-www-form-urlencoded',
      upstream: 'overpass',
      throttle: this.throttle,
    });
    return mapOverpass(data);
  }
}
