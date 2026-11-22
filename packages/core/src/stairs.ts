/**
 * Stairs and lifts inside the stair cores (cage d'escalier / Treppenhaus).
 *
 * Every core of the schematic layout (`layout.ts`) gets a two-flight stair (escalier à deux
 * volées, demi-tour) from its floor up to the floor above, with an intermediate landing at
 * mid-height, and — where it fits — a lift shaft beside it. The stair keeps its floor landing
 * (palier d'arrivée) on the side of the core that opens onto the circulation.
 *
 * Pure and deterministic; all output is in world (project) coordinates, z up.
 */
import { normalizePolygon, pointInPolygon } from './geometry.js';
import type { CoreBox, LayoutArea, MassLayout, StoreyLayout } from './layout.js';
import type { Polygon, Settings, StairRules, Vec2 } from './types.js';

/**
 * Defaults: French collective housing (arrêté du 24/12/2015, escaliers des parties communes:
 * ≥ 1.00 m between handrails, risers ≤ 17 cm, going ≥ 28 cm) and a 630 kg lift (1.10 × 1.40
 * cabin) in a 1.80 × 2.00 m shaft.
 */
export const DEFAULT_STAIR_RULES: StairRules = {
  flightWidth: 1.2,
  maxRiser: 0.17,
  going: 0.28,
  gap: 0.1,
  waist: 0.18,
  wall: 0.2,
  liftWidth: 1.8,
  liftDepth: 2.0,
};

/** Shortest going accepted before the stair is flagged as not fitting the core, m. */
const MIN_GOING = 0.24;

export function resolveStairRules(settings?: Pick<Settings, 'cores'>): StairRules {
  return { ...DEFAULT_STAIR_RULES, ...(settings?.cores.stair ?? {}) };
}

export interface StairFlight {
  /** Corner of the flight's start (bottom riser) on the `side` = 0 edge, world. */
  origin: Vec2;
  /** Unit plan direction in which the flight rises. */
  dir: Vec2;
  /** Unit plan direction across the flight, right-handed: side = (dir.y, −dir.x). */
  side: Vec2;
  width: number;
  /** Floor level the flight starts from, m. */
  z0: number;
  /** Level the flight arrives at (landing or floor above), m. */
  z1: number;
  risers: number;
  riser: number;
  going: number;
  /**
   * Closed side profile of the flight (steps on top, sloped soffit below) in the vertical plane:
   * [s along `dir` from `origin`, z above `z0`], counter-clockwise.
   */
  profile: [number, number][];
  /** Plan of the whole flight. */
  polygon: Polygon;
  /** Treads in plan with their top level (for drawings). */
  treads: { polygon: Polygon; z: number }[];
}

export interface StairLanding {
  polygon: Polygon;
  /** Top of the landing, m. */
  z: number;
  thickness: number;
}

export interface CoreStair {
  massId: string;
  storeyIndex: number;
  /** Index of the core within the storey layout. */
  coreIndex: number;
  z0: number;
  z1: number;
  /** Outline of the core (the cage), world. */
  outline: Polygon;
  wall: number;
  flights: StairFlight[];
  /** Intermediate landing(s) (palier de repos). */
  landings: StairLanding[];
  /** Lift shaft outline (outer), if it fits beside the stair. */
  lift?: Polygon;
  /** Total number of risers and their height. */
  risers: number;
  riser: number;
  going: number;
  /** False when the stair had to be compressed below the rules to fit the core. */
  fits: boolean;
}

// ---------------------------------------------------------------------------

/** Local frame of a core: s from the front (access side) inwards, c across. */
interface CoreFrame {
  o: Vec2;
  s: Vec2;
  c: Vec2;
  ls: number;
  lc: number;
}

const add = (p: Vec2, v: Vec2, k: number): Vec2 => [p[0] + v[0] * k, p[1] + v[1] * k];
const at = (f: CoreFrame, s: number, c: number): Vec2 => add(add(f.o, f.s, s), f.c, c);
const rectIn = (f: CoreFrame, s0: number, c0: number, s1: number, c1: number): Polygon =>
  normalizePolygon({ outer: [at(f, s0, c0), at(f, s1, c0), at(f, s1, c1), at(f, s0, c1)] });

