/**
 * Schematic unit layout (plan d'étage schématique / Wohnungsaufteilung).
 *
 * For every above-ground storey of a mass the footprint is subdivided into stair cores,
 * circulation (landing, gallery, corridor) and dwellings, following the access type of the mass
 * and the target unit mix. Pure and deterministic; all output is in world (project) coordinates.
 *
 * Every footprint is cut into straight "bars" (a rectangle in a local frame: a = along the axis,
 * b = across the depth, b = 0 on the access side, preferably north). The access rules lay out
 * rectangles inside each bar, which are then clipped to the real footprint, so the pieces are
 * always disjoint, inside the footprint and – together – cover it exactly.
 */
import {
  analyzeMasses,
  isMemoizedMassResult,
  type MassResult,
  type VariantResult,
} from './analysis.js';
import { largestRemainder, unitMix, unitsPerCoreRange } from './mix.js';
import {
  difference,
  intersection,
  normalizePolygon,
  offsetPolygons,
  overlapArea,
  orientedExtents,
  rect,
  polygonArea,
  polygonPerimeter,
  ringCentroid,
  union,
} from './geometry.js';
import { requiredCores, resolveAccess } from './typologies.js';
import { resolveStairRules } from './stairs.js';
import {
  coreRange,
  facadeOf,
  minUnitWidth,
  polygonEdges,
  roomsFit,
  requiredFacade,
  resolveUnitRules,
  unitRooms,
} from './unitRules.js';
import { duplexProgram, duplexWet, unitRoomLayout, wetProgram, type LayoutRoom } from './rooms.js';
import {
  FACADE_SIDES,
  facadeSide,
  placeOutdoor,
  resolveOutdoor,
  resolveOutdoorRules,
  sideConfig,
  type LayoutOutdoor,
} from './outdoor.js';
import type {
  AccessType,
  DuplexConfig,
  FacadeSide,
  Mass,
  Polygon,
  Project,
  Settings,
  StoreySolid,
  UnitType,
  Usage,
  Vec2,
} from './types.js';

export type LayoutAreaKind = 'core' | 'landing' | 'gallery' | 'corridor' | 'lift' | 'open';

export interface LayoutArea {
  kind: LayoutAreaKind;
  polygon: Polygon;
  area: number;
  /** Core number within the storey (cores only). */
  index?: number;
  /** Oriented rectangle of the core (cores only), for the stair inside it. */
  box?: CoreBox;
}

/**
 * Oriented rectangle in world coordinates: corner `o`, unit axis `u` (along the bar, length
 * `w`) and unit axis `n` (across the depth, length `d`, pointing away from the access side).
 */
export interface CoreBox {
  o: Vec2;
  u: Vec2;
  n: Vec2;
  w: number;
  d: number;
}

export interface LayoutUnit {
  polygon: Polygon;
  typeId: string;
  label: string;
  area: number;
  /** Serving core (index into `cores`), -1 for houses with their own stair. */
  coreIndex: number;
  /** True when the area lies outside [areaMin, areaMax] of the chosen type. */
  outOfRange: boolean;
  /** Façade length of the unit (edges on the exterior of the storey footprint), m. */
  facade: number;
  /** Minimum façade length of the chosen type (office rules), m. */
  facadeRequired: number;
  /** False when the unit does not meet the minimum façade length. */
  facadeOk: boolean;
  /** Façade pieces of the unit (world coordinates), for drawing. */
  facadeSegments: [Vec2, Vec2][];
  /**
   * Rooms: séjour, chambre PMR, chambres (and a separate kitchen) along the façade, the wet
   * core (gaine, SDB, WC, SDE) behind them and the passage (dégagement).
   */
  rooms: LayoutRoom[];
  /** Façade at least `facadeAreaRatio` (12 %) of the area, in m per m² (office rule A). */
  facadeRatioOk?: boolean;
  /** Orientations of the façade of the unit (pieces ≥ 0.8 m). */
  orientations?: FacadeSide[];
  /**
   * False when the unit breaks the orientation rules: from T3 at least two orientations,
   * never only north.
   */
  orientationOk?: boolean;
  /** Outdoor space (balcon, loggia, terrasse), if the building has one on this façade. */
  outdoor?: LayoutOutdoor;
  /** One level of a duplex dwelling (the same polygon on both storeys). */
  duplex?: LayoutDuplex;
}

/** Level of a duplex dwelling. */
export interface LayoutDuplex {
  /** jour: entrance, séjour and chambre PMR; nuit: the further bedrooms. */
  level: 'jour' | 'nuit';
  /** Lower or upper of the two storeys. */
  part: 'lower' | 'upper';
  /** Storey indices of the lower and the upper level. */
  storeys: [number, number];
  /** Area of both levels, m². */
  totalArea: number;
  /** Internal stair (same place on both levels). */
  stair?: Polygon;
}

export interface LayoutTypeCount {
  typeId: string;
  label: string;
  /** Dwellings (a duplex counts once, on its entrance level). */
  count: number;
  /** Area of the dwellings (both levels of a duplex). */
  area: number;
  /** Of which duplex. */
  duplex?: number;
}

export interface StoreyLayoutSummary {
  /** Dwellings with their entrance on this storey (duplex upper/lower levels not counted). */
  units: number;
  byType: LayoutTypeCount[];
  unitArea: number;
  coreArea: number;
  circulationArea: number;
  openArea: number;
  footprintArea: number;
  /** Units below the minimum façade length of their type. */
  facadeViolations: number;
}

export interface StoreyLayout {
  massId: string;
  storeyIndex: number;
  label: string;
  usage: Usage;
  access: AccessType;
  setback: boolean;
  z0: number;
  /** Finished floor level of the storey above (z0 + floor-to-floor height). */
  z1: number;
  /** Footprints of the storey (one per section). */
  footprints: Polygon[];
  cores: LayoutArea[];
  /** Landings, galleries and corridors. */
  circulation: LayoutArea[];
  /** Open floor areas of non-residential storeys. */
  open: LayoutArea[];
  units: LayoutUnit[];
  summary: StoreyLayoutSummary;
  /** Units per core of this storey (undefined without cores). */
  unitsPerCore?: number;
  /** Stable signature of the layout (identical storeys share it). */
  signature: string;
}

export interface MassLayout {
  massId: string;
  name: string;
  access: AccessType;
  storeys: StoreyLayout[];
  totals: { units: number; byType: LayoutTypeCount[]; unitArea: number };
  /** Dwelling count of the area-based unit mix (existing KPI), for comparison. */
  areaBasedDwellings: number;
  /** Expected units per core of the access type (Zweispänner 2, Dreispänner 3, …). */
  expectedUnitsPerCore?: [number, number];
}

export interface LayoutDimensions {
  coreWidth: number;
  /** Lift opposite the stair across the landing (Dreispänner). */
  liftOpposite: boolean;
  /** Width of a core holding the stair only (two flights, walls), m. */
  stairCoreWidth: number;
  /** Lift shaft with walls, along the bar / across, m. */
  liftBox: [number, number];
  coreDepth: number;
  galleryWidth: number;
  corridorWidth: number;
  landingDepth: number;
}

export function layoutDimensions(settings: Pick<Settings, 'cores'>): LayoutDimensions {
  const c = settings.cores;
  const st = resolveStairRules(settings);
  return {
    coreWidth: c.coreWidth ?? 5.5,
    liftOpposite: (c.liftOpposite ?? true) && st.liftWidth > 0,
    stairCoreWidth: 2 * st.flightWidth + st.gap + 2 * st.wall,
    liftBox: [st.liftWidth + st.wall, st.liftDepth + st.wall],
    coreDepth: c.coreDepth ?? 6,
    galleryWidth: c.galleryWidth ?? 1.6,
    corridorWidth: c.corridorWidth ?? 1.8,
    landingDepth: c.landingDepth ?? 1.5,
  };
}

// ---------------------------------------------------------------------------
// Frames and bars
// ---------------------------------------------------------------------------

interface Frame {
  o: Vec2;
  u: Vec2;
  n: Vec2;
}

interface Bar {
  frame: Frame;
  /** Region of the footprint owned by this bar (world). */
  region: Polygon[];
  length: number;
  depth: number;
}

type Rect = [number, number, number, number]; // a0, b0, a1, b1 in bar coordinates

const toWorld = (f: Frame, a: number, b: number): Vec2 => [
  f.o[0] + f.u[0] * a + f.n[0] * b,
  f.o[1] + f.u[1] * a + f.n[1] * b,
];
const toFrame = (f: Frame, p: Vec2): Vec2 => {
  const dx = p[0] - f.o[0];
  const dy = p[1] - f.o[1];
  return [dx * f.u[0] + dy * f.u[1], dx * f.n[0] + dy * f.n[1]];
};

function rectPoly(f: Frame, [a0, b0, a1, b1]: Rect): Polygon {
  return normalizePolygon({
    outer: [toWorld(f, a0, b0), toWorld(f, a1, b0), toWorld(f, a1, b1), toWorld(f, a0, b1)],
  });
}

/** Oriented rectangle of a (clipped) piece in a bar frame. */
function boxOf(f: Frame, p: Polygon): CoreBox {
  const [a0, b0, a1, b1] = frameExtents(f, [p]);
  return { o: toWorld(f, a0, b0), u: f.u, n: f.n, w: a1 - a0, d: b1 - b0 };
}

