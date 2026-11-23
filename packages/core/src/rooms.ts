/**
 * Schematic rooms of a dwelling for the floor plan and the granulometry view, following the
 * office floor-plan guide (docs/GRUNDRISS_REGELN.md):
 *
 * - The façade rooms form one chain along the façade: séjour (day zone, near the entrance)
 *   → separate kitchen (optional) → chambre PMR → further chambres (night zone). The séjour sits
 *   at one end of the chain: in the corner when the dwelling has one, then by orientation
 *   (S > W > E > N), near the entrance, above the séjour of the storey below and next to the
 *   séjour of the neighbour (mirrored dwellings).
 * - Behind the chambre PMR, at the junction with the day zone, the wet core: one shaft
 *   (gaine, 60 × 60 cm) with the bathroom (SDB) next to the PMR bedroom, WC and shower room
 *   (SDE) further on. The kitchen of the séjour uses the same shaft.
 * - The rest is the entrance hall / passage (dégagement).
 *
 * Pure and deterministic; world coordinates.
 */
import {
  difference,
  intersection,
  union,
  normalizePolygon,
  overlapArea,
  pointInPolygon,
  polygonArea,
  polygonDistance,
  ringBBox,
  ringCentroid,
} from './geometry.js';
import { facadeOf, fullRules } from './unitRules.js';
import type { FacadeSide, Polygon, UnitRules, Vec2 } from './types.js';

/** Façade rooms of the chain. */
export type FacadeRoomKind = 'sejour' | 'cuisine' | 'chambrePmr' | 'chambre';
/** Wet rooms of the wet core. */
export type WetKind = 'sdb' | 'sde' | 'wc';
export type RoomKind = FacadeRoomKind | WetKind | 'gaine' | 'degagement';

/** Main rooms (pièces principales): séjour and chambres. */
export const MAIN_ROOM_KINDS: readonly RoomKind[] = ['sejour', 'chambrePmr', 'chambre'];
/** Rooms on the façade (with a façade requirement). */
export const FACADE_ROOM_KINDS: readonly RoomKind[] = [
  'sejour',
  'cuisine',
  'chambrePmr',
  'chambre',
];
/** Night rooms (bedrooms). */
const NIGHT: readonly RoomKind[] = ['chambrePmr', 'chambre'];

export interface LayoutRoom {
  kind: RoomKind;
  polygon: Polygon;
  area: number;
  /** Façade length of the room, m. */
  facade: number;
  /** Minimum façade length of the room (office rules), m; 0 for interior rooms. */
  facadeRequired: number;
  facadeOk: boolean;
  /** Minimum area of the room (office rules), m²; 0 when none. */
  areaRequired: number;
  areaOk: boolean;
  /** Bedroom facing the access gallery (allowed only when nothing else fits; flagged). */
  onGallery?: boolean;
}

export interface ProgramRoom {
  kind: FacadeRoomKind;
  min: number;
}

export interface UnitRoomOptions {
  /** Preference of a façade piece for the séjour (higher first), e.g. where a balcony goes. */
  preferSejour?: (seg: Seg) => number;
  /** Exterior façade segments (outline of the storey); other façade pieces are gallery. */
  exterior?: readonly Seg[];
  /** Access of the dwelling (landing, gallery, corridor, core): the entrance side. */
  access?: readonly Polygon[];
  /** Séjours of the storey below: séjours stack (coherent façade). */
  below?: readonly Polygon[];
  /** Rooms of the neighbour dwellings already laid out on this storey (mirroring). */
  neighbours?: readonly LayoutRoom[];
  /** Wet rooms; default from the number of main rooms (none for an explicit program). */
  wet?: readonly WetKind[];
  /** Number of main rooms (for the separate kitchen, from T3), default from the program. */
  mainRooms?: number;
}

type Seg = [Vec2, Vec2];

interface Run {
  o: Vec2;
  u: Vec2;
  n: Vec2;
  length: number;
  /** Depth of the dwelling behind this façade piece, m. */
  depth: number;
  /** Position along the outline of the dwelling (sorts the pieces around it). */
  key: number;
  exterior: boolean;
  side: FacadeSide;
  /** An exterior façade piece on the opposite side (through dwelling). */
  opposite: boolean;
  /** Façade pieces (exterior or gallery) on the opposite side of the dwelling. */
  facing: number[];
  pref: number;
}

/** Preferred façade widths (grown up to these when the façade allows), m. */
const PREFERRED: Record<FacadeRoomKind, number> = {
  sejour: 4.6,
  cuisine: 2.4,
  chambrePmr: 3.2,
  chambre: 2.9,
};
/** Widest séjour before the rest of a façade piece goes to the other rooms, m. */
const SEJOUR_MAX = 7;
/** Room depths: share of the dwelling depth, minimum, maximum, m. */
const DEPTH: Record<FacadeRoomKind, [number, number, number]> = {
  sejour: [0.6, 3.6, 7.5],
  cuisine: [0, 2.6, 4],
  chambrePmr: [0.5, 3.2, 4.6],
  chambre: [0.5, 3.0, 4.4],
};
/** Widest room along the façade (the séjour: SEJOUR_MAX), m. */
const MAX_WIDTH: Record<FacadeRoomKind, number> = {
  sejour: 7,
  cuisine: 3.2,
  chambrePmr: 4.4,
  chambre: 4.2,
};
/** Longest room depth as a multiple of its width (no long, narrow rooms). */
const RATIO: Record<FacadeRoomKind, number> = {
  sejour: 1.6,
  cuisine: 1.8,
  chambrePmr: 1.6,
  chambre: 1.6,
};
/** A through séjour (façade on both sides) when the dwelling is at most this deep, m. */
const THROUGH_MAX = 10.5;
/** Width of the wet rooms along the façade direction, m (depth from the minimum area). */
const WET_WIDTH: Record<WetKind, number> = { sdb: 2.4, wc: 1.5, sde: 2.0 };
/** Inner zone kept between rooms on opposite façades (wet core, passage), m. */
const INNER = 2.2;
/** Façade pieces shorter than this are not used for rooms, m. */
const MIN_RUN = 1.2;
const ORIENT: Record<FacadeSide, number> = { S: 4, W: 3, E: 2, N: 1 };

