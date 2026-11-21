import type { ContextBuilding, Polygon, Vec2 } from '@kubatur/core';
import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Path,
  Shape,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Pure geometry builders for the 3D view (no WebGL needed, unit-tested).
 * World coordinates: metres, x = east, y = north, z = up.
 */

const v2 = (p: Vec2) => new Vector2(p[0], p[1]);

/** Polygon with holes → closed prism between z0 and z1 (non-indexed, with normals). */
export function extrudePolygon(poly: Polygon, z0: number, z1: number): BufferGeometry | null {
  if (poly.outer.length < 3 || !(z1 - z0 > 1e-6)) return null;
  const shape = new Shape(poly.outer.map(v2));
  for (const h of poly.holes ?? []) if (h.length >= 3) shape.holes.push(new Path(h.map(v2)));
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, z0);
  g.clearGroups();
  return g;
}

/** Line segments of a closed ring at height z (pairs of points, flat xyz array). */
export function ringSegments(ring: readonly Vec2[], z: number, out: number[] = []): number[] {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    out.push(a[0], a[1], z, b[0], b[1], z);
  }
  return out;
}

/** True when the outline turns by more than `featureAngleDeg` at vertex i. */
export function isFeatureVertex(ring: readonly Vec2[], i: number, featureAngleDeg = 30): boolean {
  const n = ring.length;
  const p = ring[(i - 1 + n) % n]!;
  const c = ring[i]!;
  const q = ring[(i + 1) % n]!;
  const ax = c[0] - p[0];
  const ay = c[1] - p[1];
  const bx = q[0] - c[0];
  const by = q[1] - c[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return false;
  const cos = (ax * bx + ay * by) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, cos))) > (featureAngleDeg * Math.PI) / 180;
}

export interface PrismEdgeOptions {
  bottom?: boolean;
  top?: boolean;
  vertical?: boolean;
  featureAngleDeg?: number;
}

/** Edges of an extruded polygon: bottom/top outlines + vertical edges at corners (feature angle). */
export function prismEdges(
  poly: Polygon,
  z0: number,
  z1: number,
  opts: PrismEdgeOptions = {},
  out: number[] = [],
): number[] {
  const { bottom = true, top = true, vertical = true, featureAngleDeg = 30 } = opts;
  for (const ring of [poly.outer, ...(poly.holes ?? [])]) {
    if (ring.length < 2) continue;
    if (bottom) ringSegments(ring, z0, out);
    if (top) ringSegments(ring, z1, out);
    if (vertical)
      ring.forEach((p, i) => {
        if (isFeatureVertex(ring, i, featureAngleDeg)) out.push(p[0], p[1], z0, p[0], p[1], z1);
      });
  }
  return out;
}

/** Horizontal outline rings of a polygon at each given height (storey slab lines). */
export function storeyLines(
  poly: Polygon,
  levels: readonly number[],
  out: number[] = [],
): number[] {
  for (const z of levels)
    for (const ring of [poly.outer, ...(poly.holes ?? [])]) ringSegments(ring, z, out);
  return out;
}

/**
 * Dash-dot pattern along a closed ring (site boundary): [dash, gap, dot, gap] in metres.
 * Returns line segments (flat xyz pairs).
 */
export function dashDotSegments(
  ring: readonly Vec2[],
  z: number,
  pattern: readonly number[] = [4, 1, 0.4, 1],
): number[] {
  const out: number[] = [];
  const total = pattern.reduce((a, b) => a + b, 0);
  if (total <= 0) return ringSegments(ring, z);
  let phase = 0; // distance into the pattern
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const dx = (b[0] - a[0]) / len;
    const dy = (b[1] - a[1]) / len;
    let s = 0;
    while (s < len) {
      // locate the current pattern element
      let acc = 0;
      let k = 0;
      while (k < pattern.length && acc + pattern[k]! <= phase + 1e-9) acc += pattern[k++]!;
      k %= pattern.length;
      const remain = acc + pattern[k]! - phase;
      const step = Math.min(remain, len - s);
      if (k % 2 === 0) {
        out.push(
          a[0] + dx * s,
          a[1] + dy * s,
          z,
          a[0] + dx * (s + step),
          a[1] + dy * (s + step),
          z,
        );
      }
      s += step;
      phase = (phase + step) % total;
    }
  }
  return out;
}

