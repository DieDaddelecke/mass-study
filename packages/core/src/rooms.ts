/**
 * Schematic rooms of a dwelling (pièces principales / Wohnräume) for the floor plan and the
 * granulometry view: the living room (séjour), the PMR bedroom and the further bedrooms as
 * rectangles along the façade of the dwelling, sized by the office rules (minimum façade per
 * room, partitions between rooms). Kitchen, bathroom and entrance stay in the remaining area
 * and are not drawn. Pure and deterministic; world coordinates.
 */
import {
  difference,
  intersection,
  normalizePolygon,
  pointInPolygon,
  polygonArea,
} from './geometry.js';
import { assignRooms, facadeOf } from './unitRules.js';
import type { Polygon, UnitRules, Vec2 } from './types.js';

export type RoomKind = 'sejour' | 'chambrePmr' | 'chambre';

export interface LayoutRoom {
  kind: RoomKind;
  polygon: Polygon;
  area: number;
  /** Façade length of the room, m. */
  facade: number;
  /** Minimum façade length of the room (office rules), m. */
  facadeRequired: number;
  facadeOk: boolean;
}

type Seg = [Vec2, Vec2];

interface Run {
  o: Vec2;
  u: Vec2;
  n: Vec2;
  length: number;
  /** Depth of the dwelling behind this façade piece, m. */
  depth: number;
  used: number;
  rooms: { i: number; width: number }[];
  /** Preference of this piece for the séjour (e.g. outer façade with a balcony). */
  pref: number;
}

/** Preferred façade widths (grown up to these when the façade allows), m. */
const PREFERRED: Record<RoomKind, number> = { sejour: 4.6, chambrePmr: 3.2, chambre: 2.9 };
/** Room depths: share of the dwelling depth, clamped, m. */
const DEPTH: Record<RoomKind, [number, number, number]> = {
  sejour: [0.6, 3.6, 5.6],
  chambrePmr: [0.5, 3.2, 4.2],
  chambre: [0.5, 3.0, 4.0],
};
/** Façade pieces shorter than this are not used for rooms, m. */
const MIN_RUN = 1.2;

/** Requested rooms of a dwelling with `rooms` main rooms (T1 = 1 … T5 = 5). */
export function roomProgram(rooms: number, rules: UnitRules): { kind: RoomKind; min: number }[] {
  const out: { kind: RoomKind; min: number }[] = [{ kind: 'sejour', min: rules.livingMinFacade }];
  if (rooms >= 2) out.push({ kind: 'chambrePmr', min: rules.pmrBedroomMinFacade });
  for (let i = 2; i < rooms; i++) out.push({ kind: 'chambre', min: rules.bedroomMinFacade });
  return out;
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
  return { o: a, u, n, length: len, depth, used: 0, rooms: [], pref: 0 };
}

const at = (r: Run, s: number, t: number): Vec2 => [
  r.o[0] + r.u[0] * s + r.n[0] * t,
  r.o[1] + r.u[1] * s + r.n[1] * t,
];
const box = (r: Run, s0: number, s1: number, t0: number, t1: number): Polygon =>
  normalizePolygon({ outer: [at(r, s0, t0), at(r, s1, t0), at(r, s1, t1), at(r, s0, t1)] });

/** Largest interval [s0, s1] of a façade piece not covered by already placed rooms. */
function freeGap(run: Run, taken: readonly Polygon[]): [number, number] {
  if (!taken.length) return [0, run.length];
  const strip = box(run, 0, run.length, 0, 0.5);
  const blocked: [number, number][] = [];
  for (const p of intersection([strip], taken)) {
    let a = Infinity;
    let b = -Infinity;
    for (const q of p.outer) {
      const t = (q[0] - run.o[0]) * run.u[0] + (q[1] - run.o[1]) * run.u[1];
      a = Math.min(a, t);
      b = Math.max(b, t);
    }
    if (b - a > 1e-3) blocked.push([a, b]);
  }
  blocked.sort((x, y) => x[0] - y[0]);
  let best: [number, number] = [0, 0];
  let cur = 0;
  for (const [a, b] of [...blocked, [run.length, run.length] as [number, number]]) {
    if (a - cur > best[1] - best[0]) best = [cur, Math.min(a, run.length)];
    cur = Math.max(cur, b);
  }
  return best;
}

/**
 * Rooms of one dwelling: séjour, chambre PMR and further chambres as rectangles along its
 * façade pieces (`facadeSegments`, as measured by `facadeOf`), separated by `interiorWall`.
 * Rooms that cannot get their minimum façade are still drawn (as wide as possible) and flagged.
 */
