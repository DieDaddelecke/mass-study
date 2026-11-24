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
  blindFacades,
  resolveBoundaryRules,
  subtractSegments,
  vueDistance,
  type SiteEdges,
} from './boundaries.js';
import {
  analyzeMasses,
  isMemoizedMassResult,
  type MassResult,
  type VariantResult,
} from './analysis.js';
import { largestRemainder, unitMix } from './mix.js';
import {
  difference,
  intersection,
  normalizePolygon,
  offsetPolygons,
  polygonDistance,
  offsetPolyline,
  pointInPolygon,
  overlapArea,
  orientedExtents,
  rect,
  polygonArea,
  polygonPerimeter,
  ringCentroid,
  union,
} from './geometry.js';
import { massUnitsPerCoreRange, requiredCores, resolveAccess } from './typologies.js';
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
import { libraryWidths, matchTemplate, planTemplates, type UnitTemplate } from './planLibrary.js';
import { duplexProgram, duplexWet, unitRoomLayout, wetProgram, type LayoutRoom } from './rooms.js';
import type { LayoutSpace, OfficeSummary, ResidenceSummary } from './spaces.js';
import { residenceStoreyLayout } from './residence.js';
import { officeStoreyLayout } from './office.js';
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
  /** False when the unit has no door (≥ 0.90 m) to a landing, corridor or gallery. */
  accessOk?: boolean;
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
  /** Interior spaces of a residence unit (entrée, salle d'eau, kitchenette). */
  spaces?: LayoutSpace[];
  /** Plan of the office library the dwelling follows (rooms from the template). */
  template?: UnitTemplate;
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
  /** Dwellings following a plan of the office library. */
  libraryUnits?: number;
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
  /** Rooms of residence / office storeys not owned by a unit (shafts, common rooms, plateau). */
  spaces?: LayoutSpace[];
  residence?: ResidenceSummary;
  office?: OfficeSummary;
  /**
   * Façade pieces facing a neighbour boundary closer than the vue distance: no windows, no
   * balconies (mur aveugle).
   */
  blindFacades?: [Vec2, Vec2][];
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

export interface Frame {
  o: Vec2;
  u: Vec2;
  n: Vec2;
}

export interface Bar {
  frame: Frame;
  /** Region of the footprint owned by this bar (world). */
  region: Polygon[];
  length: number;
  depth: number;
}

export type Rect = [number, number, number, number]; // a0, b0, a1, b1 in bar coordinates

const toWorld = (f: Frame, a: number, b: number): Vec2 => [
  f.o[0] + f.u[0] * a + f.n[0] * b,
  f.o[1] + f.u[1] * a + f.n[1] * b,
];
const toFrame = (f: Frame, p: Vec2): Vec2 => {
  const dx = p[0] - f.o[0];
  const dy = p[1] - f.o[1];
  return [dx * f.u[0] + dy * f.u[1], dx * f.n[0] + dy * f.n[1]];
};

export function rectPoly(f: Frame, [a0, b0, a1, b1]: Rect): Polygon {
  return normalizePolygon({
    outer: [toWorld(f, a0, b0), toWorld(f, a1, b0), toWorld(f, a1, b1), toWorld(f, a0, b1)],
  });
}

/** Oriented rectangle of a (clipped) piece in a bar frame. */
export function boxOf(f: Frame, p: Polygon): CoreBox {
  const [a0, b0, a1, b1] = frameExtents(f, [p]);
  return { o: toWorld(f, a0, b0), u: f.u, n: f.n, w: a1 - a0, d: b1 - b0 };
}

const validRect = (r: Rect): boolean => r[2] - r[0] > 1e-6 && r[3] - r[1] > 1e-6;
const keep = (...rs: Rect[]): Rect[] => rs.filter(validRect);

