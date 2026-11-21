import { massFootprints, type Polygon, type Project, type Vec2 } from '@kubatur/core';
import type { SnapSettings } from '../../store/tools';

export type SnapKind = 'endpoint' | 'midpoint' | 'edge' | 'angle' | 'grid' | 'none';

export type Segment = [Vec2, Vec2];

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** Reference geometry: the edge snapped to, or the site edge an angle snap is parallel / perpendicular to. */
  ref?: Segment;
}

export interface SnapGeometry {
  /** Edges of all snappable outlines (masses, context, site). */
  edges: Segment[];
  /** Site boundary edges (reference directions for parallel / perpendicular). */
  siteEdges: Segment[];
  /** Additional snap points (e.g. the points of the shape being drawn). */
  points?: Vec2[];
}

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function ringEdges(ring: readonly Vec2[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < ring.length; i++) out.push([ring[i]!, ring[(i + 1) % ring.length]!]);
  return ring.length >= 2 ? out : [];
}

export function polygonEdges(p: Polygon): Segment[] {
  return [ringEdges(p.outer), ...(p.holes ?? []).map(ringEdges)].flat();
}

/** Collect snap geometry from a project; masses in `exclude` are ignored. */
export function collectSnapGeometry(
  project: Project,
  masses: Project['variants'][number]['masses'],
  exclude: readonly string[] = [],
): SnapGeometry {
  const siteEdges = polygonEdges(project.site.boundary);
  const edges: Segment[] = [...siteEdges];
  for (const m of masses) {
    if (exclude.includes(m.id)) continue;
    for (const f of massFootprints(m)) edges.push(...polygonEdges(f));
  }
  for (const c of project.context) if (!c.hidden) edges.push(...polygonEdges(c.footprint));
  return { edges, siteEdges };
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return [a[0] + t * dx, a[1] + t * dy];
}

function nearest(raw: Vec2, cands: Iterable<[Vec2, Segment?]>, tol: number) {
  let best: [Vec2, Segment?] | null = null;
  let bd = tol;
  for (const c of cands) {
    const d = dist(raw, c[0]);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Snap a direction from `prev` towards `raw` to angle steps or site edge directions. */
export function snapAngle(
  raw: Vec2,
  prev: Vec2,
  stepDeg: number,
  tol: number,
  siteEdges: readonly Segment[] = [],
): SnapResult | null {
  const len = dist(prev, raw);
  if (len < 1e-9) return null;
  const cur = Math.atan2(raw[1] - prev[1], raw[0] - prev[0]);
  const dirs: { a: number; ref?: Segment }[] = [];
  const step = (Math.max(1, stepDeg) * Math.PI) / 180;
  dirs.push({ a: Math.round(cur / step) * step });
  for (const e of siteEdges) {
    const ea = Math.atan2(e[1][1] - e[0][1], e[1][0] - e[0][0]);
    for (const off of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const a = ea + off;
      // the closest equivalent of `a` to `cur`
      const k = Math.round((cur - a) / (2 * Math.PI));
      dirs.push({ a: a + k * 2 * Math.PI, ref: e });
    }
  }
  let best: SnapResult | null = null;
  let bd = tol;
  for (const d of dirs) {
    const ux = Math.cos(d.a);
    const uy = Math.sin(d.a);
    const t = (raw[0] - prev[0]) * ux + (raw[1] - prev[1]) * uy;
    if (t <= 0) continue;
    const p: Vec2 = [prev[0] + t * ux, prev[1] + t * uy];
    const dd = dist(p, raw);
    // prefer site-referenced directions on ties
    if (dd < bd - 1e-9 || (best && !best.ref && d.ref && Math.abs(dd - bd) < 1e-9)) {
      bd = dd;
      best = d.ref ? { point: p, kind: 'angle', ref: d.ref } : { point: p, kind: 'angle' };
    }
  }
  return best;
}

export function snapGrid(raw: Vec2, size: number): Vec2 {
  if (size <= 0) return raw;
  return [Math.round(raw[0] / size) * size, Math.round(raw[1] / size) * size];
}

/**
 * Snap a raw model point. Priority: endpoint > midpoint > edge > angle > grid.
 * `tol` is the tolerance in model units (m), typically ~10 px converted via the camera.
 */
export function snapPoint(
  raw: Vec2,
  geom: SnapGeometry,
  s: SnapSettings,
  tol: number,
  prev?: Vec2 | null,
): SnapResult {
  if (!s.enabled) return { point: raw, kind: 'none' };
  if (s.endpoints) {
    const pts: [Vec2, Segment?][] = (geom.points ?? []).map((p) => [p]);
    for (const e of geom.edges) pts.push([e[0], e], [e[1], e]);
    const b = nearest(raw, pts, tol);
    if (b) return { point: b[0], kind: 'endpoint', ...(b[1] ? { ref: b[1] } : {}) };
  }
  if (s.midpoints) {
    const b = nearest(
      raw,
      geom.edges.map((e): [Vec2, Segment] => [
        [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2],
        e,
      ]),
      tol,
    );
    if (b) return { point: b[0], kind: 'midpoint', ref: b[1]! };
  }
  if (s.edges) {
    const b = nearest(
      raw,
      geom.edges.map((e): [Vec2, Segment] => [closestOnSegment(raw, e[0], e[1]), e]),
      tol,
    );
    if (b) return { point: b[0], kind: 'edge', ref: b[1]! };
  }
  if (s.angle && prev) {
    const a = snapAngle(raw, prev, s.angleStep, tol, geom.siteEdges);
    if (a) return a;
  }
  if (s.grid) {
    const g = snapGrid(raw, s.gridSize);
    if (dist(g, raw) <= tol) return { point: g, kind: 'grid' };
  }
  return { point: raw, kind: 'none' };
}
