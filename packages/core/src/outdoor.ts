/**
 * Outdoor spaces of dwellings (espaces extérieurs / Außenbereiche): balcons, loggias and
 * ground-floor terrasses. One per dwelling, preferably in front of the séjour, otherwise next to
 * it on an adjoining façade. Configurable per building for all façades or per orientation.
 * Pure and deterministic; world coordinates.
 */
import {
  difference,
  intersection,
  normalizePolygon,
  pointInPolygon,
  polygonArea,
  union,
} from './geometry.js';
import type {
  FacadeSide,
  Mass,
  OutdoorConfig,
  OutdoorRules,
  OutdoorSideConfig,
  Polygon,
  Settings,
  Vec2,
} from './types.js';

export const DEFAULT_OUTDOOR_RULES: OutdoorRules = {
  minArea: 4,
  loggiaMinDepth: 1.8,
  balconMinDepth: 1.4,
  terraceDepth: 3,
};

export const DEFAULT_OUTDOOR: OutdoorConfig = { kind: 'balcon', depth: 1.6, groundTerrace: true };

export const FACADE_SIDES: readonly FacadeSide[] = ['N', 'E', 'S', 'W'];

export type OutdoorType = 'balcon' | 'loggia' | 'terrasse';

export interface LayoutOutdoor {
  kind: OutdoorType;
  polygon: Polygon;
  area: number;
  depth: number;
  /** Length along the façade, m. */
  width: number;
  side: FacadeSide;
  /** In front of the séjour, next to it, or elsewhere on the dwelling's façade. */
  position: 'front' | 'side' | 'remote';
  /** Meets minimum area and depth and touches the séjour. */
  ok: boolean;
  /**
   * Loggias only: the shape to cut out of the building volume. The loggia extended a little
   * beyond the façade, so that the cut opens the façade despite rounding of the outlines.
   */
  cut?: Polygon;
}

export function resolveOutdoorRules(settings: Pick<Settings, 'outdoorRules'>): OutdoorRules {
  return { ...DEFAULT_OUTDOOR_RULES, ...(settings.outdoorRules ?? {}) };
}

/** Configuration of a building: its own, else the project default, else balconies everywhere. */
export function resolveOutdoor(
  mass: Pick<Mass, 'outdoor'>,
  settings: Pick<Settings, 'outdoor'>,
): OutdoorConfig {
  return { ...DEFAULT_OUTDOOR, ...(settings.outdoor ?? {}), ...(mass.outdoor ?? {}) };
}

/** Configuration of one façade orientation. */
export function sideConfig(cfg: OutdoorConfig, side: FacadeSide): OutdoorSideConfig {
  return cfg.sides?.[side] ?? { kind: cfg.kind, depth: cfg.depth };
}

/** Minimum depth of an outdoor space type, m. */
export function outdoorMinDepth(kind: OutdoorType, rules: OutdoorRules): number {
  return kind === 'loggia' ? rules.loggiaMinDepth : rules.balconMinDepth;
}

type Seg = [Vec2, Vec2];

/** How far a loggia's volume cut reaches beyond / inside its façade line, m. */
const CUT_OUT = 0.3;
const CUT_IN = 0.05;

/** Orientation of a façade piece of `inside` (outward normal: N / E / S / W). */
export function facadeSide([a, b]: Seg, inside: Polygon): FacadeSide {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = (b[1] - a[1]) / len;
  let ny = -(b[0] - a[0]) / len;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (pointInPolygon([mid[0] + nx * 0.05, mid[1] + ny * 0.05], inside)) {
    nx = -nx;
    ny = -ny;
  }
  if (Math.abs(ny) >= Math.abs(nx)) return ny > 0 ? 'N' : 'S';
  return nx > 0 ? 'E' : 'W';
}

interface Cand {
  o: Vec2;
  u: Vec2;
  /** Inward normal (into the dwelling). */
  n: Vec2;
  len: number;
  side: FacadeSide;
  kind: OutdoorType;
  depth: number;
}

const at = (c: Cand, s: number, t: number): Vec2 => [
  c.o[0] + c.u[0] * s + c.n[0] * t,
  c.o[1] + c.u[1] * s + c.n[1] * t,
];
const box = (c: Cand, s0: number, s1: number, t0: number, t1: number): Polygon =>
  normalizePolygon({ outer: [at(c, s0, t0), at(c, s1, t0), at(c, s1, t1), at(c, s0, t1)] });

/**
 * Outdoor space of one dwelling.
 * `exterior`: the dwelling's façade pieces on the building outline (not the gallery);
 * `sejour`: its living room; `taken`: outdoor spaces already placed on this storey.
 */