/** Requested façade rooms of a dwelling with `rooms` main rooms (T1 = 1 … T5 = 5). */
export function roomProgram(rooms: number, rules: UnitRules): ProgramRoom[] {
  const out: ProgramRoom[] = [{ kind: 'sejour', min: rules.livingMinFacade }];
  if (rooms >= 2) out.push({ kind: 'chambrePmr', min: rules.pmrBedroomMinFacade });
  for (let i = 2; i < rooms; i++) out.push({ kind: 'chambre', min: rules.bedroomMinFacade });
  return out;
}

/** Wet rooms of a dwelling: T1/T2 SDB (with WC), T3 + WC, T4/T5 + SDE. */
export function wetProgram(rooms: number): WetKind[] {
  if (rooms >= 4) return ['sdb', 'wc', 'sde'];
  if (rooms >= 3) return ['sdb', 'wc'];
  return ['sdb'];
}

/**
 * Rooms of one level of a duplex: the entrance level (jour) holds the séjour and the PMR
 * bedroom (accessible from the entrance), the other level (nuit) the further bedrooms.
 */
export function duplexProgram(
  rooms: number,
  level: 'jour' | 'nuit',
  rules: UnitRules,
): ProgramRoom[] {
  const all = roomProgram(rooms, rules);
  return level === 'jour' ? all.slice(0, 2) : all.slice(2);
}

/** Wet rooms of a duplex level: SDB (+ WC from T3) on the jour level, an SDE on the nuit level. */
export function duplexWet(rooms: number, level: 'jour' | 'nuit'): WetKind[] {
  if (level === 'nuit') return ['sde'];
  return rooms >= 3 ? ['sdb', 'wc'] : ['sdb'];
}

const sideOf = (n: Vec2): FacadeSide => {
  // n points into the dwelling; the façade faces -n (y = north)
  const x = -n[0];
  const y = -n[1];
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 'N' : 'S';
  return x > 0 ? 'E' : 'W';
};

function segOverlap([p, q]: Seg, [r, s]: Seg, tol = 0.03): number {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (len < 1e-9) return 0;
  const ux = (q[0] - p[0]) / len;
  const uy = (q[1] - p[1]) / len;
  const off = (x: Vec2) => Math.abs((x[0] - p[0]) * uy - (x[1] - p[1]) * ux);
  if (off(r) > tol || off(s) > tol) return 0;
  const tr = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy;
  const ts = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy;
  return Math.max(0, Math.min(len, Math.max(tr, ts)) - Math.max(0, Math.min(tr, ts)));
}

function makeRun(unit: Polygon, [a, b]: Seg): Run | undefined {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < MIN_RUN) return undefined;
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let n: Vec2 = [-u[1], u[0]];
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const probe = (s: number): Vec2 => [mid[0] + n[0] * 0.05 * s, mid[1] + n[1] * 0.05 * s];
  if (!pointInPolygon(probe(1), unit)) {
    if (!pointInPolygon(probe(-1), unit)) return undefined;
    n = [-n[0], -n[1]];
  }
  // depth: extent of the dwelling along n within the strip of this façade piece
  let depth = 0;
  for (const r of [unit.outer, ...(unit.holes ?? [])])
    for (const p of r) {
      const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1];
      if (t < -0.05 || t > len + 0.05) continue;
      depth = Math.max(depth, (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]);
    }
  // position along the outer ring
  let key = 1e6;
  const ring = unit.outer;
  for (let i = 0; i < ring.length; i++) {
    const e: Seg = [ring[i]!, ring[(i + 1) % ring.length]!];
    if (segOverlap(e, [a, b]) < len * 0.5) continue;
    const el = Math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]) || 1;
    const t0 =
      ((a[0] - e[0][0]) * (e[1][0] - e[0][0]) + (a[1] - e[0][1]) * (e[1][1] - e[0][1])) / el;
    const t1 =
      ((b[0] - e[0][0]) * (e[1][0] - e[0][0]) + (b[1] - e[0][1]) * (e[1][1] - e[0][1])) / el;
    key = i + Math.min(t0, t1) / el;
    break;
  }
  return {
    o: a,
    u,
    n,
    length: len,
    depth,
    key,
    exterior: true,
    side: sideOf(n),
    opposite: false,
    facing: [],
    pref: 0,
  };
}

const at = (r: Run, s: number, t: number): Vec2 => [
  r.o[0] + r.u[0] * s + r.n[0] * t,
  r.o[1] + r.u[1] * s + r.n[1] * t,
];
const box = (r: Run, s0: number, s1: number, t0: number, t1: number): Polygon =>
  normalizePolygon({ outer: [at(r, s0, t0), at(r, s1, t0), at(r, s1, t1), at(r, s0, t1)] });

