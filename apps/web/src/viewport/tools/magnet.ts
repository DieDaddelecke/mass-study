import { rotatePoint, type Polygon, type Vec2 } from '@kubatur/core';
import { closestOnSegment, dist, polygonEdges, type Segment } from './snap';

/**
 * Magnetic snapping of whole volumes (move, copy, drag): the outline of the moved volumes is
 * pulled onto nearby edges of other volumes, the site boundary, context buildings and vegetation
 * zones. Pure geometry, unit-tested.
 *
 * Order: 1) rotation (an edge that is almost parallel to a nearby target edge becomes parallel),
 * 2) corner on corner, 3) façade flush on façade (along the target's normal), then a second
 * correction along the first façade: flush on a second, non-parallel target or corner in line
 * with the target's end.
 */

export interface MagnetOptions {
  /** Snap distance, m (≈ 12 px on screen). */
  tol: number;
  /** Allow a small rotation to make façades parallel. */
  rotate?: boolean;
  /**
   * Largest rotation that is snapped, degrees (default 25). Rotations above 6° only snap when the
   * façade is already within `tol` of the target.
   */
  maxAngleDeg?: number;
  /** Pivot of the rotation (centroid of the moved volumes). */
  pivot?: Vec2;
  /** Preferred targets (the site boundary): they win over other edges at similar distance. */
  priority?: readonly Segment[];
}

export interface MagnetResult {
  /** Translation to add (after the rotation). */
  delta: Vec2;
  /** Rotation about `pivot` (radians, CCW), applied before `delta`. */
  rotation: number;
  /** Pivot of the rotation: the point of the volume closest to the target edge. */
  pivot?: Vec2;
  /** Target edges that were snapped to (drawn as guides). */
  guides: Segment[];
  kind: 'none' | 'corner' | 'flush' | 'flush2' | 'aligned' | 'onEdge';
}

const NONE: MagnetResult = { delta: [0, 0], rotation: 0, guides: [], kind: 'none' };

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (s: Segment): Vec2 => {
  const d = sub(s[1], s[0]);
  const l = len(d);
  return l < 1e-12 ? [1, 0] : [d[0] / l, d[1] / l];
};

/** Smallest distance between two segments (they do not cross in practice). */
export function segmentDistance(a: Segment, b: Segment): number {
  return Math.min(
    dist(a[0], closestOnSegment(a[0], b[0], b[1])),
    dist(a[1], closestOnSegment(a[1], b[0], b[1])),
    dist(b[0], closestOnSegment(b[0], a[0], a[1])),
    dist(b[1], closestOnSegment(b[1], a[0], a[1])),
  );
}

