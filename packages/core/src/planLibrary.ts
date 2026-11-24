/**
 * Plan library (bibliothèque de plans de l'agence): dwellings are taken from the office's
 * reference plans first, the parametric room layout is the fallback (Soheyl, 24.11.2026).
 *
 * A template is a dwelling outline with its séjour, kitchen and bedrooms, normalised so that its
 * main façade lies on y = 0 and x runs along that façade. A dwelling of the floor plan takes a
 * template when
 * - the dwelling is (nearly) a rectangle,
 * - the template has the same number of main rooms (T3 = séjour + 2 chambres),
 * - every façade of the template lands on a façade of the dwelling (rotations and mirror images
 *   allowed),
 * - the template stretches by at most ±10 % along its main façade and ±0.50 m in depth.
 * Only the séjour, the kitchen and the bedrooms come from the template; the rest of the dwelling
 * (entrée, bathrooms, WC) stays one zone without further detail.
 */
import { intersection, polygonArea } from './geometry.js';
import type { LayoutRoom } from './rooms.js';
import { facadeOf, resolveUnitRules } from './unitRules.js';
import { PLAN_TEMPLATES } from './planLibraryData.js';
import type { Polygon, UnitRules, Vec2 } from './types.js';

export type TemplateSide = 'front' | 'right' | 'back' | 'left';
export type TemplateRoomKind = 'sejour' | 'cuisine' | 'chambrePmr' | 'chambre';

export interface PlanTemplate {
  id: string;
  /** T1 … T5. */
  type: string;
  /** Mono, Traversant, Angle, Triple orienté, … (as named in the library). */
  category: string;
  /** Main rooms: séjour + bedrooms. */
  rooms: number;
  /** Extent along the main façade (x) and across (y), m. */
  width: number;
  depth: number;
  /** Sides of the bounding box with windows ('front' = main façade, y = 0). */
  facades: TemplateSide[];
  /** Side of the entrance door, when known. */
  access: TemplateSide | null;
  door: [number, number] | null;
  outline: [number, number][];
  spaces: { kind: TemplateRoomKind; polygon: [number, number][] }[];
}

export interface UnitTemplate {
  id: string;
  type: string;
  category: string;
  /** Stretch along the main façade of the template (1 = as drawn). */
  stretch: number;
  /** Depth change of the template, m. */
  depthDelta: number;
}

export interface TemplateMatch {
  template: UnitTemplate;
  rooms: LayoutRoom[];
}

export interface LibraryOptions {
  /** Allowed stretch along the main façade (0.10 = ±10 %). */
  stretch?: number;
  /** Allowed depth change, m. */
  depthTolerance?: number;
  /** Templates not to use. */
  exclude?: readonly string[];
  /** Templates used by the neighbours (variety: a small penalty for repeating one). */
  used?: readonly string[];
  /** Preference of a façade piece for the séjour (higher first), e.g. where the balcony goes. */
  preferSejour?: (seg: Seg) => number;
}

type Seg = [Vec2, Vec2];
/** Gap between a room and the dwelling outline closed when mapping (exterior wall), m. */
const WALL_SNAP = 0.6;
const SIDES: TemplateSide[] = ['front', 'right', 'back', 'left'];
/** Outward normal of a side in the normalised frame. */
const NORMAL: Record<TemplateSide, Vec2> = {
  front: [0, -1],
  right: [1, 0],
  back: [0, 1],
  left: [-1, 0],
};

export const planTemplates = (): readonly PlanTemplate[] => PLAN_TEMPLATES;

/** The 8 symmetries of the square: rotation by k × 90° after an optional mirror (x → −x). */
interface Sym {
  k: number;
  mirror: boolean;
}
const SYMS: Sym[] = [0, 1, 2, 3].flatMap((k) => [
  { k, mirror: false },
  { k, mirror: true },
]);
const applyVec = (s: Sym, [x, y]: Vec2): Vec2 => {
  let p: Vec2 = s.mirror ? [-x, y] : [x, y];
  for (let i = 0; i < s.k; i++) p = [-p[1], p[0]];
  return p;
};
const sideOfNormal = (n: Vec2): TemplateSide =>
  SIDES.reduce((best, s) =>
    NORMAL[s][0] * n[0] + NORMAL[s][1] * n[1] > NORMAL[best][0] * n[0] + NORMAL[best][1] * n[1]
      ? s
      : best,
  );
const mapSide = (s: Sym, side: TemplateSide): TemplateSide =>
  sideOfNormal(applyVec(s, NORMAL[side]));