/** The four frames of a box: front on a0 / a1 (run along u) or b0 / b1 (run along n). */
function frames(b: CoreBox): Record<'a0' | 'a1' | 'b0' | 'b1', CoreFrame> {
  const neg = (v: Vec2): Vec2 => [-v[0], -v[1]];
  const far = add(add(b.o, b.u, b.w), b.n, b.d);
  return {
    a0: { o: b.o, s: b.u, c: b.n, ls: b.w, lc: b.d },
    a1: { o: far, s: neg(b.u), c: neg(b.n), ls: b.w, lc: b.d },
    b0: { o: b.o, s: b.n, c: b.u, ls: b.d, lc: b.w },
    b1: { o: far, s: neg(b.n), c: neg(b.u), ls: b.d, lc: b.w },
  };
}

/** Sides of the core box that open onto circulation (landing, gallery, corridor). */
function openSides(b: CoreBox, circulation: readonly Polygon[]): Set<string> {
  const out = new Set<string>();
  const fs = frames(b);
  for (const [k, f] of Object.entries(fs)) {
    // probe just outside the middle of the side
    const p = at(f, -0.3, f.lc / 2);
    if (circulation.some((q) => pointInPolygon(p, q))) out.add(k);
  }
  return out;
}

interface Fit {
  frame: CoreFrame;
  going: number;
  landing: number;
  fits: boolean;
  lift: boolean;
  front: boolean;
}

function evaluate(f: CoreFrame, r: StairRules, treads: number, front: boolean, width: number): Fit {
  const t = r.wall;
  const runAvail = f.ls - 2 * t;
  const landing = r.flightWidth;
  // floor landing + flight + intermediate landing
  let going = r.going;
  let fits = width <= f.lc - 2 * t + 1e-9;
  const need = (g: number) => 2 * landing + treads * g;
  if (need(going) > runAvail + 1e-9) {
    going = treads > 0 ? Math.max(0.05, (runAvail - 2 * landing) / treads) : r.going;
    if (going < MIN_GOING - 1e-9) fits = false;
  }
  const lift =
    r.liftWidth > 0 && f.lc - 2 * t - width >= r.liftWidth + 0.1 && f.ls - 2 * t >= r.liftDepth;
  return { frame: f, going, landing, fits, lift, front };
}

/** Side profile of a flight with `m` treads (see StairFlight.profile). */
export function flightProfile(
  m: number,
  riser: number,
  going: number,
  waist: number,
): [number, number][] {
  if (m < 1) return [];
  const slope = riser / going;
  const wv = waist * Math.sqrt(1 + slope * slope); // vertical waist
  const x0 = Math.min(m * going, wv / slope);
  const zEnd = Math.max(0, m * riser - wv);
  const out: [number, number][] = [[0, 0]];
  if (x0 > 1e-6) out.push([x0, 0]);
  out.push([m * going, zEnd]);
  for (let i = m; i >= 1; i--) {
    out.push([i * going, i * riser]);
    out.push([(i - 1) * going, i * riser]);
  }
  // drop duplicate consecutive points
  return out.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - out[i - 1]![0], p[1] - out[i - 1]![1]) > 1e-9,
  );
}

/**
 * Stair (and lift) of one core from `z0` up to `z1`. `circulation` (landings, galleries,
 * corridors of the storey) decides which side the stair opens onto.
 */
