/**
 * Site boundaries (limites de la parcelle): which edge of the site borders a neighbouring parcel
 * (limite séparative) and which borders a street, path or other public space (alignement /
 * domaine public).
 *
 * France: streets and public spaces are not cadastral parcels, so the cadastre has a gap in front
 * of them. An edge is classified by looking just outside it: inside another cadastral parcel →
 * neighbour; in the gap → public space, refined to street or path with the nearest road centre
 * line (IGN BD TOPO / OSM). The user can override every edge.
 *
 * Façades that face a neighbour boundary closer than the "vue" distance (PLU: vues droites,
 * L ≥ H/2, min. 8 m by default) get no windows and no balconies in the dwelling layout, since the
 * neighbour may build up to the boundary.
 *
 * Pure and deterministic; world (project-local) coordinates.
 */
import { intersection, pointInPolygon, polygonArea } from './geometry.js';
import type {
  BoundaryKind,
  BoundaryRules,
  ContextRoadKind,
  Polygon,
  Settings,
  Site,
  Surroundings,
  Vec2,
} from './types.js';

type Seg = [Vec2, Vec2];

export const BOUNDARY_KINDS: readonly BoundaryKind[] = [
  'road',
  'path',
  'public',
  'neighbour',
  'unknown',
];

export const DEFAULT_BOUNDARY_RULES: BoundaryRules = {
  enabled: true,
  vueMin: 8,
  vueRatio: 0.5,
};

export function resolveBoundaryRules(settings: Pick<Settings, 'boundaryRules'>): BoundaryRules {
  return { ...DEFAULT_BOUNDARY_RULES, ...(settings.boundaryRules ?? {}) };
}

/** One classified piece of the site boundary. */
export interface BoundarySegment {
  a: Vec2;
  b: Vec2;
  /** Effective kind (user override, else automatic). */
  kind: BoundaryKind;
  /** Automatic classification. */
  auto: BoundaryKind;
  /** The user changed the kind of this edge. */
  overridden: boolean;
  /** Index of the edge of the site boundary's outer ring. */
  edge: number;
  /** Stable key of that edge (for overrides, see Site.edgeKinds). */
  key: string;
  /** Name of the street, when known. */
  name?: string;
}

/** Stable key of a boundary edge: its end points rounded to 10 cm. */
export function boundaryEdgeKey(a: Vec2, b: Vec2): string {
  const r = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
  return `${r(a[0])},${r(a[1])};${r(b[0])},${r(b[1])}`;
}

const PATH_KINDS: ReadonlySet<ContextRoadKind> = new Set(['footway', 'path', 'cycleway', 'track']);
const NO_ACCESS_KINDS: ReadonlySet<ContextRoadKind> = new Set(['rail', 'tram', 'motorway']);

/** Distance from a public-space sample to a road edge that still makes it "the street", m. */
const ROAD_REACH = 12;
/** Probe distances outside the boundary, m. */
const PROBES = [0.8, 2.5];
/** Sampling step along an edge, m. */
const STEP = 1;
/** Runs shorter than this merge into their neighbour, m. */
const MIN_RUN = 2;

interface Sample {
  kind: BoundaryKind;
  name?: string;
}

const memo = new WeakMap<Site, WeakMap<object, BoundarySegment[]>>();
const NO_SURROUNDINGS = {};

/**
 * Classified site boundary (outer ring of `site.boundary`), with the user's overrides applied.
 * Memoized per site / surroundings object.
 */
export function siteBoundaries(site: Site, surroundings?: Surroundings): BoundarySegment[] {
  const key: object = surroundings ?? NO_SURROUNDINGS;
  let m = memo.get(site);
  const hit = m?.get(key);
  if (hit) return hit;
  const out = classifyBoundary(site, surroundings);
  if (!m) memo.set(site, (m = new WeakMap()));
  m.set(key, out);
  return out;
}