export function segmentsGeometry(segs: readonly number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(segs, 3));
  return g;
}

/** Signed volume of a closed triangle mesh (non-indexed or indexed). */
export function meshVolume(g: BufferGeometry): number {
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const at = (i: number) => (idx ? idx.getX(i) : i);
  let v = 0;
  for (let t = 0; t < count; t += 3) {
    const a = at(t);
    const b = at(t + 1);
    const c = at(t + 2);
    const [ax, ay, az] = [pos.getX(a), pos.getY(a), pos.getZ(a)];
    const [bx, by, bz] = [pos.getX(b), pos.getY(b), pos.getZ(b)];
    const [cx, cy, cz] = [pos.getX(c), pos.getY(c), pos.getZ(c)];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/** Stable key of a footprint (to detect identical stacked storey footprints). */
export function footprintKey(p: Polygon): string {
  const r = (x: number) => Math.round(x * 100);
  return [p.outer, ...(p.holes ?? [])]
    .map((ring) => ring.map((q) => `${r(q[0])},${r(q[1])}`).join(';'))
    .join('|');
}

// ---------------------------------------------------------------------------
// Context (neighbours), merged for performance
// ---------------------------------------------------------------------------

export interface ContextGeometry {
  /** Merged faces of all visible, non-demolished buildings (null when empty). */
  faces: BufferGeometry | null;
  /** Building id per triangle range: triangle t belongs to ids[i] with starts[i] ≤ t < starts[i+1]. */
  ids: string[];
  starts: number[];
  /** Edges of buildings with known height. */
  edges: number[];
  /** Edges of buildings with estimated height (drawn dashed). */
  edgesEstimated: number[];
  /** Ghost outline of demolished buildings. */
  edgesDemolished: number[];
}

export function contextRange(b: ContextBuilding): [number, number] {
  // `height` is the top above ground (OSM semantics), `baseHeight` the bottom (min_height).
  const z0 = b.baseHeight ?? 0;
  return [z0, Math.max(z0 + 0.1, b.height)];
}

export function buildContextGeometry(buildings: readonly ContextBuilding[]): ContextGeometry {
  const geoms: BufferGeometry[] = [];
  const ids: string[] = [];
  const starts: number[] = [];
  const edges: number[] = [];
  const edgesEstimated: number[] = [];
  const edgesDemolished: number[] = [];
  let tri = 0;
  for (const b of buildings) {
    if (b.hidden) continue;
    const [z0, z1] = contextRange(b);
    if (b.demolished) {
      prismEdges(b.footprint, z0, z1, {}, edgesDemolished);
      continue;
    }
    const g = extrudePolygon(b.footprint, z0, z1);
    if (!g) continue;
    ids.push(b.id);
    starts.push(tri);
    tri += g.getAttribute('position').count / 3;
    geoms.push(g);
    prismEdges(b.footprint, z0, z1, {}, b.heightEstimated ? edgesEstimated : edges);
  }
  const faces = geoms.length ? mergeGeometries(geoms, false) : null;
  for (const g of geoms) g.dispose();
  return { faces, ids, starts, edges, edgesEstimated, edgesDemolished };
}

/** Building id for a triangle index of the merged context geometry (binary search). */
export function contextIdAt(
  geo: Pick<ContextGeometry, 'ids' | 'starts'>,
  tri: number,
): string | null {
  let lo = 0;
  let hi = geo.starts.length - 1;
  if (hi < 0 || tri < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (geo.starts[mid]! <= tri) lo = mid;
    else hi = mid - 1;
  }
  return geo.ids[lo] ?? null;
}