/** Point of segment m that is closest to segment t. */
function contactPoint(m: Segment, t: Segment): Vec2 {
  let best: Vec2 = m[0];
  let bd = Infinity;
  for (const p of [m[0], m[1]]) {
    const d = dist(p, closestOnSegment(p, t[0], t[1]));
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  for (const p of [t[0], t[1]]) {
    const q = closestOnSegment(p, m[0], m[1]);
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Overlap length of the projections of a and b on the direction u. */
function overlapAlong(a: Segment, b: Segment, u: Vec2): number {
  const a0 = dot(a[0], u);
  const a1 = dot(a[1], u);
  const b0 = dot(b[0], u);
  const b1 = dot(b[1], u);
  return (
    Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1))
  );
}

export function rotatePolygons(polys: readonly Polygon[], pivot: Vec2, angle: number): Polygon[] {
  if (Math.abs(angle) < 1e-12) return [...polys];
  const r = (p: Vec2): Vec2 => {
    const q = rotatePoint(sub(p, pivot), angle);
    return [q[0] + pivot[0], q[1] + pivot[1]];
  };
  return polys.map((p) => ({
    outer: p.outer.map(r),
    ...(p.holes ? { holes: p.holes.map((h) => h.map(r)) } : {}),
  }));
}

const MIN_EDGE = 0.5;

interface Flush {
  /** Correction along `n` (signed). */
  c: number;
  n: Vec2;
  /** Direction of the façade (free direction after the flush). */
  u: Vec2;
  target: Segment;
  moving: Segment;
  overlap: boolean;
}

/** Parallel edge pairs within `tol` (signed normal correction). */
function flushCandidates(moving: Segment[], targets: Segment[], tol: number): Flush[] {
  const out: Flush[] = [];
  for (const m of moving) {
    if (dist(m[0], m[1]) < MIN_EDGE) continue;
    const um = unit(m);
    for (const t of targets) {
      if (dist(t[0], t[1]) < MIN_EDGE) continue;
      const ut = unit(t);
      if (Math.abs(cross(um, ut)) > 0.0035) continue; // ≈ 0.2°
      const n: Vec2 = [-ut[1], ut[0]];
      const mid: Vec2 = [(m[0][0] + m[1][0]) / 2, (m[0][1] + m[1][1]) / 2];
      const c = dot(sub(t[0], mid), n);
      if (Math.abs(c) > tol) continue;
      const ov = overlapAlong(m, t, ut);
      // collinear but apart: only a weak "in line" alignment
      if (ov < -tol * 8) continue;
      out.push({ c, n, u: ut, target: t, moving: m, overlap: ov > 1e-6 });
    }
  }
  return out;
}

/**
 * Smallest move that puts a corner of the moved outline on a target edge, or a target corner on
 * a moved edge (perpendicular to that edge).
 */
function pointOnEdge(
  moving: readonly Segment[],
  targets: readonly Segment[],
  tol: number,
): { d: Vec2; g: Segment } | null {
  let best: { d: Vec2; g: Segment } | null = null;
  let bd = tol;
  for (const t of targets)
    for (const m of moving) {
      const v = m[0];
      const q = closestOnSegment(v, t[0], t[1]);
      const dv = dist(v, q);
      if (dv < bd) {
        bd = dv;
        best = { d: sub(q, v), g: t };
      }
      for (const w of [t[0], t[1]]) {
        const p = closestOnSegment(w, m[0], m[1]);
        const dw = dist(w, p);
        if (dw < bd) {
          bd = dw;
          best = { d: sub(w, p), g: t };
        }
      }
    }
  return best;
}

/**
 * Magnetic correction of volumes whose outlines (already at the proposed position) are `polys`.
 */
export function magnetSnap(
  polys: readonly Polygon[],
  targets: readonly Segment[],
  o: MagnetOptions,
): MagnetResult {
  if (!polys.length || !targets.length || !(o.tol > 0)) return NONE;
  const tol = o.tol;
  const tgt = targets.filter((t) => dist(t[0], t[1]) >= MIN_EDGE);
  const prio = new Set(o.priority ?? []);
  const weight = (t: Segment) => (prio.has(t) ? 0.5 : 1);
  let moving = polys.flatMap(polygonEdges);

  // 1) rotation
  let rotation = 0;
  let rotTarget: Segment | null = null;
  let pivot: Vec2 | undefined;
  if (o.rotate && o.pivot) {
    const maxA = ((o.maxAngleDeg ?? 25) * Math.PI) / 180;
    const smallA = (6 * Math.PI) / 180;
    let best = Infinity;
    for (const m of moving) {
      if (dist(m[0], m[1]) < 2) continue;
      const am = Math.atan2(m[1][1] - m[0][1], m[1][0] - m[0][0]);
      for (const t of tgt) {
        if (dist(t[0], t[1]) < 2) continue;
        const d = segmentDistance(m, t);
        if (d > tol * 2) continue;
        const at = Math.atan2(t[1][1] - t[0][1], t[1][0] - t[0][0]);
        // parallel in either direction
        let da = at - am;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (da > Math.PI / 2) da -= Math.PI;
        if (da < -Math.PI / 2) da += Math.PI;
        if (Math.abs(da) < 1e-6 || Math.abs(da) > maxA) continue;
        if (Math.abs(da) > smallA && d > tol) continue;
        const score = (d + Math.abs(da) * 10) * weight(t);
        if (score < best) {
          best = score;
          rotation = da;
          rotTarget = t;
          pivot = contactPoint(m, t);
        }
      }
    }
    if (rotation && pivot) moving = rotatePolygons(polys, pivot, rotation).flatMap(polygonEdges);
  }

  // 2) corner on corner
  const tVerts: Vec2[] = [];
  for (const t of tgt) tVerts.push(t[0], t[1]);
  let corner: { d: Vec2; g: Segment[] } | null = null;
  let bc = tol * 0.75;
  for (const m of moving)
    for (const v of [m[0]]) {
      for (const t of tgt)
        for (const w of [t[0], t[1]]) {
          const d = dist(v, w);
          if (d < bc) {
            bc = d;
            corner = { d: sub(w, v), g: [t] };
          }
        }
    }
  if (corner)
    return {
      delta: corner.d,
      rotation,
      ...(pivot ? { pivot } : {}),
      guides: corner.g,
      kind: 'corner',
    };

  // 3) façade flush (after a rotation the rotated façade may have moved a little further away)
  let cands = flushCandidates(moving, tgt, tol);
  if (!cands.length && rotTarget) cands = flushCandidates(moving, [rotTarget], tol * 2.5);
  if (!cands.length) {
    // 4) corner on a façade / boundary line (volumes that are not parallel to it)
    const on = pointOnEdge(moving, tgt, tol);
    if (on)
      return { delta: on.d, rotation, ...(pivot ? { pivot } : {}), guides: [on.g], kind: 'onEdge' };
    return rotation && pivot ? { ...NONE, rotation, pivot } : NONE;
  }
  cands.sort(
    (a, b) =>
      Number(b.overlap) - Number(a.overlap) ||
      Math.abs(a.c) * weight(a.target) - Math.abs(b.c) * weight(b.target),
  );
  const f = cands[0]!;
  let delta: Vec2 = [f.n[0] * f.c, f.n[1] * f.c];
  const guides: Segment[] = [f.target];
  let kind: MagnetResult['kind'] = f.overlap ? 'flush' : 'aligned';

  // 4) second correction along the façade direction u
  const shifted = moving.map((m): Segment => [
    [m[0][0] + delta[0], m[0][1] + delta[1]],
    [m[1][0] + delta[0], m[1][1] + delta[1]],
  ]);
  let best2: { s: number; g: Segment } | null = null;
  let b2 = tol;
  // a) flush on a non-parallel target
  for (const g of flushCandidates(shifted, tgt, tol)) {
    const k = dot(f.u, g.n);
    if (Math.abs(k) < 0.2) continue;
    const s = g.c / k;
    if (Math.abs(s) < b2) {
      b2 = Math.abs(s);
      best2 = { s, g: g.target };
    }
  }
  // b) corner in line with the end of the snapped target (façades end flush)
  if (!best2) {
    const fm: Segment = [
      [f.moving[0][0] + delta[0], f.moving[0][1] + delta[1]],
      [f.moving[1][0] + delta[0], f.moving[1][1] + delta[1]],
    ];
    for (const v of fm)
      for (const w of f.target) {
        const s = dot(sub(w, v), f.u);
        if (Math.abs(s) < b2 * 0.75) {
          b2 = Math.abs(s);
          best2 = { s, g: f.target };
        }
      }
  }
  if (best2) {
    delta = [delta[0] + f.u[0] * best2.s, delta[1] + f.u[1] * best2.s];
    if (best2.g !== f.target) guides.push(best2.g);
    kind = 'flush2';
  }
  return { delta, rotation, ...(pivot ? { pivot } : {}), guides, kind };
}

/**
 * Magnetic offset of a single façade that moves along its outward direction `dir` (side grips):
 * flush on parallel target edges, or in line with target corners. Returns the correction along
 * `dir` and the guide, or null.
 */
export function facadeMagnet(
  facade: Segment,
  dir: Vec2,
  targets: readonly Segment[],
  tol: number,
): { offset: number; guide: Segment } | null {
  const u = unit(facade);
  let best: { offset: number; guide: Segment } | null = null;
  let bd = tol;
  const mid: Vec2 = [(facade[0][0] + facade[1][0]) / 2, (facade[0][1] + facade[1][1]) / 2];
  for (const t of targets) {
    if (dist(t[0], t[1]) < MIN_EDGE) continue;
    const ut = unit(t);
    if (Math.abs(cross(u, ut)) < 0.0035) {
      // parallel: flush
      const off = dot(sub(t[0], mid), dir);
      if (Math.abs(off) < bd) {
        bd = Math.abs(off);
        best = { offset: off, guide: t };
      }
    } else {
      // target corners in line with the façade
      for (const w of [t[0], t[1]]) {
        const off = dot(sub(w, mid), dir);
        if (Math.abs(off) < bd * 0.75) {
          bd = Math.abs(off) / 0.75;
          best = { offset: off, guide: [w, [w[0] - u[0] * 0.01, w[1] - u[1] * 0.01]] };
        }
      }
    }
  }
  return best;
}