const validRect = (r: Rect): boolean => r[2] - r[0] > 1e-6 && r[3] - r[1] > 1e-6;
const keep = (...rs: Rect[]): Rect[] => rs.filter(validRect);

/** Extents of polygons in a frame. */
function frameExtents(f: Frame, polys: readonly Polygon[]): Rect {
  let a0 = Infinity,
    b0 = Infinity,
    a1 = -Infinity,
    b1 = -Infinity;
  for (const p of polys)
    for (const q of p.outer) {
      const [a, b] = toFrame(f, q);
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
  return [a0, b0, a1, b1];
}

/** Bar frame on the extents of `region` along direction `u`; b = 0 on the north side. */
function barFrom(u: Vec2, region: Polygon[]): Bar | undefined {
  if (!region.length) return undefined;
  let n: Vec2 = [-u[1], u[0]];
  // b = 0 on the access side = north (n pointing south); keep the frame right-handed
  if (n[1] > 1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] > 0)) {
    u = [-u[0], -u[1]];
    n = [-n[0], -n[1]];
  }
  const f: Frame = { o: [0, 0], u, n };
  const [a0, b0] = frameExtents(f, region);
  const o = toWorld(f, a0, b0);
  const frame: Frame = { o, u, n };
  const ext = frameExtents(frame, region);
  return { frame, region, length: ext[2], depth: ext[3] };
}

const unit = (dx: number, dy: number): Vec2 => {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

/** Straight bars of one storey solid. */
function solidBars(mass: Mass, footprint: Polygon): Bar[] {
  const fp = [normalizePolygon(footprint)];
  const t = mass.typology;
  const cos = Math.cos(mass.rotation);
  const sin = Math.sin(mass.rotation);
  const w = (p: Vec2): Vec2 => [
    mass.position[0] + p[0] * cos - p[1] * sin,
    mass.position[1] + p[0] * sin + p[1] * cos,
  ];
  if (t.kind === 'freeLine' && t.points.length >= 2) {
    const pts = t.points.map(w);
    const legs: [Vec2, Vec2][] = [];
    for (let i = 1; i < pts.length; i++) legs.push([pts[i - 1]!, pts[i]!]);
    if (t.closed && pts.length > 2) legs.push([pts[pts.length - 1]!, pts[0]!]);
    const bars: Bar[] = [];
    let claimed: Polygon[] = [];
    const ext = t.depth * 1.01;
    for (const [p, q] of legs) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-6) continue;
      const u = unit(q[0] - p[0], q[1] - p[1]);
      const f: Frame = { o: p, u, n: [-u[1], u[0]] };
      // depth band of this leg (alignment), probed at its midpoint
      const probe = intersection(fp, [rectPoly(f, [len / 2 - 0.05, -ext, len / 2 + 0.05, ext])]);
      if (!probe.length) continue;
      const [, pb0, , pb1] = frameExtents(f, probe);
      const reach = Math.max(Math.abs(pb0), Math.abs(pb1));
      const legRect = rectPoly(f, [-reach, pb0, len + reach, pb1]);
      const region = difference(intersection(fp, [legRect]), claimed).filter(
        (r) => polygonArea(r) > 0.5,
      );
      if (!region.length) continue;
      claimed = union([...claimed, ...region]);
      const bar = barFrom(u, region);
      if (bar) bars.push(bar);
    }
    const rest = difference(fp, claimed).filter((r) => polygonArea(r) > 0.5);
    if (rest.length) {
      const bar = barFrom(dirOf(rest), rest);
      if (bar) bars.push(bar);
    }
    return bars;
  }
  if (t.kind === 'freePolygon') {
    const bar = barFrom(dirOf(fp), fp);
    return bar ? [bar] : [];
  }
  // Solitär, Zeile, Reihe: mass axis (or its normal when the footprint is deeper than long)
  let u: Vec2 = [cos, sin];
  const ex = frameExtents({ o: [0, 0], u, n: [-u[1], u[0]] }, fp);
  if (ex[3] - ex[1] > ex[2] - ex[0] + 1e-6) u = [-sin, cos];
  const bar = barFrom(u, fp);
  return bar ? [bar] : [];
}

function dirOf(polys: Polygon[]): Vec2 {
  const largest = [...polys].sort((a, b) => polygonArea(b) - polygonArea(a))[0]!;
  const e = orientedExtents(largest.outer);
  // orientedExtents' angle is along an edge of the hull; take the longer side
  const u: Vec2 = [Math.cos(e.angle), Math.sin(e.angle)];
  const f: Frame = { o: [0, 0], u, n: [-u[1], u[0]] };
  const r = frameExtents(f, [largest]);
  return r[3] - r[1] > r[2] - r[0] ? [-u[1], u[0]] : u;
}

// ---------------------------------------------------------------------------
// Access rules → pieces in bar coordinates
// ---------------------------------------------------------------------------

interface FixedUnit {
  rects: Rect[];
  core: number; // local core number within the bar
  /** Preferred type (from the mix); checked against the final area. */
  type?: UnitType | undefined;
}
interface Row {
  rect: Rect;
  core: number;
  /** Façade sides of the row (long sides on the exterior: 1 or 2). */
  sides: number;
}
interface BarPlan {
  cores: Rect[];
  circulation: { kind: LayoutAreaKind; rect: Rect }[];
  fixed: FixedUnit[];
  rows: Row[];
  open: boolean;
}

/**
 * Cores of the mass (`requiredCores`: escape distance + section length of the access type)
 * distributed over its bars by length (largest remainder). Bars too short for a core get none.
 */
function distributeCores(
  bars: readonly Bar[],
  mass: Mass,
  access: AccessType,
  settings: Settings,
  dim: LayoutDimensions,
  avgTarget: number,
): number[] {
  if (access === 'reihenhaus' || !bars.length) return bars.map(() => 0);
  const total = Math.max(
    requiredCores(mass, access, settings),
    mixCores(bars, access, dim, avgTarget, coreRange(settings)[1]),
  );
  const fits = bars.map((b) => b.length >= dim.coreWidth + 4);
  const weights = bars.map((b, i) => (fits[i] ? b.length : 0));
  if (!weights.some((w) => w > 0)) {
    // nothing long enough: one core in the longest bar
    const longest = bars.reduce((bi, b, i) => (b.length > bars[bi]!.length ? i : bi), 0);
    return bars.map((_, i) => (i === longest ? 1 : 0));
  }
  const out = largestRemainder(Math.max(total, 1), weights);
  // a single straight bar keeps at least one core per escape distance
  return out.map((n, i) =>
    fits[i] ? Math.min(n, Math.max(1, Math.floor(bars[i]!.length / (dim.coreWidth + 8)))) : 0,
  );
}

/** Gross-to-net factor of a dwelling (walls, shafts) used to size spänner sections. */
const UNIT_GROSS_FACTOR = 1.12;

/**
 * Cores needed so that the units of a spänner type (2 or 3 per landing) get the average target
 * area of the unit mix: section length = (units × target × wall factor + core + landing) / depth.
 * The regulatory minimum (`requiredCores`) still applies on top.
 */
export function mixCores(
  bars: readonly { length: number; depth: number }[],
  access: AccessType,
  dim: LayoutDimensions,
  avgTarget: number,
  /** Gallery, corridor, point block: most dwellings per core and storey (office rule, 8). */
  maxPerCore?: number,
): number {
  const perCore = access === 'zweispaenner' ? 2 : access === 'dreispaenner' ? 3 : 0;
  if (!perCore && maxPerCore && maxPerCore > 0 && avgTarget > 0 && access !== 'reihenhaus') {
    // enough cores that none serves more than maxPerCore dwellings per storey
    const units = bars.reduce(
      (s, b) => s + (b.length * b.depth) / (avgTarget * UNIT_GROSS_FACTOR),
      0,
    );
    return Math.ceil(units / maxPerCore - 1e-9);
  }
  if (!perCore || !(avgTarget > 0)) return 0;
  let n = 0;
  for (const b of bars) {
    if (b.depth <= 0) continue;
    const section =
      (perCore * avgTarget * UNIT_GROSS_FACTOR +
        dim.coreWidth * dim.coreDepth +
        dim.coreWidth * dim.landingDepth) /
      b.depth;
    n += b.length / section;
  }
  return Math.max(1, Math.round(n));
}

