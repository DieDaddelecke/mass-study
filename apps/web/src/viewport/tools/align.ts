import {
  normalizePolygon,
  polygonArea,
  typologySegments,
  union,
  type Mass,
  type Polygon,
  type Project,
  type Typology,
  type Vec2,
} from '@kubatur/core';
import {
  applySideGrip,
  gripWorldDir,
  rotateAbout,
  sideSegment,
  toLocal,
  toWorldPoint,
  type SideGrip,
} from './math';
import { dist, type Segment } from './snap';

/**
 * "Aligner" (AL): pick a reference edge (any volume, context building, site boundary,
 * vegetation zone), then a façade of a volume. The façade is moved onto the reference line —
 * parallel façades of parametric volumes keep their typology (length / depth change), inclined
 * references turn the volume into a free polygon. In "volume" mode the whole volume is rotated
 * and moved instead.
 */

export interface PickableEdge {
  seg: Segment;
  z0: number;
  z1: number;
  /** Owning mass (façades that can be aligned). */
  massId?: string;
  /** Other owners (reference only). */
  kind: 'mass' | 'context' | 'site' | 'planting';
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const unit = (s: Segment): Vec2 => {
  const d = sub(s[1], s[0]);
  const l = Math.hypot(d[0], d[1]);
  return l < 1e-12 ? [1, 0] : [d[0] / l, d[1] / l];
};

export function isParallel(a: Segment, b: Segment): boolean {
  return Math.abs(cross(unit(a), unit(b))) < 0.0035;
}

function ringEdges(ring: readonly Vec2[]): Segment[] {
  return ring.map((p, i): Segment => [p, ring[(i + 1) % ring.length]!]);
}

/** Height of the above-ground part of a mass (top of the upper storeys). */
function massHeight(m: Mass): number {
  const s = m.storeys;
  return s.ground.height + s.upper.count * s.upper.height + s.parapet;
}

/** All pickable edges of the project (active variant). */
export function pickableEdges(project: Project, masses: readonly Mass[]): PickableEdge[] {
  const out: PickableEdge[] = [];
  for (const m of masses) {
    const h = massHeight(m);
    for (const seg of typologySegments(m.typology)) {
      for (const ring of [seg.local.outer, ...(seg.local.holes ?? [])])
        for (const e of ringEdges(ring))
          out.push({
            seg: [toWorldPoint(m, e[0]), toWorldPoint(m, e[1])],
            z0: 0,
            z1: h,
            massId: m.id,
            kind: 'mass',
          });
    }
  }
  for (const c of project.context) {
    if (c.hidden) continue;
    for (const e of ringEdges(c.footprint.outer))
      out.push({ seg: e, z0: c.baseHeight ?? 0, z1: c.height, kind: 'context' });
  }
  for (const e of ringEdges(project.site.boundary.outer))
    out.push({ seg: e, z0: 0, z1: 0, kind: 'site' });
  const v = project.variants.find((x) => x.id === project.activeVariantId);
  for (const z of v?.plantings ?? [])
    for (const e of ringEdges(z.polygon.outer))
      out.push({ seg: e, z0: 0, z1: 0, kind: 'planting' });
  return out.filter((e) => dist(e.seg[0], e.seg[1]) > 0.05);
}

/**
 * Edge under a view ray (origin o, direction d): walls are hit on their vertical plane, ground
 * edges (site, vegetation, …) within `tol` of the ray's ground point. Nearest hit wins.
 */
export function pickEdge(
  edges: readonly PickableEdge[],
  o: [number, number, number],
  d: [number, number, number],
  tol: number,
): PickableEdge | null {
  let best: PickableEdge | null = null;
  let bt = Infinity;
  const tg = Math.abs(d[2]) > 1e-9 ? -o[2] / d[2] : Infinity;
  const g: Vec2 | null =
    tg > 0 && Number.isFinite(tg) ? [o[0] + d[0] * tg, o[1] + d[1] * tg] : null;
  for (const e of edges) {
    const [a, b] = e.seg;
    if (e.z1 - e.z0 > 0.1) {
      const n: Vec2 = [-(b[1] - a[1]), b[0] - a[0]];
      const den = n[0] * d[0] + n[1] * d[1];
      if (Math.abs(den) > 1e-12) {
        const t = (n[0] * (a[0] - o[0]) + n[1] * (a[1] - o[1])) / den;
        if (t > 0 && t < bt) {
          const h: [number, number, number] = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
          const u = unit(e.seg);
          const s = dot(sub([h[0], h[1]], a), u);
          const pad = tol * 0.5;
          if (s >= -pad && s <= dist(a, b) + pad && h[2] >= e.z0 - pad && h[2] <= e.z1 + pad) {
            bt = t;
            best = e;
            continue;
          }
        }
      }
    }
    // ground proximity (also for walls: clicking at their foot in a plan view)
    if (g) {
      const ab = sub(b, a);
      const l2 = dot(ab, ab);
      const s = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(g, a), ab) / l2)) : 0;
      const dd = Math.hypot(a[0] + ab[0] * s - g[0], a[1] + ab[1] * s - g[1]);
      // compare on the ray: ground hits count a bit behind any wall hit
      const t = tg + dd * 2;
      if (dd <= tol && t < bt) {
        bt = t;
        best = e;
      }
    }
  }
  return best;
}