/** True when two rooms on facing façade pieces overlap along the façade direction. */
function overlapS(r: Run, p: { s0: number; s1: number }, q: Run, x: { s0: number; s1: number }) {
  const proj = (run: Run, s: number) => {
    const w = at(run, s, 0);
    return (w[0] - r.o[0]) * r.u[0] + (w[1] - r.o[1]) * r.u[1];
  };
  const a0 = Math.min(proj(q, x.s0), proj(q, x.s1));
  const a1 = Math.max(proj(q, x.s0), proj(q, x.s1));
  return Math.min(p.s1, a1) - Math.max(p.s0, a0) > 0.3;
}

/** Blocked intervals [s0, s1] of the strip along a façade piece. */
function blockedOn(run: Run, taken: readonly Polygon[]): [number, number][] {
  if (!taken.length) return [];
  const strip = box(run, 0, run.length, 0, 0.5);
  const out: [number, number][] = [];
  for (const p of intersection([strip], taken)) {
    let a = Infinity;
    let b = -Infinity;
    for (const q of p.outer) {
      const t = (q[0] - run.o[0]) * run.u[0] + (q[1] - run.o[1]) * run.u[1];
      a = Math.min(a, t);
      b = Math.max(b, t);
    }
    if (b - a > 1e-3) out.push([Math.max(0, a), Math.min(run.length, b)]);
  }
  return out;
}

/**
 * Free span of a façade piece from the chain side `dir` (+1: from s = 0, -1: from s = length):
 * [cursor, limit] in chain coordinates c (s = c or length - c).
 */
function freeSpan(run: Run, taken: readonly Polygon[], dir: 1 | -1): [number, number] {
  const iv = blockedOn(run, taken)
    .map(([a, b]): [number, number] => (dir > 0 ? [a, b] : [run.length - b, run.length - a]))
    .sort((x, y) => x[0] - y[0]);
  let cursor = 0;
  for (const [a, b] of iv) {
    if (a <= cursor + 1e-6) cursor = Math.max(cursor, b);
    else return [cursor, a];
  }
  return [cursor, run.length];
}

interface Placed {
  i: number;
  run: number;
  /** Interval along the run (s). */
  s0: number;
  s1: number;
  depth: number;
  room: LayoutRoom;
  block: Polygon;
}

interface Attempt {
  placed: Placed[];
  taken: Polygon[];
  dir: 1 | -1;
  through: boolean;
  program: ProgramRoom[];
}

/**
 * Rooms of one dwelling: the façade rooms as a chain along its façade pieces (`facadeSegments`,
 * as measured by `facadeOf`), separated by `interiorWall`, then the wet core and the passage.
 * Rooms that cannot get their minimum façade are still drawn (as wide as possible) and flagged.
 */