/** Types for a row of area `area`: count and combination closest to the area. */
function rowTypes(
  area: number,
  pool: UnitType[],
  mix: readonly UnitType[],
  avgTarget: number,
  count?: number,
  fit?: { length: number; depth: number; minWidth: (t: UnitType) => number },
): UnitType[] {
  const maxT = Math.max(...mix.map((t) => t.areaTarget));
  const minT = Math.min(...mix.map((t) => t.areaTarget));
  let best: UnitType[] = [];
  let bestErr = Infinity;
  const nMin = count ?? Math.max(1, Math.floor(area / maxT));
  const nMax = count ?? Math.max(nMin, Math.min(Math.ceil(area / minT), nMin + 12));
  for (let n = nMin; n <= nMax; n++) {
    const avail = [...pool];
    const chosen: UnitType[] = [];
    for (let i = 0; i < n; i++) {
      const t = avail.shift() ?? mix[i % mix.length]!;
      chosen.push(t);
    }
    // local improvement: swap single types (pool types first, then any mix type)
    // a type forced wider than its target by the façade rule takes that larger area
    const effTargets = (ts: UnitType[]) =>
      fit
        ? ts.reduce((s, t) => s + Math.max(t.areaTarget, fit.minWidth(t) * fit.depth), 0)
        : sumTargets(ts);
    const excess = (ts: UnitType[]) =>
      fit ? Math.max(0, ts.reduce((s, t) => s + fit.minWidth(t), 0) - fit.length) : 0;
    const cost = (ts: UnitType[]) =>
      Math.abs(effTargets(ts) - area) +
      ts.reduce((s, t) => s + (pool.includes(t) ? 0 : avgTarget * 0.08), 0) +
      excess(ts) * avgTarget * 10;
    let improved = true;
    for (let it = 0; improved && it < 30; it++) {
      improved = false;
      for (let i = 0; i < chosen.length; i++)
        for (const t of mix) {
          if (t === chosen[i]) continue;
          const trial = [...chosen];
          trial[i] = t;
          if (cost(trial) < cost(chosen) - 1e-9) {
            chosen.splice(0, chosen.length, ...trial);
            improved = true;
          }
        }
    }
    const err = cost(chosen) + Math.abs(n - area / avgTarget) * 0.5;
    if (err < bestErr) {
      bestErr = err;
      best = chosen;
    }
  }
  for (const t of best) {
    const i = pool.indexOf(t);
    if (i >= 0) pool.splice(i, 1);
  }
  if (count !== undefined) return [...best].sort((a, b) => b.areaTarget - a.areaTarget);
  // largest at both ends of the row
  const sorted = [...best].sort((a, b) => b.areaTarget - a.areaTarget);
  const ordered: UnitType[] = [];
  sorted.forEach((t, i) => (i % 2 === 0 ? ordered.push(t) : ordered.unshift(t)));
  return ordered;
}

/** Façade rules as seen by the planner. */
interface FacadeCtx {
  /** Minimum façade length of a type, m. */
  req: (t: UnitType) => number;
  /** Minimum width of a type with `sides` equal façades (+ fixed extra pieces), m. */
  width: (t: UnitType, sides: number, extra?: number[]) => number;
  /** Next smaller type of the mix (fewer rooms), if any. */
  down: (t: UnitType) => UnitType | undefined;
  /** Gallery side counts as façade. */
  gallery: boolean;
}

/**
 * Replaces the type with the largest façade requirement by the next smaller type until
 * `feasible` holds (or nothing can be downgraded any more).
 */
function fitTypes(
  types: (UnitType | undefined)[],
  fc: FacadeCtx,
  feasible: (ts: (UnitType | undefined)[]) => boolean,
): (UnitType | undefined)[] {
  const ts = [...types];
  for (let it = 0; it < 30 && !feasible(ts); it++) {
    let bi = -1;
    ts.forEach((t, i) => {
      if (t && fc.down(t) && (bi < 0 || fc.req(t) > fc.req(ts[bi]!))) bi = i;
    });
    if (bi < 0) break;
    ts[bi] = fc.down(ts[bi]!);
  }
  return ts;
}

