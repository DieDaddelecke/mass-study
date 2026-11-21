import {
  lonLatPolygonToLocal,
  lonLatToLocal,
  normalizePolygon,
  pointInPolygon,
  ringCentroid,
  type ContextBuilding,
  type LocalFrame,
  type Polygon,
  type Surroundings,
} from '@kubatur/core';
import type {
  ContextBuildingLonLat,
  ContextLayersResponse,
  ContextResponse,
  LonLatRings,
} from '../api/contract';

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

/** Local polygons of a multi-polygon; ids get `#i` suffixes when there is more than one. */
function localPolygons(
  id: string,
  polygons: LonLatRings[],
  frame: LocalFrame,
): { id: string; footprint: Polygon }[] {
  return polygons.flatMap((rings, i) => {
    const footprint = normalizePolygon(lonLatPolygonToLocal(frame, rings));
    if (footprint.outer.length < 3) return [];
    return [{ id: polygons.length > 1 ? `${id}#${i}` : id, footprint }];
  });
}

/**
 * Convert the server context layers (WGS 84) into local model coordinates. Parcels that belong to
 * the site (`siteParcelRefs`) are dropped; nothing is clipped.
 */
export function toSurroundings(
  res: ContextLayersResponse,
  frame: LocalFrame,
  siteParcelRefs: readonly string[],
): Surroundings {
  const site = new Set(siteParcelRefs);
  return {
    roads: res.roads.flatMap((r) => {
      if (r.line.length < 2) return [];
      const road: Surroundings['roads'][number] = {
        id: r.id,
        centerline: r.line.map((p) => lonLatToLocal(frame, p)),
        width: r.width,
        widthEstimated: r.widthEstimated,
        kind: r.kind,
        level: r.level,
        source: r.source,
      };
      if (r.name) road.name = r.name;
      return [road];
    }),
    green: res.green.flatMap((g) =>
      localPolygons(g.id, g.polygons, frame).map((p) => ({ ...p, kind: g.kind, source: g.source })),
    ),
    trees: res.trees.map((t) => {
      const tree: Surroundings['trees'][number] = {
        id: t.id,
        position: lonLatToLocal(frame, t.lonLat),
        height: t.height,
        crown: t.crown,
        heightEstimated: t.heightEstimated,
        source: t.source,
      };
      if (t.leafType) tree.leafType = t.leafType;
      return tree;
    }),
    water: res.water.flatMap((w) =>
      localPolygons(w.id, w.polygons, frame).map((p) => ({ ...p, source: w.source })),
    ),
    parcels: res.parcels
      .filter((p) => !site.has(p.ref))
      .flatMap((p) =>
        localPolygons(p.ref, p.polygons, frame).map(({ id, footprint }) => ({
          id,
          ref: p.ref,
          label: p.label,
          polygon: footprint,
        })),
      ),
  };
}