export function classifyBoundary(site: Site, surroundings?: Surroundings): BoundarySegment[] {
  const ring = site.boundary.outer;
  if (ring.length < 3) return [];
  const boundary = site.boundary;
  const siteRefs = new Set(site.parcels.map((p) => p.ref).filter((r): r is string => !!r));
  const siteArea = polygonArea(boundary);
  // neighbouring parcels: everything but the site's own parcels (by reference or by overlap)
  const neighbours = (surroundings?.parcels ?? []).filter((p) => {
    if (p.ref && siteRefs.has(p.ref)) return false;
    const a = polygonArea(p.polygon);
    if (a < 1) return false;
    const ov = intersection([boundary], [p.polygon]).reduce((s, q) => s + polygonArea(q), 0);
    return ov < 0.5 * Math.min(a, siteArea);
  });
  const roads = (surroundings?.roads ?? []).filter((r) => r.level >= 0);
  const known = neighbours.length > 0 || (surroundings?.parcels.length ?? 0) > 0;

  const parcelAt = (q: Vec2) => neighbours.findIndex((x) => pointInPolygon(q, x.polygon));
  const sample = (p: Vec2, n: Vec2): Sample => {
    if (!known) return { kind: 'unknown' };
    const probes = PROBES.map((d) => [p[0] + n[0] * d, p[1] + n[1] * d] as Vec2).filter(
      (q) => !pointInPolygon(q, boundary),
    );
    const inParcel = probes.map(parcelAt);
    // streets within reach; a street counts when its nearest point lies in the cadastre gap
    // (domaine public) or in the very parcel just outside the edge (road parcel, e.g. in a ZAC)
    let road: { d: number; name?: string } | undefined;
    let path: { d: number; name?: string } | undefined;
    let named: { d: number; name?: string } | undefined;
    for (const r of roads) {
      if (NO_ACCESS_KINDS.has(r.kind)) continue;
      for (let i = 0; i + 1 < r.centerline.length; i++) {
        const c = closestOnSegment(p, r.centerline[i]!, r.centerline[i + 1]!);
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]) - r.width / 2;
        if (d >= ROAD_REACH) continue;
        if (pointInPolygon(c, boundary)) continue;
        const at = parcelAt(c);
        if (at >= 0 && !inParcel.includes(at)) continue;
        const hit = { d, ...(r.name ? { name: r.name } : {}) };
        if (PATH_KINDS.has(r.kind)) {
          if (!path || d < path.d) path = hit;
        } else {
          if (!road || d < road.d) road = hit;
          if (r.name && (!named || d < named.d)) named = hit;
        }
      }
    }
    const nameOf = (x?: { name?: string }) => (x?.name ? { name: x.name } : {});
    if (road) return { kind: 'road', ...nameOf(road.name ? road : named) };
    if (path) return { kind: 'path', ...nameOf(path) };
    if (inParcel.length && inParcel.every((x) => x >= 0)) return { kind: 'neighbour' };
    return { kind: 'public' };
  };

  const out: BoundarySegment[] = [];
  const overrides = site.edgeKinds ?? {};
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n: Vec2 = [u[1], -u[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pointInPolygon([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05], boundary)) n = [-n[0], -n[1]];
    const count = Math.max(2, Math.ceil(len / STEP));
    const samples: Sample[] = [];
    for (let k = 0; k < count; k++) {
      const t = ((k + 0.5) / count) * len;
      samples.push(sample([a[0] + u[0] * t, a[1] + u[1] * t], n));
    }
    // runs of equal kind; short runs merge into the longer neighbour
    let runs: { from: number; to: number; s: Sample }[] = [];
    for (let k = 0; k < count; k++) {
      const last = runs[runs.length - 1];
      if (last && last.s.kind === samples[k]!.kind) last.to = k + 1;
      else runs.push({ from: k, to: k + 1, s: samples[k]! });
    }
    const minSamples = Math.max(1, Math.round(MIN_RUN / (len / count)));
    let changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (let r = 0; r < runs.length; r++) {
        const run = runs[r]!;
        if (run.to - run.from >= minSamples) continue;
        const prev = runs[r - 1];
        const next = runs[r + 1];
        const into = prev && (!next || prev.to - prev.from >= next.to - next.from) ? prev : next!;
        into.from = Math.min(into.from, run.from);
        into.to = Math.max(into.to, run.to);
        runs.splice(r, 1);
        changed = true;
        break;
      }
      // merge neighbours of equal kind
      runs = runs.reduce<typeof runs>((acc, x) => {
        const l = acc[acc.length - 1];
        if (l && l.s.kind === x.s.kind) l.to = x.to;
        else acc.push(x);
        return acc;
      }, []);
    }
    const key = boundaryEdgeKey(a, b);
    const ov = overrides[key];
    const at = (k: number): Vec2 => {
      const t = (k / count) * len;
      return k >= count ? b : [a[0] + u[0] * t, a[1] + u[1] * t];
    };
    if (ov) {
      out.push({
        a,
        b,
        kind: ov,
        auto: dominant(runs),
        overridden: true,
        edge: i,
        key,
      });
      continue;
    }
    for (const run of runs) {
      const names = new Map<string, number>();
      for (const x of samples.slice(run.from, run.to))
        if (x.name) names.set(x.name, (names.get(x.name) ?? 0) + 1);
      const name = [...names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      out.push({
        a: at(run.from),
        b: at(run.to),
        kind: run.s.kind,
        auto: run.s.kind,
        overridden: false,
        edge: i,
        key,
        ...(name ? { name } : {}),
      });
    }
  }
  return out;
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