/** Widths for a row of length `len`: proportional to `weights`, each at least `mins`. */
function allocate(len: number, weights: readonly number[], mins: readonly number[]): number[] {
  const n = weights.length;
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum >= len - 1e-9) return mins.map((m) => (len * m) / (minSum || 1));
  const fixed = new Array<boolean>(n).fill(false);
  let w: number[] = [];
  for (let it = 0; it <= n; it++) {
    const rest = len - mins.reduce((s, m, i) => s + (fixed[i] ? m : 0), 0);
    const wsum = weights.reduce((s, x, i) => s + (fixed[i] ? 0 : x), 0) || 1;
    w = weights.map((x, i) => (fixed[i] ? mins[i]! : (rest * x) / wsum));
    let changed = false;
    w.forEach((x, i) => {
      if (!fixed[i] && x < mins[i]! - 1e-9) {
        fixed[i] = true;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return w;
}

/** Evenly spaced core centres along [0, L]. */
const coreCentres = (L: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => ((i + 0.5) * L) / n);

function planBar(
  bar: Bar,
  access: AccessType,
  residential: boolean,
  settings: Settings,
  dim: LayoutDimensions,
  avgTarget: number,
  n: number,
  pick: (area: number, count: number) => UnitType[],
  fc: FacadeCtx,
  /** Core centres (along the bar) to keep, e.g. those of the storey below. */
  pins?: readonly number[],
): BarPlan {
  const L = bar.length;
  const D = bar.depth;
  const plan: BarPlan = { cores: [], circulation: [], fixed: [], rows: [], open: !residential };
  const cw0 = Math.min(dim.coreWidth, L);
  const cw = cw0;
  const cd = Math.min(dim.coreDepth, D);
  if (access === 'reihenhaus') {
    if (residential) plan.fixed.push({ rects: [[0, 0, L, D]], core: -1 });
    return plan;
  }
  // a bar without its own core (e.g. a short wing) is served by a neighbouring core
  if (n <= 0) {
    if (residential) plan.rows.push({ rect: [0, 0, L, D], core: -1, sides: 2 });
    return plan;
  }
  const centres = pins?.length === n ? [...pins] : coreCentres(L, n);
  const pin = (i: number) => (pins?.length === n ? pins[i] : undefined);

  if (!residential) {
    for (const c of centres) plan.cores.push([c - cw / 2, (D - cd) / 2, c + cw / 2, (D + cd) / 2]);
    return plan;
  }

  switch (access) {
    case 'zweispaenner':
    case 'dreispaenner': {
      // per core section: types chosen from the mix for the section's area, the core (and the
      // middle band of a Dreispänner) shifted so that each unit gets its type's share
      const S = L / n;
      const clampC = (c: number, s0: number, s1: number, half: number) =>
        Math.min(Math.max(c, s0 + half + 3), s1 - half - 3);
      centres.forEach((_, i) => {
        const s0 = i * S;
        const s1 = (i + 1) * S;
        const td = D - cd - dim.landingDepth;
        // narrow core with the stair only; the lift opposite across the landing
        const [lw, lt] = dim.liftBox;
        const opp = dim.liftOpposite && td >= lt + 3;
        const cw = opp ? Math.min(cw0, dim.stairCoreWidth) : cw0;
        if (access === 'dreispaenner' && td >= 3 && S - cw >= 8) {
          const est = S * D - cw * cd - S * 0.4 * dim.landingDepth;
          // façades: big/mid units = north + south strip (2 w + side), small unit = south (wm)
          const geo = (ts: (UnitType | undefined)[]) => {
            const [big, mid, small] = ts;
            const tot = (big?.areaTarget ?? 1) + (mid?.areaTarget ?? 1) + (small?.areaTarget ?? 1);
            // third unit (behind the landing) = the smallest type
            let wm = (est * (small?.areaTarget ?? 1)) / tot / td;
            wm = Math.min(Math.max(wm, cw, opp ? lw : 0), S - 6);
            // no wider than the type allows (its area), but at least its façade requirement
            if (small) wm = Math.min(wm, small.areaMax / td);
            wm = Math.max(wm, small ? fc.req(small) : 0);
            const A = S * D - cw * cd - wm * dim.landingDepth;
            const side = (wm - cw) / 2;
            const lo = Math.max(3, big ? fc.width(big, 2, [side]) : 0);
            const hi = S - wm - Math.max(3, mid ? fc.width(mid, 2, [side]) : 0);
            let wl = ((A * (big?.areaTarget ?? 1)) / tot - side * cd) / D;
            wl = Math.min(Math.max(wl, 3), S - wm - 3);
            wl = Math.min(Math.max(wl, lo), hi);
            return { wm, wl, side, ok: lo <= hi + 1e-9 };
          };
          const ts = fitTypes(pick(est, 3), fc, (x) => geo(x).ok);
          const [big, mid, small] = ts;
          const { wm, wl: wl0, side } = geo(ts);
          // a pinned core keeps its place: the big unit takes what is left beside it
          const pc = pin(i);
          const wl =
            pc === undefined ? wl0 : Math.min(Math.max(pc - cw / 2 - side - s0, 0.5), S - wm - 0.5);
          const m0 = s0 + wl;
          const m1 = m0 + wm;
          const k0 = m0 + side;
          const k1 = k0 + cw;
          plan.cores.push([k0, 0, k1, cd]);
          plan.circulation.push({ kind: 'landing', rect: [m0, cd, m1, cd + dim.landingDepth] });
          plan.fixed.push({ rects: keep([s0, 0, m0, D], [m0, 0, k0, cd]), core: i, type: big });
          const behind: Rect = [m0, cd + dim.landingDepth, m1, D];
          if (opp) {
            // lift across the landing, opposite the stair (within the landing's width)
            const kc = Math.min(Math.max((k0 + k1) / 2, m0 + lw / 2), m1 - lw / 2);
            const lift: Rect = [kc - lw / 2, behind[1], kc + lw / 2, behind[1] + lt];
            plan.circulation.push({ kind: 'lift', rect: lift });
            plan.fixed.push({ rects: subtractRect(behind, lift), core: i, type: small });
          } else plan.fixed.push({ rects: [behind], core: i, type: small });
          plan.fixed.push({ rects: keep([m1, 0, s1, D], [k1, 0, m1, cd]), core: i, type: mid });
        } else {
          const kb0 = D - cd < 1 ? 0 : (D - cd) / 2;
          const kb1 = D - cd < 1 ? D : kb0 + cd;
          const back = cw * (D - kb1);
          const A = S * D - cw * cd - cw * kb0;
          // façades: left unit 2 (c − s0) (− cw without the strip behind the core),
          // right unit 2 (s1 − c − cw / 2); the core moves within these bounds
          const noBack = D - kb1 < 1e-6 ? cw : 0;
          const bounds = (x: (UnitType | undefined)[]) => [
            s0 + (x[0] ? fc.width(x[0], 2) : 0) + noBack / 2,
            s1 - cw / 2 - (x[1] ? fc.width(x[1], 2) : 0),
          ];
          const ts = fitTypes(pick(A, 2), fc, (x) => {
            const [lo, hi] = bounds(x);
            return lo! <= hi! + 1e-9;
          });
          const [t1, t2] = ts;
          const [lo, hi] = bounds(ts);
          const r = (t1?.areaTarget ?? 1) / ((t1?.areaTarget ?? 1) + (t2?.areaTarget ?? 1));
          // left unit (with the strip behind the core) gets share r
          let c = clampC(s0 + (A * r - back) / D + cw / 2, s0, s1, cw / 2);
          if (lo! <= hi! + 1e-9) c = Math.min(Math.max(c, lo!), hi!);
          c = pin(i) ?? c;
          const k0 = c - cw / 2;
          const k1 = c + cw / 2;
          plan.cores.push([k0, kb0, k1, kb1]);
          if (kb0 > 0) plan.circulation.push({ kind: 'landing', rect: [k0, 0, k1, kb0] });
          plan.fixed.push({ rects: keep([s0, 0, k0, D], [k0, kb1, k1, D]), core: i, type: t1 });
          plan.fixed.push({ rects: [[k1, 0, s1, D]], core: i, type: t2 });
        }
      });
      return plan;
    }
    case 'laubengang': {
      const g = Math.min(dim.galleryWidth, D / 3);
      plan.circulation.push({ kind: 'gallery', rect: [0, 0, L, g] });
      const gs = fc.gallery ? 2 : 1;
      let a = 0;
      centres.forEach((c, i) => {
        const k0 = Math.max(0, c - cw / 2);
        const k1 = Math.min(L, c + cw / 2);
        plan.cores.push([k0, g, k1, D]);
        if (k0 - a > 1e-6) plan.rows.push({ rect: [a, g, k0, D], core: i, sides: gs });
        a = k1;
      });
      if (L - a > 1e-6) plan.rows.push({ rect: [a, g, L, D], core: n - 1, sides: gs });
      return plan;
    }
    case 'mittelflur': {
      const c = Math.min(dim.corridorWidth, D / 3);
      const m0 = (D - c) / 2;
      const m1 = (D + c) / 2;
      plan.circulation.push({ kind: 'corridor', rect: [0, m0, L, m1] });
      let a = 0;
      centres.forEach((x, i) => {
        const k0 = x - cw / 2;
        const k1 = x + cw / 2;
        plan.cores.push([k0, 0, k1, m0]);
        if (k0 - a > 1e-6) plan.rows.push({ rect: [a, 0, k0, m0], core: i, sides: 1 });
        a = k1;
      });
      if (L - a > 1e-6) plan.rows.push({ rect: [a, 0, L, m0], core: n - 1, sides: 1 });
      // south row split at the midpoints between cores (core assignment only)
      const bounds = [0, ...centres.slice(1).map((x, i) => (x + centres[i]!) / 2), L];
      for (let i = 0; i < n; i++)
        plan.rows.push({ rect: [bounds[i]!, m1, bounds[i + 1]!, D], core: i, sides: 1 });
      return plan;
    }
    case 'punkthaus': {
      // one core in the middle (several along the axis for long blocks), units around it
      centres.forEach((cx, i) => {
        const s0 = (i * L) / n;
        const s1 = ((i + 1) * L) / n;
        const cy = D / 2;
        // stair-only core with the lift across the hall (office rule F), else stair + lift
        const [lw, lt] = dim.liftBox;
        const opp = dim.liftOpposite && cd >= lw;
        const kw = opp ? Math.min(cw, dim.stairCoreWidth) : cw;
        const ld = Math.min(dim.landingDepth, (s1 - s0 - kw) / 4);
        const span = kw + (opp ? ld + lt : 0);
        const k: Rect = [cx - span / 2, cy - cd / 2, cx - span / 2 + kw, cy + cd / 2];
        plan.cores.push(k);
        plan.circulation.push({ kind: 'landing', rect: [k[0] - ld, k[1], k[0], k[3]] });
        plan.circulation.push({ kind: 'landing', rect: [k[2], k[1], k[2] + ld, k[3]] });
        let right = k[2] + ld;
        if (opp) {
          plan.circulation.push({
            kind: 'lift',
            rect: [right, cy - lw / 2, right + lt, cy + lw / 2],
          });
          if (cd - lw > 0.3) {
            // the rest beside the lift belongs to the hall
            plan.circulation.push({
              kind: 'landing',
              rect: [right, k[1], right + lt, cy - lw / 2],
            });
            plan.circulation.push({
              kind: 'landing',
              rect: [right, cy + lw / 2, right + lt, k[3]],
            });
          }
          right += lt;
        }
        const hole: Rect = [k[0] - ld, k[1], right, k[3]];
        const area = (s1 - s0) * D - span * cd;
        const six = area / 6 >= avgTarget * 0.85 && s1 - s0 >= 3 * 6;
        const cols = six ? [s0, s0 + (s1 - s0) / 3, s1 - (s1 - s0) / 3, s1] : [s0, cx, s1];
        const rows = [0, cy, D];
        for (let r = 0; r < 2; r++)
          for (let q = 0; q < cols.length - 1; q++)
            plan.fixed.push({
              rects: subtractRect([cols[q]!, rows[r]!, cols[q + 1]!, rows[r + 1]!], hole),
              core: i,
            });
      });
      return plan;
    }
    default: {
      // office access on a residential storey: treat as corridor-less open floor with cores
      plan.open = true;
      for (const c of centres)
        plan.cores.push([c - cw / 2, (D - cd) / 2, c + cw / 2, (D + cd) / 2]);
      return plan;
    }
  }
}

/** r − h as up to four rectangles. */
function subtractRect(r: Rect, h: Rect): Rect[] {
  const i: Rect = [
    Math.max(r[0], h[0]),
    Math.max(r[1], h[1]),
    Math.min(r[2], h[2]),
    Math.min(r[3], h[3]),
  ];
  if (!validRect(i)) return [r];
  return (
    [
      [r[0], r[1], i[0], r[3]],
      [i[2], r[1], r[2], r[3]],
      [i[0], r[1], i[2], i[1]],
      [i[0], i[3], i[2], r[3]],
    ] as Rect[]
  ).filter(validRect);
}

// ---------------------------------------------------------------------------
// Unit types
// ---------------------------------------------------------------------------

interface TypeChoice {
  type: UnitType;
  outOfRange: boolean;
}

function typeByArea(
  area: number,
  mix: readonly UnitType[],
  quota: Map<string, number>,
): TypeChoice {
  const fitting = mix.filter((t) => area >= t.areaMin - 1e-6 && area <= t.areaMax + 1e-6);
  if (fitting.length) {
    fitting.sort(
      (x, y) =>
        (quota.get(y.id) ?? 0) - (quota.get(x.id) ?? 0) ||
        Math.abs(area - x.areaTarget) - Math.abs(area - y.areaTarget),
    );
    return { type: fitting[0]!, outOfRange: false };
  }
  const near = [...mix].sort(
    (x, y) =>
      Math.min(Math.abs(area - x.areaMin), Math.abs(area - x.areaMax)) -
      Math.min(Math.abs(area - y.areaMin), Math.abs(area - y.areaMax)),
  )[0]!;
  return { type: near, outOfRange: true };
}

/** Types for `n` units following the mix shares, interleaved large/small. */
function mixSequence(n: number, mix: readonly UnitType[]): UnitType[] {
  const counts = largestRemainder(
    n,
    mix.map((t) => t.share),
  );
  const list: UnitType[] = [];
  mix.forEach((t, i) => {
    for (let k = 0; k < counts[i]!; k++) list.push(t);
  });
  list.sort((a, b) => b.areaTarget - a.areaTarget);
  const out: UnitType[] = [];
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    out.push(list[lo++]!);
    if (lo <= hi) out.push(list[hi--]!);
  }
  return out;
}

const sumTargets = (ts: readonly UnitType[]): number => ts.reduce((s, t) => s + t.areaTarget, 0);

// ---------------------------------------------------------------------------
// Storey layout
// ---------------------------------------------------------------------------

interface RawUnit {
  polys: Polygon[];
  core: number;
  pref?: UnitType;
  type?: TypeChoice;
}

/**
 * Layout of one mass on one storey. `solids` are the storey solids of the mass at that storey
 * (one per section). The result is in world coordinates.
 */
export function storeyLayout(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  access: AccessType = resolveAccess(mass, settings),
): StoreyLayout {
  return layoutStorey(mass, solids, settings, access).layout;
}

interface LayoutPass {
  /** Core centres per bar to keep (from the simplex layout of the same footprint). */
  pins?: number[][];
  /** Level of the duplex dwellings on this storey (duplex types of the mix). */
  duplex?: 'jour' | 'nuit';
  /** Séjours of the storey below (séjours and loggias stack). */
  below?: Polygon[];
}

function layoutStorey(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  access: AccessType,
  pass: LayoutPass = {},
): { layout: StoreyLayout; pins: number[][] } {
  const first = solids[0]!;
  const dim = layoutDimensions(settings);
  const mix = settings.unitMix.filter((t) => t.share > 0 && t.areaTarget > 0);
  const shareSum = mix.reduce((s, t) => s + t.share, 0);
  const avgTarget =
    shareSum > 0 ? mix.reduce((s, t) => s + (t.share / shareSum) * t.areaTarget, 0) : 60;
  const usage = first.usage;
  const residential = usage === 'wohnen' && mix.length > 0;
  const effAccess: AccessType = access;
  const rules = resolveUnitRules(settings);
  const fc: FacadeCtx = {
    req: (t) => requiredFacade(t, rules),
    width: (t, sides, extra = []) => minUnitWidth(t, sides, rules, extra),
    down: (t) => {
      const r = unitRooms(t);
      return [...mix]
        .filter((x) => unitRooms(x) < r)
        .sort((a, b) => unitRooms(b) - unitRooms(a) || b.share - a.share)[0];
    },
    gallery: rules.galleryCountsAsFacade,
  };

  const cores: LayoutArea[] = [];
  const circulation: LayoutArea[] = [];
  const open: LayoutArea[] = [];
  const raw: RawUnit[] = [];
  const rows: {
    frame: Frame;
    rect: Rect;
    core: number;
    region: Polygon[];
    sides: number;
    /** The row starts / ends at an end of its bar (building corner). */
    atStart: boolean;
    atEnd: boolean;
  }[] = [];
  const regions: Polygon[] = [];

  const clip = (region: Polygon[], p: Polygon): Polygon[] =>
    intersection(region, [p]).filter((q) => polygonArea(q) > 1e-3);

  // sections of a Zeile form one building: lay them out as one bar (staggered sections are
  // covered by the bar's extents and clipped back)
  const outlines =
    mass.typology.kind === 'zeile' && solids.length > 1
      ? union(solids.map((s) => s.footprint))
      : solids.map((s) => s.footprint);
  const bars = outlines.flatMap((p) => solidBars(mass, p));
  // pool of preferred types for the storey (mix shares for the expected number of units)
  const storeyArea = bars.reduce(
    (a, b) => a + b.region.reduce((s2, r) => s2 + polygonArea(r), 0),
    0,
  );
  const typePool = mix.length
    ? mixSequence(Math.max(1, Math.round(storeyArea / avgTarget)), mix)
    : [];
  const pick = (area: number, count: number): UnitType[] =>
    mix.length ? rowTypes(area, typePool, mix, avgTarget, count) : [];
  const pinned = pass.pins && pass.pins.length === bars.length ? pass.pins : undefined;
  const coresPerBar = pinned
    ? pinned.map((p) => p.length)
    : distributeCores(bars, mass, effAccess, settings, dim, avgTarget);
  const pins: number[][] = [];
  for (const [bi, bar] of bars.entries()) {
    {
      regions.push(...bar.region);
      const plan = planBar(
        bar,
        effAccess,
        residential,
        settings,
        dim,
        avgTarget,
        coresPerBar[bi]!,
        pick,
        fc,
        pinned?.[bi],
      );
      pins.push(plan.cores.map((r) => (r[0] + r[2]) / 2));
      const coreBase = cores.length;
      for (const r of plan.cores) {
        for (const p of clip(bar.region, rectPoly(bar.frame, r)))
          cores.push({
            kind: 'core',
            polygon: p,
            area: polygonArea(p),
            index: cores.length,
            box: boxOf(bar.frame, p),
          });
      }
      const coreOf = (c: number): number =>
        c < 0
          ? cores.length > coreBase
            ? coreBase
            : -1
          : Math.min(coreBase + c, cores.length - 1);
      for (const c of plan.circulation)
        for (const p of clip(bar.region, rectPoly(bar.frame, c.rect)))
          circulation.push({ kind: c.kind, polygon: p, area: polygonArea(p) });
      for (const f of plan.fixed) {
        // union in bar coordinates (exact for axis-aligned rectangles), then to world
        const merged = union(f.rects.map((r) => rect(r[0], r[1], r[2], r[3]))).map((p) =>
          normalizePolygon({
            outer: p.outer.map(([a, b]) => toWorld(bar.frame, a, b)),
            holes: (p.holes ?? []).map((h) => h.map(([a, b]) => toWorld(bar.frame, a, b))),
          }),
        );
        const polys = intersection(bar.region, merged).filter((q) => polygonArea(q) > 1e-3);
        if (polys.length)
          raw.push({
            polys,
            core: effAccess === 'reihenhaus' ? -1 : coreOf(f.core),
            ...(f.type ? { pref: f.type } : {}),
          });
      }
      for (const r of plan.rows)
        rows.push({
          frame: bar.frame,
          rect: r.rect,
          core: coreOf(r.core),
          region: bar.region,
          sides: r.sides,
          atStart: r.rect[0] <= 1e-6,
          atEnd: r.rect[2] >= bar.length - 1e-6,
        });
    }
  }

  // --- unit types -----------------------------------------------------------
  const units: LayoutUnit[] = [];
  if (residential) {
    // free rows: number of units close to the target mix, widths scaled to fill each row
    const rowAreas = rows.map((r) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]));
    const fixedAreas = raw.map((u) => u.polys.reduce((s, p) => s + polygonArea(p), 0));
    const quota = new Map<string, number>();
    const estimate = raw.length + Math.round(rowAreas.reduce((a, b) => a + b, 0) / avgTarget);
    const q = largestRemainder(
      estimate,
      mix.map((t) => t.share),
    );
    mix.forEach((t, i) => quota.set(t.id, q[i]!));
    raw.forEach((u, i) => {
      const a = fixedAreas[i]!;
      const p = u.pref;
      u.type =
        p && a >= p.areaMin - 1e-6 && a <= p.areaMax + 1e-6
          ? { type: p, outOfRange: false }
          : typeByArea(a, mix, quota);
      quota.set(u.type.type.id, (quota.get(u.type.type.id) ?? 0) - 1);
    });

    const rowTotal = rowAreas.reduce((a, b) => a + b, 0);
    if (rows.length && rowTotal > 0) {
      // preferred types: the mix for the expected number of units; each row picks the
      // combination closest to its area (pool types first), widths then fill the row exactly
      const pool = mixSequence(Math.max(1, Math.round(rowTotal / avgTarget)) + rows.length, mix);
      rows.forEach((row, ri) => {
        const [a0, b0, a1, b1] = row.rect;
        // each unit at least as wide as its façade requirement (per façade side)
        // rooms are not split over two façades (séjour, chambre PMR, chambres each on one side)
        const minWidth = (t: UnitType) => minUnitWidth(t, row.sides, rules);
        const len = a1 - a0;
        let ordered = rowTypes(rowAreas[ri]!, pool, mix, avgTarget, undefined, {
          length: len,
          depth: b1 - b0,
          minWidth,
        });
        const fitsRow = (ts: (UnitType | undefined)[]) =>
          ts.reduce((x, t) => x + (t ? minWidth(t) : 0), 0) <= len + 1e-9;
        ordered = fitTypes(ordered, fc, fitsRow).filter((t): t is UnitType => !!t);
        while (ordered.length > 1 && !fitsRow(ordered)) {
          // drop the smallest unit; its width goes to the others
          let si = 0;
          ordered.forEach((t, i) => (t.areaTarget < ordered[si]!.areaTarget ? (si = i) : 0));
          ordered.splice(si, 1);
        }
        // large dwellings (T4, T5) at the building corners, small ones in the middle
        ordered = cornerOrder(ordered, row.atStart, row.atEnd);
        const widths = allocate(
          len,
          ordered.map((t) => Math.max(t.areaTarget, minWidth(t) * (b1 - b0))),
          ordered.map(minWidth),
        );
        // party walls on the façade grid (office rule E, default 1.25 m): each boundary moves
        // to the nearest grid line that keeps both neighbours at their minimum width
        const grid = rules.facadeGrid;
        if (grid > 0 && ordered.length > 1) {
          let x = a0;
          const bounds = widths.slice(0, -1).map((w) => (x += w));
          for (let k = 0; k < bounds.length; k++) {
            const lo = (k ? bounds[k - 1]! : a0) + minWidth(ordered[k]!);
            const hi = (k + 1 < bounds.length ? bounds[k + 1]! : a1) - minWidth(ordered[k + 1]!);
            const g = a0 + Math.round((bounds[k]! - a0) / grid) * grid;
            const cands = [g, g - grid, g + grid].filter((v) => v >= lo - 1e-6 && v <= hi + 1e-6);
            if (cands.length)
              bounds[k] = cands.reduce((p, q) =>
                Math.abs(q - bounds[k]!) < Math.abs(p - bounds[k]!) ? q : p,
              );
          }
          bounds.forEach((b, k) => (widths[k] = b - (k ? bounds[k - 1]! : a0)));
        }
        let a = a0;
        ordered.forEach((t, i) => {
          const w = i === ordered.length - 1 ? a1 - a : widths[i]!;
          const polys = clip(row.region, rectPoly(row.frame, [a, b0, a + w, b1]));
          a += w;
          if (!polys.length) return;
          const area = polys.reduce((s, p) => s + polygonArea(p), 0);
          const fits = area >= t.areaMin - 1e-6 && area <= t.areaMax + 1e-6;
          raw.push({
            polys,
            core: row.core < 0 ? -2 : row.core,
            type: fits ? { type: t, outOfRange: false } : typeByArea(area, mix, new Map()),
          });
        });
      });
    }
  }

  // --- keep one polygon per unit; remnants merge into a neighbour ------------
  const leftovers: Polygon[] = [];
  for (const u of raw) {
    if (u.polys.length > 1) {
      u.polys.sort((a, b) => polygonArea(b) - polygonArea(a));
      u.polys.splice(1); // remnants are picked up below as leftovers
    }
  }
  if (!residential) {
    const taken = union(cores.map((c) => c.polygon));
    for (const p of difference(regions, taken).filter((r) => polygonArea(r) > 1e-3))
      open.push({ kind: 'open', polygon: p, area: polygonArea(p) });
  } else {
    const taken = union([
      ...cores.map((c) => c.polygon),
      ...circulation.map((c) => c.polygon),
      ...raw.map((u) => u.polys[0]!),
    ]);
    leftovers.push(...difference(union(regions), taken));
    for (const l of leftovers) {
      const la = polygonArea(l);
      if (la < 1e-3) continue;
      const minArea = Math.min(...mix.map((t) => t.areaMin));
      if (la >= minArea) {
        raw.push({
          polys: [l],
          core: nearestCoreIndex(cores, l),
          type: typeByArea(la, mix, new Map()),
        });
        continue;
      }
      const c = ringCentroid(l.outer);
      const order = raw
        .map((u, i) => ({ i, d: dist(ringCentroid(u.polys[0]!.outer), c) }))
        .sort((x, y) => x.d - y.d);
      let merged = false;
      for (const { i } of order) {
        const m = union([raw[i]!.polys[0]!, l]);
        if (m.length === 1) {
          raw[i]!.polys[0] = m[0]!;
          merged = true;
          break;
        }
      }
      if (!merged) circulation.push({ kind: 'landing', polygon: l, area: la });
    }
    // --- façade rules: measure, merge units without enough façade, downgrade types ----
    const outline = union(solids.map((x) => normalizePolygon(x.footprint)));
    const facadeSegs = polygonEdges(outline);
    const outlineSegs = [...facadeSegs];
    const outdoorCfg = resolveOutdoor(mass, settings);
    const outdoorRules = resolveOutdoorRules(settings);
    const ground = first.storeyIndex === 0;
    if (rules.galleryCountsAsFacade)
      facadeSegs.push(
        ...polygonEdges(circulation.filter((c) => c.kind === 'gallery').map((c) => c.polygon)),
      );
    const minReq = Math.min(...mix.map(fc.req));
    const roomsOf = (t: UnitType) =>
      t.duplex && pass.duplex ? duplexProgram(unitRooms(t), pass.duplex, rules) : unitRooms(t);
    const wetOf = (t: UnitType) =>
      t.duplex && pass.duplex ? duplexWet(unitRooms(t), pass.duplex) : wetProgram(unitRooms(t));
    const accessPolys = [...cores, ...circulation].map((c) => c.polygon);
    const polys = raw.map((u) => simplify(u.polys[0]!));
    const fac = polys.map((p) => facadeOf(p, facadeSegs).length);
    const alive = raw.map(() => true);
    for (let i = 0; i < raw.length; i++) {
      if (!alive[i] || fac[i]! >= minReq - 1e-6) continue;
      // merge with the neighbour sharing the longest wall (the merged unit must stay one polygon)
      const edges = polygonEdges([polys[i]!]);
      const cands = raw
        .map((_, j) => ({
          j,
          shared: j === i || !alive[j] ? 0 : facadeOf(polys[j]!, edges).length,
        }))
        .filter((c) => c.shared > 1)
        .sort((x, y) => y.shared - x.shared);
      for (const { j } of cands) {
        const m = union([polys[j]!, polys[i]!]);
        if (m.length !== 1 || m[0]!.holes?.length) continue;
        polys[j] = simplify(m[0]!);
        fac[j] = facadeOf(polys[j]!, facadeSegs).length;
        alive[i] = false;
        if (raw[j]!.type && raw[i]!.type) delete raw[j]!.type;
        break;
      }
    }
    raw.forEach((u, i) => {
      if (!alive[i]) return;
      const polygon = polys[i]!;
      const area = polygonArea(polygon);
      const facade = facadeOf(polygon, facadeSegs);
      const pieces = facade.segments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
      const allowed = mix.filter(
        (t) => fc.req(t) <= facade.length + 1e-6 && roomsFit(t, pieces, rules),
      );
      const pool = allowed.length ? allowed : mix;
      let choice = u.type ?? typeByArea(area, pool, new Map());
      const t = choice.type;
      if (!pool.includes(t) || area < t.areaMin - 1e-6 || area > t.areaMax + 1e-6) {
        choice = typeByArea(area, pool, new Map());
        // a wide unit with little façade: the largest type the façade allows
        if (allowed.length && !allowed.includes(choice.type))
          choice = typeByArea(area, allowed, new Map());
      }
      const need = fc.req(choice.type);
      units.push({
        polygon,
        typeId: choice.type.id,
        label: choice.type.label,
        area,
        coreIndex:
          u.core < 0 && effAccess !== 'reihenhaus' ? nearestCoreIndex(cores, polygon) : u.core,
        outOfRange: choice.outOfRange,
        facade: facade.length,
        facadeRequired: need,
        facadeOk: facade.length >= need - 1e-6 && roomsFit(choice.type, pieces, rules),
        facadeSegments: facade.segments,
        ...(choice.type.duplex && pass.duplex
          ? {
              duplex: {
                level: pass.duplex,
                part: 'lower' as const,
                storeys: [first.storeyIndex, first.storeyIndex] as [number, number],
                totalArea: area,
              },
            }
          : {}),
        rooms: unitRoomLayout(polygon, facade.segments, roomsOf(choice.type), rules, {
          preferSejour: (seg) => {
            // séjour preferably on the outer façade, where the outdoor space can go
            const outer = onLine(seg, outlineSegs);
            if (!outer) return 0;
            return sideConfig(outdoorCfg, facadeSide(seg, polygon)).kind === 'none' ? 1 : 2;
          },
          exterior: outlineSegs,
          access: accessPolys,
          ...(pass.below ? { below: pass.below } : {}),
          neighbours: units.flatMap((x) => x.rooms),
          wet: wetOf(choice.type),
          mainRooms: unitRooms(choice.type),
        }),
        ...orientationCheck(facade.segments, polygon, unitRooms(choice.type)),
        facadeRatioOk: facade.length >= rules.facadeAreaRatio * area - 1e-6,
      });
    });
    // outdoor spaces: one per dwelling, in front of (or next to) the séjour
    const placedOutdoor: Polygon[] = [];
    for (const u of units) {
      // a duplex has its outdoor space on the séjour level only
      if (u.duplex?.level === 'nuit') continue;
      const exterior = facadeOf(u.polygon, outlineSegs).segments;
      const sejour = u.rooms.find((r) => r.kind === 'sejour');
      const o = placeOutdoor(
        u.polygon,
        sejour?.polygon,
        exterior,
        outdoorCfg,
        outdoorRules,
        ground,
        placedOutdoor,
      );
      if (!o) continue;
      u.outdoor = o;
      placedOutdoor.push(o.polygon);
      if (o.kind === 'loggia' && sejour) {
        // the loggia is cut out of the séjour
        const rest = difference([sejour.polygon], [o.polygon]).sort(
          (a, b) => polygonArea(b) - polygonArea(a),
        )[0];
        if (rest) {
          sejour.polygon = rest;
          sejour.area = polygonArea(rest);
        }
      }
    }
  }

  const byType: LayoutTypeCount[] = mix
    .filter((t, i) => mix.findIndex((x) => x.id === t.id) === i)
    .map((t) => {
      const list = units.filter((u) => u.typeId === t.id);
      const dpx = list.filter((u) => u.duplex?.level === 'jour').length;
      return {
        typeId: t.id,
        label: t.label,
        count: list.filter(countsHere).length,
        area: list.reduce((s, u) => s + u.area, 0),
        ...(dpx ? { duplex: dpx } : {}),
      };
    })
    .filter((t) => t.area > 0);
  for (const xs of [cores, circulation, open]) for (const x of xs) x.polygon = simplify(x.polygon);
  const sum = (xs: LayoutArea[]) => xs.reduce((s, x) => s + x.area, 0);
  const footprints = solids.map((s) => normalizePolygon(s.footprint));
  const summary: StoreyLayoutSummary = {
    units: units.filter(countsHere).length,
    byType,
    unitArea: units.reduce((s, u) => s + u.area, 0),
    coreArea: sum(cores),
    circulationArea: sum(circulation),
    openArea: sum(open),
    footprintArea: footprints.reduce((s, p) => s + polygonArea(p), 0),
    facadeViolations: units.filter((u) => !u.facadeOk && countsHere(u)).length,
  };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const signature = [
    usage,
    ...footprints.map((p) => p.outer.map(([x, y]) => `${r1(x)},${r1(y)}`).join(';')),
    ...units.map((u) => `${u.typeId}${u.duplex ? `/${u.duplex.level}` : ''}:${r1(u.area)}`),
  ].join('|');
  const out: StoreyLayout = {
    massId: mass.id,
    storeyIndex: first.storeyIndex,
    label: first.label,
    usage,
    access: effAccess,
    setback: first.setback,
    z0: first.z0,
    z1: Math.max(...solids.map((x) => x.z1)),
    footprints,
    cores,
    circulation,
    open,
    units,
    summary,
    signature,
  };
  if (cores.length && summary.units)
    out.unitsPerCore = Math.round((summary.units / cores.length) * 10) / 10;
  return { layout: out, pins };
}