/** Extents of polygons in a frame. */
export function frameExtents(f: Frame, polys: readonly Polygon[]): Rect {
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

/**
 * Bars whose far side (b = depth) faces a neighbour boundary more than their access side
 * (b = 0) are turned round: dwellings then get their windows on the open side.
 */
function accessTowardsBlind(bars: Bar[], party: LayoutPass['party'], outline: Polygon[]): Bar[] {
  if (!party) return bars;
  const blind = blindFacades(
    polygonEdges(outline),
    outline,
    party.segs,
    party.distance,
    party.site,
  );
  if (!blind.length) return bars;
  return bars.map((bar) => {
    let near = 0;
    let far = 0;
    for (const [p, q] of blind) {
      const [a0, b0] = toFrame(bar.frame, p);
      const [a1, b1] = toFrame(bar.frame, q);
      if (Math.abs(b1 - b0) > 0.1 || a1 < -0.1 || a0 > bar.length + 0.1) continue;
      const l = Math.abs(a1 - a0);
      if (Math.abs(b0) < 0.3) near += l;
      else if (Math.abs(b0 - bar.depth) < 0.3) far += l;
    }
    if (far <= near + 1e-6) return bar;
    const u: Vec2 = [-bar.frame.u[0], -bar.frame.u[1]];
    const n: Vec2 = [-bar.frame.n[0], -bar.frame.n[1]];
    return { ...bar, frame: { o: toWorld(bar.frame, bar.length, bar.depth), u, n } };
  });
}

const unit = (dx: number, dy: number): Vec2 => {
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

/** Straight bars of one storey solid. */
export function solidBars(mass: Mass, footprint: Polygon): Bar[] {
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
    mixCores(
      bars,
      access,
      dim,
      avgTarget,
      massUnitsPerCoreRange(mass, access, coreRange(settings))?.[1] ?? coreRange(settings)[1],
    ),
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
  const perCore =
    access === 'zweispaenner'
      ? 2
      : access === 'dreispaenner'
        ? 3
        : access === 'vierspaenner'
          ? 4
          : 0;
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
export const coreCentres = (L: number, n: number): number[] =>
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
  /** Picks without taking from the pool, and taking the types of the chosen plan. */
  trial?: {
    peek: (area: number, count: number) => UnitType[];
    consume: (ts: readonly UnitType[]) => void;
  },
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

  // spänner sections of rectangular dwellings that take the plans of the office library
  if (
    (access === 'zweispaenner' || access === 'dreispaenner' || access === 'vierspaenner') &&
    (access === 'vierspaenner' || resolveUnitRules(settings).planLibrary !== false) &&
    planSpaenner(
      plan,
      L,
      D,
      n,
      access,
      dim,
      settings,
      trial ?? { peek: pick, consume: () => {} },
      fc,
      pins,
    )
  )
    return plan;

  switch (access) {
    case 'zweispaenner':
    case 'dreispaenner':
    case 'vierspaenner': {
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

/**
 * Spänner sections built from rectangular dwellings (office plan library, Soheyl 24.11.2026):
 * the core is a narrow strip across the building (stair on the access façade, landing behind it
 * up to the other façade, lift opposite the stair) and the dwellings beside it are plain
 * rectangles whose widths come from the library plans.
 * - Zweispänner: [A | strip | B] per core, A and B through the depth (traversant).
 * - Dreispänner: [A | middle | B], the middle band holds stair, lift and landing on the access
 *   side and a small mono-oriented dwelling C behind the landing.
 * - Vierspänner: [A | strip | B] on the access side and [A' | strip | B'] on the other, all
 *   mono-oriented; the landing reaches both rows.
 * Without pinned cores the number of cores may move by one from `n0` (never below the escape
 * distance minimum) and the types towards those with a library plan for the depth, when that
 * lets more dwellings take a library plan.
 * Returns false when the bar is too short or too shallow (the caller falls back).
 */
function planSpaenner(
  plan: BarPlan,
  L: number,
  D: number,
  n0: number,
  access: 'zweispaenner' | 'dreispaenner' | 'vierspaenner',
  dim: LayoutDimensions,
  settings: Settings,
  types: {
    peek: (area: number, count: number) => UnitType[];
    consume: (ts: readonly UnitType[]) => void;
  },
  fc: FacadeCtx,
  pins?: readonly number[],
): boolean {
  const pick = types.peek;
  const rules = resolveUnitRules(settings);
  const mix = settings.unitMix.filter((t) => t.share > 0 && t.areaTarget > 0);
  const cd = Math.min(dim.coreDepth, D);
  const [lw, lt] = dim.liftBox;
  const ld = dim.landingDepth;
  // stair-only core with the lift opposite (office rule F); else the core holds the lift
  const opp = dim.liftOpposite && lw > 0;
  const sw = opp ? Math.max(dim.stairCoreWidth, lw) : dim.coreWidth;
  const libOpts = { stretch: rules.libraryStretch, depthTolerance: rules.libraryDepthTolerance };
  const useLib = rules.planLibrary !== false;
  const st = rules.libraryStretch;

  /** Widths of the library plans for a type at this depth (façades on 1 or 2 long sides). */
  const planWidths = (t: UnitType, depth: number, sides: number): number[] =>
    useLib
      ? planTemplates()
          .filter(
            (p) =>
              p.rooms === unitRooms(t) &&
              Math.abs(p.depth - depth) <= rules.libraryDepthTolerance + 1e-9 &&
              p.facades.every((f) => f === 'front' || (sides >= 2 && f === 'back')) &&
              p.width * (1 + st) >= fc.width(t, sides) - 1e-9,
          )
          .map((p) => p.width)
      : [];

  /** Widths of a row of dwellings: library plans first, else by area with the minimum widths. */
  const solve = (
    ts: readonly UnitType[],
    len: number,
    depth: number,
    sides: number,
    atStart: boolean,
    atEnd: boolean,
  ): { w: number[]; hits: number } => {
    const mins = ts.map((t) => fc.width(t, sides));
    const lib = useLib
      ? libraryWidths(ts.map(unitRooms), len, depth, sides, atStart, atEnd, mins, libOpts)
      : undefined;
    if (lib) return { w: lib.widths, hits: lib.templates.filter(Boolean).length };
    // by area target, each within its type's area range where the row allows
    const lo = ts.map((t, i) => Math.max(mins[i]!, t.areaMin / depth));
    const hi = ts.map((t, i) => Math.max(lo[i]!, t.areaMax / depth));
    const w = allocate(
      len,
      ts.map((t, i) => Math.max(t.areaTarget, mins[i]! * depth)),
      lo,
    );
    const over = w.map((x, i) => Math.max(0, x - hi[i]!));
    let spare = over.reduce((a, b) => a + b, 0);
    if (spare > 1e-6) {
      w.forEach((x, i) => (w[i] = x - over[i]!));
      // the surplus goes to those below their maximum
      for (let it = 0; it < 4 && spare > 1e-6; it++) {
        const room = w.map((x, i) => Math.max(0, hi[i]! - x));
        const total = room.reduce((a, b) => a + b, 0);
        if (total < 1e-6) break;
        const give = Math.min(spare, total);
        w.forEach((x, i) => (w[i] = x + (give * room[i]!) / total));
        spare -= give;
      }
      // what no type can take widens all evenly (out of range, the layout trims it)
      if (spare > 1e-6) w.forEach((x, i) => (w[i] = x + spare / w.length));
    }
    return { w, hits: 0 };
  };

  /**
   * Types of a row: as the mix picks them ('mix'), moved to types with a library plan for the
   * depth ('library'), or all of the type whose range holds the average slot area ('area').
   */
  const rowOf = (
    len: number,
    depth: number,
    count: number,
    sides: number,
    variant: 'mix' | 'library' | 'area',
  ): UnitType[] => {
    let ts = pick(len * depth, count);
    if (ts.length !== count) return [];
    // a type that cannot be narrow enough for its area at this depth: the nearest that can
    const feasible = mix.filter((t) => fc.width(t, sides) * depth <= t.areaMax + 1e-6);
    if (!feasible.length) return [];
    const nearest = (t: UnitType, pool: readonly UnitType[]) =>
      pool.includes(t)
        ? t
        : [...pool].sort(
            (a, b) => Math.abs(a.areaTarget - t.areaTarget) - Math.abs(b.areaTarget - t.areaTarget),
          )[0]!;
    ts = ts.map((t) => nearest(t, feasible));
    const withPlan = feasible.filter((t) => !t.duplex && planWidths(t, depth, sides).length);
    if (variant === 'library') {
      if (!withPlan.length) return [];
      ts = ts.map((t) => nearest(t, withPlan));
    } else if (variant === 'area') {
      const a = (len * depth) / count;
      const inRange = (pool: readonly UnitType[]) =>
        pool.filter((t) => a >= t.areaMin - 1e-6 && a <= t.areaMax + 1e-6);
      const near = (pool: readonly UnitType[]) =>
        [...pool].sort(
          (x, y) =>
            Math.max(0, x.areaMin - a, a - x.areaMax) - Math.max(0, y.areaMin - a, a - y.areaMax),
        );
      const pool = inRange(withPlan).length
        ? inRange(withPlan)
        : inRange(feasible).length
          ? inRange(feasible)
          : near(feasible).slice(0, 1);
      if (!pool.length) return [];
      const t = [...pool].sort(
        (x, y) => Math.abs(x.areaTarget - a) - Math.abs(y.areaTarget - a),
      )[0]!;
      ts = ts.map(() => t);
    }
    ts = fitTypes(
      ts,
      fc,
      (x) => x.reduce((s2, t) => s2 + (t ? fc.width(t, sides) : 0), 0) <= len,
    ).filter((t): t is UnitType => !!t);
    return cornerOrder(ts, true, true);
  };

  /**
   * Places a row: dwellings 2i and 2i + 1 flank middle band i. Without centres the widths fill
   * the bar; with centres the middle bands stay there and each gap is solved.
   */
  const placeRow = (
    ts: readonly UnitType[],
    mids: readonly number[],
    depth: number,
    sides: number,
    centres?: readonly number[],
  ): { units: [number, number][]; mids: [number, number][]; hits: number } | undefined => {
    const units: [number, number][] = [];
    const bands: [number, number][] = [];
    if (ts.length !== 2 * mids.length) return undefined;
    if (!centres) {
      const len = L - mids.reduce((x, y) => x + y, 0);
      if (len <= 0) return undefined;
      const { w, hits } = solve(ts, len, depth, sides, true, true);
      let x = 0;
      for (let i = 0; i < mids.length; i++) {
        units.push([x, (x += w[2 * i]!)]);
        bands.push([x, (x += mids[i]!)]);
        units.push([x, (x += w[2 * i + 1]!)]);
      }
      units[units.length - 1]![1] = L;
      return { units, mids: bands, hits };
    }
    centres.forEach((c, i) => bands.push([c - mids[i]! / 2, c + mids[i]! / 2]));
    const edges = [0, ...bands.flat(), L];
    let hits = 0;
    for (let k = 0; k <= bands.length; k++) {
      const a = edges[2 * k]!;
      const b = edges[2 * k + 1]!;
      const idx = k === 0 ? [0] : k === bands.length ? [ts.length - 1] : [2 * k - 1, 2 * k];
      if (b - a < 2) return undefined;
      const r = solve(
        idx.map((i) => ts[i]!),
        b - a,
        depth,
        sides,
        k === 0,
        k === bands.length,
      );
      hits += r.hits;
      let x = a;
      idx.forEach((i, j) => (units[i] = [x, (x = j === idx.length - 1 ? b : x + r.w[j]!)]));
    }
    return { units, mids: bands, hits };
  };

  /** Stair on the access side, landing behind it, the lift opposite the stair at the far end. */
  const strip = (m0: number, m1: number, front: number, back: number) => {
    plan.cores.push([m0, 0, m0 + Math.min(sw, m1 - m0), cd]);
    if (m1 - m0 - sw > 0.05) plan.circulation.push({ kind: 'landing', rect: [m0 + sw, 0, m1, cd] });
    if (opp && back - front - lt >= 1) {
      plan.circulation.push({ kind: 'lift', rect: [m0, back - lt, m0 + lw, back] });
      plan.circulation.push({ kind: 'landing', rect: [m0, front, m1, back - lt] });
      if (m1 - m0 - lw > 0.05)
        plan.circulation.push({ kind: 'landing', rect: [m0 + lw, back - lt, m1, back] });
    } else plan.circulation.push({ kind: 'landing', rect: [m0, front, m1, back] });
  };

  const pinned = pins?.length === n0 ? pins : undefined;
  const nMin = Math.max(1, Math.ceil(L / (2 * settings.cores.maxEscapeDistance) - 1e-9));
  const ns = pinned ? [n0] : [n0, n0 - 1, n0 + 1].filter((k) => k >= nMin);
  // a trial: library dwellings it reaches, and the plan it writes when chosen
  type Trial = { score: number; apply: () => void };
  let best: Trial | undefined;
  const consider = (t: Trial | undefined) => {
    if (t && (!best || t.score > best.score + 1e-9)) best = t;
  };
  /**
   * How far the dwellings of a row leave the area range of their type (relative, summed) plus
   * those narrower than their façade rules allow: the layout has to cut or merge them.
   */
  const misfits = (
    ts: readonly UnitType[],
    units: readonly [number, number][],
    depth: number,
    sides: number,
  ) =>
    ts.reduce((sum, t, k) => {
      const w = units[k]![1] - units[k]![0];
      const a = w * depth;
      const off = Math.max(0, a - t.areaMax, t.areaMin - a) / t.areaTarget;
      return sum + 4 * off + (off > 0 ? 0.3 : 0) + (w < fc.width(t, sides) - 0.05 ? 1 : 0);
    }, 0);
  /** Distance of the dwellings' types from the shares of the unit mix (in dwellings). */
  const shareSum = mix.reduce((x, t) => x + t.share, 0) || 1;
  const mixDev = (ts: readonly UnitType[]) =>
    0.5 *
    mix.reduce(
      (x, t) =>
        x + Math.abs(ts.filter((u) => u.id === t.id).length - (t.share / shareSum) * ts.length),
      0,
    );

  const variants: ('mix' | 'area' | 'library')[] = useLib
    ? ['mix', 'area', 'library']
    : ['mix', 'area'];
  for (const n of ns) {
    const off = Math.abs(n - n0) * 4;
    for (const variant of variants) {
      if (access === 'zweispaenner') {
        if (D - cd < 1.2) continue;
        const mids = Array.from({ length: n }, () => sw);
        const ts = rowOf(L - n * sw, D, 2 * n, 2, variant);
        const row = placeRow(ts, mids, D, 2, pinned);
        if (!row) continue;
        consider({
          score: row.hits - off - mixDev(ts) - misfits(ts, row.units, D, 2),
          apply: () => {
            row.mids.forEach(([m0, m1]) => strip(m0, m1, cd, D));
            row.units.forEach(([a, b], k) =>
              plan.fixed.push({ rects: [[a, 0, b, D]], core: Math.floor(k / 2), type: ts[k] }),
            );
          },
        });
      } else if (access === 'dreispaenner') {
        // dwelling C behind the landing: mono-oriented, at least as wide as stair + lift
        const td = D - cd - ld;
        if (td < 5) continue;
        const minMid = opp ? sw + lw : dim.coreWidth;
        // the small type whose library plan wastes least beside the core, else the smallest
        const small = mix
          .filter((t) => unitRooms(t) <= 2 && !t.duplex)
          .map((t) => {
            const ws = planWidths(t, td, 1).filter((w) => w * (1 + st) >= minMid);
            const w = ws.length ? Math.min(...ws.map((x) => Math.max(x, minMid))) : undefined;
            return { t, w };
          })
          .sort(
            (a, b) =>
              (a.w === undefined ? 1 : 0) - (b.w === undefined ? 1 : 0) ||
              (a.w ?? 0) - (b.w ?? 0) ||
              a.t.areaTarget - b.t.areaTarget,
          );
        const c = small[0];
        if (!c) continue;
        let wm = c.w ?? Math.max(minMid, fc.width(c.t, 1), c.t.areaTarget / td);
        wm = Math.max(Math.min(wm, c.t.areaMax / td), minMid);
        const mids = Array.from({ length: n }, () => wm);
        const ts = rowOf(L - n * wm, D, 2 * n, 2, variant);
        const row = placeRow(ts, mids, D, 2, pinned);
        if (!row) continue;
        consider({
          score:
            row.hits +
            (c.w !== undefined ? n : 0) -
            off -
            mixDev([...ts, ...Array.from({ length: n }, () => c.t)]) -
            misfits(ts, row.units, D, 2),
          apply: () => {
            row.mids.forEach(([m0, m1], i) => {
              const kw = Math.min(opp ? sw : dim.coreWidth, m1 - m0);
              plan.cores.push([m0, 0, m0 + kw, cd]);
              const k = m0 + kw;
              if (opp && k + lw <= m1 + 1e-6) {
                plan.circulation.push({ kind: 'lift', rect: [k, cd - lt, k + lw, cd] });
                if (cd - lt > 0.05)
                  plan.circulation.push({ kind: 'landing', rect: [k, 0, k + lw, cd - lt] });
                if (m1 - k - lw > 0.05)
                  plan.circulation.push({ kind: 'landing', rect: [k + lw, 0, m1, cd] });
              } else if (m1 - k > 0.05)
                plan.circulation.push({ kind: 'landing', rect: [k, 0, m1, cd] });
              plan.circulation.push({ kind: 'landing', rect: [m0, cd, m1, cd + ld] });
              plan.fixed.push({ rects: [[m0, cd + ld, m1, D]], core: i, type: c.t });
            });
            row.units.forEach(([a, b], k) =>
              plan.fixed.push({ rects: [[a, 0, b, D]], core: Math.floor(k / 2), type: ts[k] }),
            );
          },
        });
      } else {
        // Vierspänner: two mono-oriented rows; the landing reaches both (the front row deeper
        // than the stair, the back row in front of the lift)
        const lo = cd + 1;
        const hi = D - (opp ? lt : 0) - 1;
        if (hi < lo || D < 11) continue;
        const depths = [
          ...new Set(
            [D / 2, lo, hi, 6.7, 7.4, D - 6.7, D - 7.4].map(
              (x) => Math.round(Math.min(Math.max(x, lo), hi) * 100) / 100,
            ),
          ),
        ];
        const mids = Array.from({ length: n }, () => sw);
        const len = L - n * sw;
        for (const yl of depths) {
          const front = rowOf(len, yl, 2 * n, 1, variant);
          const back = rowOf(len, D - yl, 2 * n, 1, variant);
          const f = placeRow(front, mids, yl, 1, pinned);
          if (!f) continue;
          const b = placeRow(
            back,
            mids,
            D - yl,
            1,
            f.mids.map(([m0, m1]) => (m0 + m1) / 2),
          );
          if (!b) continue;
          consider({
            score:
              f.hits +
              b.hits -
              off -
              mixDev([...front, ...back]) -
              (misfits(front, f.units, yl, 1) + misfits(back, b.units, D - yl, 1)) -
              0.05 * Math.abs(yl - D / 2),
            apply: () => {
              f.mids.forEach(([m0, m1]) => strip(m0, m1, cd, D));
              f.units.forEach(([a, x], k) =>
                plan.fixed.push({
                  rects: [[a, 0, x, yl]],
                  core: Math.floor(k / 2),
                  type: front[k],
                }),
              );
              b.units.forEach(([a, x], k) =>
                plan.fixed.push({ rects: [[a, yl, x, D]], core: Math.floor(k / 2), type: back[k] }),
              );
            },
          });
        }
      }
    }
  }
  if (!best) return false;
  (best as Trial).apply();
  types.consume(plan.fixed.flatMap((f) => (f.type ? [f.type] : [])));
  return true;
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
  site?: SiteEdges,
): StoreyLayout {
  const party = partyOf(mass, solids, settings, site);
  return layoutStorey(mass, solids, settings, access, party ? { party } : {}).layout;
}

/** Neighbour boundaries and the vue distance for the height of a mass (undefined: none). */
function partyOf(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  site?: SiteEdges,
): LayoutPass['party'] {
  const rules = resolveBoundaryRules(settings);
  if (!site?.party.length || !rules.enabled) return undefined;
  let h = 0;
  for (const s of solids) if (s.aboveGround && s.massId === mass.id) h = Math.max(h, s.z1);
  return {
    segs: site.party,
    distance: vueDistance(rules, h),
    ...(site.boundary ? { site: site.boundary } : {}),
  };
}

interface LayoutPass {
  /** Core centres per bar to keep (from the simplex layout of the same footprint). */
  pins?: number[][];
  /** Level of the duplex dwellings on this storey (duplex types of the mix). */
  duplex?: 'jour' | 'nuit';
  /** Séjours of the storey below (séjours and loggias stack). */
  below?: Polygon[];
  /** Neighbour boundaries: façades facing them within `distance` get no windows. */
  party?: { segs: [Vec2, Vec2][]; distance: number; site?: Polygon };
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
  // access side (landing, gallery, corridor) towards a neighbour boundary when one long side
  // must stay blind (no windows there), else north
  const bars = accessTowardsBlind(
    outlines.flatMap((p) => solidBars(mass, p)),
    pass.party,
    union(solids.map((x) => normalizePolygon(x.footprint))),
  );
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
  /** The same without taking the types from the storey's pool (for trials). */
  const peek = (area: number, count: number): UnitType[] =>
    mix.length ? rowTypes(area, [...typePool], mix, avgTarget, count) : [];
  /** Takes the types a plan uses from the storey's pool. */
  const consume = (ts: readonly UnitType[]) => {
    for (const t of ts) {
      const i = typePool.indexOf(t);
      if (i >= 0) typePool.splice(i, 1);
    }
  };
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
        { peek, consume },
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
  const blind: [Vec2, Vec2][] = [];
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
        let widths = allocate(
          len,
          ordered.map((t) => Math.max(t.areaTarget, minWidth(t) * (b1 - b0))),
          ordered.map(minWidth),
        );
        // office plan library first: widths that let each dwelling take a library plan
        const lib =
          rules.planLibrary !== false
            ? libraryWidths(
                ordered.map((t) => unitRooms(t)),
                len,
                b1 - b0,
                row.sides,
                row.atStart,
                row.atEnd,
                ordered.map(minWidth),
                { stretch: rules.libraryStretch, depthTolerance: rules.libraryDepthTolerance },
              )
            : undefined;
        if (lib) widths = lib.widths;
        // a library dwelling keeps its width within the stretch of its plan
        const libRange = (k: number): [number, number] => {
          const w = widths[k]!;
          if (!lib?.templates[k]) return [0, Infinity];
          const tol = rules.libraryStretch * 0.5;
          return [w * (1 - tol), w * (1 + tol)];
        };
        // party walls on the façade grid (office rule E, default 1.25 m): each boundary moves
        // to the nearest grid line that keeps both neighbours at their minimum width
        const grid = rules.facadeGrid;
        if (grid > 0 && ordered.length > 1) {
          let x = a0;
          const bounds = widths.slice(0, -1).map((w) => (x += w));
          for (let k = 0; k < bounds.length; k++) {
            const left = k ? bounds[k - 1]! : a0;
            const right = k + 1 < bounds.length ? bounds[k + 1]! : a1;
            const [l0, l1] = libRange(k);
            const [r0, r1] = libRange(k + 1);
            const lo = Math.max(
              left + (lib?.templates[k] ? l0 : minWidth(ordered[k]!)),
              right - (lib?.templates[k + 1] ? r1 : Infinity),
            );
            const hi = Math.min(
              right - (lib?.templates[k + 1] ? r0 : minWidth(ordered[k + 1]!)),
              left + (lib?.templates[k] ? l1 : Infinity),
            );
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
    // façades facing a neighbour boundary too closely have no windows (vues droites)
    const allSegs = polygonEdges(outline);
    blind.push(
      ...(pass.party
        ? blindFacades(allSegs, outline, pass.party.segs, pass.party.distance, pass.party.site)
        : []),
    );
    const facadeSegs = subtractSegments(allSegs, blind);
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
    // --- every dwelling reachable, no dwelling larger than its type allows ------------------
    // (office rules 23.11.2026: a unit without a door to a landing/corridor is not a unit; the
    // surplus of a corner or deep piece is no living area, a T2 never exceeds its areaMax)
    if (effAccess !== 'reihenhaus' && !pass.duplex) {
      const DOOR = 0.9;
      const access = () => [...cores, ...circulation].map((c) => c.polygon);
      let accessEdges = polygonEdges(access());
      const door = (p: Polygon) => facadeOf(p, accessEdges).length;
      const facOf = (p: Polygon) => facadeOf(p, facadeSegs);
      /** Largest area a unit with this façade may have (largest allowed type's areaMax). */
      const allowedFor = (p: Polygon) => {
        const f = facOf(p);
        const pieces = f.segments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
        return mix.filter((t) => fc.req(t) <= f.length + 1e-6 && roomsFit(t, pieces, rules));
      };
      const maxArea = (p: Polygon) => {
        const ok = allowedFor(p);
        const pool = ok.length ? ok : [...mix].sort((a, b) => a.areaMax - b.areaMax).slice(0, 1);
        return Math.max(...pool.map((t) => t.areaMax));
      };
      const shared = (a: Polygon, b: Polygon) => facadeOf(a, polygonEdges([b])).length;
      // no dwelling half in the dark middle of the building (Soheyl 23.11.2026): at most
      // max(4 m², 10 %) of it outside the zone in front of its façade
      const dark = (p: Polygon) =>
        darkArea(p, facOf(p).segments) > Math.max(4, 0.1 * polygonArea(p));
      // one compact piece: no hole, no neck narrower than 1 m
      const single = (ps: Polygon[]) => {
        const xs = ps.filter((q) => polygonArea(q) > 0.05);
        if (xs.length !== 1 || xs[0]!.holes?.length) return undefined;
        return offsetPolygons([xs[0]!], -0.5).filter((q) => polygonArea(q) > 0.05).length === 1 &&
          !tubeLike(xs[0]!)
          ? xs[0]
          : undefined;
      };
      const live = () => raw.map((_, k) => k).filter((k) => alive[k]);

      // 1. unreachable dwellings: a corridor (1.20 m) through a reachable neighbour, else a merge
      for (const i of live()) {
        if (door(polys[i]!) >= DOOR) continue;
        let best: { j: number; band: Polygon; rest: Polygon } | undefined;
        for (const j of live()) {
          if (j === i || door(polys[j]!) < DOOR || shared(polys[j]!, polys[i]!) < 1.2) continue;
          const band = corridorIn(polys[j]!, access(), polys[i]!, 1.2);
          if (!band) continue;
          const rest = single(difference([polys[j]!], [band]));
          if (!rest || facOf(rest).length < facOf(polys[j]!).length - 0.3) continue;
          if (facadeOf(rest, polygonEdges([...access(), band])).length < DOOR) continue;
          if (!best || polygonArea(band) < polygonArea(best.band)) best = { j, band, rest };
        }
        if (best) {
          polys[best.j] = simplify(best.rest);
          circulation.push({ kind: 'corridor', polygon: best.band, area: polygonArea(best.band) });
          accessEdges = polygonEdges(access());
          delete raw[best.j]!.type;
          continue;
        }
        // no corridor: merge into the reachable neighbour where the result stays in range
        const cands = live()
          .filter((j) => j !== i && door(polys[j]!) >= DOOR && shared(polys[j]!, polys[i]!) > 1)
          .map((j) => ({ j, m: single(union([polys[j]!, polys[i]!])) }))
          .filter((c): c is { j: number; m: Polygon } => !!c.m)
          .sort((x, y) => polygonArea(x.m) - maxArea(x.m) - (polygonArea(y.m) - maxArea(y.m)));
        const c = cands[0];
        if (c) {
          polys[c.j] = simplify(c.m);
          alive[i] = false;
          delete raw[c.j]!.type;
        }
      }

      // 2. surplus: keep the part near the façade (and the way to the door), the rest goes to a
      // neighbour that becomes a larger type, or stays as unused secondary area
      for (const i of live()) {
        const p = polys[i]!;
        const area = polygonArea(p);
        const cap = maxArea(p);
        if (area <= cap + 1e-6 && !dark(p) && !tubeLike(p)) continue;
        // the way from the door to the kept part is a shared corridor, never a long hall of
        // the dwelling in the dark middle of the building (Soheyl 23.11.2026)
        const hall = new WeakMap<Polygon, Polygon>();
        const cands = trimToArea(p, facOf(p).segments, cap - 0.05, (q) => {
          if (polygonArea(q) > maxArea(q) + 1e-6 || dark(q) || tubeLike(q)) return undefined;
          if (facadeOf(q, accessEdges).length >= DOOR) return q;
          const band = corridorIn(p, access(), q, 1.2, true);
          if (!band) return undefined;
          hall.set(q, band);
          return q;
        });
        // the rest: to a neighbour that stays in range (a larger type), or unused secondary
        // area – but never façade left unused
        const apply = (facadeOpen: boolean): boolean => {
          for (const kept of cands) {
            const plan: { piece: Polygon; to?: number; m?: Polygon }[] = [];
            const grown = new Map<number, Polygon>();
            let ok = true;
            const band = hall.get(kept);
            const taken = band ? [kept, band] : [kept];
            for (const piece of difference([p], taken).filter((q) => polygonArea(q) > 0.05)) {
              const take = live()
                .filter((j) => j !== i && shared(grown.get(j) ?? polys[j]!, piece) > 2.4)
                .map((j) => ({ j, m: single(union([grown.get(j) ?? polys[j]!, piece])) }))
                .filter(
                  (c): c is { j: number; m: Polygon } =>
                    !!c.m && polygonArea(c.m) <= maxArea(c.m) + 1e-6,
                )
                .sort((x, y) => polygonArea(y.m) - polygonArea(x.m))[0];
              if (take) {
                grown.set(take.j, take.m);
                plan.push({ piece, to: take.j, m: take.m });
              } else if (facadeOpen || facOf(piece).length < 1) plan.push({ piece });
              else {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            polys[i] = simplify(kept);
            delete raw[i]!.type;
            if (band) {
              circulation.push({ kind: 'corridor', polygon: band, area: polygonArea(band) });
              accessEdges = polygonEdges(access());
            }
            for (const [j, m] of grown) {
              polys[j] = simplify(m);
              delete raw[j]!.type;
            }
            for (const x of plan)
              if (x.to === undefined)
                open.push({ kind: 'open', polygon: x.piece, area: polygonArea(x.piece) });
            return true;
          }
          return false;
        };
        if (apply(false)) continue;
        // still too large: share the pair (this unit + a neighbour) out again with one straight
        // party wall, so that both parts are in range of a type their façade allows
        let bestSplit: { j: number; a: Polygon; b: Polygon; score: number } | undefined;
        for (const j of live()) {
          if (j === i || shared(polys[j]!, p) < 2.4) continue;
          const m = single(union([p, polys[j]!]));
          if (!m) continue;
          for (const [a, b] of slabSplits(m)) {
            const inRange = (q: Polygon) => {
              const ar = polygonArea(q);
              return (
                door(q) >= DOOR &&
                !dark(q) &&
                allowedFor(q).some((t) => ar >= t.areaMin - 1e-6 && ar <= t.areaMax + 1e-6)
              );
            };
            if (!single([a]) || !single([b]) || !inRange(a) || !inRange(b)) continue;
            // keep close to the current split (least change)
            const score = Math.abs(polygonArea(a) - area);
            if (!bestSplit || score < bestSplit.score) bestSplit = { j, a, b, score };
          }
        }
        if (bestSplit) {
          polys[i] = simplify(bestSplit.a);
          polys[bestSplit.j] = simplify(bestSplit.b);
          delete raw[i]!.type;
          delete raw[bestSplit.j]!.type;
        } else apply(true); // last resort: the surplus stays unused, even on the façade
      }

      // 2b. tube-like dwellings left: their narrow arms go to a neighbour (compact, in range),
      // else to the landing they touch, else stay unused; a dwelling that is all arm is merged
      // into a neighbour or given up
      for (const i of live()) {
        const p = polys[i]!;
        if (!tubeLike(p)) continue;
        const body = offsetPolygons(offsetPolygons([p], -1.4), 1.4);
        const kept = single(intersection([p], body));
        const pieces = kept ? difference([p], [kept]).filter((q) => polygonArea(q) > 0.05) : [p];
        const give = (piece: Polygon, others: number[]) => {
          const take = others
            .filter((j) => shared(polys[j]!, piece) > 1.2)
            .map((j) => ({ j, m: single(union([polys[j]!, piece])) }))
            .filter(
              (c): c is { j: number; m: Polygon } =>
                !!c.m && polygonArea(c.m) <= maxArea(c.m) + 1e-6 && !dark(c.m),
            )
            .sort((x, y) => polygonArea(y.m) - polygonArea(x.m))[0];
          if (take) {
            polys[take.j] = simplify(take.m);
            delete raw[take.j]!.type;
          } else if (circulation.some((c) => c.kind !== 'lift' && shared(c.polygon, piece) > 1.2))
            circulation.push({ kind: 'landing', polygon: piece, area: polygonArea(piece) });
          else open.push({ kind: 'open', polygon: piece, area: polygonArea(piece) });
        };
        const others = live().filter((j) => j !== i);
        if (
          kept &&
          door(kept) >= DOOR &&
          allowedFor(kept).some((t) => polygonArea(kept) >= t.areaMin - 1e-6)
        ) {
          polys[i] = simplify(kept);
          delete raw[i]!.type;
          for (const piece of pieces) give(piece, others);
        } else {
          alive[i] = false;
          give(p, others);
        }
        accessEdges = polygonEdges(access());
      }

      // 3. a dark leftover big enough for the stair (inner corner of an L, Soheyl 23.11.2026):
      // the nearest stair and its lift move there, their old place goes to the dwellings
      const sw = dim.stairCoreWidth;
      const cd = dim.coreDepth;
      for (const o of [...open]) {
        if (o.kind !== 'open' || o.area < sw * cd) continue;
        const hall = circulation.filter(
          (c) => c.kind !== 'lift' && shared(o.polygon, c.polygon) >= 2,
        );
        if (!hall.length) continue;
        const hallEdges = polygonEdges(hall.map((c) => c.polygon));
        const ci = cores
          .map((c, k) => ({ k, d: polygonDistance(c.polygon, o.polygon) }))
          .filter(({ k }) => hall.some((h) => shared(cores[k]!.polygon, h.polygon) >= 1))
          .sort((x, y) => x.d - y.d)[0]?.k;
        if (ci === undefined) continue;
        const placed = placeInPiece(o.polygon, [sw, cd], hallEdges);
        if (!placed) continue;
        const old = cores[ci]!;
        const oldLift = circulation.find(
          (c) => c.kind === 'lift' && polygonDistance(c.polygon, old.polygon) < 4,
        );
        let rest = difference([o.polygon], [placed.polygon]);
        let lift: Polygon | undefined;
        if (oldLift) {
          const [lw, lt] = dim.liftBox;
          const lp = rest
            .map((r) => placeInPiece(r, [lw, lt], hallEdges))
            .find((x): x is NonNullable<typeof x> => !!x);
          if (lp) {
            lift = lp.polygon;
            rest = difference(rest, [lift]);
          }
        }
        cores[ci] = {
          kind: 'core',
          polygon: placed.polygon,
          area: polygonArea(placed.polygon),
          index: old.index ?? ci,
          box: placed.box,
        };
        open.splice(open.indexOf(o), 1);
        for (const r of rest.filter((q) => polygonArea(q) > 0.05))
          circulation.push({ kind: 'landing', polygon: r, area: polygonArea(r) });
        const freed = [old.polygon];
        if (lift && oldLift) {
          circulation.splice(circulation.indexOf(oldLift), 1);
          circulation.push({ kind: 'lift', polygon: lift, area: polygonArea(lift) });
          freed.push(oldLift.polygon);
        }
        // the old stair (and lift) to the neighbouring dwelling, else to the landing
        for (const f of freed) {
          const take = live()
            .filter((j) => shared(polys[j]!, f) > 2)
            .map((j) => ({ j, m: single(union([polys[j]!, f])) }))
            .filter(
              (c): c is { j: number; m: Polygon } =>
                !!c.m && polygonArea(c.m) <= maxArea(c.m) + 1e-6 && !dark(c.m),
            )
            .sort((x, y) => polygonArea(y.m) - polygonArea(x.m))[0];
          if (take) {
            polys[take.j] = simplify(take.m);
            delete raw[take.j]!.type;
          } else circulation.push({ kind: 'landing', polygon: f, area: polygonArea(f) });
        }
        accessEdges = polygonEdges(access());
      }
    }
    const accessNow = [...cores, ...circulation].map((c) => c.polygon);
    const accessNowEdges = polygonEdges(accessNow);
    const libraryUsed: string[] = [];
    /** Rooms from the office plan library, when a plan fits the dwelling. */
    const libraryMatch = (polygon: Polygon, segs: [Vec2, Vec2][], type: UnitType) => {
      if (rules.planLibrary === false || pass.duplex || type.duplex) return undefined;
      const m = matchTemplate(polygon, segs, accessNowEdges, unitRooms(type), rules, {
        stretch: rules.libraryStretch,
        depthTolerance: rules.libraryDepthTolerance,
        used: libraryUsed.slice(-2),
        preferSejour: (seg) => {
          const outer = onLine(seg, outlineSegs);
          if (!outer) return 0;
          return sideConfig(outdoorCfg, facadeSide(seg, polygon)).kind === 'none' ? 1 : 2;
        },
      });
      if (!m) return undefined;
      libraryUsed.push(m.template.id);
      return { rooms: m.rooms, template: m.template };
    };
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
      // office plan library first: the type whose library plan fits the dwelling
      let lm = choice.type.duplex ? undefined : libraryMatch(polygon, facade.segments, choice.type);
      if (!lm && rules.planLibrary !== false && !pass.duplex && !choice.type.duplex) {
        const alt = (allowed.length ? allowed : mix)
          .filter(
            (t) =>
              t !== choice.type &&
              !t.duplex &&
              area >= t.areaMin * 0.9 - 1e-6 &&
              area <= t.areaMax * 1.1 + 1e-6,
          )
          .sort((a, b) => Math.abs(a.areaTarget - area) - Math.abs(b.areaTarget - area));
        for (const t of alt) {
          lm = libraryMatch(polygon, facade.segments, t);
          if (lm) {
            choice = { type: t, outOfRange: area < t.areaMin - 1e-6 || area > t.areaMax + 1e-6 };
            break;
          }
        }
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
        ...(lm ?? {
          rooms: unitRoomLayout(polygon, facade.segments, roomsOf(choice.type), rules, {
            preferSejour: (seg) => {
              // séjour preferably on the outer façade, where the outdoor space can go
              const outer = onLine(seg, outlineSegs);
              if (!outer) return 0;
              return sideConfig(outdoorCfg, facadeSide(seg, polygon)).kind === 'none' ? 1 : 2;
            },
            exterior: outlineSegs,
            access: accessNow,
            ...(pass.below ? { below: pass.below } : {}),
            neighbours: units.flatMap((x) => x.rooms),
            wet: wetOf(choice.type),
            mainRooms: unitRooms(choice.type),
          }),
        }),
        ...orientationCheck(facade.segments, polygon, unitRooms(choice.type)),
        facadeRatioOk: facade.length >= rules.facadeAreaRatio * area - 1e-6,
        accessOk:
          effAccess === 'reihenhaus' ||
          !!pass.duplex ||
          facadeOf(polygon, accessNowEdges).length >= 0.9 - 1e-6,
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
    libraryUnits: units.filter((u) => !!u.template && countsHere(u)).length,
  };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const signature = [
    usage,
    ...footprints.map((p) => p.outer.map(([x, y]) => `${r1(x)},${r1(y)}`).join(';')),
    ...units.map((u) => `${u.typeId}${u.duplex ? `/${u.duplex.level}` : ''}:${r1(u.area)}`),
    ...(blind.length ? [`b${r1(blind.reduce((x, [a, b]) => x + dist(a, b), 0))}`] : []),
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
  if (blind.length) out.blindFacades = blind;
  return { layout: out, pins };
}

/** Point on segment [a, b] at parameter t. */
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/**
 * A corridor of `width` inside `host` from the access areas `from` to the polygon `to`: one
 * straight run or an L along the main direction of `host`, perpendicular to both walls it
 * opens onto. `touchOnly`: `to` lies inside `host` (the corridor only has to reach it).
 * Smallest such band, or undefined.
 */
function corridorIn(
  host: Polygon,
  from: readonly Polygon[],
  to: Polygon,
  width: number,
  touchOnly = false,
): Polygon | undefined {
  const sa = facadeOf(host, polygonEdges(from)).segments;
  const su = touchOnly
    ? polygonEdges([to]).filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= width - 0.1)
    : facadeOf(host, polygonEdges([to])).segments;
  if (!sa.length || !su.length) return undefined;
  const u = dirOf([host]);
  const n: Vec2 = [-u[1], u[0]];
  const pts = (s: [Vec2, Vec2]): Vec2[] => {
    const len = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
    if (len < width - 0.1) return [];
    const e = Math.min(0.5, width / 2 / len);
    return [lerp(s[0], s[1], e), lerp(s[0], s[1], 0.5), lerp(s[0], s[1], 1 - e)];
  };
  const along = (s: [Vec2, Vec2], d: Vec2) => {
    const l = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) || 1;
    return Math.abs(((s[1][0] - s[0][0]) * d[0] + (s[1][1] - s[0][1]) * d[1]) / l);
  };
  const dot = (v: Vec2, d: Vec2) => v[0] * d[0] + v[1] * d[1];
  /** Sample point pairs: the sample points, plus each point projected straight across. */
  const proj = (p: Vec2, s: [Vec2, Vec2]): Vec2 | undefined => {
    const dx = s[1][0] - s[0][0];
    const dy = s[1][1] - s[0][1];
    const l2 = dx * dx + dy * dy || 1;
    const t = ((p[0] - s[0][0]) * dx + (p[1] - s[0][1]) * dy) / l2;
    const e = width / 2 / Math.sqrt(l2);
    return t >= e - 1e-9 && t <= 1 - e + 1e-9 ? lerp(s[0], s[1], t) : undefined;
  };
  const pairs = (a: [Vec2, Vec2], b: [Vec2, Vec2]): [Vec2, Vec2][] => {
    const out: [Vec2, Vec2][] = [];
    for (const pa of pts(a)) {
      for (const pb of pts(b)) out.push([pa, pb]);
      const q = proj(pa, b);
      if (q) out.push([pa, q]);
    }
    for (const pb of pts(b)) {
      const q = proj(pb, a);
      if (q) out.push([q, pb]);
    }
    return out;
  };
  const fromEdges = polygonEdges(from);
  const toEdges = polygonEdges([to]);
  let best: Polygon | undefined;
  for (const a of sa)
    for (const b of su)
      for (const [pa, pb] of pairs(a, b)) {
        const v: Vec2 = [pb[0] - pa[0], pb[1] - pa[1]];
        const paths: Vec2[][] = [];
        for (const [d1, d2] of [
          [u, n],
          [n, u],
        ] as const) {
          const c: Vec2 = [pa[0] + d1[0] * dot(v, d1), pa[1] + d1[1] * dot(v, d1)];
          const l1 = Math.abs(dot(v, d1));
          const l2 = Math.abs(dot(v, d2));
          if (l2 < 0.05) {
            // straight run: must leave both walls at a right angle
            if (along(a, d1) < 0.2 && along(b, d1) < 0.2) paths.push([pa, pb]);
          } else if (l1 < 0.05) {
            if (along(a, d2) < 0.2 && along(b, d2) < 0.2) paths.push([pa, pb]);
          } else if (along(a, d1) < 0.2 && along(b, d2) < 0.2) paths.push([pa, c, pb]);
        }
        for (const path of paths) {
          // run the band a little past both ends so it opens onto the walls
          const ext = (p: Vec2, q: Vec2): Vec2 => {
            const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
            return [p[0] + ((p[0] - q[0]) / l) * 0.3, p[1] + ((p[1] - q[1]) / l) * 0.3];
          };
          const line = [
            ext(path[0]!, path[1]!),
            ...path.slice(1, -1),
            ext(path.at(-1)!, path.at(-2)!),
          ];
          let band = intersection([host], offsetPolyline(line, false, width, 'center', 2));
          if (touchOnly) band = difference(band, [to]);
          band = band.filter((q) => polygonArea(q) > 0.05);
          if (band.length !== 1) continue;
          const q = band[0]!;
          if (facadeOf(q, fromEdges).length < 0.9 || facadeOf(q, toEdges).length < 0.9) continue;
          if (!best || polygonArea(q) < polygonArea(best)) best = q;
        }
      }
  return best;
}

/**
 * The part of `p` within depth d of its façade pieces, with d chosen so that the result (after
 * `fix`, which may add the way to the door or reject) has about `target` m². Undefined when no
 * depth works.
 */
/**
 * True when `p` has an arm narrower than 2.80 m (the smallest bedroom façade) that is a room of
 * its own: at least 6 m² and 4.50 m long. Such tube-like dwellings are excluded (Soheyl
 * 23.11.2026); an entrance strip of 1.20 m by 3 m is not an arm.
 */
export function tubeLike(p: Polygon): boolean {
  const r = 1.4;
  const body = offsetPolygons(offsetPolygons([p], -r), r);
  return difference([p], body).some((q) => {
    const a = polygonArea(q);
    return a >= 6 && obbLength(q) >= 4.5;
  });
}

/** Long side of the smallest rectangle (aligned to one of its edges) around `p`. */
function obbLength(p: Polygon): number {
  const r = p.outer;
  let best: { a: number; l: number } | undefined;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.3) continue;
    const u: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const ts = r.map((q) => q[0] * u[0] + q[1] * u[1]);
    const ns = r.map((q) => q[1] * u[0] - q[0] * u[1]);
    const w = Math.max(...ts) - Math.min(...ts);
    const d = Math.max(...ns) - Math.min(...ns);
    if (!best || w * d < best.a) best = { a: w * d, l: Math.max(w, d) };
  }
  return best?.l ?? 0;
}

function trimToArea(
  p: Polygon,
  facade: readonly [Vec2, Vec2][],
  target: number,
  fix: (q: Polygon) => Polygon | undefined,
): Polygon[] {
  if (!facade.length) return [];
  const out: Polygon[] = [];
  const bands = (d: number) => facadeBands(p, facade, d);
  const at = (d: number) => {
    const k = intersection([p], union(bands(d))).filter((q) => polygonArea(q) > 0.05);
    if (k.length !== 1) return undefined;
    return fix(k[0]!);
  };
  let lo = 2;
  let hi = 30;
  let best: Polygon | undefined;
  for (let it = 0; it < 14; it++) {
    const d = (lo + hi) / 2;
    const k = at(d);
    if (k && polygonArea(k) <= target + 1e-6) {
      best = k;
      lo = d;
    } else hi = d;
  }
  if (best && polygonArea(best) >= target * 0.8) out.push(best);
  // façade on several sides (traversant): cut a slab off one end instead, keeping most façade
  const u = dirOf([p]);
  const slabs: { q: Polygon; f: number }[] = [];
  for (const d of [u, [-u[1], u[0]] as Vec2])
    for (const sg of [1, -1]) {
      const dd: Vec2 = [d[0] * sg, d[1] * sg];
      const n: Vec2 = [-dd[1], dd[0]];
      const ts = p.outer.map((q) => q[0] * dd[0] + q[1] * dd[1]);
      const ns = p.outer.map((q) => q[0] * n[0] + q[1] * n[1]);
      const t0 = Math.min(...ts);
      const t1 = Math.max(...ts);
      const n0 = Math.min(...ns) - 1;
      const n1 = Math.max(...ns) + 1;
      const half = (t: number) =>
        normalizePolygon({
          outer: [
            [dd[0] * t0 + n[0] * n0 - dd[0], dd[1] * t0 + n[1] * n0 - dd[1]],
            [dd[0] * t + n[0] * n0, dd[1] * t + n[1] * n0],
            [dd[0] * t + n[0] * n1, dd[1] * t + n[1] * n1],
            [dd[0] * t0 + n[0] * n1 - dd[0], dd[1] * t0 + n[1] * n1 - dd[1]],
          ],
        });
      // from the full piece down, 0.25 m steps: the first cut that fits (not monotonic: the
      // door may be cut off on the way)
      let got: Polygon | undefined;
      for (let t = t1 - 0.25; t > t0 + 2; t -= 0.25) {
        const k = intersection([p], [half(t)]).filter((q) => polygonArea(q) > 0.05);
        if (k.length !== 1 || polygonArea(k[0]!) > target + 1e-6) continue;
        got = fix(k[0]!);
        if (got && polygonArea(got) <= target + 1e-6) break;
        got = undefined;
        if (polygonArea(k[0]!) < target * 0.8) break;
      }
      if (got && polygonArea(got) >= target * 0.8)
        slabs.push({ q: got, f: facadeOf(got, facade).length });
    }
  slabs.sort((a, b) => b.f - a.f);
  out.push(...slabs.map((x) => x.q));
  return out;
}

/** Straight cuts of `p` across its main directions (every 0.25 m): [one side, other side]. */
function slabSplits(p: Polygon): [Polygon, Polygon][] {
  const out: [Polygon, Polygon][] = [];
  const u = dirOf([p]);
  for (const d of [u, [-u[1], u[0]] as Vec2]) {
    const n: Vec2 = [-d[1], d[0]];
    const ts = p.outer.map((q) => q[0] * d[0] + q[1] * d[1]);
    const ns = p.outer.map((q) => q[0] * n[0] + q[1] * n[1]);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    const n0 = Math.min(...ns) - 1;
    const n1 = Math.max(...ns) + 1;
    const pt = (t: number, m: number): Vec2 => [d[0] * t + n[0] * m, d[1] * t + n[1] * m];
    for (let t = t0 + 2.5; t <= t1 - 2.5; t += 0.25) {
      const lo = normalizePolygon({
        outer: [pt(t0 - 1, n0), pt(t, n0), pt(t, n1), pt(t0 - 1, n1)],
      });
      const a = intersection([p], [lo]).filter((q) => polygonArea(q) > 0.05);
      const b = difference([p], [lo]).filter((q) => polygonArea(q) > 0.05);
      if (a.length === 1 && b.length === 1) out.push([a[0]!, b[0]!]);
    }
  }
  return out;
}

/** Rectangles reaching `d` m into `p` from each of its façade pieces (perpendicular). */
function facadeBands(p: Polygon, facade: readonly [Vec2, Vec2][], d: number): Polygon[] {
  return facade.map(([a, b]) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let n: Vec2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    const m: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.05, (a[1] + b[1]) / 2 + n[1] * 0.05];
    if (!pointInPolygon(m, p)) n = [-n[0], -n[1]];
    return normalizePolygon({
      outer: [a, b, [b[0] + n[0] * d, b[1] + n[1] * d], [a[0] + n[0] * d, a[1] + n[1] * d]],
    });
  });
}

/** Area of `p` not in front of any of its façade pieces (within `d` m): the dark part. */
function darkArea(p: Polygon, facade: readonly [Vec2, Vec2][], d = 12): number {
  if (!facade.length) return polygonArea(p);
  const lit = intersection([p], union(facadeBands(p, facade, d)));
  return polygonArea(p) - lit.reduce((s, q) => s + polygonArea(q), 0);
}

/**
 * A rectangle of `size` (either way round) inside `piece`, in one of its corners along its main
 * directions, with one side on `onto` (≥ 1.2 m): polygon and oriented box. Undefined if none.
 */
function placeInPiece(
  piece: Polygon,
  size: [number, number],
  onto: readonly [Vec2, Vec2][],
): { polygon: Polygon; box: CoreBox } | undefined {
  const u = dirOf([piece]);
  const f0: Frame = { o: [0, 0], u, n: [-u[1], u[0]] };
  const [a0, b0, a1, b1] = frameExtents(f0, [piece]);
  let best: { polygon: Polygon; box: CoreBox; s: number } | undefined;
  for (const [w, d] of [size, [size[1], size[0]] as [number, number]])
    for (const a of [a0, a1 - w])
      for (const b of [b0, b1 - d]) {
        const r: Rect = [a, b, a + w, b + d];
        const poly = rectPoly(f0, r);
        const inside = intersection([piece], [poly]).reduce((x, q) => x + polygonArea(q), 0);
        if (inside < w * d - 0.05) continue;
        const door = facadeOf(poly, onto).length;
        if (door < 1.2) continue;
        if (!best || door > best.s)
          best = {
            polygon: poly,
            box: { o: toWorld(f0, a, b), u: f0.u, n: f0.n, w, d },
            s: door,
          };
      }
  return best && { polygon: best.polygon, box: best.box };
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
export function simplify(p: Polygon, tol = 0.02, despike = true): Polygon {
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
  party?: LayoutPass['party'],
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
    const pass = (level: 'jour' | 'nuit'): LayoutPass => ({
      ...(p ? { pins: p } : {}),
      ...(party ? { party } : {}),
      duplex: level,
    });
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
    if (st.units.length || !st.cores.length || st.spaces?.length) return st;
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

/**
 * Storeys of the uses with their own generator (residence, office), by storey index. The
 * residence ground floor gets its common rooms sized by the units of the whole building.
 */
function specialUseLayouts(
  mass: Mass,
  byStorey: Map<number, StoreySolid[]>,
  settings: Settings,
  party?: LayoutPass['party'],
): Map<number, StoreyLayout> {
  const out = new Map<number, StoreyLayout>();
  const res: number[] = [];
  for (const [i, solids] of byStorey) {
    const usage = solids[0]!.usage;
    if (usage === 'buero') out.set(i, officeStoreyLayout(mass, solids, settings));
    else if (usage === 'wohnheim') res.push(i);
  }
  if (!res.length) return out;
  res.sort((a, b) => a - b);
  const lowest = res[0]!;
  let units = 0;
  for (const i of res) {
    const st = residenceStoreyLayout(mass, byStorey.get(i)!, settings, party ? { party } : {});
    out.set(i, st);
    units += st.summary.units;
  }
  // common rooms on the lowest residence storey (ground floor), for all units
  const ground = residenceStoreyLayout(mass, byStorey.get(lowest)!, settings, {
    totalUnits: units,
    ...(party ? { party } : {}),
  });
  out.set(lowest, ground);
  return out;
}

/** Layouts of all above-ground storeys of one mass (from its storey solids). */
export function massLayout(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  areaBasedDwellings?: number,
  site?: SiteEdges,
): MassLayout {
  const access = resolveAccess(mass, settings);
  const party = partyOf(mass, solids, settings, site);
  const byStorey = new Map<number, StoreySolid[]>();
  for (const s of solids) {
    if (!s.aboveGround || s.massId !== mass.id) continue;
    const list = byStorey.get(s.storeyIndex) ?? [];
    list.push(s);
    byStorey.set(s.storeyIndex, list);
  }
  const pins = new Map<number, number[][]>();
  const special = specialUseLayouts(mass, byStorey, settings, party);
  // séjours stack: each storey sees the séjours of the storey below
  let below: Polygon[] | undefined;
  const simplex = [...byStorey.keys()]
    .sort((a, b) => a - b)
    .map((i) => {
      const own = special.get(i);
      if (own) return own;
      const r = layoutStorey(mass, byStorey.get(i)!, settings, access, {
        ...(below ? { below } : {}),
        ...(party ? { party } : {}),
      });
      pins.set(i, r.pins);
      const sej = r.layout.units.flatMap((u) =>
        u.rooms.filter((x) => x.kind === 'sejour').map((x) => x.polygon),
      );
      below = sej.length ? sej : below;
      return r.layout;
    });
  const storeys = stackCores(applyDuplex(mass, byStorey, settings, access, simplex, pins, party));
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
  const expected = massUnitsPerCoreRange(mass, access, coreRange(settings));
  if (expected) out.expectedUnitsPerCore = expected;
  return out;
}

/**
 * Layouts of all masses of a variant: pass a project (active variant) or an existing
 * VariantResult with the settings.
 */
export function massLayouts(
  input: Project | VariantResult,
  settings?: Settings,
  site?: SiteEdges,
): MassLayout[] {
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
    if (hit && hit.settings === s && sameEdges(hit.site, site)) return hit.layout;
    const layout = massLayout(
      m.mass,
      m.solids.map((r) => r.solid),
      s,
      m.dwellings.total,
      site,
    );
    if (memo) layoutMemo.set(m, { settings: s, layout, ...(site ? { site } : {}) });
    return layout;
  });
}

const layoutMemo = new WeakMap<
  MassResult,
  { settings: Settings; layout: MassLayout; site?: SiteEdges }
>();

function sameEdges(a?: SiteEdges, b?: SiteEdges): boolean {
  if (a === b) return true;
  if (!a || !b || a.party.length !== b.party.length) return false;
  return a.party.every(
    ([p, q], i) => dist(p, b.party[i]![0]) < 1e-9 && dist(q, b.party[i]![1]) < 1e-9,
  );
}

/** Area-based dwelling count for a living area (re-exported for the UI comparison note). */
export const areaBasedUnitCount = (livingArea: number, settings: Settings): number =>
  unitMix(livingArea, settings.unitMix).total;