interface Frame {
  o: Vec2;
  e1: Vec2;
  e2: Vec2;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Bounding rectangle of the dwelling, aligned with its longest façade piece. */
function unitFrame(unit: Polygon, facade: readonly Seg[]): Frame | undefined {
  const ring = unit.outer;
  let dir: Vec2 | undefined;
  let best = 0;
  for (const [a, b] of facade.length
    ? facade
    : ring.map((p, i): Seg => [p, ring[(i + 1) % ring.length]!])) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > best) {
      best = l;
      dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    }
  }
  if (!dir) return undefined;
  const e1 = dir;
  const e2: Vec2 = [-dir[1], dir[0]];
  const o = ring[0]!;
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (const p of ring) {
    const u = (p[0] - o[0]) * e1[0] + (p[1] - o[1]) * e1[1];
    const v = (p[0] - o[0]) * e2[0] + (p[1] - o[1]) * e2[1];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  return { o, e1, e2, u0, u1, v0, v1 };
}

const toWorld = (f: Frame, u: number, v: number): Vec2 => [
  f.o[0] + f.e1[0] * u + f.e2[0] * v,
  f.o[1] + f.e1[1] * u + f.e2[1] * v,
];
const toLocal = (f: Frame, p: Vec2): Vec2 => [
  (p[0] - f.o[0]) * f.e1[0] + (p[1] - f.o[1]) * f.e1[1],
  (p[0] - f.o[0]) * f.e2[0] + (p[1] - f.o[1]) * f.e2[1],
];

/** Length of the segments lying on a side of the frame's rectangle, m. */
function onSide(f: Frame, side: TemplateSide, segs: readonly Seg[], tol = 0.15): number {
  let len = 0;
  for (const [a, b] of segs) {
    const [ua, va] = toLocal(f, a);
    const [ub, vb] = toLocal(f, b);
    if (side === 'front' || side === 'back') {
      const v = side === 'front' ? f.v0 : f.v1;
      if (Math.abs(va - v) > tol || Math.abs(vb - v) > tol) continue;
      len += Math.max(0, Math.min(Math.max(ua, ub), f.u1) - Math.max(Math.min(ua, ub), f.u0));
    } else {
      const u = side === 'left' ? f.u0 : f.u1;
      if (Math.abs(ua - u) > tol || Math.abs(ub - u) > tol) continue;
      len += Math.max(0, Math.min(Math.max(va, vb), f.v1) - Math.max(Math.min(va, vb), f.v0));
    }
  }
  return len;
}

/** Frame sides of the dwelling: front = v0 (normal −e2) … as in the template frame. */
const frameSideLength = (f: Frame, s: TemplateSide) =>
  s === 'front' || s === 'back' ? f.u1 - f.u0 : f.v1 - f.v0;

/** Façade sides of a template the séjour lies on. */
const sejourSides = (t: PlanTemplate): TemplateSide[] => {
  const sej = t.spaces.find((x) => x.kind === 'sejour');
  if (!sej) return [];
  const xs = sej.polygon.map((p) => p[0]);
  const ys = sej.polygon.map((p) => p[1]);
  const tol = 0.4;
  const out: TemplateSide[] = [];
  if (Math.min(...ys) <= tol) out.push('front');
  if (Math.max(...ys) >= t.depth - tol) out.push('back');
  if (Math.min(...xs) <= tol) out.push('left');
  if (Math.max(...xs) >= t.width - tol) out.push('right');
  return out.filter((x) => t.facades.includes(x));
};

/**
 * Best library template for a dwelling, with its rooms mapped into the dwelling, or undefined
 * when no template fits (the parametric layout takes over).
 */