/** A dwelling counts on the storey of its entrance (the séjour level of a duplex). */
const countsHere = (u: LayoutUnit): boolean => u.duplex?.level !== 'nuit';

/** True when the midpoint of `seg` lies on one of `lines` (±2 cm). */
/**
 * Order of the dwellings of a row: the largest at the row ends that are building corners
 * (docs/GRUNDRISS_REGELN.md §11), the smallest in the middle.
 */
function cornerOrder(types: UnitType[], atStart: boolean, atEnd: boolean): UnitType[] {
  const big = [...types].sort((a, b) => unitRooms(b) - unitRooms(a) || b.areaTarget - a.areaTarget);
  if (!atStart && !atEnd) return big;
  if (atStart && !atEnd) return big;
  if (!atStart && atEnd) return big.reverse();
  // both ends: alternate the largest to the two ends
  const left: UnitType[] = [];
  const right: UnitType[] = [];
  big.forEach((t, i) => (i % 2 === 0 ? left : right).push(t));
  return [...left, ...right.reverse()];
}

/**
 * Orientation rules (docs/GRUNDRISS_REGELN.md §5): from T3 at least two orientations; no
 * dwelling faces north only.
 */
function orientationCheck(
  segs: readonly [Vec2, Vec2][],
  unit: Polygon,
  rooms: number,
): { orientations: FacadeSide[]; orientationOk: boolean } {
  const set = new Set<FacadeSide>();
  for (const s of segs)
    if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) >= 0.8) set.add(facadeSide(s, unit));
  const orientations = FACADE_SIDES.filter((x) => set.has(x));
  const northOnly = orientations.length === 1 && orientations[0] === 'N';
  return {
    orientations,
    orientationOk: !northOnly && (rooms < 3 || orientations.length >= 2),
  };
}

