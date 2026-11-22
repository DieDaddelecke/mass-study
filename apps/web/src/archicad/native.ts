import {
  difference,
  normalizePolygon,
  offsetPolygons,
  pointRingDistance,
  union,
  type CoreStair,
  type Polygon,
  type RoofPiece,
  type StoreyLayout,
  type StoreySolid,
  type Vec2,
} from '@kubatur/core';

/**
 * Geometry for native Archicad elements (walls, slabs, roofs, stairs), in app (world)
 * coordinates. Pure; `plan.ts` places the results and turns them into Tapir items.
 */

const EPS = 1e-6;
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];

export interface WallSegment {
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** façade wall (on the storey outline) or wall inside the storey. */
  kind: 'facade' | 'core' | 'interior';
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function ringEdges(ring: readonly Vec2[]): [Vec2, Vec2][] {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]!] as [Vec2, Vec2]);
}

const len = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Façade walls of a storey footprint: the outline (and courtyard outlines) shifted inwards by
 * half the wall thickness, so that the outer face of each wall lies on the footprint and the
 * walls meet at their centre lines (Archicad joins the corners).
 */
export function facadeWalls(footprint: Polygon, thickness: number): WallSegment[] {
  const out: WallSegment[] = [];
  for (const p of offsetPolygons([normalizePolygon(footprint)], -thickness / 2))
    for (const ring of [p.outer, ...(p.holes ?? [])])
      for (const [a, b] of ringEdges(ring))
        if (len(a, b) > 0.05) out.push({ a, b, thickness, kind: 'facade' });
  return out;
}

interface Line {
  /** unit direction, angle in [0, π) */
  d: Vec2;
  /** signed distance of the line from the origin along the normal (−d.y, d.x) */
  c: number;
  spans: { t0: number; t1: number; w: number; kind: WallSegment['kind'] }[];
}

/**
 * Walls inside a storey: the outlines of the units, cores and circulation areas, without the
 * parts on the façade. Edges shared by two areas are merged into one wall; where a core edge
 * and a unit edge coincide the thicker (core) wall wins.
 */
export function interiorWalls(
  st: Pick<StoreyLayout, 'footprints' | 'units' | 'cores' | 'circulation' | 'open'>,
  thickness: { interior: number; core: number },
): WallSegment[] {
  const lines: Line[] = [];
  const lineOf = (a: Vec2, b: Vec2): { line: Line; t0: number; t1: number } | null => {
    const l = len(a, b);
    if (l < 0.05) return null;
    let d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    if (d[1] < -EPS || (Math.abs(d[1]) <= EPS && d[0] < 0)) d = [-d[0], -d[1]];
    const n: Vec2 = [-d[1], d[0]];
    const c = a[0] * n[0] + a[1] * n[1];
    let line = lines.find(
      (x) => Math.abs(x.d[0] * d[1] - x.d[1] * d[0]) < 1e-4 && Math.abs(x.c - c) < 0.005,
    );
    if (!line) lines.push((line = { d, c, spans: [] }));
    const ta = a[0] * line.d[0] + a[1] * line.d[1];
    const tb = b[0] * line.d[0] + b[1] * line.d[1];
    return { line, t0: Math.min(ta, tb), t1: Math.max(ta, tb) };
  };
  const add = (ring: readonly Vec2[], w: number, kind: WallSegment['kind']) => {
    for (const [a, b] of ringEdges(ring)) {
      const x = lineOf(a, b);
      if (x) x.line.spans.push({ t0: x.t0, t1: x.t1, w, kind });
    }
  };
  for (const c of st.cores) add(normalizePolygon(c.polygon).outer, thickness.core, 'core');
  for (const u of st.units) add(normalizePolygon(u.polygon).outer, thickness.interior, 'interior');
  for (const c of st.circulation)
    add(normalizePolygon(c.polygon).outer, thickness.interior, 'interior');

  const onFacade = (p: Vec2) =>
    st.footprints.some((f) =>
      [f.outer, ...(f.holes ?? [])].some((r) => pointRingDistance(p, r) < 0.02),
    );
  const out: WallSegment[] = [];
  for (const line of lines) {
    const cuts = [...new Set(line.spans.flatMap((s) => [s.t0, s.t1]))].sort((x, y) => x - y);
    const at = (t: number): Vec2 => [
      line.d[0] * t - line.d[1] * line.c,
      line.d[1] * t + line.d[0] * line.c,
    ];
    let cur: WallSegment | null = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t0 = cuts[i]!;
      const t1 = cuts[i + 1]!;
      if (t1 - t0 < 0.01) continue;
      const m = (t0 + t1) / 2;
      const cover = line.spans.filter((s) => s.t0 <= m && s.t1 >= m);
      if (!cover.length || onFacade(at(m))) {
        if (cur) out.push(cur);
        cur = null;
        continue;
      }
      const best = cover.reduce((x, s) => (s.w > x.w ? s : x));
      if (cur && Math.abs(cur.thickness - best.w) < EPS && len(cur.b, at(t0)) < 0.01) {
        cur.b = at(t1);
      } else {
        if (cur) out.push(cur);
        cur = { a: at(t0), b: at(t1), thickness: best.w, kind: best.kind };
      }
    }
    if (cur) out.push(cur);
  }
  return out.filter((w) => len(w.a, w.b) > 0.05);
}