export function placeOutdoor(
  unit: Polygon,
  sejour: Polygon | undefined,
  exterior: readonly Seg[],
  cfg: OutdoorConfig,
  rules: OutdoorRules,
  ground: boolean,
  taken: readonly Polygon[] = [],
): LayoutOutdoor | undefined {
  const cands: Cand[] = [];
  for (const [a, b] of exterior) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1) continue;
    const side = facadeSide([a, b], unit);
    const sc = sideConfig(cfg, side);
    if (sc.kind === 'none') continue;
    const kind: OutdoorType = ground && cfg.groundTerrace ? 'terrasse' : sc.kind;
    const depth =
      kind === 'terrasse'
        ? Math.max(rules.terraceDepth, rules.balconMinDepth)
        : Math.max(sc.depth, outdoorMinDepth(kind, rules));
    const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n: Vec2 = [-u[1], u[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (!pointInPolygon([mid[0] + n[0] * 0.05, mid[1] + n[1] * 0.05], unit)) n = [-n[0], -n[1]];
    cands.push({ o: a, u, n, len, side, kind, depth });
  }
  if (!cands.length) return undefined;

  type Option = {
    c: Cand;
    s0: number;
    s1: number;
    position: LayoutOutdoor['position'];
    score: number;
  };
  const options: Option[] = [];
  const sv = sejour ? [sejour.outer, ...(sejour.holes ?? [])].flat() : [];
  for (const c of cands) {
    const wmin = rules.minArea / c.depth;
    const w0 = Math.min(c.len, wmin);
    // séjour on this façade piece: its extent along the piece
    let f0 = Infinity;
    let f1 = -Infinity;
    let near = Infinity;
    let nearS = 0;
    for (const p of sv) {
      const s = (p[0] - c.o[0]) * c.u[0] + (p[1] - c.o[1]) * c.u[1];
      const t = (p[0] - c.o[0]) * c.n[0] + (p[1] - c.o[1]) * c.n[1];
      if (Math.abs(t) < 0.05 && s > -0.05 && s < c.len + 0.05) {
        f0 = Math.min(f0, Math.max(0, s));
        f1 = Math.max(f1, Math.min(c.len, s));
      }
      // distance of the séjour to the piece (for a lateral attachment)
      const sc = Math.min(Math.max(s, 0), c.len);
      const d = Math.hypot(s - sc, t);
      if (d < near) {
        near = d;
        nearS = sc;
      }
    }
    if (f1 - f0 > 0.5) {
      // in front of the séjour: its width (at least the minimum), centred on it
      const w = Math.min(c.len, Math.max(f1 - f0, w0));
      const mid = (f0 + f1) / 2;
      const s0 = Math.min(Math.max(mid - w / 2, 0), c.len - w);
      options.push({ c, s0, s1: s0 + w, position: 'front', score: 100 + (f1 - f0) });
    } else if (sv.length) {
      // next to the séjour: at the end of the piece closest to it
      const w = Math.min(c.len, Math.max(w0, 2.5));
      const s0 = nearS > c.len / 2 ? c.len - w : 0;
      options.push({
        c,
        s0,
        s1: s0 + w,
        position: near < 0.6 ? 'side' : 'remote',
        score: (near < 0.6 ? 50 : 0) - near,
      });
    } else options.push({ c, s0: 0, s1: w0, position: 'remote', score: -100 });
  }
  options.sort((x, y) => y.score - x.score);

  for (const o of options) {
    const { c } = o;
    const raw =
      c.kind === 'loggia'
        ? intersection([unit], [box(c, o.s0, o.s1, 0, c.depth)])
        : [box(c, o.s0, o.s1, -c.depth, 0)];
    const pieces = (taken.length ? difference(raw, taken) : raw).filter(
      (p) => polygonArea(p) > 0.5,
    );
    if (!pieces.length) continue;
    const polygon = pieces.reduce((x, y) => (polygonArea(y) > polygonArea(x) ? y : x));
    const area = polygonArea(polygon);
    const width = area / c.depth;
    const minDepth = c.kind === 'loggia' ? rules.loggiaMinDepth : rules.balconMinDepth;
    let cut: Polygon | undefined;
    if (c.kind === 'loggia') {
      // extent of the loggia along the façade, then a strip from outside to just inside it
      let s0 = Infinity;
      let s1 = -Infinity;
      for (const p of polygon.outer) {
        const t = (p[0] - c.o[0]) * c.n[0] + (p[1] - c.o[1]) * c.n[1];
        if (t > 0.05) continue;
        const s = (p[0] - c.o[0]) * c.u[0] + (p[1] - c.o[1]) * c.u[1];
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
      }
      cut =
        s1 - s0 > 0.05
          ? union([polygon, box(c, s0, s1, -CUT_OUT, CUT_IN)]).reduce((x, y) =>
              polygonArea(y) > polygonArea(x) ? y : x,
            )
          : polygon;
    }
    return {
      kind: c.kind,
      polygon,
      area,
      depth: c.depth,
      width,
      side: c.side,
      position: o.position,
      ok: area >= rules.minArea - 0.05 && c.depth >= minDepth - 1e-6 && o.position !== 'remote',
      ...(cut ? { cut } : {}),
    };
  }
  return undefined;
}
