import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  PolyTreeD,
  booleanOpDWithPolyTree,
  inflatePathsD,
  type PathD,
  type PathsD,
  type PolyPathD,
} from 'clipper2-ts';
import polylabel from 'polylabel';
import type { Polygon, Vec2 } from './types.js';

/** Clipper precision in decimal places (0.1 mm). */
const PRECISION = 4;
const EPS = 1e-9;

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

/** Signed area of a ring (shoelace), positive for counter-clockwise rings. */
export function signedRingArea(ring: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringPerimeter(ring: readonly Vec2[]): number {
  let l = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    l += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return l;
}

export function isCCW(ring: readonly Vec2[]): boolean {
  return signedRingArea(ring) > 0;
}

/** Remove a duplicated closing point and consecutive duplicates. */
export function cleanRing(ring: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > EPS || Math.abs(last[1] - p[1]) > EPS) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length > 1) {
    const f = out[0]!;
    const l = out[out.length - 1]!;
    if (Math.abs(f[0] - l[0]) < EPS && Math.abs(f[1] - l[1]) < EPS) out.pop();
  }
  return out;
}

/** Normalise a polygon: outer CCW, holes CW, rings cleaned. */
export function normalizePolygon(p: Polygon): Polygon {
  const outer = cleanRing(p.outer);
  if (!isCCW(outer)) outer.reverse();
  const holes = (p.holes ?? [])
    .map((h) => {
      const r = cleanRing(h);
      if (isCCW(r)) r.reverse();
      return r;
    })
    .filter((h) => h.length >= 3);
  return holes.length ? { outer, holes } : { outer };
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

export function polygonArea(p: Polygon): number {
  let a = Math.abs(signedRingArea(p.outer));
  for (const h of p.holes ?? []) a -= Math.abs(signedRingArea(h));
  return a;
}

/** Total perimeter including holes (relevant for exterior walls around courtyards). */
export function polygonPerimeter(p: Polygon): number {
  let l = ringPerimeter(p.outer);
  for (const h of p.holes ?? []) l += ringPerimeter(h);
  return l;
}

export function polygonsArea(ps: readonly Polygon[]): number {
  return ps.reduce((s, p) => s + polygonArea(p), 0);
}

export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < EPS) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBBox(ring: readonly Vec2[]): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of ring) {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  }
  return b;
}