// ---------------------------------------------------------------------------
// Slabs
// ---------------------------------------------------------------------------

export interface LevelSlab {
  /** Top of the slab (finished floor level), m. */
  z: number;
  polygon: Polygon;
  /** Storey whose floor (or roof, for the top) this slab is. */
  storeyIndex: number;
  segment?: number;
  /** true for the slab above the top storey (roof slab). */
  roof: boolean;
}

/**
 * One slab per level of a mass: at every floor level, the footprints of the storeys above and
 * below it (a set-back storey's terrace is still covered); the top of every top storey gets a
 * roof slab. Stair openings are cut out of the floors the stairs arrive at.
 */
export function levelSlabs(
  solids: readonly StoreySolid[],
  stairs: readonly CoreStair[] = [],
): LevelSlab[] {
  const levels = new Map<string, { z: number; above: StoreySolid[]; below: StoreySolid[] }>();
  const get = (z: number) => {
    const k = z.toFixed(3);
    let l = levels.get(k);
    if (!l) levels.set(k, (l = { z, above: [], below: [] }));
    return l;
  };
  for (const s of solids) {
    if (!(s.z1 > s.z0)) continue;
    get(s.z0).above.push(s);
    get(s.z1).below.push(s);
  }
  const out: LevelSlab[] = [];
  for (const l of [...levels.values()].sort((a, b) => a.z - b.z)) {
    const polys = union([...l.above, ...l.below].map((s) => normalizePolygon(s.footprint)));
    const openings = stairs
      .filter((st) => Math.abs(st.z1 - l.z) < 1e-3)
      .map(stairOpening)
      .filter((p): p is Polygon => !!p);
    const cut = openings.length ? difference(polys, openings) : polys;
    const owner = l.above[0] ?? l.below[0]!;
    for (const polygon of cut) {
      const slab: LevelSlab = {
        z: l.z,
        polygon,
        storeyIndex: owner.storeyIndex,
        roof: !l.above.length,
      };
      if (owner.segment !== undefined) slab.segment = owner.segment;
      out.push(slab);
    }
  }
  return out;
}

/**
 * Opening of a stair in the floor it arrives at: the rectangle around its flights and its
 * intermediate landing (in the stair's own axes).
 */
export function stairOpening(st: CoreStair): Polygon | null {
  const f = st.flights[0];
  if (!f) return null;
  const pts = [
    ...st.flights.flatMap((x) => x.polygon.outer),
    ...st.landings.flatMap((l) => l.polygon.outer),
  ];
  const u = f.dir;
  const v = f.side;
  const su = pts.map((p) => dot(p, u));
  const sv = pts.map((p) => dot(p, v));
  const [u0, u1, v0, v1] = [Math.min(...su), Math.max(...su), Math.min(...sv), Math.max(...sv)];
  if (u1 - u0 < 0.1 || v1 - v0 < 0.1) return null;
  const at = (a: number, b: number): Vec2 => [u[0] * a + v[0] * b, u[1] * a + v[1] * b];
  return normalizePolygon({ outer: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)] });
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface PlaneRoof {
  polygon: Polygon;
  /** Level of the pivot line (eaves), m. */
  level: number;
  /** Pivot line; the roof rises on its left. */
  pivot: [Vec2, Vec2];
  /** Slope, radians. */
  angle: number;
}

