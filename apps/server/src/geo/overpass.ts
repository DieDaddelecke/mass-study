import type { ContextBuildingLonLat, LonLatRings } from './contract.js';
import { type BBox, isRecord, pointInPolygon, ringCentroid } from './geometry.js';
import { parseCount, parseMeters, resolveHeight } from './height.js';
import { OverpassClient, elementPolygons, readTags } from './osm.js';
import type { ContextProvider } from './providers.js';

export function overpassQuery(b: BBox): string {
  const [w, s, e, n] = b;
  const box = `${s},${w},${n},${e}`;
  return `[out:json][timeout:25];(way["building"](${box});relation["building"](${box});way["building:part"](${box}););out geom;`;
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
    const polygons: LonLatRings[] = elementPolygons(e);
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
  constructor(private readonly client: OverpassClient) {}

  covers(): boolean {
    return true;
  }

  async buildings(bbox: BBox): Promise<ContextBuildingLonLat[]> {
    const data = await this.client.query(overpassQuery(bbox));
    return mapOverpass(data);
  }
}
