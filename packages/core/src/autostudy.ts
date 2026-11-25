import { analyzeMass, analyzeMasses } from './analysis.js';
import type { BoundarySegment } from './boundaries.js';
import {
  difference,
  intersection,
  outsideArea,
  pointInRing,
  polygonArea,
  pointSegmentDistance,
  polygonDistance,
  polygonsArea,
  rotatePoint,
  transformPolygon,
} from './geometry.js';
import { massFootprints } from './generators.js';
import { newId } from './project.js';
import { kpisFR } from './rules.js';
import { defaultStoreys } from './settings.js';
import type {
  Constraints,
  FreeLineTypology,
  Mass,
  Polygon,
  Settings,
  StoreyStack,
  Usage,
  Vec2,
} from './types.js';

// ---------------------------------------------------------------------------
// Automatic massing study (étude de capacité automatique)
//
// The parcel minus the set-backs of every edge gives a buildable envelope per number of levels
// (prospects grow with the height). Candidate building forms (bar, parallel bars, L, U, point
// blocks) are fitted into each envelope in several orientations, checked against the hard rules
// (envelope, CES / pleine terre, height, distances between buildings, depths) and ranked by
// surface de plancher. The best candidate of every form is one scenario.
// ---------------------------------------------------------------------------

export type AutoUsage = 'wohnen' | 'wohnheim' | 'buero';
export const AUTO_USAGES: readonly AutoUsage[] = ['wohnen', 'wohnheim', 'buero'];

export type AutoFamily = 'zeile' | 'zeilen' | 'winkel' | 'uForm' | 'punkthaus' | 'doppelplot';
export const AUTO_FAMILIES: readonly AutoFamily[] = [
  'zeile',
  'zeilen',
  'winkel',
  'uForm',
  'punkthaus',
  'doppelplot',
];

/** Planning rules of the automatic study (FR: PLU, articles on implantation and height). */
export interface AutoStudyRules {
  /** Maximum height at the top slab (hauteur à l'égout / acrotère without parapet), m. */
  hauteurMax?: number;
  /** Maximum number of above-ground levels (R+3 → 4). */
  niveauxMax?: number;
  /** Maximum CES (emprise au sol / terrain), 0…1. */
  empriseMax?: number;
  /** Minimum share of pleine terre, 0…1 (approximated as site minus footprint). */
  pleineTerreMin?: number;
  /** Set-back from streets, paths and public spaces (recul / alignement = 0), m. */
  reculVoie: number;
  /** Limites séparatives: L ≥ ratio × H … */
  prospectRatio: number;
  /** … and at least this distance, m. */
  prospectMin: number;
  /** Between buildings on the same parcel: L ≥ ratio × H … */
  distanceRatio: number;
  /** … and at least this distance, m. */
  distanceMin: number;
  /**
   * Minimum distance per boundary edge (key: BoundarySegment.key), m. Replaces the street
   * set-back or the prospect minimum of that edge (e.g. a more sensitive neighbouring zone).
   */
  edgeRecul?: Record<string, number>;
}

export const DEFAULT_AUTO_RULES: AutoStudyRules = {
  reculVoie: 0,
  prospectRatio: 0.5,
  prospectMin: 4,
  distanceRatio: 0.5,
  distanceMin: 8,
};

/** Rules of the study from the project constraints (defaults where missing). */
export function autoRulesFromConstraints(c: Constraints): AutoStudyRules {
  const r: AutoStudyRules = {
    reculVoie: c.reculVoie ?? DEFAULT_AUTO_RULES.reculVoie,
    prospectRatio: c.prospectRatio ?? DEFAULT_AUTO_RULES.prospectRatio,
    prospectMin: c.prospectMin ?? DEFAULT_AUTO_RULES.prospectMin,
    distanceRatio: c.distanceRatio ?? DEFAULT_AUTO_RULES.distanceRatio,
    distanceMin: c.distanceMin ?? DEFAULT_AUTO_RULES.distanceMin,
  };
  const h = c.hauteurMax ?? c.maxHeight;
  if (h !== undefined) r.hauteurMax = h;
  if (c.niveauxMax !== undefined) r.niveauxMax = c.niveauxMax;
  if (c.empriseMax !== undefined) r.empriseMax = c.empriseMax;
  if (c.pleineTerreMin !== undefined) r.pleineTerreMin = c.pleineTerreMin;
  if (c.edgeRecul && Object.keys(c.edgeRecul).length) r.edgeRecul = { ...c.edgeRecul };
  return r;
}

/** The study rules written back into the project constraints. */
export function constraintsWithAutoRules(c: Constraints, r: AutoStudyRules): Constraints {
  const out: Constraints = {
    ...c,
    reculVoie: r.reculVoie,
    prospectRatio: r.prospectRatio,
    prospectMin: r.prospectMin,
    distanceRatio: r.distanceRatio,
    distanceMin: r.distanceMin,
  };
  const opt = (k: 'hauteurMax' | 'niveauxMax' | 'empriseMax' | 'pleineTerreMin') => {
    if (r[k] === undefined) delete out[k];
    else out[k] = r[k];
  };
  opt('hauteurMax');
  opt('niveauxMax');
  opt('empriseMax');
  opt('pleineTerreMin');
  if (r.edgeRecul && Object.keys(r.edgeRecul).length) out.edgeRecul = { ...r.edgeRecul };
  else delete out.edgeRecul;
  return out;
}