/** A sloped roof face as an Archicad single-plane roof. Null for a flat face. */
export function planeRoof(piece: RoofPiece): PlaneRoof | null {
  const [a, b, c] = piece.plane;
  const g = Math.hypot(b, c);
  if (g < 1e-6) return null;
  const ring = piece.polygon.outer;
  const q: Vec2 = [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
  // foot of the eaves line: z(p) = z0 on the line through q along the gradient
  const zq = a + b * q[0] + c * q[1];
  const k = (zq - piece.z0) / (g * g);
  const p: Vec2 = [q[0] - b * k, q[1] - c * k];
  // the roof rises to the left of the pivot direction: left normal of d = gradient direction
  const d: Vec2 = [c / g, -b / g];
  return {
    polygon: piece.polygon,
    level: piece.z0,
    pivot: [
      [p[0] - d[0] * 5, p[1] - d[1] * 5],
      [p[0] + d[0] * 5, p[1] + d[1] * 5],
    ],
    angle: Math.atan(g),
  };
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

export interface NativeStair {
  /** Baseline on the outer edge of the U: flight 1, landing, flight 2. */
  points: Vec2[];
  /** Side of the flights on which the baseline runs. */
  baseline: 'Left' | 'Right';
  z0: number;
  height: number;
  flightWidth: number;
  risers: number;
  riser: number;
  going: number;
}

const plus = (p: Vec2, v: Vec2, k = 1): Vec2 => [p[0] + v[0] * k, p[1] + v[1] * k];

/**
 * A two-flight core stair (demi-tour) as an Archicad U-shaped stair: the baseline follows the
 * outer edge of flight 1 up to the back of the landing, across it, and back along flight 2.
 * Null when the stair does not have two flights and a landing.
 */
export function nativeStair(st: CoreStair): NativeStair | null {
  const [f1, f2] = st.flights;
  const landing = st.landings[0];
  if (!f1 || !f2 || !landing) return null;
  const dir = f1.dir;
  const across: Vec2 = f1.side;
  // lane of each flight across `across`
  const lane = (f: typeof f1): [number, number] => {
    const o = dot(f.origin, across);
    const w = dot(f.side, across) * f.width;
    return [Math.min(o, o + w), Math.max(o, o + w)];
  };
  const l1 = lane(f1);
  const l2 = lane(f2);
  // the outer edges are the lane edges away from the other flight
  const out1 = l1[0] < l2[0] ? l1[0] : l1[1];
  const out2 = l1[0] < l2[0] ? l2[1] : l2[0];
  const s0 = dot(f1.origin, dir);
  const sBack = Math.max(...landing.polygon.outer.map((p) => dot(p, dir)));
  const end2 = plus(f2.origin, f2.dir, (f2.risers - 1) * f2.going);
  const sEnd = dot(end2, dir);
  const pt = (s: number, c: number): Vec2 => plus(plus([0, 0], dir, s), across, c);
  const points = [pt(s0, out1), pt(sBack, out1), pt(sBack, out2), pt(sEnd, out2)];
  // flights lie towards the inside of the U: left of the travel direction → baseline on the right
  const toInside: Vec2 = [points[2]![0] - points[1]![0], points[2]![1] - points[1]![1]];
  const cross = dir[0] * toInside[1] - dir[1] * toInside[0];
  return {
    points,
    baseline: cross > 0 ? 'Right' : 'Left',
    z0: st.z0,
    height: st.z1 - st.z0,
    flightWidth: f1.width,
    risers: st.risers,
    riser: st.riser,
    going: st.going,
  };
}