export function matchTemplate(
  unit: Polygon,
  facadeSegments: readonly Seg[],
  accessSegments: readonly Seg[],
  mainRooms: number,
  rulesIn: UnitRules,
  opts: LibraryOptions = {},
): TemplateMatch | undefined {
  const stretchTol = opts.stretch ?? 0.1;
  const depthTol = opts.depthTolerance ?? 0.5;
  const f = unitFrame(unit, facadeSegments);
  if (!f) return undefined;
  const W = f.u1 - f.u0;
  const D = f.v1 - f.v0;
  if (W < 2 || D < 2) return undefined;
  // only (nearly) rectangular dwellings take a template
  if (polygonArea(unit) < 0.9 * W * D) return undefined;
  const facadeSides = new Set(
    SIDES.filter((s) => {
      const l = onSide(f, s, facadeSegments);
      return l >= Math.min(2, 0.4 * frameSideLength(f, s));
    }),
  );
  if (!facadeSides.size) return undefined;
  const accessSides = new Set(SIDES.filter((s) => onSide(f, s, accessSegments) >= 0.9));
  // séjour preference per side of the dwelling
  const pref = new Map<TemplateSide, number>(
    SIDES.map((sd) => [
      sd,
      opts.preferSejour
        ? Math.max(
            0,
            ...facadeSegments
              .filter((g) => onSide(f, sd, [g]) > 0.5)
              .map((g) => opts.preferSejour!(g)),
          )
        : 0,
    ]),
  );
  const maxPref = Math.max(...pref.values());
  const exclude = new Set(opts.exclude ?? []);
  const used = new Set(opts.used ?? []);

  let best: { t: PlanTemplate; s: Sym; score: number; sx: number; dd: number } | undefined;
  for (const t of PLAN_TEMPLATES) {
    if (t.rooms !== mainRooms || exclude.has(t.id)) continue;
    for (const s of SYMS) {
      const fac = t.facades.map((x) => mapSide(s, x));
      if (!fac.every((x) => facadeSides.has(x))) continue;
      // the template's main façade direction ends up along u (k even) or along v (k odd)
      const along = s.k % 2 === 0 ? W : D;
      const across = s.k % 2 === 0 ? D : W;
      const sx = along / t.width;
      const dd = across - t.depth;
      if (Math.abs(sx - 1) > stretchTol + 1e-9 || Math.abs(dd) > depthTol + 1e-9) continue;
      const lostFacades = [...facadeSides].filter((x) => !fac.includes(x)).length;
      const acc = t.access ? mapSide(s, t.access) : undefined;
      const accessPenalty = accessSides.size && acc && !accessSides.has(acc) ? 1 : 0;
      const sejSides = sejourSides(t).map((x) => mapSide(s, x));
      const sejPref = Math.max(0, ...sejSides.map((x) => pref.get(x) ?? 0));
      // the séjour never faces the gallery when the dwelling has an outer façade
      if (maxPref > 0 && sejPref <= 0) continue;
      const score =
        0.75 * (maxPref - sejPref) +
        10 * Math.abs(Math.log(sx)) +
        Math.abs(dd) +
        1.5 * lostFacades +
        accessPenalty +
        (used.has(t.id) ? 0.3 : 0);
      if (!best || score < best.score) best = { t, s, score, sx, dd };
    }
  }
  if (!best) return undefined;
  const { t, s } = best;
  // template point → dwelling: symmetry, then scale the result onto the dwelling rectangle
  const corners = [
    [0, 0],
    [t.width, 0],
    [t.width, t.depth],
    [0, t.depth],
  ].map((p) => applyVec(s, p as Vec2));
  const minX = Math.min(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const ext: Vec2 = [
    Math.max(...corners.map((p) => p[0])) - minX,
    Math.max(...corners.map((p) => p[1])) - minY,
  ];
  const map = (p: [number, number]): Vec2 => {
    const q = applyVec(s, p);
    const u = f.u0 + ((q[0] - minX) / ext[0]) * W;
    const v = f.v0 + ((q[1] - minY) / ext[1]) * D;
    // the plans are drawn to the inner face of the walls: rooms reach the dwelling's outline
    const snap = (x: number, lo: number, hi: number) =>
      x - lo < WALL_SNAP ? lo : hi - x < WALL_SNAP ? hi : x;
    return toWorld(f, snap(u, f.u0, f.u1), snap(v, f.v0, f.v1));
  };
  const rules = resolveUnitRules({ unitRules: rulesIn });
  const hasKitchen = t.spaces.some((x) => x.kind === 'cuisine');
  const required = (k: TemplateRoomKind): [number, number] => {
    switch (k) {
      case 'sejour':
        return [
          rules.livingMinFacade,
          hasKitchen ? rules.minAreas.sejour : rules.minAreas.sejourCuisine,
        ];
      case 'chambrePmr':
        return [rules.pmrBedroomMinFacade, rules.minAreas.chambrePmr];
      case 'chambre':
        return [rules.bedroomMinFacade, rules.minAreas.chambre];
      case 'cuisine':
        return [rules.kitchenMinFacade, rules.minAreas.cuisine];
    }
  };
  const rooms: LayoutRoom[] = [];
  for (const sp of t.spaces) {
    const raw: Polygon = { outer: sp.polygon.map(map) };
    const clipped = intersection([raw], [unit]).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    if (!clipped || polygonArea(clipped) < 1) continue;
    const [facadeRequired, areaRequired] = required(sp.kind);
    const facade = facadeOf(clipped, facadeSegments).length;
    const area = polygonArea(clipped);
    rooms.push({
      kind: sp.kind,
      polygon: clipped,
      area,
      facade,
      facadeRequired,
      facadeOk: facade >= facadeRequired - 0.02,
      areaRequired,
      areaOk: area >= areaRequired - 0.05,
    });
  }
  return {
    template: {
      id: t.id,
      type: t.type,
      category: t.category,
      stretch: Math.round(best.sx * 1000) / 1000,
      depthDelta: Math.round(best.dd * 100) / 100,
    },
    rooms,
  };
}

const OPPOSITE: Record<TemplateSide, TemplateSide> = {
  front: 'back',
  back: 'front',
  left: 'right',
  right: 'left',
};

/**
 * Widths of the dwellings of a row so that each can take a library plan: every dwelling picks
 * a plan of its type whose depth fits the row (± tolerance) and whose façades the row offers,
 * then the plans are stretched together (within ± stretch) to fill the row exactly. Dwellings
 * without a fitting plan (`flexible`) take the rest, at least their minimum width.
 * Returns undefined when no combination fills the row.
 */
export function libraryWidths(
  /** Main rooms of each dwelling of the row, in order. */
  rooms: readonly number[],
  len: number,
  depth: number,
  /** Façade on one long side (1) or on both (2). */
  sides: number,
  /** The row starts / ends at a façade (gable) of the building. */
  atStart: boolean,
  atEnd: boolean,
  mins: readonly number[],
  opts: LibraryOptions = {},
): { widths: number[]; templates: (string | undefined)[] } | undefined {
  const st = opts.stretch ?? 0.1;
  const dt = opts.depthTolerance ?? 0.5;
  const n = rooms.length;
  if (!n) return undefined;
  const cands = rooms.map((r, i) => {
    const avail = new Set<TemplateSide>(['front']);
    if (sides >= 2) avail.add('back');
    if (i === 0 && atStart) avail.add('left');
    if (i === n - 1 && atEnd) avail.add('right');
    const out: { id: string; w: number; score: number }[] = [];
    for (const t of PLAN_TEMPLATES) {
      if (t.rooms !== r || Math.abs(t.depth - depth) > dt + 1e-9) continue;
      // the office's minimum façade of the type still holds (séjour 3.60 m, …)
      if (t.width * (1 + st) < (mins[i] ?? 0) - 1e-9) continue;
      const variants: TemplateSide[][] = [
        t.facades,
        t.facades.map((s) => (s === 'left' || s === 'right' ? OPPOSITE[s] : s)),
      ];
      if (sides >= 2)
        variants.push(
          t.facades.map((s) => (s === 'front' || s === 'back' ? OPPOSITE[s] : s)),
          t.facades.map((s) => OPPOSITE[s]),
        );
      const ok = variants.filter((v) => v.every((s) => avail.has(s)));
      if (!ok.length) continue;
      // prefer plans that use every façade the dwelling has (corner plans at corners)
      const used = Math.max(...ok.map((v) => v.length));
      out.push({
        id: t.id,
        w: t.width,
        score: Math.abs(t.depth - depth) + 1.5 * (avail.size - used),
      });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 12);
  });
  const lib = cands.map((c) => c.length > 0);
  const flexMin = mins.reduce((s, m, i) => s + (lib[i] ? 0 : m), 0);
  const nFlex = lib.filter((x) => !x).length;
  // beam search over the plan widths
  type State = { sum: number; cost: number; pick: number[] };
  let beam: State[] = [{ sum: 0, cost: 0, pick: [] }];
  for (let i = 0; i < n; i++) {
    const next: State[] = [];
    for (const s of beam) {
      if (!lib[i]) next.push({ ...s, pick: [...s.pick, -1] });
      else
        cands[i]!.forEach((c, k) =>
          next.push({ sum: s.sum + c.w, cost: s.cost + c.score, pick: [...s.pick, k] }),
        );
    }
    next.sort((a, b) => a.cost - b.cost);
    const seen = new Set<string>();
    beam = next
      .filter((s) => {
        const key = `${Math.round(s.sum * 10)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 400);
  }
  let best: { s: State; lambda: number; cost: number } | undefined;
  for (const s of beam) {
    if (!s.sum) continue;
    let lambda: number;
    if (!nFlex) lambda = len / s.sum;
    else {
      // plans as drawn, the flexible dwellings take the rest (shrink the plans if needed)
      lambda = Math.min(1, (len - flexMin) / s.sum);
      if (lambda < 1 - st) continue;
    }
    if (Math.abs(lambda - 1) > st + 1e-9) continue;
    if (s.pick.some((k, i) => k >= 0 && cands[i]![k]!.w * lambda < mins[i]! - 1e-6)) continue;
    const cost = s.cost + 10 * Math.abs(Math.log(lambda));
    if (!best || cost < best.cost) best = { s, lambda, cost };
  }
  if (!best) return undefined;
  const libWidths = best.s.pick.map((k, i) => (k >= 0 ? cands[i]![k]!.w * best.lambda : 0));
  const rest = len - libWidths.reduce((a, b) => a + b, 0);
  const widths = libWidths.map((w, i) =>
    lib[i] ? w : flexMin > 0 ? (rest * mins[i]!) / flexMin : rest / nFlex,
  );
  return {
    widths,
    templates: best.s.pick.map((k, i) => (k >= 0 ? cands[i]![k]!.id : undefined)),
  };
}