function onLine([a, b]: [Vec2, Vec2], lines: readonly [Vec2, Vec2][]): boolean {
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return lines.some(([p, q]) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return false;
    const t = ((m[0] - p[0]) * dx + (m[1] - p[1]) * dy) / l2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(p[0] + dx * t - m[0], p[1] + dy * t - m[1]) < 0.02;
  });
}

/** Drop vertices closer than `tol` to the line through their neighbours (clipping noise). */
function simplify(p: Polygon, tol = 0.02, despike = true): Polygon {
  const ring = (r: Vec2[]): Vec2[] => {
    const pts = [...r];
    let changed = true;
    while (changed && pts.length > 3) {
      changed = false;
      for (let i = 0; i < pts.length && pts.length > 3; i++) {
        const a = pts[(i + pts.length - 1) % pts.length]!;
        const b = pts[i]!;
        const c = pts[(i + 1) % pts.length]!;
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const cross = Math.abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]));
        if (len < 1e-9 || cross / len < tol) {
          pts.splice(i, 1);
          changed = true;
          i--;
        }
      }
    }
    return pts;
  };
  const out: Polygon = { outer: ring(p.outer) };
  if (p.holes?.length) out.holes = p.holes.map(ring);
  return despike ? removeSpikes(out, (q) => simplify(q, tol, false)) : out;
}