export function unitRoomLayout(
  unit: Polygon,
  facadeSegments: readonly Seg[],
  rooms: number,
  rules: UnitRules,
  /** Preference of a façade piece for the séjour (higher first), e.g. where a balcony goes. */
  preferSejour?: (seg: Seg) => number,
): LayoutRoom[] {
  const wall = rules.interiorWall;
  const runs = facadeSegments
    .map((s) => {
      const r = makeRun(unit, s);
      if (r && preferSejour) r.pref = preferSejour(s);
      return r;
    })
    .filter((r): r is Run => !!r && r.depth > 1.5)
    .sort((a, b) => b.length - a.length);
  if (!runs.length) return [];
  const program = roomProgram(rooms, rules);
  const free = (r: Run) => r.length - r.used - (r.rooms.length ? wall : 0);

  const attempt = (caps: readonly number[], grow = true): LayoutRoom[] => {
    for (const r of runs) {
      r.used = 0;
      r.rooms = [];
    }
    // 1. minimum widths: an exact assignment of the rooms to the façade pieces when one exists
    //    (séjour on the preferred piece), else each room where the most free length is left
    const exact = assignRooms(
      program.map((r) => r.min),
      caps,
      wall,
      runs.map((r) => r.pref),
    );
    if (exact)
      program.forEach((room, i) => {
        const run = runs[exact[i]!]!;
        run.used += room.min + (run.rooms.length ? wall : 0);
        run.rooms.push({ i, width: room.min });
      });
    else
      program.forEach((room, i) => {
        const fits = runs.filter((r) => free(r) >= room.min - 1e-6);
        const better = (x: Run, y: Run) =>
          i === 0 && y.pref !== x.pref ? y.pref > x.pref : free(y) > free(x);
        const run = (fits.length ? fits : runs).reduce((x, y) => (better(x, y) ? y : x));
        const w = Math.min(room.min, free(run));
        if (w < MIN_RUN) return;
        run.used += w + (run.rooms.length ? wall : 0);
        run.rooms.push({ i, width: w });
      });
    // 2. grow rooms towards their preferred widths with the remaining façade (séjour first)
    for (const run of grow ? runs : [])
      for (const kind of ['sejour', 'chambrePmr', 'chambre'] as const)
        for (const rm of run.rooms) {
          if (program[rm.i]!.kind !== kind) continue;
          const add = Math.max(0, Math.min(PREFERRED[kind] - rm.width, run.length - run.used));
          rm.width += add;
          run.used += add;
        }

    // 3. rectangles: rooms one after the other in the largest part of each façade piece that is
    //    not taken by rooms of another piece (corners), from whichever end fits better
    const out: LayoutRoom[] = [];
    const taken: Polygon[] = [];
    for (const run of runs) {
      const order = [...run.rooms].sort((x, y) => x.i - y.i);
      if (!order.length) continue;
      const [g0, g1] = freeGap(run, taken);
      const total = order.reduce((x, rm) => x + rm.width, 0) + wall * (order.length - 1);
      const place = (reverse: boolean, centre = false) => {
        const res: { room: LayoutRoom; block: Polygon }[] = [];
        let s = centre ? g0 + Math.max(0, (g1 - g0 - total) / 2) : reverse ? g1 : g0;
        for (const rm of order) {
          const room = program[rm.i]!;
          const [share, lo, hi] = DEPTH[room.kind];
          const d = Math.min(
            Math.max(run.depth * share, lo),
            hi,
            Math.max(run.depth - 1, run.depth * 0.7),
          );
          const s0 = reverse ? s - rm.width : s;
          const s1 = s0 + rm.width;
          s = reverse ? s0 - wall : s1 + wall;
          let pieces = intersection([unit], [box(run, s0, s1, 0, d)]);
          if (taken.length) pieces = difference(pieces, taken);
          pieces = pieces.filter((p) => polygonArea(p) > 1);
          if (!pieces.length) continue;
          const polygon = pieces.reduce((x, y) => (polygonArea(y) > polygonArea(x) ? y : x));
          const facade = facadeOf(polygon, facadeSegments).length;
          res.push({
            room: {
              kind: room.kind,
              polygon,
              area: polygonArea(polygon),
              facade,
              facadeRequired: room.min,
              facadeOk: facade >= room.min - 0.02,
            },
            // keeps a partition between this room and rooms placed later on other façades
            block: box(run, s0 - wall, s1 + wall, -wall, d + wall),
          });
        }
        return res;
      };
      const score = (r: ReturnType<typeof place>) =>
        r.reduce((a, x) => a + (x.room.facadeOk ? 1000 : 0) + Math.min(x.room.facade, 1), 0);
      // centred first (keeps the corners free for the rooms of the other façade), on a tie
      const best = [place(false, true), place(false), place(true)].sort(
        (a, b) => score(b) - score(a),
      )[0]!;
      for (const x of best) {
        out.push(x.room);
        taken.push(x.block);
      }
    }
    return out;
  };
  // pieces meeting at a corner lose the depth of the rooms of the other piece: try the plain
  // lengths first, then with that loss, and keep the layout with the most compliant rooms
  const corner = (r: Run): number =>
    [r.o, at(r, r.length, 0)].filter((p) =>
      runs.some(
        (q) =>
          q !== r &&
          Math.abs(q.u[0] * r.u[0] + q.u[1] * r.u[1]) < 0.5 &&
          [q.o, at(q, q.length, 0)].some((x) => Math.hypot(p[0] - x[0], p[1] - x[1]) < 0.05),
      ),
    ).length;
  const ok = (rs: LayoutRoom[]) =>
    rs.filter((r) => r.facadeOk).length * 1000 +
    rs.length * 100 +
    rs.reduce((x, r) => x + r.facade, 0);
  let out = attempt(runs.map((r) => r.length));
  if (out.some((r) => !r.facadeOk) && runs.some((r) => corner(r) > 0)) {
    const loss = DEPTH.sejour[2] + wall;
    for (const [caps, grow] of [
      [runs.map((r) => r.length), false],
      [runs.map((r) => Math.max(0, r.length - corner(r) * loss)), true],
      [runs.map((r) => Math.max(0, r.length - corner(r) * loss)), false],
    ] as const) {
      const alt = attempt(caps, grow);
      if (ok(alt) > ok(out)) out = alt;
    }
  }
  const rank: Record<RoomKind, number> = { sejour: 0, chambrePmr: 1, chambre: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