/** Building forms and dimensions of one use. */
export interface AutoStudyOptions {
  usage: AutoUsage;
  families: AutoFamily[];
  /** Maximum number of buildings of a scenario. */
  maxBuildings: number;
  /** Building depth of bars, L and U (min, max), m. */
  depth: [number, number];
  /** Side of point blocks (min, max), m. */
  pointSide: [number, number];
  /** Minimum length of a bar / wing beyond the corner, m. */
  minLength: number;
}

/** Office defaults: housing bars ≤ 15 m deep, residences 12–15 m, offices 13.5–18 m. */
export function defaultAutoOptions(usage: AutoUsage): AutoStudyOptions {
  const base = { usage, families: [...AUTO_FAMILIES], maxBuildings: 3, minLength: 12 };
  switch (usage) {
    case 'wohnen':
      return { ...base, depth: [11, 15], pointSide: [18, 24] };
    case 'wohnheim':
      return { ...base, depth: [12, 15], pointSide: [18, 24] };
    case 'buero':
      return { ...base, depth: [13.5, 18], pointSide: [20, 28] };
  }
}

export interface AutoStudyInput {
  /** Site boundary (project coordinates). */
  boundary: Polygon;
  /** Classified boundary (siteBoundaries). */
  edges: readonly BoundarySegment[];
  /** Optional zone constructible / Baufenster: the buildings stay inside. */
  buildable?: Polygon[];
  rules: AutoStudyRules;
  options: AutoStudyOptions;
  settings: Settings;
}

/** Which rule bounds a scenario (shown to the user). */
export type AutoLimit = 'emprise' | 'hauteur' | 'niveaux' | 'prospect' | 'recul' | 'distance';

export interface AutoScenario {
  id: string;
  usage: AutoUsage;
  family: AutoFamily;
  /** Above-ground levels (R+n → n+1). */
  levels: number;
  masses: Mass[];
  /** Buildable envelope at this height (project coordinates). */
  envelope: Polygon[];
  footprintArea: number;
  ces: number;
  surfaceDePlancher: number;
  /** Net usable area (NUF / SU). */
  nuf: number;
  surfaceHabitable: number;
  /** Top slab height, m. */
  height: number;
  dwellings: number;
  workplaces: number;
  limits: AutoLimit[];
}

export interface AutoStudyResult {
  scenarios: AutoScenario[];
  /** Highest number of levels the height rules allow. */
  maxLevels: number;
  /** Envelope without any building (lowest height). */
  envelope: Polygon[];
}

// ---------------------------------------------------------------------------
// Heights and envelopes
// ---------------------------------------------------------------------------

const MASS_USAGE: Record<AutoUsage, Usage> = {
  wohnen: 'wohnen',
  wohnheim: 'wohnheim',
  buero: 'buero',
};

function stack(usage: AutoUsage, levels: number): StoreyStack {
  const s = defaultStoreys(MASS_USAGE[usage]);
  return { ...s, upper: { ...s.upper, count: Math.max(0, levels - 1) } };
}

/** Top slab height (hauteur à l'égout) of a building with `levels` levels. */
export function autoLevelHeight(usage: AutoUsage, levels: number, settings: Settings): number {
  const m: Mass = {
    id: 'probe',
    name: 'probe',
    typology: { kind: 'solitaer', length: 10, depth: 10 },
    position: [0, 0],
    rotation: 0,
    storeys: stack(usage, levels),
    usage: MASS_USAGE[usage],
  };
  return analyzeMass(m, settings).eavesHeight;
}

/** Highest allowed number of levels (at least 1, at most 15). */
export function autoMaxLevels(usage: AutoUsage, rules: AutoStudyRules, settings: Settings): number {
  let max = Math.min(15, rules.niveauxMax ?? 15);
  if (rules.hauteurMax !== undefined) {
    let n = 1;
    while (n < max && autoLevelHeight(usage, n + 1, settings) <= rules.hauteurMax + 1e-6) n++;
    max = n;
  }
  return Math.max(1, max);
}

const isStreet = (k: BoundarySegment['kind']) => k === 'road' || k === 'path' || k === 'public';

/** Required distance of a boundary piece for a building of height `h`. */
export function edgeDistance(e: BoundarySegment, rules: AutoStudyRules, h: number): number {
  const override = rules.edgeRecul?.[e.key];
  if (isStreet(e.kind)) return override ?? rules.reculVoie;
  return Math.max(override ?? rules.prospectMin, rules.prospectRatio * h);
}