export function rect(minX: number, minY: number, maxX: number, maxY: number): Polygon {
  return {
    outer: [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ],
  };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export function rotatePoint(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** Rotate around the origin, then translate. */
export function transformPolygon(p: Polygon, translation: Vec2, rotation: number): Polygon {
  const tf = (pt: Vec2): Vec2 => {
    const r = rotatePoint(pt, rotation);
    return [r[0] + translation[0], r[1] + translation[1]];
  };
  const out: Polygon = { outer: p.outer.map(tf) };
  if (p.holes?.length) out.holes = p.holes.map((h) => h.map(tf));
  return out;
}

export function translatePolygon(p: Polygon, dx: number, dy: number): Polygon {
  return transformPolygon(p, [dx, dy], 0);
}

// ---------------------------------------------------------------------------
// Clipper bridge
// ---------------------------------------------------------------------------

const toPath = (ring: readonly Vec2[]): PathD => ring.map(([x, y]) => ({ x, y }));
const fromPath = (path: PathD): Vec2[] => path.map((p) => [p.x, p.y]);

function polygonsToPaths(ps: readonly Polygon[]): PathsD {
  const paths: PathsD = [];
  for (const p of ps) {
    const n = normalizePolygon(p);
    paths.push(toPath(n.outer));
    for (const h of n.holes ?? []) paths.push(toPath(h));
  }
  return paths;
}

function treeToPolygons(tree: PolyTreeD): Polygon[] {
  const out: Polygon[] = [];
  const visitOuter = (node: PolyPathD): void => {
    const poly = node.poly;
    if (poly && poly.length >= 3) {
      const holes: Vec2[][] = [];
      for (let i = 0; i < node.count; i++) {
        const hole = node.child(i);
        if (hole.poly && hole.poly.length >= 3) holes.push(fromPath(hole.poly));
        // islands inside holes
        for (let j = 0; j < hole.count; j++) visitOuter(hole.child(j));
      }
      out.push(
        normalizePolygon(
          holes.length ? { outer: fromPath(poly), holes } : { outer: fromPath(poly) },
        ),
      );
    }
  };
  for (let i = 0; i < tree.count; i++) visitOuter(tree.child(i));
  return out;
}

function boolean(
  clipType: ClipType,
  subject: readonly Polygon[],
  clip: readonly Polygon[],
): Polygon[] {
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(
    clipType,
    polygonsToPaths(subject),
    clip.length ? polygonsToPaths(clip) : null,
    tree,
    FillRule.NonZero,
    PRECISION,
  );
  return treeToPolygons(tree);
}

export function union(polys: readonly Polygon[]): Polygon[] {
  if (!polys.length) return [];
  return boolean(ClipType.Union, polys, []);
}

export function intersection(a: readonly Polygon[], b: readonly Polygon[]): Polygon[] {
  if (!a.length || !b.length) return [];
  return boolean(ClipType.Intersection, a, b);
}

export function difference(a: readonly Polygon[], b: readonly Polygon[]): Polygon[] {
  if (!a.length) return [];
  if (!b.length) return a.map(normalizePolygon);
  return boolean(ClipType.Difference, a, b);
}

/** Offset closed polygons; negative delta shrinks. Mitred corners. */
export function offsetPolygons(
  polys: readonly Polygon[],
  delta: number,
  miterLimit = 4,
): Polygon[] {
  if (Math.abs(delta) < EPS) return polys.map(normalizePolygon);
  const paths = inflatePathsD(
    polygonsToPaths(polys),
    delta,
    JoinType.Miter,
    EndType.Polygon,
    miterLimit,
    PRECISION,
  );
  if (!paths.length) return [];
  // re-run through a union to get a proper outer/hole hierarchy
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Union, paths, null, tree, FillRule.NonZero, PRECISION);
  return treeToPolygons(tree);
}

/**
 * Offset an open (or closed) polyline into a band of the given width.
 * `alignment` places the band to the left/right of the line direction or centred on it.
 */
export function offsetPolyline(
  points: readonly Vec2[],
  closed: boolean,
  width: number,
  alignment: 'center' | 'left' | 'right',
  miterLimit = 4,
): Polygon[] {
  const pts = cleanRing(points);
  if (pts.length < 2 || width <= 0) return [];
  if (closed) {
    if (pts.length < 3) return [];
    const ring: Polygon = { outer: pts };
    const n = normalizePolygon(ring);
    // for a CCW ring, "left" of the direction is inside
    const ccwInput = isCCW(pts);
    let outerDelta: number;
    let innerDelta: number;
    if (alignment === 'center') {
      outerDelta = width / 2;
      innerDelta = -width / 2;
    } else {
      const inside = (alignment === 'left') === ccwInput;
      outerDelta = inside ? 0 : width;
      innerDelta = inside ? -width : 0;
    }
    const outer = offsetPolygons([n], outerDelta, miterLimit);
    const inner = offsetPolygons([n], innerDelta, miterLimit);
    return difference(outer, inner);
  }
  // open polyline: shift the line sideways for left/right alignment, then do a centred butt offset
  let line = pts;
  if (alignment !== 'center') {
    const side = alignment === 'left' ? 1 : -1;
    line = shiftPolyline(pts, (side * width) / 2, miterLimit);
  }
  const paths = inflatePathsD(
    [toPath(line)],
    width / 2,
    JoinType.Miter,
    EndType.Butt,
    miterLimit,
    PRECISION,
  );
  const tree = new PolyTreeD();
  booleanOpDWithPolyTree(ClipType.Union, paths, null, tree, FillRule.NonZero, PRECISION);
  return treeToPolygons(tree);
}

/** Parallel offset of an open polyline to the left (positive d) with mitred joins. */
export function shiftPolyline(pts: readonly Vec2[], d: number, miterLimit = 4): Vec2[] {
  const n = pts.length;
  const normals: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    normals.push([-(b[1] - a[1]) / len, (b[0] - a[0]) / len]);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    if (i === 0 || i === n - 1) {
      const nm = normals[i === 0 ? 0 : n - 2]!;
      out.push([p[0] + nm[0] * d, p[1] + nm[1] * d]);
      continue;
    }
    const n1 = normals[i - 1]!;
    const n2 = normals[i]!;
    const bx = n1[0] + n2[0];
    const by = n1[1] + n2[1];
    const dot = bx * n1[0] + by * n1[1] || 1;
    let scale = d / dot;
    const limit = Math.abs(d) * miterLimit;
    const len = Math.hypot(bx, by) * Math.abs(scale);
    if (len > limit) scale *= limit / len;
    out.push([p[0] + bx * scale, p[1] + by * scale]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  if (!pointInRing(p, poly.outer)) return false;
  return !(poly.holes ?? []).some((h) => pointInRing(p, h));
}

/** Area of a ∩ b. */
export function overlapArea(a: readonly Polygon[], b: readonly Polygon[]): number {
  return polygonsArea(intersection(a, b));
}

/** Area of a that lies outside b. */
export function outsideArea(a: readonly Polygon[], b: readonly Polygon[]): number {
  return polygonsArea(difference(a, b));
}

/** Radius of the largest inscribed circle (pole of inaccessibility). */
export function inscribedRadius(p: Polygon): number {
  const rings = [p.outer, ...(p.holes ?? [])].map((r) =>
    r.map(([x, y]): [number, number] => [x, y]),
  );
  return polylabel(rings, 0.01).distance;
}

/** Side lengths of the minimum-area oriented bounding rectangle (rotating calipers over hull edges). */
export function orientedExtents(ring: readonly Vec2[]): {
  length: number;
  width: number;
  angle: number;
} {
  const hull = convexHull(ring);
  let best = { area: Infinity, length: 0, width: 0, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const pts = hull.map((p) => rotatePoint(p, -angle));
    const bb = ringBBox(pts);
    const w = bb.maxX - bb.minX;
    const h = bb.maxY - bb.minY;
    if (w * h < best.area - EPS) {
      best = { area: w * h, length: Math.max(w, h), width: Math.min(w, h), angle };
    }
  }
  return { length: best.length, width: best.width, angle: best.angle };
}

export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Minimum distance between two polygons' outlines (0 if they intersect). */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (overlapArea([a], [b]) > 1e-6) return 0;
  let d = Infinity;
  const ringsA = [a.outer, ...(a.holes ?? [])];
  const ringsB = [b.outer, ...(b.holes ?? [])];
  for (const ra of ringsA)
    for (const rb of ringsB) {
      for (const p of ra) d = Math.min(d, pointRingDistance(p, rb));
      for (const p of rb) d = Math.min(d, pointRingDistance(p, ra));
    }
  return d;
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointRingDistance(p: Vec2, ring: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++)
    d = Math.min(d, pointSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!));
  return d;
}
