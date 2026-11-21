import {
  lonLatPolygonToLocal,
  normalizePolygon,
  pointInPolygon,
  ringCentroid,
  type ContextBuilding,
  type LocalFrame,
  type Polygon,
} from '@kubatur/core';
import type { ContextBuildingLonLat, ContextResponse } from '../api/contract';

/** Convert server context buildings (WGS 84) into local model coordinates. */
export function toContextBuildings(
  res: Pick<ContextResponse, 'buildings'>,
  frame: LocalFrame,
  site?: Polygon,
): ContextBuilding[] {
  const out: ContextBuilding[] = [];
  for (const b of res.buildings) out.push(...convert(b, frame, site));
  return out;
}

function convert(b: ContextBuildingLonLat, frame: LocalFrame, site?: Polygon): ContextBuilding[] {
  return b.polygons.map((rings, i) => {
    const footprint = normalizePolygon(lonLatPolygonToLocal(frame, rings));
    const c: ContextBuilding = {
      id: b.polygons.length > 1 ? `${b.id}#${i}` : b.id,
      footprint,
      height: b.height,
      source: b.source,
      heightEstimated: b.heightEstimated,
    };
    if (b.baseHeight !== undefined) c.baseHeight = b.baseHeight;
    if (b.levels !== undefined) c.levels = b.levels;
    // Existing buildings on the site are marked for demolition by default (toggle in the UI).
    if (site && footprint.outer.length && pointInPolygon(ringCentroid(footprint.outer), site))
      c.demolished = true;
    return c;
  });
}

/** WGS 84 bounding box of a circle around a point (for /api/context). */
export function bboxAround(
  lon: number,
  lat: number,
  radius: number,
): [number, number, number, number] {
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