/** Buildable envelope for buildings of height `h`: site minus a band along every edge. */
export function autoEnvelope(
  boundary: Polygon,
  edges: readonly BoundarySegment[],
  rules: AutoStudyRules,
  h: number,
  buildable?: Polygon[],
): Polygon[] {
  const bands: Polygon[] = [];
  for (const e of edges) {
    const d = edgeDistance(e, rules, h);
    if (d <= 1e-6) continue;
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    let nx = -dy / len;
    let ny = dx / len;
    const mid: Vec2 = [(e.a[0] + e.b[0]) / 2 + nx * 0.05, (e.a[1] + e.b[1]) / 2 + ny * 0.05];
    if (!pointInRing(mid, boundary.outer)) {
      nx = -nx;
      ny = -ny;
    }
    // inward by d, outward by 1 m (no slivers along the boundary)
    bands.push({
      outer: [
        [e.a[0] - nx, e.a[1] - ny],
        [e.b[0] - nx, e.b[1] - ny],
        [e.b[0] + nx * d, e.b[1] + ny * d],
        [e.a[0] + nx * d, e.a[1] + ny * d],
      ],
    });
  }
  let env = difference([boundary], bands);
  if (buildable?.length) env = intersection(env, buildable);
  return env.filter((p) => polygonArea(p) > 20);
}

// ---------------------------------------------------------------------------
// Fitting in a rotated frame (x along the main direction)
// ---------------------------------------------------------------------------

type Interval = [number, number];
type Rings = Vec2[][];

/** x-intervals where the horizontal line at `y` lies inside the rings (even-odd). */
function lineIntervals(rings: Rings, y: number): Interval[] {
  const xs: number[] = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  }
  xs.sort((p, q) => p - q);
  const out: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]![0], b[j]![0]);
    const hi = Math.min(a[i]![1], b[j]![1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i]![1] < b[j]![1]) i++;
    else j++;
  }
  return out;
}

/**
 * x-intervals where the whole band y0…y1 lies inside the rings. Exact for polygons: the inside
 * intervals change linearly between vertex heights, so checking the band ends and every vertex
 * height inside the band is enough.
 */
function bandIntervals(rings: Rings, y0: number, y1: number): Interval[] {
  const eps = 1e-4;
  const ys = [y0 + eps, y1 - eps];
  for (const r of rings) for (const p of r) if (p[1] > y0 && p[1] < y1) ys.push(p[1]);
  let acc: Interval[] | null = null;
  for (const y of ys) {
    const iv = lineIntervals(rings, y);
    acc = acc ? intersectIntervals(acc, iv) : iv;
    if (!acc.length) return [];
  }
  return acc ?? [];
}

const swapRings = (rings: Rings): Rings => rings.map((r) => r.map(([x, y]) => [y, x] as Vec2));

function longest(iv: Interval[]): Interval | undefined {
  let best: Interval | undefined;
  for (const i of iv) if (!best || i[1] - i[0] > best[1] - best[0]) best = i;
  return best;
}

/** Interval of `iv` containing [lo, hi], if any. */
function containing(iv: Interval[], lo: number, hi: number): Interval | undefined {
  return iv.find((i) => i[0] <= lo + 1e-6 && i[1] >= hi - 1e-6);
}

/** A building in the rotated frame. */
type Shape =
  | { kind: 'bar'; x0: number; x1: number; y0: number; d: number }
  | { kind: 'line'; pts: Vec2[]; d: number }
  | { kind: 'point'; x0: number; y0: number; s: number }
  /** One building with a free outline (two blocks overlapping at a corner). */
  | { kind: 'poly'; pts: Vec2[] };

function shapeArea(s: Shape): number {
  switch (s.kind) {
    case 'bar':
      return (s.x1 - s.x0) * s.d;
    case 'poly':
      return polygonArea({ outer: s.pts });
    case 'point':
      return s.s * s.s;
    case 'line': {
      let l = 0;
      for (let i = 1; i < s.pts.length; i++)
        l += Math.hypot(s.pts[i]![0] - s.pts[i - 1]![0], s.pts[i]![1] - s.pts[i - 1]![1]);
      return l * s.d;
    }
  }
}

interface Candidate {
  family: AutoFamily;
  shapes: Shape[];
  theta: number;
  levels: number;
  trimmed: boolean;
}

const STEP = 0.5;

function depths([a, b]: [number, number]): number[] {
  const r = (v: number) => Math.round(v * 2) / 2;
  return [...new Set([r(b), r((a + b) / 2), r(a)])].filter((d) => d > 0);
}

/**
 * Distance of an axis-aligned rectangle (rotated frame) beyond the set-back line of the nearest
 * street: ≈ 0 when the building stands on the street set-back (alignement), Infinity without
 * streets.
 */
type Near = (x0: number, y0: number, x1: number, y1: number) => number;

/** A building on the street line is worth this much extra bar length when ranking positions, m. */
const STREET_BONUS = 3;
/** Tolerance for "on the street line", m. */
const ON_STREET = 0.6;