export function unitRoomLayout(
  unit: Polygon,
  facadeSegments: readonly Seg[],
  /** Number of main rooms (T3 = 3) or an explicit room program (duplex levels). */
  rooms: number | readonly ProgramRoom[],
  rulesIn: UnitRules,
  /** Options, or (older form) the séjour preference of a façade piece. */
  options?: UnitRoomOptions | ((seg: Seg) => number),
): LayoutRoom[] {
  const opts: UnitRoomOptions =
    typeof options === 'function' ? { preferSejour: options } : (options ?? {});
  const rules = fullRules(rulesIn);
  const wall = rules.interiorWall;
  const pieces = facadeOf(unit, facadeSegments).segments;
  const runs = pieces
    .map((s) => {
      const r = makeRun(unit, s);
      if (!r) return r;
      if (opts.exterior)
        r.exterior = opts.exterior.some((e) => segOverlap(e, s) > r.length * 0.5 - 1e-6);
      if (opts.preferSejour) r.pref = opts.preferSejour(s);
      return r;
    })
    .filter((r): r is Run => !!r && r.depth > 1.5)
    .sort((a, b) => a.key - b.key);
  if (!runs.length) return [];
  const isFacing = (r: Run, q: Run) =>
    q !== r &&
    q.n[0] * r.n[0] + q.n[1] * r.n[1] < -0.99 &&
    Math.abs((q.o[0] - r.o[0]) * r.n[0] + (q.o[1] - r.o[1]) * r.n[1] - r.depth) < 0.3;
  runs.forEach((r) => (r.facing = runs.flatMap((q, j) => (isFacing(r, q) ? [j] : []))));
  for (const r of runs)
    r.opposite = runs.some(
      (q) =>
        q !== r &&
        q.exterior &&
        q.n[0] * r.n[0] + q.n[1] * r.n[1] < -0.99 &&
        Math.abs((q.o[0] - r.o[0]) * r.n[0] + (q.o[1] - r.o[1]) * r.n[1] - r.depth) < 0.3,
    );

  const base = typeof rooms === 'number' ? roomProgram(rooms, rules) : [...rooms];
  if (!base.length) return [];
  const mainRooms =
    opts.mainRooms ??
    (typeof rooms === 'number' ? rooms : base.filter((r) => r.kind !== 'cuisine').length);
  const wet = opts.wet ?? (typeof rooms === 'number' ? wetProgram(rooms) : []);
  const hasSejour = base.some((r) => r.kind === 'sejour');
  const programs: ProgramRoom[][] = [];
  if (rules.separateKitchen && hasSejour && mainRooms >= 3)
    programs.push([base[0]!, { kind: 'cuisine', min: rules.kitchenMinFacade }, ...base.slice(1)]);
  programs.push(base);
  const anyExterior = runs.some((r) => r.exterior);

  const areaMin = (kind: FacadeRoomKind, program: readonly ProgramRoom[]): number => {
    const a = rules.minAreas;
    if (kind === 'sejour')
      return program.some((r) => r.kind === 'cuisine') ? a.sejour : a.sejourCuisine;
    return a[kind];
  };
  const depthOf = (
    kind: FacadeRoomKind,
    w: number,
    run: Run,
    through: boolean,
    need: number,
    cap = Infinity,
  ) => {
    if (through && kind === 'sejour') return run.depth;
    const [share, lo, hi] = DEPTH[kind];
    const maxD = run.depth < 3 ? run.depth : Math.max(run.depth - 1.2, run.depth * 0.7);
    return Math.min(Math.max(run.depth * share, lo, need / Math.max(w, 0.5)), hi, maxD, cap);
  };
  /**
   * Depth caps for rooms facing rooms on the opposite façade (through and gallery dwellings):
   * both keep an inner zone of INNER m for the wet core and the passage between them.
   */
  const capsOf = (a: Attempt): number[] =>
    a.program.map((room, i) => {
      const p = a.placed.find((x) => x.i === i);
      if (!p) return Infinity;
      const run = runs[p.run]!;
      const opp = a.placed.filter(
        (x) =>
          run.facing.includes(x.run) &&
          !(a.through && x.i === 0) &&
          !(a.through && i === 0) &&
          overlapS(run, p, runs[x.run]!, x),
      );
      if (!opp.length) return Infinity;
      const free = run.depth - INNER - 2 * wall;
      const mine = p.depth;
      const other = Math.max(...opp.map((x) => x.depth));
      return Math.max(DEPTH[room.kind][1], (free * mine) / (mine + other));
    });

  const makeRoom = (
    kind: RoomKind,
    polygon: Polygon,
    facadeRequired: number,
    areaRequired: number,
  ): LayoutRoom => {
    const facade = facadeRequired > 0 ? facadeOf(polygon, facadeSegments).length : 0;
    const area = polygonArea(polygon);
    return {
      kind,
      polygon,
      area,
      facade,
      facadeRequired,
      facadeOk: facadeRequired <= 0 || facade >= facadeRequired - 0.02,
      areaRequired,
      areaOk: areaRequired <= 0 || area >= areaRequired - 0.05,
    };
  };

  /**
   * Largest free rectangle behind the séjour (from its back wall into the dwelling, within
   * [sLo, sHi] along the façade, overlapping the séjour): the day zone's second leg.
   */
  function dayExtension(
    run: Run,
    sej: Placed,
    sLo: number,
    sHi: number,
    blockers: readonly Polygon[],
  ): [number, number, number, number] | undefined {
    const t0 = sej.depth;
    const sw = sej.s1 - sej.s0;
    // a real part of the day zone, not a corridor: ≥ 2 m wide, and the whole séjour no deeper
    // than 1.6 × its width (office rule: rooms are not elongated)
    const MIN_W = 2.0;
    const maxB1 = Math.min(run.depth, RATIO.sejour * Math.max(sw, sHi - sLo));
    if (maxB1 - t0 < 1 || sHi - sLo < MIN_W) return undefined;
    // only blockers near the search area take part in the boolean tests
    const area = box(run, sLo, sHi, t0, maxB1);
    const near = blockers.filter((b) => intersection([area], [b]).length > 0);
    const clip = intersection([unit], [area]);
    const free = (a0: number, a1: number, b1: number) => {
      const bx = box(run, a0, a1, t0, b1);
      let ps = intersection(clip, [bx]);
      if (near.length) ps = difference(ps, near);
      return ps.reduce((x, p) => x + polygonArea(p), 0) >= (a1 - a0) * (b1 - t0) - 0.01;
    };
    let best: [number, number, number, number] | undefined;
    let bestA = 0;
    const alive = { 1: true, [-1]: true } as Record<number, boolean>;
    for (let d = 1.0; t0 + d <= maxB1 + 1e-6; d += 0.25) {
      const b1 = t0 + d;
      for (const side of [1, -1] as const) {
        if (!alive[side]) continue;
        const anchor = side > 0 ? sej.s0 : sej.s1;
        const max = side > 0 ? sHi - anchor : anchor - sLo;
        const ok = (w: number) =>
          side > 0 ? free(anchor, anchor + w, b1) : free(anchor - w, anchor, b1);
        // deeper is never freer: once the narrowest strip is blocked, stop on this side
        if (max < MIN_W || !ok(MIN_W)) {
          alive[side] = false;
          continue;
        }
        let lo = MIN_W;
        let hi = max;
        if (ok(hi)) lo = hi;
        else
          for (let k = 0; k < 7; k++) {
            const m = (lo + hi) / 2;
            if (ok(m)) lo = m;
            else hi = m;
          }
        if (b1 > RATIO.sejour * Math.max(sw, lo)) continue;
        if (lo * d > bestA + 1e-6) {
          bestA = lo * d;
          best = side > 0 ? [anchor, anchor + lo, t0, b1] : [anchor - lo, anchor, t0, b1];
        }
      }
    }
    return best;
  }

  /**
   * Largest free rectangle [s0, s1, t0, t1] inside [s0, s1] × [t0, t1] of a façade piece (inside
   * the dwelling, clear of `taken`): shallower, or narrower from either side. Rooms are always
   * single rectangles (office rule 23.11.2026). `narrowFirst`: prefer keeping the depth.
   */
  function fitRect(
    run: Run,
    s0: number,
    s1: number,
    t0: number,
    t1: number,
    taken: readonly Polygon[],
    narrowFirst: boolean,
  ): [number, number, number, number] | undefined {
    const free = (a0: number, a1: number, b0: number, b1: number) => {
      if (a1 - a0 < 0.3 || b1 - b0 < 0.3) return false;
      const bx = box(run, a0, a1, b0, b1);
      let ps = intersection([unit], [bx]);
      if (taken.length) ps = difference(ps, taken);
      return ps.reduce((x, p) => x + polygonArea(p), 0) >= (a1 - a0) * (b1 - b0) - 0.01;
    };
    if (free(s0, s1, t0, t1)) return [s0, s1, t0, t1];
    const search = (ok: (x: number) => boolean, lo: number, hi: number) => {
      // largest x in [lo, hi] with ok(x) (ok monotone, true at lo)
      if (!ok(lo)) return undefined;
      for (let k = 0; k < 18; k++) {
        const m = (lo + hi) / 2;
        if (ok(m)) lo = m;
        else hi = m;
      }
      return lo;
    };
    const cands: [number, number, number, number][] = [];
    const dd = search((x) => free(s0, s1, t0, t0 + x), 0.3, t1 - t0);
    if (dd !== undefined) cands.push([s0, s1, t0, t0 + dd]);
    const wa = search((x) => free(s0, s0 + x, t0, t1), 0.3, s1 - s0);
    if (wa !== undefined) cands.push([s0, s0 + wa, t0, t1]);
    const wb = search((x) => free(s1 - x, s1, t0, t1), 0.3, s1 - s0);
    if (wb !== undefined) cands.push([s1 - wb, s1, t0, t1]);
    if (!cands.length) return undefined;
    const area = (c: (typeof cands)[number]) =>
      (c[1] - c[0]) * (c[3] - c[2]) * (narrowFirst || c[1] - c[0] >= s1 - s0 - 1e-6 ? 1 : 0.85);
    return cands.reduce((x, y) => (area(y) > area(x) + 1e-6 ? y : x));
  }

  /** Places room `i` with width `w` at the free start of run `ri` (chain direction `dir`). */
  const put = (
    a: Attempt,
    i: number,
    ri: number,
    w: number,
    cursor: number,
    cap?: number,
  ): Placed | undefined => {
    const run = runs[ri]!;
    const room = a.program[i]!;
    const need = areaMin(room.kind, a.program);
    const d0 = Math.min(
      depthOf(room.kind, w, run, a.through && i === 0, need, cap),
      a.through && i === 0 ? Infinity : RATIO[room.kind] * w,
    );
    const [w0, w1] =
      a.dir > 0 ? [cursor, cursor + w] : [run.length - cursor - w, run.length - cursor];
    // rooms are single rectangles: shrink until nothing of other rooms or outside is in it
    const r = fitRect(run, w0, w1, 0, d0, a.taken, false);
    if (!r) return undefined;
    const [s0, s1, , d] = r;
    const polygon = box(run, s0, s1, 0, d);
    const p: Placed = {
      i,
      run: ri,
      s0,
      s1,
      depth: d,
      room: makeRoom(room.kind, polygon, room.min, need),
      block: box(run, s0 - wall, s1 + wall, -wall, d + wall),
    };
    a.placed.push(p);
    a.taken.push(p.block);
    return p;
  };

  /** Chain from façade piece `start` in direction `dir`; `widths` per room; optional fixed runs. */
  const chain = (
    program: ProgramRoom[],
    start: number,
    dir: 1 | -1,
    through: boolean,
    widths: readonly number[],
    fixed?: readonly number[],
    caps?: readonly number[],
  ): Attempt => {
    const a: Attempt = { placed: [], taken: [], dir, through, program };
    const m = runs.length;
    const visit = Array.from({ length: m }, (_, j) => (((start + dir * j) % m) + m) % m);
    let v = 0;
    const missing: number[] = [];
    program.forEach((room, i) => {
      const w = widths[i]!;
      if (fixed) {
        const ri = fixed[i]!;
        if (ri < 0) return missing.push(i);
        const [c, lim] = freeSpan(runs[ri]!, a.taken, dir);
        const ww = Math.min(w, lim - c);
        if (ww < MIN_RUN || !put(a, i, ri, ww, c, caps?.[i])) missing.push(i);
        return;
      }
      const night = NIGHT.includes(room.kind);
      for (; v < m; v++) {
        const ri = visit[v]!;
        const run = runs[ri]!;
        // bedrooms do not face the gallery (when there is an exterior façade)
        if (night && anyExterior && !run.exterior) continue;
        const [c, lim] = freeSpan(run, a.taken, dir);
        if (lim - c >= w - 1e-6 && put(a, i, ri, w, c)) return;
      }
      missing.push(i);
    });
    // rooms that did not fit: on the piece with the most free length, as wide as possible
    for (const i of missing) {
      let best: { ri: number; c: number; free: number } | undefined;
      runs.forEach((run, ri) => {
        const [c, lim] = freeSpan(run, a.taken, dir);
        if (!best || lim - c > best.free) best = { ri, c, free: lim - c };
      });
      if (best && best.free - wall >= MIN_RUN)
        put(a, i, best.ri, Math.min(widths[i]!, best.free - wall), best.c + wall);
    }
    return a;
  };

  /** Widths grown from the minimum with the spare façade of each piece (séjour first). */
  const grown = (a: Attempt): number[] => {
    const w = a.program.map((r) => r.min);
    for (let ri = 0; ri < runs.length; ri++) {
      const on = a.placed.filter((p) => p.run === ri).sort((x, y) => x.i - y.i);
      if (!on.length) continue;
      const end = Math.max(...on.map((p) => (a.dir > 0 ? p.s1 : runs[ri]!.length - p.s0)));
      // spare length up to the next blocked part of the piece
      const others = a.placed.filter((p) => p.run !== ri).map((p) => p.block);
      const iv = blockedOn(runs[ri]!, others)
        .map(([x, y]): [number, number] =>
          a.dir > 0 ? [x, y] : [runs[ri]!.length - y, runs[ri]!.length - x],
        )
        .filter(([x]) => x >= end - 1e-6)
        .sort((x, y) => x[0] - y[0]);
      let slack = (iv[0]?.[0] ?? runs[ri]!.length) - end;
      for (const p of on) w[p.i] = p.s1 - p.s0;
      for (const kind of ['sejour', 'cuisine', 'chambrePmr', 'chambre'] as const)
        for (const p of on) {
          if (a.program[p.i]!.kind !== kind || slack <= 0) continue;
          const add = Math.max(0, Math.min(PREFERRED[kind] - w[p.i]!, slack));
          w[p.i]! += add;
          slack -= add;
        }
      if (slack > 1e-3) {
        const sej = on.find((p) => a.program[p.i]!.kind === 'sejour');
        if (sej) {
          const add = Math.min(SEJOUR_MAX - w[sej.i]!, slack);
          if (add > 0) {
            w[sej.i]! += add;
            slack -= add;
          }
        }
        // then the other rooms, up to a sensible width (no long, shallow rooms); what is
        // left stays with the passage
        const rest = on.filter((p) => a.program[p.i]!.kind !== 'sejour');
        for (let k = 0; k < 3 && slack > 1e-3; k++) {
          const open = rest.filter((p) => w[p.i]! < MAX_WIDTH[a.program[p.i]!.kind] - 1e-6);
          if (!open.length) break;
          const share = slack / open.length;
          for (const p of open) {
            const add = Math.min(share, MAX_WIDTH[a.program[p.i]!.kind] - w[p.i]!);
            w[p.i]! += add;
            slack -= add;
          }
        }
      }
    }
    return w;
  };

  const sides = (p: Polygon): FacadeSide[] => {
    const out = new Set<FacadeSide>();
    for (const s of facadeOf(p, facadeSegments).segments) {
      if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) < 0.8) continue;
      const r = makeRun(unit, s);
      if (r) out.add(r.side);
    }
    return [...out];
  };
  const nbBox = (opts.neighbours ?? []).map((r) => ({ r, bb: ringBBox(r.polygon.outer) }));
  const near = (p: Polygon, kinds: readonly RoomKind[]) => {
    const bb = ringBBox(p.outer);
    return nbBox.some(
      ({ r, bb: q }) =>
        kinds.includes(r.kind) &&
        q.minX <= bb.maxX + 0.5 &&
        q.maxX >= bb.minX - 0.5 &&
        q.minY <= bb.maxY + 0.5 &&
        q.maxY >= bb.minY - 0.5 &&
        polygonDistance(p, r.polygon) < 0.45,
    );
  };
  const accessSegs = opts.access?.length
    ? facadeOf(
        unit,
        opts.access.flatMap((q) => {
          const ring = q.outer;
          return ring.map((x, k): Seg => [x, ring[(k + 1) % ring.length]!]);
        }),
      ).segments
    : [];
  const entranceDist = (p: Polygon): number => {
    if (!accessSegs.length) return 0;
    const c = ringCentroid(p.outer);
    let d = Infinity;
    for (const [x, y] of accessSegs) {
      const dx = y[0] - x[0];
      const dy = y[1] - x[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - x[0]) * dx + (c[1] - x[1]) * dy) / l2));
      d = Math.min(d, Math.hypot(c[0] - x[0] - t * dx, c[1] - x[1] - t * dy));
    }
    return d;
  };

  const score = (a: Attempt): number => {
    let s = 0;
    for (const p of a.placed) {
      s += 1e4 + (p.room.facadeOk ? 1e5 : 0) + (p.room.areaOk ? 1500 : 0);
      // bedrooms on the gallery only when nothing else fits; the séjour never (Laubengang)
      if (NIGHT.includes(p.room.kind) && !runs[p.run]!.exterior && anyExterior) s -= 2500;
      if (p.room.kind === 'sejour' && !runs[p.run]!.exterior && anyExterior) s -= 2e5;
    }
    const sej = a.placed.find((p) => p.room.kind === 'sejour');
    if (!sej) return s;
    const sd = sides(sej.room.polygon);
    if (sd.length >= 2) s += 3000; // corner or through séjour
    if (a.through) s += 300;
    s += 400 * runs[sej.run]!.pref;
    const ranks = sd.map((x) => ORIENT[x]).sort((x, y) => y - x);
    s += 150 * (ranks[0] ?? 0) + 15 * (ranks[1] ?? 0);
    if (opts.below?.length) {
      const o = overlapArea([sej.room.polygon], opts.below);
      s += 1500 * Math.min(1, o / Math.max(1, sej.room.area));
    }
    if (nbBox.length) {
      if (near(sej.room.polygon, ['sejour', 'cuisine'])) s += 200;
      if (near(sej.room.polygon, NIGHT)) s -= 200;
    }
    s -= Math.min(300, 25 * entranceDist(sej.room.polygon));
    return s;
  };

  let best: { a: Attempt; s: number } | undefined;
  let k = 0;
  for (const program of programs) {
    for (let ri = 0; ri < runs.length; ri++)
      for (const dir of [1, -1] as const)
        for (const through of runs[ri]!.opposite &&
        runs[ri]!.exterior &&
        runs[ri]!.depth <= THROUGH_MAX
          ? [true, false]
          : [false]) {
          // the séjour opens the chain at the start of the piece (towards the chain direction)
          const first = chain(
            program,
            ri,
            dir,
            through,
            program.map((r) => r.min),
          );
          const fixed = program.map((_, i) => first.placed.find((p) => p.i === i)?.run ?? -1);
          const widths = grown(first);
          const second = chain(program, ri, dir, through, widths, fixed);
          const final = chain(program, ri, dir, through, widths, fixed, capsOf(second));
          const a = final.placed.length >= first.placed.length ? final : first;
          const s = score(a) - k++ * 1e-3;
          if (!best || s > best.s) best = { a, s };
        }
    // the separate kitchen only when every room still gets its façade
    if (
      best &&
      best.a.placed.length === program.length &&
      best.a.placed.every((p) => p.room.facadeOk)
    )
      break;
    if (program !== base) best = undefined;
  }
  if (!best) return [];
  const a = best.a;
  for (const p of a.placed)
    if (NIGHT.includes(p.room.kind) && anyExterior && !runs[p.run]!.exterior)
      p.room.onGallery = true;
  const out: LayoutRoom[] = a.placed.map((p) => p.room);

  // --- wet core: shaft + SDB next to the PMR bedroom (junction with the day zone) ---------
  if (wet.length) {
    const wetRooms = wetCore(a, wet);
    out.push(...wetRooms.rooms);
    a.taken.push(...wetRooms.blocks);
  }
  // --- day zone and passage (office rules B/D) -------------------------------------
  // The entrance opens into the day zone: the séjour takes the rest of the dwelling on its
  // side of the day/night boundary (it may run round a corner, an L); the rest on the night
  // side is the small hall (dégagement) to the bedrooms and bathrooms.
  const sejP = a.placed.find((p) => p.room.kind === 'sejour');
  let rest = difference([unit], a.taken).filter((p) => polygonArea(p) > 0.05);
  if (sejP) {
    const run = runs[sejP.run]!;
    const lastDay = a.placed
      .filter((p) => p.run === sejP.run && (p.room.kind === 'sejour' || p.room.kind === 'cuisine'))
      .reduce((x, y) => (a.dir > 0 ? (y.s1 > x.s1 ? y : x) : y.s0 < x.s0 ? y : x));
    const hasNight = a.placed.some((p) => NIGHT.includes(p.room.kind));
    const others = a.placed.filter((p) => p !== sejP).map((p) => p.block);
    const wetBlocks = a.taken.slice(a.placed.length);
    // the day side of the dwelling along this façade piece (s range)
    let sLo = Infinity;
    let sHi = -Infinity;
    for (const q of unit.outer) {
      const t = (q[0] - run.o[0]) * run.u[0] + (q[1] - run.o[1]) * run.u[1];
      sLo = Math.min(sLo, t);
      sHi = Math.max(sHi, t);
    }
    if (hasNight) {
      if (a.dir > 0) sHi = Math.min(sHi, lastDay.s1);
      else sLo = Math.max(sLo, lastDay.s0);
    }
    // one rectangle behind the séjour, from its back wall into the dwelling: séjour + this =
    // a simple L or T (no ragged shapes)
    const blockers = [...others, ...wetBlocks];
    const back = dayExtension(run, sejP, sLo, sHi, blockers);
    if (back && (back[1] - back[0]) * (back[3] - back[2]) > 1.5 && back[3] - back[2] > 0.9) {
      const merged = union([sejP.room.polygon, box(run, back[0], back[1], back[2], back[3])]);
      if (merged.length === 1) {
        const z = merged[0]!;
        Object.assign(
          sejP.room,
          makeRoom('sejour', z, sejP.room.facadeRequired, sejP.room.areaRequired),
        );
        const b = box(run, back[0] - wall, back[1] + wall, back[2], back[3] + wall);
        a.taken.push(b);
        rest = difference(rest, [b, sejP.block]).filter((p) => polygonArea(p) > 0.05);
      }
    }
  }
  for (const p of rest) if (polygonArea(p) > 1) out.push(makeRoom('degagement', p, 0, 0));

  const rank: Record<RoomKind, number> = {
    sejour: 0,
    cuisine: 1,
    chambrePmr: 2,
    chambre: 3,
    sdb: 4,
    wc: 5,
    sde: 6,
    gaine: 7,
    degagement: 8,
  };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind]);

  function wetCore(
    a: Attempt,
    kinds: readonly WetKind[],
  ): { rooms: LayoutRoom[]; blocks: Polygon[] } {
    const day = a.placed.filter((p) => p.room.kind === 'sejour' || p.room.kind === 'cuisine');
    const pmr =
      a.placed.find((p) => p.room.kind === 'chambrePmr') ??
      a.placed.find((p) => p.room.kind === 'chambre');
    const anchors: { p: Placed; g: 1 | -1; s: number }[] = [];
    if (pmr) {
      // junction: the side of the bedroom towards the day zone (chain start)
      anchors.push({ p: pmr, g: a.dir, s: a.dir > 0 ? pmr.s0 : pmr.s1 });
      anchors.push({ p: pmr, g: -a.dir as 1 | -1, s: a.dir > 0 ? pmr.s1 : pmr.s0 });
    }
    const lastDay = day[day.length - 1];
    if (lastDay) {
      // behind the séjour, from its night-side end back along it
      anchors.push({ p: lastDay, g: -a.dir as 1 | -1, s: a.dir > 0 ? lastDay.s1 : lastDay.s0 });
      anchors.push({ p: lastDay, g: a.dir, s: a.dir > 0 ? lastDay.s0 : lastDay.s1 });
    }
    // further anchors: behind every other façade room, from either end (odd shapes)
    for (const p of a.placed)
      for (const g of [1, -1] as const)
        for (const sv of [p.s0, p.s1])
          if (!anchors.some((x) => x.p === p && x.g === g && Math.abs(x.s - sv) < 1e-6))
            anchors.push({ p, g, s: sv });
    if (!anchors.length) return { rooms: [], blocks: [] };
    let bestW: { rooms: LayoutRoom[]; blocks: Polygon[]; s: number } | undefined;
    for (const an of anchors) {
      const run = runs[an.p.run]!;
      const t0 = an.p.depth + wall;
      // rooms on the opposite façade limit the depth of the wet core
      const opp = a.placed.filter(
        (x) => run.facing.includes(x.run) && overlapS(run, an.p, runs[x.run]!, x),
      );
      const avail = run.depth - t0 - (opp.length ? Math.max(...opp.map((x) => x.depth)) + wall : 0);
      if (avail < 0.9) continue;
      const rooms: LayoutRoom[] = [];
      const blocks: Polygon[] = [];
      const taken = [...a.taken];
      let c = 0;
      const rects: [number, number, number, number][] = [];
      const item = (kind: RoomKind, w: number, d: number, need: number, gap: number) => {
        const s0 = an.g > 0 ? an.s + c : an.s - c - w;
        const s1 = s0 + w;
        c += w + gap;
        const r = fitRect(run, s0, s1, t0, t0 + d, taken, true);
        if (!r) return;
        const poly = box(run, r[0], r[1], r[2], r[3]);
        rooms.push(makeRoom(kind, poly, 0, need));
        rects.push(r);
        const b = box(run, r[0] - gap, r[1] + gap, r[2] - gap, r[3] + gap);
        blocks.push(b);
        taken.push(b);
      };
      const g = rules.shaftSize;
      item('gaine', g, g, 0, wall);
      for (const kind of kinds) {
        const need = rules.minAreas[kind];
        let w = WET_WIDTH[kind];
        let d = need / w;
        if (d > avail) {
          d = avail;
          w = need / d;
        }
        item(kind, w, d, need, wall);
      }
      // no room for the shaft at the junction: next to the first wet room
      if (!rooms.some((r) => r.kind === 'gaine') && rects.length) {
        const [a0, a1, b0, b1] = rects[0]!;
        for (const [x0, y0] of [
          [a1 + wall, b0],
          [a0 - wall - g, b0],
          [a0, b1 + wall],
          [a0, b0 - wall - g],
          [a1 + wall, b1 - g],
          [a0 - wall - g, b1 - g],
        ] as const) {
          const bx = box(run, x0, x0 + g, y0, y0 + g);
          let ps = intersection([unit], [bx]);
          ps = difference(ps, taken);
          if (ps.reduce((x, p) => x + polygonArea(p), 0) < g * g - 0.01) continue;
          rooms.push(makeRoom('gaine', bx, 0, 0));
          const b = box(run, x0 - wall, x0 + g + wall, y0 - wall, y0 + g + wall);
          blocks.push(b);
          taken.push(b);
          break;
        }
        if (!rooms.some((r) => r.kind === 'gaine') && a1 - a0 > g + wall + 0.9) {
          // last resort: the bathroom gives up one end for the shaft (both stay rectangles)
          const first = rooms.find((r) => r.kind !== 'gaine')!;
          const nb = box(run, a0, a1 - g - wall, b0, b1);
          Object.assign(first, makeRoom(first.kind, nb, 0, first.areaRequired));
          rooms.push(makeRoom('gaine', box(run, a1 - g, a1, b0, b0 + g), 0, 0));
        }
      }
      const ok = rooms.filter((r) => r.areaOk).length;
      const nextToPmr =
        pmr &&
        rooms.some((r) => r.kind !== 'gaine' && polygonDistance(r.polygon, pmr.room.polygon) < 0.3);
      const s =
        ok * 100 +
        rooms.length * 10 +
        rooms.reduce((x, r) => x + r.area, 0) * 0.1 +
        (nextToPmr ? 40 : 0) +
        // close to the entrance and back to back with the neighbour's bathroom (rule C)
        (rooms.some((r) => r.kind !== 'gaine' && near(r.polygon, ['sdb', 'sde', 'wc'])) ? 25 : 0) -
        Math.min(30, 3 * Math.min(...rooms.map((r) => entranceDist(r.polygon)), 10)) -
        anchors.indexOf(an) * 0.01;
      if (!bestW || s > bestW.s + 1e-6) bestW = { rooms, blocks, s };
    }
    return bestW ?? { rooms: [], blocks: [] };
  }
}

/** Rooms that count as main rooms (pièces principales: séjour, chambres). */
export const isMainRoom = (r: Pick<LayoutRoom, 'kind'>): boolean =>
  MAIN_ROOM_KINDS.includes(r.kind);
/** Rooms on the façade (séjour, separate kitchen, chambres). */
export const isFacadeRoom = (r: Pick<LayoutRoom, 'kind'>): boolean =>
  FACADE_ROOM_KINDS.includes(r.kind);
