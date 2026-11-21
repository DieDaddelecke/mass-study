import { typologySegments } from './generators.js';
import {
  intersection,
  normalizePolygon,
  orientedExtents,
  pointSegmentDistance,
  polygonArea,
  ringBBox,
  rotatePoint,
  transformPolygon,
  union,
} from './geometry.js';
import type {
  Mass,
  Polygon,
  RoofConfig,
  RoofKind,
  StoreySolid,
  StoreyStack,
  Vec2,
} from './types.js';

/**
 * Pitched roofs (shed / gable / hip) on the top storeys of a mass.
 *
 * The roof is described by a height function over the roof frame of the mass (the local axes for
 * Solitär / Zeile / Reihe, the minimum-area rectangle for free shapes): z rises from the eaves
 * with tan(pitch) times the distance to the eaves side(s) of the footprint's bounding box. The
 * function is piecewise linear; every linear piece is clipped with the footprint and returned as
 * a planar roof face over a plan polygon ("prism with a sloped top").
 */

export interface RoofPiece {
  massId: string;
  segment?: number;
  /** Plan polygon in world coordinates. */
  polygon: Polygon;
  /** Bottom of the roof (top of the top slab). */
  z0: number;
  /** Roof plane in world coordinates: z = a + b·x + c·y. */
  plane: [number, number, number];
  /**
   * Per edge of `polygon.outer`: true for an internal edge between two roof faces (ridge, hip),
   * false for an edge on the façade (eaves or gable).
   */
  seams: boolean[];
}

export const DEFAULT_ROOF_PITCH: Record<RoofKind, number> = {
  flat: 0,
  shed: 12,
  gable: 35,
  hip: 30,
};

export function defaultRoof(kind: RoofKind): RoofConfig {
  return { kind, pitch: DEFAULT_ROOF_PITCH[kind], ridge: 'length' };
}

export function isPitched(roof: RoofConfig | undefined): roof is RoofConfig {
  return !!roof && roof.kind !== 'flat' && roof.pitch > 0.01;
}

/** Parapet that applies to the top of a stack: none under a pitched roof. */
export function effectiveParapet(mass: Pick<Mass, 'roof'>, stack: StoreyStack): number {
  return isPitched(mass.roof) ? 0 : stack.parapet;
}

export function roofZ(piece: Pick<RoofPiece, 'plane'>, p: Vec2): number {
  return piece.plane[0] + piece.plane[1] * p[0] + piece.plane[2] * p[1];
}

/** Highest point of the roof faces (0 when there are none). */
export function roofTop(pieces: readonly RoofPiece[]): number {
  let top = 0;
  for (const pc of pieces) for (const p of pc.polygon.outer) top = Math.max(top, roofZ(pc, p));
  return top;
}

/** Volume under the roof faces (above the top slab), m³. */
export function roofVolume(pieces: readonly RoofPiece[]): number {
  let v = 0;
  for (const pc of pieces) {
    // ∫(plane − z0) over the polygon = area · (plane(centroid) − z0)
    const a = polygonArea(pc.polygon);
    if (a < 1e-9) continue;
    const c = areaCentroid(pc.polygon);
    v += a * Math.max(0, roofZ(pc, c) - pc.z0);
  }
  return v;
}

function areaCentroid(p: Polygon): Vec2 {
  let a = 0;
  let x = 0;
  let y = 0;
  for (const [ri, ring] of [p.outer, ...(p.holes ?? [])].entries()) {
    const sign = ri === 0 ? 1 : -1;
    for (let i = 0; i < ring.length; i++) {
      const p0 = ring[i]!;
      const p1 = ring[(i + 1) % ring.length]!;
      const cr = (p0[0] * p1[1] - p1[0] * p0[1]) * sign;
      a += cr;
      x += (p0[0] + p1[0]) * cr;
      y += (p0[1] + p1[1]) * cr;
    }
  }
  if (Math.abs(a) < 1e-12) return p.outer[0] ?? [0, 0];
  return [x / (3 * a), y / (3 * a)];
}

/** Linear distance function d = k0 + kx·x + ky·y (roof frame). */
type Lin = [number, number, number];

