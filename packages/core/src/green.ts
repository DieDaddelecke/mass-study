import {
  difference,
  intersection,
  pointInPolygon,
  polygonsArea,
  ringBBox,
  union,
} from './geometry.js';
import type { VariantResult } from './analysis.js';
import type { PlantingKind, PlantingZone, Polygon, Vec2 } from './types.js';

/**
 * Vegetation zones (espaces verts) and their figures.
 *
 * - Espaces verts: all zones within the site, minus the above-ground footprints
 *   (planted slabs "sur dalle" count, even above a basement).
 * - Pleine terre: open-ground zones (not "sur dalle") minus every footprint above or below ground
 *   (an underground car park is no open ground).
 */

/** Kinds that are open ground (pleine terre) unless built over or under. */
export const OPEN_GROUND_KINDS: readonly PlantingKind[] = [
  'pleineTerre',
  'pelouse',
  'arbustes',
  'boise',
];

/** Default tree spacing per kind, m (0 = none). */
export const DEFAULT_TREE_SPACING: Record<PlantingKind, number> = {
  pleineTerre: 0,
  pelouse: 0,
  arbustes: 0,
  boise: 7,
  surDalle: 0,
};

export interface GreenKpis {
  /** Planted area within the site, m². */
  espacesVerts: number;
  /** Open-ground area within the site, m². */
  pleineTerre: number;
  /** Share of the site area, 0…1. */
  espacesVertsRatio: number;
  pleineTerreRatio: number;
  /** Number of planted trees in the zones. */
  trees: number;
}

export function greenKpis(
  zones: readonly PlantingZone[],
  site: Polygon,
  result: Pick<VariantResult, 'solids'>,
): GreenKpis {
  const siteArea = site.outer.length >= 3 ? polygonsArea([site]) : 0;
  const clip = (ps: Polygon[]) => (site.outer.length >= 3 ? intersection(ps, [site]) : ps);
  const above = result.solids.filter((s) => s.solid.aboveGround).map((s) => s.solid.footprint);
  const all = result.solids.map((s) => s.solid.footprint);
  const valid = zones.filter((z) => z.polygon.outer.length >= 3);
  const ground = valid.filter((z) => z.kind !== 'surDalle').map((z) => z.polygon);
  const slab = valid.filter((z) => z.kind === 'surDalle').map((z) => z.polygon);
  const evPolys = union([
    ...difference(clip(ground.length ? union(ground) : []), above),
    ...clip(slab),
  ]);
  const open = valid.filter((z) => OPEN_GROUND_KINDS.includes(z.kind)).map((z) => z.polygon);
  const ptPolys = open.length ? difference(clip(union(open)), all.length ? union(all) : []) : [];
  const espacesVerts = polygonsArea(evPolys);
  const pleineTerre = polygonsArea(ptPolys);
  return {
    espacesVerts,
    pleineTerre,
    espacesVertsRatio: siteArea > 0 ? espacesVerts / siteArea : 0,
    pleineTerreRatio: siteArea > 0 ? pleineTerre / siteArea : 0,
    trees: valid.reduce((a, z) => a + zoneTrees(z).length, 0),
  };
}

/**
 * Tree positions of a zone: a staggered grid with the zone's spacing, kept at half a spacing
 * from the outline. Deterministic.
 */
export function zoneTrees(zone: PlantingZone): Vec2[] {
  const s = zone.treeSpacing ?? 0;
  if (!(s >= 2) || zone.polygon.outer.length < 3) return [];
  const bb = ringBBox(zone.polygon.outer);
  const out: Vec2[] = [];
  const rowH = (s * Math.sqrt(3)) / 2;
  const margin = s * 0.4;
  let row = 0;
  for (let y = bb.minY + margin; y <= bb.maxY - margin + 1e-9; y += rowH, row++) {
    const x0 = bb.minX + margin + (row % 2 ? s / 2 : 0);
    for (let x = x0; x <= bb.maxX - margin + 1e-9; x += s) {
      const p: Vec2 = [x, y];
      if (pointInPolygon(p, zone.polygon) && edgeDistance(p, zone.polygon) >= margin - 1e-9)
        out.push(p);
      if (out.length > 2000) return out;
    }
  }
  // small zones: at least one tree in the middle when it fits
  if (!out.length) {
    const c: Vec2 = [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2];
    if (pointInPolygon(c, zone.polygon) && edgeDistance(c, zone.polygon) >= margin) out.push(c);
  }
  return out;
}

function edgeDistance(p: Vec2, poly: Polygon): number {
  let d = Infinity;
  for (const ring of [poly.outer, ...(poly.holes ?? [])])
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t =
        l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
      d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
    }
  return d;
}