const GRIPS: SideGrip[] = [
  { axis: 'length', sign: 1 },
  { axis: 'length', sign: -1 },
  { axis: 'depth', sign: 1 },
  { axis: 'depth', sign: -1 },
];

function sameSegment(a: Segment, b: Segment, tol = 0.02): boolean {
  return (
    (dist(a[0], b[0]) < tol && dist(a[1], b[1]) < tol) ||
    (dist(a[0], b[1]) < tol && dist(a[1], b[0]) < tol)
  );
}

/** Remove vertices that lie on the straight line between their neighbours. */
export function dropCollinear(ring: readonly Vec2[]): Vec2[] {
  let pts = [...ring];
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      const l = dist(a, c);
      if (l > 1e-9 && Math.abs(cross(sub(b, a), sub(c, a))) / l < 1e-4) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Intersection of the line p + s·r with the line q + t·w (null when parallel). */
function lineHit(p: Vec2, r: Vec2, q: Vec2, w: Vec2): Vec2 | null {
  const den = cross(r, w);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(q, p), w) / den;
  return [p[0] + r[0] * s, p[1] + r[1] * s];
}

/** Move edge i of a ring onto the line (q, w): its end points slide along the adjacent edges. */
export function moveEdgeOntoLine(ring: readonly Vec2[], i: number, q: Vec2, w: Vec2): Vec2[] {
  const n = ring.length;
  const a = ring[i]!;
  const b = ring[(i + 1) % n]!;
  const prev = ring[(i - 1 + n) % n]!;
  const next = ring[(i + 2) % n]!;
  const proj = (p: Vec2): Vec2 => {
    const t = dot(sub(p, q), w) / dot(w, w);
    return [q[0] + w[0] * t, q[1] + w[1] * t];
  };
  const na = lineHit(prev, sub(a, prev), q, w) ?? proj(a);
  const nb = lineHit(next, sub(b, next), q, w) ?? proj(b);
  const out = [...ring];
  out[i] = na;
  out[(i + 1) % n] = nb;
  return out;
}

export interface AlignResult {
  position: Vec2;
  rotation: number;
  typology: Typology;
}

/** Façade of `mass` (world segment) onto the reference line. Null when not possible. */
export function alignFacade(mass: Mass, facade: Segment, ref: Segment): AlignResult | null {
  const t = mass.typology;
  // parametric volumes: the matching side, parallel reference → side grip
  for (const g of GRIPS) {
    const side = sideSegment(mass, g);
    if (!side || !sameSegment(side, facade)) continue;
    if (isParallel(side, ref)) {
      const dir = gripWorldDir(mass, g);
      const mid: Vec2 = [(side[0][0] + side[1][0]) / 2, (side[0][1] + side[1][1]) / 2];
      const delta = dot(sub(ref[0], mid), dir);
      const r = applySideGrip(mass, g, delta);
      return { position: r.position, rotation: mass.rotation, typology: r.typology };
    }
  }
  // free polygon (others are converted when they are a single outline)
  let local: Polygon;
  if (t.kind === 'freePolygon') local = t.polygon;
  else {
    // several sections become one outline (only when they form a single polygon)
    const segs = typologySegments(t);
    const merged = segs.length === 1 ? [segs[0]!.local] : union(segs.map((x) => x.local));
    if (merged.length !== 1) return null;
    local = { ...merged[0]!, outer: dropCollinear(merged[0]!.outer) };
  }
  const ring = local.outer;
  const lf: Segment = [toLocal(mass, facade[0]), toLocal(mass, facade[1])];
  const i = ring.findIndex((p, k) => sameSegment([p, ring[(k + 1) % ring.length]!], lf));
  if (i < 0) return null;
  const q = toLocal(mass, ref[0]);
  const w = sub(toLocal(mass, ref[1]), q);
  const outer = moveEdgeOntoLine(ring, i, q, w);
  const poly = normalizePolygon({ outer, ...(local.holes ? { holes: local.holes } : {}) });
  if (poly.outer.length < 3 || polygonArea(poly) < 1) return null;
  return {
    position: mass.position,
    rotation: mass.rotation,
    typology: { kind: 'freePolygon', polygon: poly },
  };
}

/** Rotate and move the whole volume so that its façade lies on the reference line. */
export function alignVolume(
  mass: Pick<Mass, 'position' | 'rotation'>,
  facade: Segment,
  ref: Segment,
): { position: Vec2; rotation: number } {
  const uf = unit(facade);
  const ur = unit(ref);
  let da = Math.atan2(cross(uf, ur), dot(uf, ur));
  if (da > Math.PI / 2) da -= Math.PI;
  if (da < -Math.PI / 2) da += Math.PI;
  const mid: Vec2 = [(facade[0][0] + facade[1][0]) / 2, (facade[0][1] + facade[1][1]) / 2];
  const r = rotateAbout(mass, mid, da);
  const n: Vec2 = [-ur[1], ur[0]];
  const c = dot(sub(ref[0], mid), n);
  return { position: [r.position[0] + n[0] * c, r.position[1] + n[1] * c], rotation: r.rotation };
}