/** Sutherland–Hodgman: keep the part of a convex ring where f(p) ≤ 0. */
function clipHalfPlane(ring: Vec2[], f: Lin): Vec2[] {
  const val = (p: Vec2) => f[0] + f[1] * p[0] + f[2] * p[1];
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const va = val(a);
    const vb = val(b);
    if (va <= 1e-12) out.push(a);
    if ((va < -1e-12 && vb > 1e-12) || (va > 1e-12 && vb < -1e-12)) {
      const t = va / (va - vb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Eaves sides of the bounding box and their distance functions. */
function eavesSides(
  roof: RoofConfig,
  bb: { minX: number; maxX: number; minY: number; maxY: number },
): Lin[] {
  const minX: Lin = [-bb.minX, 1, 0];
  const maxX: Lin = [bb.maxX, -1, 0];
  const minY: Lin = [-bb.minY, 0, 1];
  const maxY: Lin = [bb.maxY, 0, -1];
  switch (roof.kind) {
    case 'shed':
      return roof.ridge === 'length' ? [roof.flip ? maxY : minY] : [roof.flip ? maxX : minX];
    case 'gable':
      return roof.ridge === 'length' ? [minY, maxY] : [minX, maxX];
    case 'hip':
      return [minX, maxX, minY, maxY];
    default:
      return [];
  }
}

/** Roof frame of a mass: origin and angle of the x axis (world). */
export function roofFrame(mass: Mass): { origin: Vec2; angle: number } {
  const t = mass.typology;
  if (t.kind === 'solitaer' || t.kind === 'zeile' || t.kind === 'reihe')
    return { origin: mass.position, angle: mass.rotation };
  const locals = typologySegments(t).map((s) => s.local);
  const pts = locals.flatMap((p) => p.outer);
  if (pts.length < 3) return { origin: mass.position, angle: mass.rotation };
  const ext = orientedExtents(pts);
  // orientedExtents gives the angle of one rectangle side; take the longer one as x
  const rot = pts.map((p) => rotatePoint(p, -ext.angle));
  const bb = ringBBox(rot);
  const along = bb.maxX - bb.minX >= bb.maxY - bb.minY ? ext.angle : ext.angle + Math.PI / 2;
  return { origin: mass.position, angle: mass.rotation + along };
}

function toFrame(p: Vec2, origin: Vec2, angle: number): Vec2 {
  return rotatePoint([p[0] - origin[0], p[1] - origin[1]], -angle);
}

function onBoundary(p: Vec2, poly: Polygon, tol = 1e-3): boolean {
  for (const ring of [poly.outer, ...(poly.holes ?? [])])
    for (let i = 0; i < ring.length; i++)
      if (pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!) < tol) return true;
  return false;
}

/**
 * Roof faces of one roofed footprint (world) at slab height z0.
 * Exported for tests and for callers that roof arbitrary outlines.
 */
export function roofPieces(
  footprint: Polygon,
  z0: number,
  roof: RoofConfig,
  frame: { origin: Vec2; angle: number },
  tag: { massId: string; segment?: number } = { massId: '' },
): RoofPiece[] {
  if (!isPitched(roof) || footprint.outer.length < 3) return [];
  const { origin, angle } = frame;
  const local: Polygon = normalizePolygon({
    outer: footprint.outer.map((p) => toFrame(p, origin, angle)),
    ...(footprint.holes?.length
      ? { holes: footprint.holes.map((h) => h.map((p) => toFrame(p, origin, angle))) }
      : {}),
  });
  const bb = ringBBox(local.outer);
  const sides = eavesSides(roof, bb);
  if (!sides.length) return [];
  const t = Math.tan((Math.min(roof.pitch, 75) * Math.PI) / 180);
  const pad = 1;
  const box: Vec2[] = [
    [bb.minX - pad, bb.minY - pad],
    [bb.maxX + pad, bb.minY - pad],
    [bb.maxX + pad, bb.maxY + pad],
    [bb.minX - pad, bb.maxY + pad],
  ];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: RoofPiece[] = [];
  sides.forEach((d, k) => {
    // region where side k is the nearest eaves side: d_k − d_j ≤ 0
    let region = box;
    for (let j = 0; j < sides.length && region.length >= 3; j++) {
      if (j === k) continue;
      const o = sides[j]!;
      region = clipHalfPlane(region, [d[0] - o[0], d[1] - o[1], d[2] - o[2]]);
    }
    if (region.length < 3) return;
    const parts = intersection([local], [{ outer: region }]);
    // z = z0 + t·(k0 + kx·xf + ky·yf), xf/yf = frame coordinates of the world point
    const b = t * (d[1] * cos - d[2] * sin);
    const c = t * (d[1] * sin + d[2] * cos);
    const a = z0 + t * d[0] - b * origin[0] - c * origin[1];
    for (const part of parts) {
      if (polygonArea(part) < 1e-4) continue;
      const world = transformPolygon(part, origin, angle);
      const seams = world.outer.map((p, i) => {
        const q = world.outer[(i + 1) % world.outer.length]!;
        return !onBoundary([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], footprint);
      });
      const piece: RoofPiece = { massId: tag.massId, polygon: world, z0, plane: [a, b, c], seams };
      if (tag.segment !== undefined) piece.segment = tag.segment;
      out.push(piece);
    }
  });
  return out;
}

/**
 * Roof faces of a mass from its storey solids. Every top storey is roofed; top storeys of the
 * same height (sections of a Zeile) are unioned first so that they share one roof.
 */
export function massRoofPieces(mass: Mass, solids: readonly StoreySolid[]): RoofPiece[] {
  const roof = mass.roof;
  if (!isPitched(roof)) return [];
  const frame = roofFrame(mass);
  // sections of the same height share one roof (continuous ridge along a Zeile)
  const groups = new Map<string, { segments: Set<number>; z0: number; polys: Polygon[] }>();
  for (const s of solids) {
    if (s.massId !== mass.id || !s.top || !s.aboveGround) continue;
    const k = s.z1.toFixed(3);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { segments: new Set(), z0: s.z1, polys: [] }));
    if (s.segment !== undefined) g.segments.add(s.segment);
    g.polys.push(s.footprint);
  }
  const out: RoofPiece[] = [];
  for (const g of groups.values()) {
    const polys = g.polys.length > 1 ? union(g.polys) : g.polys;
    const tag: { massId: string; segment?: number } = { massId: mass.id };
    if (g.segments.size === 1) tag.segment = [...g.segments][0]!;
    for (const p of polys) out.push(...roofPieces(p, g.z0, roof, frame, tag));
  }
  return out;
}