export function coreStair(
  core: Pick<LayoutArea, 'polygon' | 'box' | 'index'>,
  z0: number,
  z1: number,
  rules: StairRules = DEFAULT_STAIR_RULES,
  circulation: readonly Polygon[] = [],
  ids: { massId: string; storeyIndex: number } = { massId: '', storeyIndex: 0 },
): CoreStair | null {
  const b = core.box;
  const h = z1 - z0;
  if (!b || !(h > 0.3) || b.w < 1 || b.d < 1) return null;
  const r = rules;
  const risers = Math.max(2, Math.ceil(h / r.maxRiser - 1e-9));
  const riser = h / risers;
  const n1 = Math.ceil(risers / 2);
  const n2 = risers - n1;
  const treads = n1 - 1;
  const width = 2 * r.flightWidth + r.gap;

  const open = openSides(b, circulation);
  const fs = frames(b);
  const keys = ['b0', 'a0', 'b1', 'a1'] as const;
  const cands = keys.map((k) => evaluate(fs[k], r, treads, open.has(k), width));
  // fits first, then the lift, then the side onto the circulation, then the default order
  const score = (x: Fit) => (x.fits ? 4 : 0) + (x.lift ? 2 : 0) + (x.front ? 1 : 0);
  const best = cands.reduce((a, x) => (score(x) > score(a) ? x : a));
  const f = best.frame;
  const t = r.wall;
  const fw = Math.min(r.flightWidth, (f.lc - 2 * t - r.gap) / 2);
  const g = best.going;
  const L = best.landing;

  // flights at the back of the core, the hall (floor landing) towards the front
  const sMid = f.ls - t - L; // start of the intermediate landing
  const sb = sMid - treads * g; // first riser of flight 1
  const c1 = t;
  const c2 = t + fw + r.gap;
  const zMid = z0 + n1 * riser;
  const flights: StairFlight[] = [];

  const mk = (
    start: number,
    dirSign: 1 | -1,
    cLane: number,
    zBase: number,
    n: number,
    zTop: number,
  ): StairFlight | null => {
    const m = n - 1;
    if (m < 1) return null;
    const dir: Vec2 = dirSign > 0 ? f.s : [-f.s[0], -f.s[1]];
    const side: Vec2 = [dir[1], -dir[0]];
    // origin on the lane edge from which `side` spans the lane
    const e0 = at(f, start, cLane);
    const e1 = at(f, start, cLane + fw);
    const dot = (e1[0] - e0[0]) * side[0] + (e1[1] - e0[1]) * side[1];
    const origin = dot >= 0 ? e0 : e1;
    const sEnd = start + dirSign * m * g;
    const treadsOut: StairFlight['treads'] = [];
    for (let i = 1; i <= m; i++) {
      const a = start + dirSign * (i - 1) * g;
      const bb = start + dirSign * i * g;
      treadsOut.push({
        polygon: rectIn(f, Math.min(a, bb), cLane, Math.max(a, bb), cLane + fw),
        z: zBase + i * riser,
      });
    }
    return {
      origin,
      dir,
      side,
      width: fw,
      z0: zBase,
      z1: zTop,
      risers: n,
      riser,
      going: g,
      profile: flightProfile(m, riser, g, r.waist),
      polygon: rectIn(f, Math.min(start, sEnd), cLane, Math.max(start, sEnd), cLane + fw),
      treads: treadsOut,
    };
  };

  const f1 = mk(sb, 1, c1, z0, n1, zMid);
  const f2 = mk(sMid, -1, c2, zMid, n2, z1);
  if (f1) flights.push(f1);
  if (f2) flights.push(f2);
  const landings: StairLanding[] = [
    {
      polygon: rectIn(f, sMid, c1, f.ls - t, c2 + fw),
      z: zMid,
      thickness: r.waist + 0.02,
    },
  ];

  const out: CoreStair = {
    massId: ids.massId,
    storeyIndex: ids.storeyIndex,
    coreIndex: core.index ?? 0,
    z0,
    z1,
    outline: core.polygon,
    wall: t,
    flights,
    landings,
    risers,
    riser,
    going: g,
    fits: best.fits,
  };
  if (best.lift) out.lift = rectIn(f, t, f.lc - t - r.liftWidth, t + r.liftDepth, f.lc - t);
  return out;
}

const centre = (b: CoreBox): Vec2 => add(add(b.o, b.u, b.w / 2), b.n, b.d / 2);

/**
 * Stairs of every core of one storey layout. A core gets a stair only when the storey above
 * (`above`) still has a core at the same place; the top storey keeps its landing only.
 */
export function storeyStairs(
  st: StoreyLayout,
  above: StoreyLayout | undefined,
  rules: StairRules = DEFAULT_STAIR_RULES,
): CoreStair[] {
  if (!above) return [];
  const circ = st.circulation.map((c) => c.polygon);
  const out: CoreStair[] = [];
  for (const core of st.cores) {
    if (!core.box) continue;
    const c = centre(core.box);
    if (!above.cores.some((k) => pointInPolygon(c, k.polygon))) continue;
    const s = coreStair(core, st.z0, above.z0, rules, circ, {
      massId: st.massId,
      storeyIndex: st.storeyIndex,
    });
    if (s) out.push(s);
  }
  return out;
}

/** Stairs of all storeys of all masses (keyed by `massId#storeyIndex`). */
export function layoutStairs(
  layouts: readonly MassLayout[],
  settings?: Pick<Settings, 'cores'>,
): Map<string, CoreStair[]> {
  const rules = resolveStairRules(settings);
  const out = new Map<string, CoreStair[]>();
  for (const m of layouts) {
    const byIndex = new Map(m.storeys.map((s) => [s.storeyIndex, s]));
    for (const st of m.storeys) {
      const list = storeyStairs(st, byIndex.get(st.storeyIndex + 1), rules);
      if (list.length) out.set(`${m.massId}#${st.storeyIndex}`, list);
    }
  }
  return out;
}
