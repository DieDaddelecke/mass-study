import { signedRingArea, type Polygon, type Vec2 } from '@kubatur/core';

/**
 * Exact hidden-line removal for vertical prisms (extruded polygons with holes) under a parallel
 * projection (SPEC §11). See DECISIONS.md: analytic critical points instead of a BVH.
 *
 * 1. Candidate edges: bottom/top ring edges and vertical edges; an edge is dropped when all its
 *    adjacent faces are back faces (back-face culling).
 * 2. Every edge is split at the parameters where its projection crosses the projected edges of
 *    the prisms that can occlude it (depth- and grid-pruned). Between two such points the
 *    visibility cannot change (for non-intersecting solids), so the midpoint decides: a ray from
 *    the midpoint towards the viewer is tested against the prisms (z interval × plan segment
 *    against the footprint interior).
 * 3. Additional uniform samples (safety net for intersecting solids) are refined by bisection to
 *    `tolerance` (1 mm) where the visibility changes between them.
 * 4. Front faces are returned with a depth for painter-sorted fills underneath the lines.
 */

export type Vec3 = [number, number, number];

export interface Prism {
  outer: Vec2[];
  holes: Vec2[][];
  z0: number;
  z1: number;
  /** Free tag for the caller (e.g. 'mass' | 'context'). */
  group: string;
  id: string;
  /** Index into the caller's data. */
  ref?: number;
}

/** Parallel projection: screen x = right·p, screen y = up·p; `v` points towards the viewer. */
export interface Projection {
  right: Vec3;
  up: Vec3;
  v: Vec3;
}

export interface VisibleSegment {
  a: Vec2;
  b: Vec2;
  /** Owning prism, null for extra edges. */
  prism: Prism | null;
  /** 'storey' = horizontal edge shared by two stacked prisms; 'extra' = caller's edge. */
  cls: 'edge' | 'storey' | 'vertical' | 'extra';
  tag?: string;
}

/** Additional 3D edges (e.g. the site boundary on the ground) that get the same treatment. */
export interface ExtraEdge {
  p: Vec3;
  q: Vec3;
  tag: string;
}

export interface ProjectedFace {
  rings: Vec2[][];
  depth: number;
  prism: Prism;
  kind: 'wall' | 'roof';
}

export interface HiddenLineOptions {
  /** Keep horizontal edges between stacked prisms (storey lines). Default true. */
  storeyLines?: boolean;
  /** Bisection tolerance on screen (m). Default 0.001. */
  tolerance?: number;
  /** Uniform sample step on screen (m). Default 1. */
  sampleStep?: number;
  extraEdges?: ExtraEdge[];
}

export interface HiddenLineResult {
  segments: VisibleSegment[];
  faces: ProjectedFace[];
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function projectPoint(P: Projection, p: Vec3): Vec2 {
  return [dot3(P.right, p), dot3(P.up, p)];
}

/** Make outer rings CCW and holes CW (outward wall normals = right of the edge direction). */
export function orientPrism(p: Prism): Prism {
  const outer = signedRingArea(p.outer) < 0 ? [...p.outer].reverse() : p.outer;
  const holes = p.holes.map((h) => (signedRingArea(h) > 0 ? [...h].reverse() : h));
  return { ...p, outer, holes };
}

export function prismFromPolygon(
  poly: Polygon,
  z0: number,
  z1: number,
  group: string,
  id: string,
  ref?: number,
): Prism {
  const p: Prism = {
    outer: simplifyRing(poly.outer),
    holes: (poly.holes ?? []).map(simplifyRing).filter((h) => h.length >= 3),
    z0,
    z1,
    group,
    id,
  };
  if (ref !== undefined) p.ref = ref;
  return orientPrism(p);
}

/** Drop duplicate and collinear vertices (within 0.1 mm), so that no phantom edges appear. */
export function simplifyRing(ring: readonly Vec2[]): Vec2[] {
  let pts = [...ring];
  if (pts.length > 1) {
    const f = pts[0]!;
    const l = pts[pts.length - 1]!;
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-4) pts.pop();
  }
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = out.length ? out[out.length - 1]! : pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const lac = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const dup = Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-4;
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (dup || (lac > 0 && Math.abs(cross) / lac < 1e-4 && dot > 0)) {
        changed = true;
        continue;
      }
      out.push(b);
    }
    pts = out;
  }
  return pts;
}

interface PrismData {
  prism: Prism;
  rings: Vec2[][];
  depthMax: number;
  // projected bbox
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // plan bbox
  pminX: number;
  pminY: number;
  pmaxX: number;
  pmaxY: number;
  /** Projected contour segments (lazy). */
  contour?: [Vec2, Vec2][];
}