function dominant(runs: { from: number; to: number; s: Sample }[]): BoundaryKind {
  const len = new Map<BoundaryKind, number>();
  for (const r of runs) len.set(r.s.kind, (len.get(r.s.kind) ?? 0) + r.to - r.from);
  return [...len.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Façades facing a neighbour boundary
// ---------------------------------------------------------------------------

/** Boundary conditions the dwelling layout needs. */
export interface SiteEdges {
  /** Boundary pieces towards neighbouring parcels (limites séparatives). */
  party: Seg[];
}

/** The neighbour boundaries of a site, for the layout (undefined when there are none). */
export function siteEdges(site: Site, surroundings?: Surroundings): SiteEdges | undefined {
  const party = siteBoundaries(site, surroundings)
    .filter((s) => s.kind === 'neighbour')
    .map((s) => [s.a, s.b] as Seg);
  return party.length ? { party } : undefined;
}

/** Minimum distance between a façade with windows and a neighbour boundary, m. */
export function vueDistance(rules: BoundaryRules, height: number): number {
  return Math.max(rules.vueMin, rules.vueRatio * height);
}

/** Sampling step along façades, m. */
const FACADE_STEP = 0.25;

/**
 * Parts of the façade segments (edges of `outline`) whose windows would look straight onto a
 * neighbour boundary closer than `distance` (vues droites): a ray from the façade along its
 * outward normal hits a party segment within the distance.
 */
export function blindFacades(
  facade: readonly Seg[],
  outline: readonly Polygon[],
  party: readonly Seg[],
  distance: number,
): Seg[] {
  if (!party.length || distance <= 0) return [];
  const inside = (p: Vec2) => outline.some((o) => pointInPolygon(p, o));
  const out: Seg[] = [];
  for (const [a, b] of facade) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n: Vec2 = [u[1], -u[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (inside([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05])) n = [-n[0], -n[1]];
    const count = Math.max(1, Math.ceil(len / FACADE_STEP));
    let start = -1;
    const flush = (k: number) => {
      if (start < 0) return;
      const t0 = (start / count) * len;
      const t1 = (k / count) * len;
      out.push([
        [a[0] + u[0] * t0, a[1] + u[1] * t0],
        k >= count ? b : [a[0] + u[0] * t1, a[1] + u[1] * t1],
      ]);
      start = -1;
    };
    for (let k = 0; k < count; k++) {
      const t = ((k + 0.5) / count) * len;
      const p: Vec2 = [a[0] + u[0] * t, a[1] + u[1] * t];
      const hit = party.some((s) => rayHit(p, n, s, distance));
      if (hit && start < 0) start = k;
      if (!hit) flush(k);
    }
    flush(count);
  }
  return out;
}

/** Ray p + t·n (t ∈ [-0.05, max]) hits segment s. */
function rayHit(p: Vec2, n: Vec2, [c, d]: Seg, max: number): boolean {
  const ex = d[0] - c[0];
  const ey = d[1] - c[1];
  const den = n[0] * ey - n[1] * ex;
  if (Math.abs(den) < 1e-9) return false; // parallel: the façade is perpendicular to the boundary
  const wx = c[0] - p[0];
  const wy = c[1] - p[1];
  const t = (wx * ey - wy * ex) / den;
  const s = (wx * n[1] - wy * n[0]) / den;
  return t >= -0.05 && t <= max && s >= -1e-6 && s <= 1 + 1e-6;
}

/** Segments minus the pieces of `cut` lying on them (collinear, within `tol`). */
export function subtractSegments(segs: readonly Seg[], cut: readonly Seg[], tol = 0.02): Seg[] {
  if (!cut.length) return [...segs];
  const out: Seg[] = [];
  for (const [p, q] of segs) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    const ux = (q[0] - p[0]) / len;
    const uy = (q[1] - p[1]) / len;
    const off = (x: Vec2) => Math.abs((x[0] - p[0]) * uy - (x[1] - p[1]) * ux);
    const t = (x: Vec2) => (x[0] - p[0]) * ux + (x[1] - p[1]) * uy;
    const iv: [number, number][] = [];
    for (const [r, s] of cut) {
      if (off(r) > tol || off(s) > tol) continue;
      const a = Math.max(0, Math.min(t(r), t(s)));
      const b = Math.min(len, Math.max(t(r), t(s)));
      if (b > a + 1e-6) iv.push([a, b]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let cur = 0;
    const at = (v: number): Vec2 => (v >= len ? q : [p[0] + ux * v, p[1] + uy * v]);
    for (const [a, b] of iv) {
      if (a > cur + 1e-3) out.push([at(cur), at(a)]);
      cur = Math.max(cur, b);
    }
    if (cur < len - 1e-3) out.push([at(cur), q]);
  }
  return out;
}