function streetNear(streets: { a: Vec2; b: Vec2; req: number }[]): Near {
  if (!streets.length) return () => Infinity;
  return (x0, y0, x1, y1) => {
    const corners: Vec2[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    let best = Infinity;
    for (const st of streets) {
      let d = Infinity;
      for (const c of corners) d = Math.min(d, pointSegmentDistance(c, st.a, st.b));
      for (const q of [st.a, st.b]) {
        const dx = Math.max(x0 - q[0], 0, q[0] - x1);
        const dy = Math.max(y0 - q[1], 0, q[1] - y1);
        d = Math.min(d, Math.hypot(dx, dy));
      }
      best = Math.min(best, d - st.req);
    }
    return best;
  };
}

const onStreet = (near: Near, x0: number, y0: number, x1: number, y1: number) =>
  near(x0, y0, x1, y1) <= ON_STREET;

/** Longest bar of depth d at every grid row y (index i → y = ymin + i·STEP). */
function barRows(
  rings: Rings,
  ymin: number,
  ymax: number,
  d: number,
  minLength: number,
  near: Near,
) {
  const rows: { y0: number; iv?: Interval; street?: boolean }[] = [];
  const ys: number[] = [];
  for (let y0 = ymin; y0 + d <= ymax + 1e-9; y0 += STEP) ys.push(y0);
  // the last row flush with the top of the envelope (street lines on both sides)
  if (ymax - d > ymin && ymax - d - (ys[ys.length - 1] ?? -Infinity) > 1e-6) ys.push(ymax - d);
  for (const y0 of ys) {
    const iv = longest(bandIntervals(rings, y0, y0 + d));
    rows.push(
      iv && iv[1] - iv[0] >= minLength
        ? { y0, iv, street: onStreet(near, iv[0], y0, iv[1], y0 + d) }
        : { y0 },
    );
  }
  return rows;
}

function fitBars(
  rings: Rings,
  ymin: number,
  ymax: number,
  o: AutoStudyOptions,
  gap: number,
  count: number,
  near: Near,
): Shape[][] {
  const out: Shape[][] = [];
  for (const d of depths(o.depth)) {
    const rows = barRows(rings, ymin, ymax, d, o.minLength, near);
    // bars on the street line rank higher (same SDP → the street wins)
    const len = rows.map((r) => (r.iv ? r.iv[1] - r.iv[0] + (r.street ? STREET_BONUS : 0) : 0));
    // rows are 0.5 m apart except the last one: next row index at least d + gap further up
    const next = rows.map((r, i) => {
      let j = i + 1;
      while (j < rows.length && rows[j]!.y0 < r.y0 + d + gap - 1e-6) j++;
      return j;
    });
    // best[k][i]: best total length of k bars using rows i…, choice[k][i]: row of the first bar
    const n = rows.length;
    const best: number[][] = [];
    const pick: number[][] = [];
    for (let k = 0; k <= count; k++) {
      best.push(new Array<number>(n + 1).fill(0));
      pick.push(new Array<number>(n + 1).fill(-1));
    }
    for (let k = 1; k <= count; k++) {
      for (let i = n - 1; i >= 0; i--) {
        best[k]![i] = best[k]![i + 1]!;
        pick[k]![i] = pick[k]![i + 1]!;
        if (len[i]! > 0) {
          const rest = best[k - 1]![next[i]!]!;
          const v = len[i]! + rest;
          if (v > best[k]![i]! + 1e-9) {
            best[k]![i] = v;
            pick[k]![i] = i;
          }
        }
      }
    }
    for (let k = 1; k <= count; k++) {
      const shapes: Shape[] = [];
      let i = 0;
      for (let kk = k; kk >= 1 && i < n; kk--) {
        const p = pick[kk]![i]!;
        if (p < 0) break;
        const r = rows[p]!;
        shapes.push({ kind: 'bar', x0: r.iv![0], x1: r.iv![1], y0: r.y0, d });
        i = next[p]!;
      }
      if (shapes.length === k) out.push(shapes);
    }
  }
  return out;
}

/** L (one wing) and U (two wings) shapes on a bar along x. */
function fitWings(
  rings: Rings,
  swapped: Rings,
  ymin: number,
  ymax: number,
  o: AutoStudyOptions,
  gap: number,
  u: boolean,
  near: Near,
): Shape[][] {
  const out: Shape[][] = [];
  for (const d of depths(o.depth)) {
    const rows = barRows(rings, ymin, ymax, d, o.minLength, near);
    let best: { area: number; shape: Shape } | undefined;
    for (const r of rows) {
      if (!r.iv) continue;
      const [xa, xb] = r.iv;
      const y0 = r.y0;
      // vertical band of the wing at the left / right end: y-intervals containing the bar
      const wing = (x: number) => containing(bandIntervals(swapped, x, x + d), y0, y0 + d);
      const left = wing(xa);
      const right = wing(xb - d);
      if (u ? !left || !right : !left && !right) continue;
      for (const up of [true, false]) {
        const ext = (iv?: Interval) => (!iv ? 0 : up ? iv[1] - (y0 + d) : y0 - iv[0]);
        const yc = y0 + d / 2;
        const tip = (iv?: Interval) => (!iv ? yc : up ? iv[1] : iv[0]);
        const eL = ext(left);
        const eR = ext(right);
        // bonus when the bar or a wing stands on the street line
        const wingOn = (x: number, iv?: Interval) =>
          !!iv && onStreet(near, x, Math.min(y0, tip(iv)), x + d, Math.max(y0 + d, tip(iv)));
        const score = (area: number, wings: [number, Interval | undefined][]) =>
          area + (r.street || wings.some(([x, iv]) => wingOn(x, iv)) ? STREET_BONUS * d : 0);
        if (u) {
          if (eL < o.minLength || eR < o.minLength) continue;
          if (xb - xa - 2 * d < gap) continue;
          const pts: Vec2[] = [
            [xa + d / 2, tip(left)],
            [xa + d / 2, yc],
            [xb - d / 2, yc],
            [xb - d / 2, tip(right)],
          ];
          const shape: Shape = { kind: 'line', pts, d };
          const area = score(shapeArea(shape), [
            [xa, left],
            [xb - d, right],
          ]);
          if (!best || area > best.area) best = { area, shape };
        } else {
          for (const atLeft of [true, false]) {
            const e = atLeft ? eL : eR;
            if (e < o.minLength) continue;
            const pts: Vec2[] = atLeft
              ? [
                  [xa + d / 2, tip(left)],
                  [xa + d / 2, yc],
                  [xb, yc],
                ]
              : [
                  [xa, yc],
                  [xb - d / 2, yc],
                  [xb - d / 2, tip(right)],
                ];
            const shape: Shape = { kind: 'line', pts, d };
            const area = score(shapeArea(shape), [atLeft ? [xa, left] : [xb - d, right]]);
            if (!best || area > best.area) best = { area, shape };
          }
        }
      }
    }
    if (best) out.push([best.shape]);
  }
  return out;
}

/** Point blocks (square solitaires), greedy packing from each corner. */
function fitPoints(
  rings: Rings,
  box: { xmin: number; xmax: number; ymin: number; ymax: number },
  o: AutoStudyOptions,
  gap: number,
  near: Near,
): Shape[][] {
  const out: Shape[][] = [];
  const r = (v: number) => Math.round(v * 2) / 2;
  for (const s of [
    ...new Set([r(o.pointSide[1]), r((o.pointSide[0] + o.pointSide[1]) / 2), r(o.pointSide[0])]),
  ]) {
    const spots: { x0: number; y0: number; slack: number }[] = [];
    const ys: number[] = [];
    for (let y0 = box.ymin; y0 + s <= box.ymax + 1e-9; y0 += 1) ys.push(y0);
    if (box.ymax - s > box.ymin) ys.push(box.ymax - s);
    for (const y0 of ys) {
      const iv = bandIntervals(rings, y0, y0 + s);
      for (const [a, b] of iv) {
        const xs: number[] = [];
        for (let x0 = a; x0 + s <= b + 1e-9; x0 += 1) xs.push(x0);
        if (b - s > a) xs.push(b - s);
        for (const x0 of xs) spots.push({ x0, y0, slack: near(x0, y0, x0 + s, y0 + s) });
      }
    }
    if (!spots.length) continue;
    let bestSet: Shape[] = [];
    let bestStreet = -1;
    const orders: ((p: { x0: number; y0: number; slack: number }) => number)[] = [
      // along the street first: closest to the street line, then from one end
      (p) => Math.round(Math.max(0, p.slack)) * 1e8 + p.y0 * 1e4 + p.x0,
      (p) => Math.round(Math.max(0, p.slack)) * 1e8 + p.y0 * 1e4 - p.x0,
      (p) => Math.round(Math.max(0, p.slack)) * 1e8 + p.x0 * 1e4 + p.y0,
      (p) => p.y0 * 1e4 + p.x0,
      (p) => p.y0 * 1e4 - p.x0,
      (p) => -p.y0 * 1e4 + p.x0,
      (p) => -p.y0 * 1e4 - p.x0,
      (p) => p.x0 * 1e4 + p.y0,
      (p) => -p.x0 * 1e4 + p.y0,
    ];
    for (const ord of orders) {
      const sorted = [...spots].sort((a, b) => ord(a) - ord(b));
      const placed: { x0: number; y0: number; slack: number }[] = [];
      for (const p of sorted) {
        if (placed.length >= o.maxBuildings) break;
        const ok = placed.every((q) => {
          const dx = Math.max(0, Math.abs(p.x0 - q.x0) - s);
          const dy = Math.max(0, Math.abs(p.y0 - q.y0) - s);
          return Math.hypot(dx, dy) >= gap - 1e-6;
        });
        if (ok) placed.push(p);
      }
      const street = placed.filter((p) => p.slack <= ON_STREET).length;
      if (
        placed.length > bestSet.length ||
        (placed.length === bestSet.length && street > bestStreet)
      ) {
        // street blocks first, so smaller counts keep them
        placed.sort((a, b) => a.slack - b.slack);
        bestSet = placed.map((p) => ({ kind: 'point', x0: p.x0, y0: p.y0, s }));
        bestStreet = street;
      }
    }
    // every count up to the best one (fewer, larger towers may win once emprise binds)
    for (let k = 1; k <= bestSet.length; k++) out.push(bestSet.slice(0, k));
  }
  return out;
}

/**
 * Two square blocks overlapping at one corner (classic office form), as one building: the
 * overlap is part of a single outline, so it counts once.
 */
function fitOffsetBlocks(
  rings: Rings,
  box: { xmin: number; xmax: number; ymin: number; ymax: number },
  o: AutoStudyOptions,
  near: Near,
): Shape[][] {
  const out: Shape[][] = [];
  const r = (v: number) => Math.round(v * 2) / 2;
  const sides = [
    ...new Set([r(o.pointSide[1]), r((o.pointSide[0] + o.pointSide[1]) / 2), r(o.pointSide[0])]),
  ];
  const fits = (x: number, y: number, s: number) =>
    !!containing(bandIntervals(rings, y, y + s), x, x + s);
  for (const s of sides) {
    for (const share of [1 / 3, 1 / 2]) {
      const t = s - r(s * share); // offset of the second block; overlap = s − t
      let best: { score: number; pts: Vec2[] } | undefined;
      for (let y = box.ymin; y + s + t <= box.ymax + 1e-9; y += 1) {
        for (let x = box.xmin; x + s <= box.xmax + 1e-9; x += 1) {
          if (!fits(x, y, s)) continue;
          for (const right of [true, false]) {
            const bx = right ? x + t : x - t;
            if (!fits(bx, y + t, s)) continue;
            const canon: Vec2[] = [
              [x, y],
              [x + s, y],
              [x + s, y + t],
              [x + t + s, y + t],
              [x + t + s, y + t + s],
              [x + t, y + t + s],
              [x + t, y + s],
              [x, y + s],
            ];
            // mirror about the first block's axis for the up-left variant (keep CCW)
            const pts = right
              ? canon
              : canon.map(([px, py]) => [2 * x + s - px, py] as Vec2).reverse();
            const area = 2 * s * s - (s - t) * (s - t);
            const street =
              onStreet(near, x, y, x + s, y + s) || onStreet(near, bx, y + t, bx + s, y + t + s);
            const score = area + (street ? STREET_BONUS * s : 0);
            if (!best || score > best.score) best = { score, pts };
          }
        }
      }
      if (best) out.push([{ kind: 'poly', pts: best.pts }]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emprise cap: shorten / shrink the buildings
// ---------------------------------------------------------------------------

function trimPolylineEnd(pts: Vec2[], cut: number): Vec2[] {
  const out = pts.map((p) => [p[0], p[1]] as Vec2);
  let rest = cut;
  while (rest > 1e-9 && out.length >= 2) {
    const a = out[out.length - 2]!;
    const b = out[out.length - 1]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > rest) {
      const t = (l - rest) / l;
      out[out.length - 1] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      rest = 0;
    } else {
      out.pop();
      rest -= l;
    }
  }
  return out;
}

function capShapes(shapes: Shape[], cap: number, o: AutoStudyOptions): Shape[] | undefined {
  const total = shapes.reduce((s, x) => s + shapeArea(x), 0);
  if (total <= cap + 1e-6) return shapes;
  if (shapes[0]!.kind === 'point') {
    for (let k = shapes.length; k >= 1; k--) {
      const s = Math.min((shapes[0] as { s: number }).s, Math.sqrt(cap / k));
      if (s >= o.pointSide[0] - 1e-6)
        return shapes.slice(0, k).map((x) => {
          const p = x as Extract<Shape, { kind: 'point' }>;
          const c = (p.s - s) / 2;
          return { kind: 'point', x0: p.x0 + c, y0: p.y0 + c, s };
        });
    }
    return undefined;
  }
  // smaller offset blocks are separate candidates
  if (shapes.some((x) => x.kind === 'poly')) return undefined;
  const factor = cap / total;
  const out: Shape[] = [];
  for (const x of shapes) {
    if (x.kind === 'bar') {
      const l = (x.x1 - x.x0) * factor;
      if (l < o.minLength) return undefined;
      const c = (x.x0 + x.x1) / 2;
      out.push({ ...x, x0: c - l / 2, x1: c + l / 2 });
    } else if (x.kind === 'line') {
      // shorten both ends equally, keep each end segment ≥ minLength beyond the corner
      const cut = (shapeArea(x) * (1 - factor)) / x.d;
      const n = x.pts.length;
      const seg = (i: number) =>
        Math.hypot(x.pts[i + 1]![0] - x.pts[i]![0], x.pts[i + 1]![1] - x.pts[i]![1]);
      const first = seg(0) - (n > 2 ? x.d / 2 + o.minLength : o.minLength);
      const last = seg(n - 2) - (n > 2 ? x.d / 2 + o.minLength : o.minLength);
      if (first + last < cut - 1e-6) return undefined;
      let a = Math.min(first, cut / 2);
      const b = Math.min(last, cut - a);
      a = cut - b;
      const pts = trimPolylineEnd([...trimPolylineEnd([...x.pts].reverse(), a)].reverse(), b);
      out.push({ kind: 'line', pts, d: x.d });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shapes → masses
// ---------------------------------------------------------------------------

const rot = (p: Vec2, theta: number): Vec2 => rotatePoint(p, theta);

function shapeToMass(s: Shape, theta: number, usage: AutoUsage, levels: number, i: number): Mass {
  const base = {
    id: newId('mass'),
    name: `BK${i + 1}`,
    rotation: theta,
    storeys: stack(usage, levels),
    usage: MASS_USAGE[usage],
    access: 'auto' as const,
  };
  switch (s.kind) {
    case 'bar': {
      const length = s.x1 - s.x0;
      return {
        ...base,
        position: rot([s.x0, s.y0 + s.d / 2], theta),
        typology: {
          kind: 'zeile',
          length,
          depth: s.d,
          sections: Math.max(1, Math.round(length / 20)),
          sectionOffset: 0,
        },
      };
    }
    case 'poly': {
      const p0 = s.pts[0]!;
      return {
        ...base,
        position: rot(p0, theta),
        typology: {
          kind: 'freePolygon',
          polygon: { outer: s.pts.map((p) => [p[0] - p0[0], p[1] - p0[1]] as Vec2) },
        },
      };
    }
    case 'point':
      return {
        ...base,
        position: rot([s.x0 + s.s / 2, s.y0 + s.s / 2], theta),
        typology: { kind: 'solitaer', length: s.s, depth: s.s },
      };
    case 'line': {
      const p0 = s.pts[0]!;
      const typology: FreeLineTypology = {
        kind: 'freeLine',
        points: s.pts.map((p) => [p[0] - p0[0], p[1] - p0[1]] as Vec2),
        closed: false,
        depth: s.d,
        alignment: 'center',
      };
      return { ...base, position: rot(p0, theta), typology };
    }
  }
}

// ---------------------------------------------------------------------------
// Orientations
// ---------------------------------------------------------------------------

/** Main directions of the envelope / site (mod 90°), longest edges first, plus their normals. */
function orientations(polys: readonly Polygon[], max = 4): number[] {
  const acc: { a: number; w: number }[] = [];
  const quarter = Math.PI / 2;
  for (const p of polys) {
    const r = p.outer;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 4) continue;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) % quarter;
      if (ang < 0) ang += quarter;
      const hit = acc.find((x) => {
        const dd = Math.abs(x.a - ang);
        return Math.min(dd, quarter - dd) < (2 * Math.PI) / 180;
      });
      if (hit) hit.w += l;
      else acc.push({ a: ang, w: l });
    }
  }
  acc.sort((x, y) => y.w - x.w);
  const out: number[] = [];
  for (const x of acc.slice(0, max)) out.push(x.a, x.a + quarter);
  return out.length ? out : [0, quarter];
}

// ---------------------------------------------------------------------------
// The study
// ---------------------------------------------------------------------------

interface Evaluated {
  cand: Candidate;
  masses: Mass[];
  sdp: number;
  result: ReturnType<typeof analyzeMasses>;
}

/** Façade length standing on a street set-back line (alignement), m. */
function streetFacade(
  masses: readonly Mass[],
  edges: readonly BoundarySegment[],
  rules: AutoStudyRules,
  h: number,
): number {
  const streets = edges.filter((e) => isStreet(e.kind));
  if (!streets.length) return 0;
  let total = 0;
  for (const m of masses)
    for (const fp of massFootprints(m)) {
      const r = fp.outer;
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!;
        const b = r[(i + 1) % r.length]!;
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const on = streets.some(
          (e) => pointSegmentDistance(mid, e.a, e.b) - edgeDistance(e, rules, h) <= ON_STREET,
        );
        if (on) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  return total;
}

/** Run the automatic study for one use. */
export function runAutoStudy(input: AutoStudyInput): AutoStudyResult {
  const { boundary, edges, rules, options: o, settings } = input;
  const siteArea = polygonArea(boundary);
  const maxLevels = autoMaxLevels(o.usage, rules, settings);
  const cap = siteArea * Math.min(rules.empriseMax ?? 1, 1 - (rules.pleineTerreMin ?? 0));
  const families = new Set(o.families);
  const maxB = Math.max(1, Math.round(o.maxBuildings));

  const baseEnv = autoEnvelope(boundary, edges, { ...rules, prospectRatio: 0 }, 0, input.buildable);
  const baseEnvArea = polygonsArea(baseEnv);

  const byFamily = new Map<AutoFamily, { cand: Candidate; est: number }[]>();
  const envs = new Map<number, Polygon[]>();
  const heights = new Map<number, number>();
  for (let levels = 1; levels <= maxLevels; levels++) {
    const h = autoLevelHeight(o.usage, levels, settings);
    heights.set(levels, h);
    const env = autoEnvelope(boundary, edges, rules, h, input.buildable);
    envs.set(levels, env);
    if (!env.length) continue;
    const gap = Math.max(rules.distanceMin, rules.distanceRatio * h);
    for (const theta of orientations(env.length ? env : [boundary])) {
      const local = env.map((p) => transformPolygon(p, [0, 0], -theta));
      const rings: Rings = local.flatMap((p) => [p.outer, ...(p.holes ?? [])]);
      const near = streetNear(
        edges
          .filter((e) => isStreet(e.kind))
          .map((e) => ({
            a: rotatePoint(e.a, -theta),
            b: rotatePoint(e.b, -theta),
            req: edgeDistance(e, rules, h),
          })),
      );
      const swapped = swapRings(rings);
      let xmin = Infinity;
      let xmax = -Infinity;
      let ymin = Infinity;
      let ymax = -Infinity;
      for (const p of local)
        for (const [x, y] of p.outer) {
          xmin = Math.min(xmin, x);
          xmax = Math.max(xmax, x);
          ymin = Math.min(ymin, y);
          ymax = Math.max(ymax, y);
        }
      const add = (family: AutoFamily, list: Shape[][]) => {
        for (const raw of list) {
          const shapes = capShapes(raw, cap, o);
          if (!shapes?.length) continue;
          const est = shapes.reduce((s, x) => s + shapeArea(x), 0) * levels;
          const arr = byFamily.get(family) ?? [];
          arr.push({ cand: { family, shapes, theta, levels, trimmed: shapes !== raw }, est });
          byFamily.set(family, arr);
        }
      };
      if (families.has('zeile')) add('zeile', fitBars(rings, ymin, ymax, o, gap, 1, near));
      if (families.has('zeilen') && maxB >= 2)
        add(
          'zeilen',
          fitBars(rings, ymin, ymax, o, gap, maxB, near).filter((s) => s.length >= 2),
        );
      if (families.has('winkel'))
        add('winkel', fitWings(rings, swapped, ymin, ymax, o, gap, false, near));
      if (families.has('uForm'))
        add('uForm', fitWings(rings, swapped, ymin, ymax, o, gap, true, near));
      if (families.has('punkthaus'))
        add('punkthaus', fitPoints(rings, { xmin, xmax, ymin, ymax }, o, gap, near));
      if (families.has('doppelplot'))
        add('doppelplot', fitOffsetBlocks(rings, { xmin, xmax, ymin, ymax }, o, near));
    }
  }

  const scenarios: AutoScenario[] = [];
  for (const family of AUTO_FAMILIES) {
    const list = byFamily.get(family);
    if (!list?.length) continue;
    list.sort((a, b) => b.est - a.est);
    const evaluated: (Evaluated & { street: number })[] = [];
    for (const { cand } of list.slice(0, 10)) {
      const masses = cand.shapes.map((s, i) => shapeToMass(s, cand.theta, o.usage, cand.levels, i));
      // safety net: everything inside the envelope of its height
      const env = envs.get(cand.levels)!;
      if (masses.some((m) => outsideArea(massFootprints(m), env) > 0.5)) continue;
      const result = analyzeMasses(masses, settings);
      const sdp = kpisFR(result, siteArea, settings).surfaceDePlancher;
      const street = streetFacade(masses, edges, rules, heights.get(cand.levels) ?? 0);
      evaluated.push({ cand, masses, sdp, result, street });
    }
    if (!evaluated.length) continue;
    // max SDP; within 2 % of it the variant with the longest façade on the street line wins
    const top = Math.max(...evaluated.map((e) => e.sdp));
    const best = evaluated
      .filter((e) => e.sdp >= top * 0.98 - 1e-6)
      .sort((a, b) => b.street - a.street || b.sdp - a.sdp)[0]!;
    const { cand, masses, result } = best;
    const fr = kpisFR(result, siteArea, settings);
    const env = envs.get(cand.levels)!;
    const limits: AutoLimit[] = [];
    if (cand.trimmed || (rules.empriseMax !== undefined && fr.ces >= rules.empriseMax - 0.005))
      limits.push('emprise');
    if (cand.levels === maxLevels) {
      if (rules.niveauxMax !== undefined && maxLevels >= rules.niveauxMax) limits.push('niveaux');
      else if (rules.hauteurMax !== undefined) limits.push('hauteur');
    }
    if (polygonsArea(env) < baseEnvArea - 1) limits.push('prospect');
    else if (edges.some((e) => edgeDistance(e, rules, 0) > 0)) limits.push('recul');
    if (masses.length > 1) {
      // the distance rule binds when two buildings stand (almost) at the minimum distance
      const h = heights.get(cand.levels) ?? 0;
      const gap = Math.max(rules.distanceMin, rules.distanceRatio * h);
      const fps = masses.map((m) => massFootprints(m));
      let min = Infinity;
      for (let i = 0; i < fps.length; i++)
        for (let j = i + 1; j < fps.length; j++)
          for (const a of fps[i]!)
            for (const b of fps[j]!) min = Math.min(min, polygonDistance(a, b));
      if (min <= gap + 1) limits.push('distance');
    }
    scenarios.push({
      id: newId('scn'),
      usage: o.usage,
      family,
      levels: cand.levels,
      masses,
      envelope: env,
      footprintArea: fr.emprise,
      ces: fr.ces,
      surfaceDePlancher: fr.surfaceDePlancher,
      nuf: result.areasAbove.nuf,
      surfaceHabitable: result.livingArea,
      height: heights.get(cand.levels) ?? 0,
      dwellings: result.dwellings,
      workplaces: result.workplaces,
      limits,
    });
  }
  scenarios.sort((a, b) => b.surfaceDePlancher - a.surfaceDePlancher);
  return { scenarios, maxLevels, envelope: baseEnv };
}