const EPS_Z = 1e-7;
const EPS_IN = 1e-6;

/** Strictly inside (not on the boundary within EPS_IN). */
function insideStrict(pt: Vec2, rings: Vec2[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a[1] > pt[1] !== b[1] > pt[1]) {
        const x = ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0];
        if (pt[0] < x) inside = !inside;
      }
    }
  }
  if (!inside) return false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (segDist2(pt, ring[j]!, ring[i]!) < EPS_IN * EPS_IN) return false;
    }
  }
  return true;
}

function segDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Parameter on a–b where it meets c–d (inclusive), or null. */
function segParam(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-14) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -1e-12 || t > 1 + 1e-12 || u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

/** Does the open plan segment a–b pass through the interior of the polygon? */
function segmentHitsInterior(a: Vec2, b: Vec2, d: PrismData): boolean {
  if (
    Math.max(a[0], b[0]) < d.pminX ||
    Math.min(a[0], b[0]) > d.pmaxX ||
    Math.max(a[1], b[1]) < d.pminY ||
    Math.min(a[1], b[1]) > d.pmaxY
  )
    return false;
  const ts = [0, 1];
  for (const ring of d.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const t = segParam(a, b, ring[j]!, ring[i]!);
      if (t !== null && t > 0 && t < 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < 1e-12) continue;
    const t = (t0 + t1) / 2;
    if (insideStrict([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d.rings)) return true;
  }
  return false;
}

class Occluders {
  private cells = new Map<number, number[]>();
  private cell: number;
  private ox: number;
  private oy: number;
  readonly data: PrismData[];
  private far: number;

  constructor(
    prisms: Prism[],
    private P: Projection,
  ) {
    let gx0 = Infinity;
    let gy0 = Infinity;
    let gx1 = -Infinity;
    let gy1 = -Infinity;
    let pf = 0;
    this.data = prisms.map((prism) => {
      const rings = [prism.outer, ...prism.holes];
      const d: PrismData = {
        prism,
        rings,
        depthMax: -Infinity,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
        pminX: Infinity,
        pminY: Infinity,
        pmaxX: -Infinity,
        pmaxY: -Infinity,
      };
      for (const q of prism.outer) {
        d.pminX = Math.min(d.pminX, q[0]);
        d.pminY = Math.min(d.pminY, q[1]);
        d.pmaxX = Math.max(d.pmaxX, q[0]);
        d.pmaxY = Math.max(d.pmaxY, q[1]);
        for (const z of [prism.z0, prism.z1]) {
          const p3: Vec3 = [q[0], q[1], z];
          const s = projectPoint(P, p3);
          d.minX = Math.min(d.minX, s[0]);
          d.minY = Math.min(d.minY, s[1]);
          d.maxX = Math.max(d.maxX, s[0]);
          d.maxY = Math.max(d.maxY, s[1]);
          d.depthMax = Math.max(d.depthMax, dot3(P.v, p3));
          pf = Math.max(pf, Math.abs(q[0]), Math.abs(q[1]));
        }
      }
      gx0 = Math.min(gx0, d.minX);
      gy0 = Math.min(gy0, d.minY);
      gx1 = Math.max(gx1, d.maxX);
      gy1 = Math.max(gy1, d.maxY);
      return d;
    });
    this.far = 4 * pf + 1000;
    this.ox = Number.isFinite(gx0) ? gx0 : 0;
    this.oy = Number.isFinite(gy0) ? gy0 : 0;
    const ext = Math.max(gx1 - gx0, gy1 - gy0, 1);
    this.cell = Math.max(ext / 48, 2);
    this.data.forEach((d, i) => {
      for (const k of this.keys(d.minX, d.minY, d.maxX, d.maxY)) {
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(i);
      }
    });
  }

  private *keys(x0: number, y0: number, x1: number, y1: number): Generator<number> {
    const i0 = Math.floor((x0 - this.ox) / this.cell);
    const i1 = Math.floor((x1 - this.ox) / this.cell);
    const j0 = Math.floor((y0 - this.oy) / this.cell);
    const j1 = Math.floor((y1 - this.oy) / this.cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) yield i * 100003 + j;
  }

  /** Prisms whose projection overlaps the box and that reach in front of minDepth. */
  candidates(x0: number, y0: number, x1: number, y1: number, minDepth: number): PrismData[] {
    const seen = new Set<number>();
    const out: PrismData[] = [];
    for (const k of this.keys(x0, y0, x1, y1)) {
      for (const i of this.cells.get(k) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const d = this.data[i]!;
        if (d.maxX < x0 - 1e-9 || d.minX > x1 + 1e-9 || d.maxY < y0 - 1e-9 || d.minY > y1 + 1e-9)
          continue;
        if (d.depthMax <= minDepth + 1e-9) continue;
        out.push(d);
      }
    }
    return out;
  }

  /** Is the point hidden by any of the candidate prisms? */
  hidden(p: Vec3, cands: PrismData[]): boolean {
    const v = this.P.v;
    for (const d of cands) {
      const { z1 } = d.prism;
      // prisms standing on the ground also hide points on the ground plane behind them
      const z0 = d.prism.z0 <= 1e-9 ? d.prism.z0 - 2 * EPS_Z : d.prism.z0;
      let t1: number;
      let t2: number;
      if (Math.abs(v[2]) < 1e-12) {
        if (!(p[2] > z0 + EPS_Z && p[2] < z1 - EPS_Z)) continue;
        t1 = 1e-6;
        t2 = this.far;
      } else {
        const ta = (z0 + EPS_Z - p[2]) / v[2];
        const tb = (z1 - EPS_Z - p[2]) / v[2];
        t1 = Math.max(Math.min(ta, tb), 1e-6);
        t2 = Math.min(Math.max(ta, tb), this.far);
        if (t2 <= t1) continue;
      }
      const a: Vec2 = [p[0] + v[0] * t1, p[1] + v[1] * t1];
      const b: Vec2 = [p[0] + v[0] * t2, p[1] + v[1] * t2];
      if (segmentHitsInterior(a, b, d)) return true;
    }
    return false;
  }

  contour(d: PrismData): [Vec2, Vec2][] {
    if (d.contour) return d.contour;
    const out: [Vec2, Vec2][] = [];
    const { z0, z1 } = d.prism;
    for (const ring of d.rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const a0 = projectPoint(this.P, [a[0], a[1], z0]);
        const a1 = projectPoint(this.P, [a[0], a[1], z1]);
        const b0 = projectPoint(this.P, [b[0], b[1], z0]);
        const b1 = projectPoint(this.P, [b[0], b[1], z1]);
        out.push([a0, b0], [a1, b1], [a0, a1]);
      }
    }
    return (d.contour = out);
  }
}