/**
 * Removes zero-width spikes and hairline strips (left by merging polygons with tiny gaps and
 * by `simplify`): they would count as façade and show as flickering faces in 3D. Polygons
 * without such parts are returned unchanged.
 */
function removeSpikes(p: Polygon, clean: (p: Polygon) => Polygon): Polygon {
  const e = 0.005;
  const opened = offsetPolygons(offsetPolygons([p], -e), e);
  if (!opened.length) return p;
  const perimeter = opened.reduce((s, q) => s + polygonPerimeter(q), 0);
  if (Math.abs(perimeter - polygonPerimeter(p)) < 0.05) return p;
  return clean(opened.reduce((x, y) => (polygonArea(y) > polygonArea(x) ? y : x)));
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function nearestCoreIndex(cores: LayoutArea[], p: Polygon): number {
  if (!cores.length) return -1;
  const c = ringCentroid(p.outer);
  let best = 0;
  cores.forEach((k, i) => {
    if (dist(ringCentroid(k.polygon.outer), c) < dist(ringCentroid(cores[best]!.polygon.outer), c))
      best = i;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Duplex dwellings
// ---------------------------------------------------------------------------

export const DEFAULT_DUPLEX: DuplexConfig = { enabled: false, fromStorey: 3, entry: 'lower' };

/** Area of the internal stair of a duplex (both levels together), m². */
export const DUPLEX_STAIR_AREA = 4;

/** Duplex configuration of a building: its own, else the project default, else off. */
export function resolveDuplex(
  mass: Pick<Mass, 'duplex'>,
  settings: Pick<Settings, 'duplex'>,
): DuplexConfig {
  return { ...DEFAULT_DUPLEX, ...(settings.duplex ?? {}), ...(mass.duplex ?? {}) };
}

/** Types of the mix that may be duplex: the configured ones, else those with ≥ 3 rooms. */
export function duplexTypeIds(mix: readonly UnitType[], cfg: DuplexConfig): string[] {
  return (cfg.types ?? mix.filter((t) => unitRooms(t) >= 3).map((t) => t.id)).filter((id) => {
    const t = mix.find((x) => x.id === id);
    return !!t && unitRooms(t) >= 2;
  });
}

/** Share of the simplex variant of a duplex type: only used where no duplex fits the area. */
const SIMPLEX_FALLBACK_SHARE = 1e-6;

/**
 * Unit mix of one storey of a duplex pair: duplex types as one level (half the area plus half
 * the stair), simplex types with half their share (they exist on both storeys, a duplex once).
 * Duplex types keep a simplex variant for dwellings too large for a duplex level (e.g. the
 * two dwellings of a Zweispänner landing).
 */
export function duplexMix(mix: readonly UnitType[], ids: readonly string[]): UnitType[] {
  const half = (a: number) => Math.round((a / 2 + DUPLEX_STAIR_AREA / 2) * 10) / 10;
  return mix.flatMap((t) =>
    ids.includes(t.id)
      ? [
          {
            ...t,
            duplex: true,
            areaMin: half(t.areaMin),
            areaTarget: half(t.areaTarget),
            areaMax: half(t.areaMax),
          },
          { ...t, share: SIMPLEX_FALLBACK_SHARE },
        ]
      : [{ ...t, share: t.share / 2 }],
  );
}

const footprintKey = (st: StoreyLayout) =>
  st.footprints
    .map((p) => p.outer.map(([x, y]) => `${Math.round(x * 20)},${Math.round(y * 20)}`).join(';'))
    .join('|');

/**
 * Internal stair of a duplex: 1.0 × 2.6 m in the part of the dwelling without rooms, else
 * (open stair) in the séjour, never in a bedroom.
 */
function duplexStair(
  unit: Polygon,
  bedrooms: readonly Polygon[],
  sejour: readonly Polygon[],
): Polygon | undefined {
  return (
    stairIn(unit, difference([unit], [...bedrooms, ...sejour])) ??
    stairIn(unit, difference([unit], bedrooms))
  );
}

function stairIn(unit: Polygon, free: Polygon[]): Polygon | undefined {
  const rest = free.filter((p) => polygonArea(p) > 2.5);
  if (!rest.length) return undefined;
  const e = orientedExtents(unit.outer);
  const c = ringCentroid(rest.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a)).outer);
  let best: { poly: Polygon; d: number } | undefined;
  for (const ang of [e.angle, e.angle + Math.PI / 2]) {
    const u: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const n: Vec2 = [-u[1], u[0]];
    const f: Frame = { o: [0, 0], u, n };
    const [a0, b0, a1, b1] = frameExtents(f, [unit]);
    const w = 2.6;
    const h = 1.0;
    for (let a = a0 + 0.1; a + w <= a1 - 0.1 + 1e-9; a += 0.25)
      for (let b = b0 + 0.1; b + h <= b1 - 0.1 + 1e-9; b += 0.25) {
        const poly = rectPoly(f, [a, b, a + w, b + h]);
        const inside = intersection(rest, [poly]).reduce((x, q) => x + polygonArea(q), 0);
        if (inside < w * h - 0.02) continue;
        const d = dist(ringCentroid(poly.outer), c);
        if (!best || d < best.d - 1e-9) best = { poly, d };
      }
  }
  return best?.poly;
}

/**
 * Duplex pairs of a mass: consecutive residential storeys from `fromStorey` up with the same
 * footprint. Both storeys are laid out with the duplex mix (core positions of the simplex
 * layout kept) and the duplex dwellings of the two storeys are linked level by level.
 */
function applyDuplex(
  mass: Mass,
  byStorey: Map<number, StoreySolid[]>,
  settings: Settings,
  access: AccessType,
  storeys: StoreyLayout[],
  pins: Map<number, number[][]>,
): StoreyLayout[] {
  const cfg = resolveDuplex(mass, settings);
  if (!cfg.enabled || access === 'reihenhaus') return storeys;
  const ids = duplexTypeIds(settings.unitMix, cfg);
  if (!ids.length) return storeys;
  const dSettings: Settings = { ...settings, unitMix: duplexMix(settings.unitMix, ids) };
  const out = [...storeys];
  const lowerLevel = cfg.entry === 'upper' ? 'nuit' : 'jour';
  const upperLevel = lowerLevel === 'jour' ? 'nuit' : 'jour';
  for (let i = 0; i + 1 < out.length; i++) {
    const lo = out[i]!;
    const hi = out[i + 1]!;
    if (
      lo.storeyIndex < cfg.fromStorey ||
      hi.storeyIndex !== lo.storeyIndex + 1 ||
      lo.usage !== 'wohnen' ||
      hi.usage !== 'wohnen' ||
      !lo.units.length ||
      !hi.units.length ||
      footprintKey(lo) !== footprintKey(hi)
    )
      continue;
    const p = pins.get(lo.storeyIndex);
    const pass = (level: 'jour' | 'nuit') => (p ? { pins: p, duplex: level } : { duplex: level });
    const L = layoutStorey(
      mass,
      byStorey.get(lo.storeyIndex)!,
      dSettings,
      access,
      pass(lowerLevel),
    ).layout;
    const U = layoutStorey(
      mass,
      byStorey.get(hi.storeyIndex)!,
      dSettings,
      access,
      pass(upperLevel),
    ).layout;
    const ld = L.units.filter((u) => u.duplex);
    const ud = U.units.filter((u) => u.duplex);
    if (!ld.length || ld.length !== ud.length) continue;
    // link the levels (same polygons on both storeys)
    const pairs: [LayoutUnit, LayoutUnit][] = [];
    for (const a of ld) {
      const ca = ringCentroid(a.polygon.outer);
      const b = ud.find(
        (x) => x.typeId === a.typeId && dist(ringCentroid(x.polygon.outer), ca) < 0.05,
      );
      if (b) pairs.push([a, b]);
    }
    if (pairs.length !== ld.length) continue;
    for (const [a, b] of pairs) {
      const total = a.area + b.area;
      const rooms = [...a.rooms, ...b.rooms];
      const loggias = [a.outdoor, b.outdoor]
        .filter((o) => o?.kind === 'loggia')
        .map((o) => o!.polygon);
      const bed = rooms.filter((r) => r.kind === 'chambre' || r.kind === 'chambrePmr');
      const wetRooms = rooms.filter(
        (r) => r.kind !== 'sejour' && r.kind !== 'degagement' && !bed.includes(r),
      );
      const hard = [...bed.map((r) => r.polygon), ...loggias];
      const sej = rooms.filter((r) => r.kind === 'sejour').map((r) => r.polygon);
      let stair = duplexStair(a.polygon, [...hard, ...wetRooms.map((r) => r.polygon)], sej);
      if (!stair) {
        // last resort: through the wet core / passage, which give way to the stair
        stair = stairIn(a.polygon, difference([a.polygon], hard));
        if (stair)
          for (const u of [a, b])
            u.rooms = u.rooms.flatMap((r) => {
              if (bed.includes(r) || overlapArea([r.polygon], [stair!]) < 1e-3) return [r];
              const rest = difference([r.polygon], [stair!]).sort(
                (x, y) => polygonArea(y) - polygonArea(x),
              )[0];
              if (!rest || polygonArea(rest) < 0.2) return [];
              return [
                {
                  ...r,
                  polygon: rest,
                  area: polygonArea(rest),
                  areaOk: r.areaRequired <= 0 || polygonArea(rest) >= r.areaRequired - 0.05,
                },
              ];
            });
      }
      for (const [u, part] of [
        [a, 'lower'],
        [b, 'upper'],
      ] as const) {
        u.duplex = {
          level: u.duplex!.level,
          part,
          storeys: [lo.storeyIndex, hi.storeyIndex],
          totalArea: total,
          ...(stair ? { stair } : {}),
        };
      }
    }
    out[i] = L;
    out[i + 1] = U;
    i++;
  }
  return out;
}

/**
 * Stair cores must stack: storeys without dwellings (commerce, offices on the ground floor)
 * take the cores of the nearest storey with dwellings above, clipped to their own footprint,
 * so the stairs run straight through. Their open area is recomputed around the cores.
 */
export function stackCores(storeys: StoreyLayout[]): StoreyLayout[] {
  return storeys.map((st, i) => {
    if (st.units.length || !st.cores.length) return st;
    const ref = storeys.slice(i + 1).find((x) => x.units.length && x.cores.length);
    if (!ref) return st;
    const cores: LayoutArea[] = [];
    for (const c of ref.cores)
      for (const p of intersection(st.footprints, [c.polygon]))
        if (polygonArea(p) > 1e-3)
          cores.push({
            kind: 'core',
            polygon: p,
            area: polygonArea(p),
            index: cores.length,
            ...(c.box ? { box: c.box } : {}),
          });
    if (!cores.length) return st;
    // the lift opposite the stair runs down too
    const lifts: LayoutArea[] = [];
    for (const c of ref.circulation)
      if (c.kind === 'lift')
        for (const p of intersection(st.footprints, [c.polygon]))
          if (polygonArea(p) > 1e-3) lifts.push({ kind: 'lift', polygon: p, area: polygonArea(p) });
    const circulation = [...st.circulation, ...lifts];
    const taken = union([...cores.map((c) => c.polygon), ...circulation.map((c) => c.polygon)]);
    const open: LayoutArea[] = difference(st.footprints, taken)
      .filter((p) => polygonArea(p) > 1e-3)
      .map((p) => ({ kind: 'open', polygon: p, area: polygonArea(p) }));
    const sum = (a: readonly LayoutArea[]) => a.reduce((x, y) => x + y.area, 0);
    return {
      ...st,
      cores,
      circulation,
      open,
      summary: { ...st.summary, coreArea: sum(cores), openArea: sum(open) },
    };
  });
}

/** Layouts of all above-ground storeys of one mass (from its storey solids). */
export function massLayout(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  areaBasedDwellings?: number,
): MassLayout {
  const access = resolveAccess(mass, settings);
  const byStorey = new Map<number, StoreySolid[]>();
  for (const s of solids) {
    if (!s.aboveGround || s.massId !== mass.id) continue;
    const list = byStorey.get(s.storeyIndex) ?? [];
    list.push(s);
    byStorey.set(s.storeyIndex, list);
  }
  const pins = new Map<number, number[][]>();
  // séjours stack: each storey sees the séjours of the storey below
  let below: Polygon[] | undefined;
  const simplex = [...byStorey.keys()]
    .sort((a, b) => a - b)
    .map((i) => {
      const r = layoutStorey(mass, byStorey.get(i)!, settings, access, below ? { below } : {});
      pins.set(i, r.pins);
      const sej = r.layout.units.flatMap((u) =>
        u.rooms.filter((x) => x.kind === 'sejour').map((x) => x.polygon),
      );
      below = sej.length ? sej : below;
      return r.layout;
    });
  const storeys = stackCores(applyDuplex(mass, byStorey, settings, access, simplex, pins));
  const counts = new Map<string, LayoutTypeCount>();
  let units = 0;
  let unitArea = 0;
  const houses = access === 'reihenhaus';
  for (const st of storeys) {
    // a terraced house spans all storeys: count it once (on its lowest residential storey)
    if (houses && st !== storeys.find((s) => s.units.length)) continue;
    for (const t of st.summary.byType) {
      const c = counts.get(t.typeId) ?? { typeId: t.typeId, label: t.label, count: 0, area: 0 };
      c.count += t.count;
      c.area += t.area;
      if (t.duplex) c.duplex = (c.duplex ?? 0) + t.duplex;
      counts.set(t.typeId, c);
    }
    units += st.summary.units;
    unitArea += st.summary.unitArea;
  }
  const out: MassLayout = {
    massId: mass.id,
    name: mass.name,
    access,
    storeys,
    totals: { units, byType: [...counts.values()], unitArea },
    areaBasedDwellings: areaBasedDwellings ?? 0,
  };
  const expected = unitsPerCoreRange(access, coreRange(settings));
  if (expected) out.expectedUnitsPerCore = expected;
  return out;
}

/**
 * Layouts of all masses of a variant: pass a project (active variant) or an existing
 * VariantResult with the settings.
 */
export function massLayouts(input: Project | VariantResult, settings?: Settings): MassLayout[] {
  let result: VariantResult;
  let s: Settings;
  if ('variants' in input) {
    s = settings ?? input.settings;
    const variant = input.variants.find((v) => v.id === input.activeVariantId) ?? input.variants[0];
    result = analyzeMasses(variant?.masses ?? [], s);
  } else {
    if (!settings) throw new Error('massLayouts(VariantResult) needs settings');
    s = settings;
    result = input;
  }
  return result.masses.map((m: MassResult) => {
    // memoized mass results have frozen inputs: their layout can be reused as long as the
    // settings are the same (moving one mass then only lays out that mass again)
    const memo = isMemoizedMassResult(m);
    const hit = memo ? layoutMemo.get(m) : undefined;
    if (hit && hit.settings === s) return hit.layout;
    const layout = massLayout(
      m.mass,
      m.solids.map((r) => r.solid),
      s,
      m.dwellings.total,
    );
    if (memo) layoutMemo.set(m, { settings: s, layout });
    return layout;
  });
}

const layoutMemo = new WeakMap<MassResult, { settings: Settings; layout: MassLayout }>();

/** Area-based dwelling count for a living area (re-exported for the UI comparison note). */
export const areaBasedUnitCount = (livingArea: number, settings: Settings): number =>
  unitMix(livingArea, settings.unitMix).total;