interface Edge {
  p: Vec3;
  q: Vec3;
  prism: Prism | null;
  cls: VisibleSegment['cls'];
  tag?: string;
}

const edgeKey = (a: Vec2, b: Vec2, z: number) => {
  const r = (x: number) => Math.round(x * 1000);
  const ka = `${r(a[0])},${r(a[1])}`;
  const kb = `${r(b[0])},${r(b[1])}`;
  return (ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`) + `|${r(z)}`;
};

function candidateEdges(prisms: Prism[], P: Projection, storeyLines: boolean): Edge[] {
  const v = P.v;
  const roofFront = v[2] > 1e-9;
  const floorFront = v[2] < -1e-9;
  // horizontal edges at the bottom of a prism, keyed (to detect stacked prisms)
  const bottoms = new Set<string>();
  for (const pr of prisms)
    for (const ring of [pr.outer, ...pr.holes])
      for (let i = 0; i < ring.length; i++)
        bottoms.add(edgeKey(ring[i]!, ring[(i + 1) % ring.length]!, pr.z0));
  const tops = new Set<string>();
  for (const pr of prisms)
    for (const ring of [pr.outer, ...pr.holes])
      for (let i = 0; i < ring.length; i++)
        tops.add(edgeKey(ring[i]!, ring[(i + 1) % ring.length]!, pr.z1));

  const edges: Edge[] = [];
  for (const pr of prisms) {
    for (const ring of [pr.outer, ...pr.holes]) {
      const n = ring.length;
      const wallFront: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        // outward normal = right of a→b for CCW outer / CW holes
        const nx = b[1] - a[1];
        const ny = -(b[0] - a[0]);
        wallFront.push(nx * v[0] + ny * v[1] > 1e-9 * Math.hypot(nx, ny));
      }
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        const wf = wallFront[i]!;
        const topKey = edgeKey(a, b, pr.z1);
        const botKey = edgeKey(a, b, pr.z0);
        const topShared = bottoms.has(topKey);
        const botShared = tops.has(botKey);
        if (wf || roofFront) {
          if (!topShared)
            edges.push({ p: [a[0], a[1], pr.z1], q: [b[0], b[1], pr.z1], prism: pr, cls: 'edge' });
          else if (storeyLines && wf)
            edges.push({
              p: [a[0], a[1], pr.z1],
              q: [b[0], b[1], pr.z1],
              prism: pr,
              cls: 'storey',
            });
        }
        if ((wf || floorFront) && !botShared)
          edges.push({ p: [a[0], a[1], pr.z0], q: [b[0], b[1], pr.z0], prism: pr, cls: 'edge' });
        // vertical edge at vertex b (between wall i and wall i+1)
        if (wf || wallFront[(i + 1) % n]!)
          edges.push({
            p: [b[0], b[1], pr.z0],
            q: [b[0], b[1], pr.z1],
            prism: pr,
            cls: 'vertical',
          });
      }
    }
  }
  return edges;
}

export function hiddenLine(
  prismsIn: readonly Prism[],
  P: Projection,
  opts: HiddenLineOptions = {},
): HiddenLineResult {
  const prisms = prismsIn.filter((p) => p.z1 - p.z0 > 1e-6 && p.outer.length >= 3);
  const tol = opts.tolerance ?? 0.001;
  const step = opts.sampleStep ?? 1;
  const occ = new Occluders(prisms, P);
  const edges = candidateEdges(prisms, P, opts.storeyLines ?? true);
  for (const x of opts.extraEdges ?? [])
    edges.push({ p: x.p, q: x.q, prism: null, cls: 'extra', tag: x.tag });
  const segments: VisibleSegment[] = [];

  for (const e of edges) {
    const sp = projectPoint(P, e.p);
    const sq = projectPoint(P, e.q);
    const len = Math.hypot(sq[0] - sp[0], sq[1] - sp[1]);
    if (len < tol) continue;
    const minDepth = Math.min(dot3(P.v, e.p), dot3(P.v, e.q));
    const cands = occ.candidates(
      Math.min(sp[0], sq[0]),
      Math.min(sp[1], sq[1]),
      Math.max(sp[0], sq[0]),
      Math.max(sp[1], sq[1]),
      minDepth,
    );
    const at = (t: number): Vec3 => [
      e.p[0] + (e.q[0] - e.p[0]) * t,
      e.p[1] + (e.q[1] - e.p[1]) * t,
      e.p[2] + (e.q[2] - e.p[2]) * t,
    ];
    if (!cands.length) {
      segments.push(seg(sp, sq, 0, 1, e));
      continue;
    }
    // critical parameters: crossings with projected contours of the candidates
    const crit: number[] = [0, 1];
    for (const d of cands) {
      for (const [c0, c1] of occ.contour(d)) {
        const t = segParam(sp, sq, c0, c1);
        if (t !== null && t > 0 && t < 1) crit.push(t);
      }
    }
    const nUni = Math.min(200, Math.floor(len / step));
    const uniform = new Set<number>();
    for (let i = 1; i < nUni; i++) {
      crit.push(i / nUni);
      uniform.add(i / nUni);
    }
    crit.sort((x, y) => x - y);
    const ts: number[] = [crit[0]!];
    for (const t of crit) if (t - ts[ts.length - 1]! > tol / len / 4) ts.push(t);
    if (ts[ts.length - 1]! < 1) ts[ts.length - 1] = 1;
    // classify intervals by their midpoint
    const vis: boolean[] = [];
    for (let i = 0; i + 1 < ts.length; i++)
      vis.push(!occ.hidden(at((ts[i]! + ts[i + 1]!) / 2), cands));
    // walk and emit, refining at uniform boundaries
    let start: number | null = vis[0] ? 0 : null;
    for (let i = 1; i < vis.length; i++) {
      if (vis[i] === vis[i - 1]) continue;
      let tb = ts[i]!;
      if (uniform.has(tb)) {
        let lo = (ts[i - 1]! + ts[i]!) / 2;
        let hi = (ts[i]! + ts[i + 1]!) / 2;
        const loVis = vis[i - 1]!;
        while ((hi - lo) * len > tol) {
          const mid = (lo + hi) / 2;
          if (!occ.hidden(at(mid), cands) === loVis) lo = mid;
          else hi = mid;
        }
        tb = (lo + hi) / 2;
      }
      if (vis[i]) start = tb;
      else if (start !== null) {
        if ((tb - start) * len > tol) segments.push(seg(sp, sq, start, tb, e));
        start = null;
      }
    }
    if (start !== null && (1 - start) * len > tol) segments.push(seg(sp, sq, start, 1, e));
  }

  // front faces for painter-sorted fills
  const faces: ProjectedFace[] = [];
  const v = P.v;
  for (const pr of prisms) {
    for (const ring of [pr.outer, ...pr.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const nx = b[1] - a[1];
        const ny = -(b[0] - a[0]);
        if (nx * v[0] + ny * v[1] <= 1e-9 * Math.hypot(nx, ny)) continue;
        const zm = (pr.z0 + pr.z1) / 2;
        faces.push({
          rings: [
            [
              projectPoint(P, [a[0], a[1], pr.z0]),
              projectPoint(P, [b[0], b[1], pr.z0]),
              projectPoint(P, [b[0], b[1], pr.z1]),
              projectPoint(P, [a[0], a[1], pr.z1]),
            ],
          ],
          depth: dot3(v, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zm]),
          prism: pr,
          kind: 'wall',
        });
      }
    }
    if (v[2] > 1e-9) {
      faces.push({
        rings: [pr.outer, ...pr.holes].map((r) =>
          r.map((q) => projectPoint(P, [q[0], q[1], pr.z1])),
        ),
        depth: -Infinity,
        prism: pr,
        kind: 'roof',
      });
    }
  }
  return { segments, faces };
}

function seg(sp: Vec2, sq: Vec2, t0: number, t1: number, e: Edge): VisibleSegment {
  const lerp = (t: number): Vec2 => [sp[0] + (sq[0] - sp[0]) * t, sp[1] + (sq[1] - sp[1]) * t];
  const s: VisibleSegment = { a: lerp(t0), b: lerp(t1), prism: e.prism, cls: e.cls };
  if (e.tag !== undefined) s.tag = e.tag;
  return s;
}

/**
 * Painter order for fills: prisms far → near by the depth of their footprint centroid at
 * mid-height; within a prism walls far → near, then the roof (covers inner walls of courtyards
 * that are hidden below the roof edge). Lines are exact anyway and drawn on top.
 */
export function painterOrder(faces: ProjectedFace[], P: Projection): ProjectedFace[] {
  const key = new Map<Prism, number>();
  for (const f of faces) {
    if (key.has(f.prism)) continue;
    const pr = f.prism;
    let cx = 0;
    let cy = 0;
    for (const q of pr.outer) {
      cx += q[0];
      cy += q[1];
    }
    cx /= pr.outer.length;
    cy /= pr.outer.length;
    key.set(pr, dot3(P.v, [cx, cy, (pr.z0 + pr.z1) / 2]));
  }
  return [...faces].sort((a, b) => {
    const ka = key.get(a.prism)!;
    const kb = key.get(b.prism)!;
    if (a.prism !== b.prism) return ka - kb;
    if (a.kind !== b.kind) return a.kind === 'roof' ? 1 : -1;
    return a.depth - b.depth;
  });
}

/** Union of collinear overlapping segments (same style key), tolerance 1 mm. */
export function mergeCollinear<T extends { a: Vec2; b: Vec2 }>(
  segs: T[],
  styleKey: (s: T) => string,
): T[] {
  const groups = new Map<string, { s: T; t0: number; t1: number; ux: number; uy: number }[]>();
  for (const s of segs) {
    let dx = s.b[0] - s.a[0];
    let dy = s.b[1] - s.a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    dx /= l;
    dy /= l;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const off = -s.a[0] * dy + s.a[1] * dx;
    const ang = Math.round(Math.atan2(dy, dx) * 1e4);
    const k = `${styleKey(s)}|${ang}|${Math.round(off * 500)}`;
    const t0 = s.a[0] * dx + s.a[1] * dy;
    const t1 = s.b[0] * dx + s.b[1] * dy;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push({ s, t0: Math.min(t0, t1), t1: Math.max(t0, t1), ux: dx, uy: dy });
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    g.sort((x, y) => x.t0 - y.t0);
    const first = g[0]!;
    const off = -first.s.a[0] * first.uy + first.s.a[1] * first.ux;
    const pt = (t: number): Vec2 => [t * first.ux - off * first.uy, t * first.uy + off * first.ux];
    let cur = { t0: first.t0, t1: first.t1, s: first.s };
    for (let i = 1; i <= g.length; i++) {
      const n = g[i];
      if (n && n.t0 <= cur.t1 + 0.001) {
        cur.t1 = Math.max(cur.t1, n.t1);
        continue;
      }
      out.push({ ...cur.s, a: pt(cur.t0), b: pt(cur.t1) });
      if (n) cur = { t0: n.t0, t1: n.t1, s: n.s };
    }
  }
  return out;
}
