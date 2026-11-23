/**
 * Office rules for dwellings (règles de l'agence / Büro-Regeln): minimum façade lengths.
 *
 * Every dwelling has a living room (séjour) with ≥ 3.60 m of façade; every dwelling with a
 * bedroom has one PMR bedroom with ≥ 2.80 m; T3/T4/T5 have 1/2/3 further bedrooms with ≥ 2.50 m;
 * 10 cm per partition (cloison) between the rooms along the façade.
 */
import type { Polygon, RoomMinAreas, Settings, UnitRules, UnitType, Vec2 } from './types.js';

/** Minimum room areas (office rules 2026-11-23, docs/GRUNDRISS_REGELN.md), m². */
export const DEFAULT_MIN_AREAS: RoomMinAreas = {
  sejour: 20,
  sejourCuisine: 25,
  cuisine: 7,
  chambre: 10,
  chambrePmr: 12,
  sdb: 5,
  sde: 4,
  wc: 2,
};

export const DEFAULT_UNIT_RULES: Required<UnitRules> = {
  livingMinFacade: 3.6,
  pmrBedroomMinFacade: 2.8,
  bedroomMinFacade: 2.5,
  interiorWall: 0.1,
  // office decision 2026-11-21: the coursive side counts as façade
  galleryCountsAsFacade: true,
  kitchenMinFacade: 2.15,
  separateKitchen: false,
  shaftSize: 0.6,
  minAreas: DEFAULT_MIN_AREAS,
  unitsPerCoreMin: 3,
  unitsPerCoreMax: 8,
  facadeAreaRatio: 0.12,
  facadeGrid: 1.25,
};

/** Fully resolved unit rules (all optional values filled in). */
export type ResolvedUnitRules = Required<UnitRules> & { minAreas: RoomMinAreas };

/** Rules of the settings with defaults for missing values (older project files). */
export function resolveUnitRules(settings: Pick<Settings, 'unitRules'>): ResolvedUnitRules {
  const r: Partial<UnitRules> = settings.unitRules ?? {};
  return {
    ...DEFAULT_UNIT_RULES,
    ...r,
    minAreas: { ...DEFAULT_MIN_AREAS, ...(r.minAreas ?? {}) },
  } as ResolvedUnitRules;
}

/** Resolve a rules object that may come without the newer optional values. */
export const fullRules = (rules: UnitRules): ResolvedUnitRules =>
  resolveUnitRules({ unitRules: rules });

/** Number of main rooms of a type: `rooms`, else the first digit in the id or label, else 1. */
export function unitRooms(t: Pick<UnitType, 'id' | 'label' | 'rooms'>): number {
  if (t.rooms !== undefined && Number.isFinite(t.rooms) && t.rooms >= 1) return Math.round(t.rooms);
  const m = /(\d+)/.exec(t.label) ?? /(\d+)/.exec(t.id);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 ? n : 1;
}

/**
 * Minimum façade length of a dwelling type under the rules, m. A duplex level (`duplex`) needs
 * the longer of its two levels: séjour + chambre PMR (jour) or the further bedrooms (nuit).
 */
export function requiredFacade(
  t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'duplex'>,
  rules: UnitRules = DEFAULT_UNIT_RULES,
): number {
  const v = Math.max(
    ...roomLevels(t, rules).map(
      (w) => w.reduce((a, b) => a + b, 0) + Math.max(0, w.length - 1) * rules.interiorWall,
    ),
  );
  return Math.round(v * 1000) / 1000;
}

type Seg = [Vec2, Vec2];

/** Edges of all rings of polygons. */
export function polygonEdges(polys: readonly Polygon[]): Seg[] {
  const out: Seg[] = [];
  const ring = (r: readonly Vec2[]) => {
    for (let i = 0; i < r.length; i++) out.push([r[i]!, r[(i + 1) % r.length]!]);
  };
  for (const p of polys) {
    ring(p.outer);
    for (const h of p.holes ?? []) ring(h);
  }
  return out;
}

/** Collinear overlap length of segment pq with segment rs (within `tol` m). */
function overlap([p, q]: Seg, [r, s]: Seg, tol: number): number {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len;
  const uy = dy / len;
  const off = (x: Vec2) => Math.abs((x[0] - p[0]) * uy - (x[1] - p[1]) * ux);
  if (off(r) > tol || off(s) > tol) return 0;
  const tr = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy;
  const ts = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy;
  return Math.max(0, Math.min(len, Math.max(tr, ts)) - Math.max(0, Math.min(tr, ts)));
}

/**
 * Façade length of a dwelling polygon: length of its edges lying (collinear, ±`tol`) on the
 * given façade segments (exterior rings of the storey footprint, optionally gallery edges).
 * Returns the total and the façade pieces (for drawing).
 */
export function facadeOf(
  unit: Polygon,
  facade: readonly Seg[],
  tol = 0.02,
): { length: number; segments: Seg[] } {
  let length = 0;
  const segments: Seg[] = [];
  const own = polygonEdges([unit]);
  for (let k = 0; k < own.length; k++) {
    const e = own[k]!;
    const [p, q] = e;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    // collect covered parameter intervals, merged so that touching segments count once
    const iv: [number, number][] = [];
    const ux = (q[0] - p[0]) / len;
    const uy = (q[1] - p[1]) / len;
    for (const f of facade) {
      if (overlap(e, f, tol) <= 1e-6) continue;
      const t = (x: Vec2) => (x[0] - p[0]) * ux + (x[1] - p[1]) * uy;
      const a = Math.max(0, Math.min(t(f[0]), t(f[1])));
      const b = Math.min(len, Math.max(t(f[0]), t(f[1])));
      if (b > a) iv.push([a, b]);
    }
    // Seams: clipping can return a unit as an outer ring with a hole that touches it along
    // shared edges. Edge pieces lying on another edge of the same polygon are not boundary.
    const seams: [number, number][] = [];
    for (let j = 0; j < own.length; j++) {
      if (j === k) continue;
      const g = own[j]!;
      if (overlap(e, g, tol) <= 1e-6) continue;
      const t = (x: Vec2) => (x[0] - p[0]) * ux + (x[1] - p[1]) * uy;
      seams.push([
        Math.max(0, Math.min(t(g[0]), t(g[1]))),
        Math.min(len, Math.max(t(g[0]), t(g[1]))),
      ]);
    }
    if (seams.length) {
      const cut: [number, number][] = [];
      for (const x of iv) {
        let parts: [number, number][] = [x];
        for (const [a, b] of seams)
          parts = parts.flatMap(([c, d]) => {
            if (b <= c || a >= d) return [[c, d] as [number, number]];
            const r: [number, number][] = [];
            if (a > c) r.push([c, a]);
            if (b < d) r.push([b, d]);
            return r;
          });
        cut.push(...parts.filter(([c, d]) => d - c > 1e-6));
      }
      iv.length = 0;
      iv.push(...cut);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let cur: [number, number] | undefined;
    const flush = () => {
      if (!cur) return;
      length += cur[1] - cur[0];
      segments.push([
        [p[0] + ux * cur[0], p[1] + uy * cur[0]],
        [p[0] + ux * cur[1], p[1] + uy * cur[1]],
      ]);
    };
    for (const x of iv) {
      if (cur && x[0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], x[1]);
      else {
        flush();
        cur = [x[0], x[1]];
      }
    }
    flush();
  }
  return { length, segments };
}

/** Minimum façade widths of the main rooms of a type: séjour, chambre PMR, chambres. */
export function roomMinWidths(
  t: Pick<UnitType, 'id' | 'label' | 'rooms'>,
  rules: UnitRules = DEFAULT_UNIT_RULES,
): number[] {
  const r = unitRooms(t);
  const out = [rules.livingMinFacade];
  if (r >= 2) out.push(rules.pmrBedroomMinFacade);
  for (let i = 2; i < r; i++) out.push(rules.bedroomMinFacade);
  return out;
}

/**
 * Minimum room widths per level of a type: one level for a simplex dwelling; for a duplex the
 * entrance level (séjour + chambre PMR, accessible) and the other level (further bedrooms).
 */
export function roomLevels(
  t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'duplex'>,
  rules: UnitRules = DEFAULT_UNIT_RULES,
): number[][] {
  const all = roomMinWidths(t, rules);
  if (!t.duplex) return [all];
  const nuit = all.slice(2);
  return nuit.length ? [all.slice(0, 2), nuit] : [all.slice(0, 2)];
}

/**
 * Assignment of rooms (minimum widths) to façade pieces (lengths) so that every piece holds its
 * rooms side by side with a partition between them; a room is never split over two pieces.
 * Returns the piece index of every room, or null when no assignment fits. With `pref`, the
 * séjour (room 0) goes to the piece with the highest preference that still allows a fit;
 * among those, the assignment with the most spare length on the fullest piece wins.
 */
export function assignRooms(
  widths: readonly number[],
  pieces: readonly number[],
  wall: number,
  pref?: readonly number[],
): number[] | null {
  const n = widths.length;
  const m = pieces.length;
  if (!m) return n ? null : [];
  let best: number[] | null = null;
  let bestKey: [number, number] = [-Infinity, -Infinity];
  const load = new Array<number>(m).fill(0);
  const count = new Array<number>(m).fill(0);
  const cur: number[] = [];
  // rooms sorted wide first prune earlier; keep the original indices
  const order = widths.map((w, i) => i).sort((a, b) => widths[b]! - widths[a]!);
  const rec = (k: number) => {
    if (k === n) {
      let slack = Infinity;
      for (let j = 0; j < m; j++) if (count[j]) slack = Math.min(slack, pieces[j]! - load[j]!);
      const key: [number, number] = [pref ? (pref[cur[0]!] ?? 0) : 0, slack];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1] + 1e-9)) {
        bestKey = key;
        best = [...cur];
      }
      return;
    }
    const i = order[k]!;
    for (let j = 0; j < m; j++) {
      const add = widths[i]! + (count[j] ? wall : 0);
      if (load[j]! + add > pieces[j]! + 1e-6) continue;
      load[j] = load[j]! + add;
      count[j]!++;
      cur[i] = j;
      rec(k + 1);
      load[j] = load[j]! - add;
      count[j]!--;
    }
  };
  rec(0);
  return best;
}

/** True when the rooms of a type fit on façade pieces of the given lengths. */
export function roomsFit(
  t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'duplex'>,
  pieces: readonly number[],
  rules: UnitRules = DEFAULT_UNIT_RULES,
): boolean {
  // 1 cm tolerance: façade pieces are measured on clipped outlines (cf. room check, 2 cm)
  const p = pieces.map((x) => x + 0.01);
  return roomLevels(t, rules).every((w) => assignRooms(w, p, rules.interiorWall) !== null);
}

/**
 * Minimum dwelling width of a type in a row with `sides` façades of the same length (1: one
 * façade, 2: through dwelling or gallery + façade): rooms are not split over two façades.
 */
export function minUnitWidth(
  t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'duplex'>,
  sides: number,
  rules: UnitRules = DEFAULT_UNIT_RULES,
  /** Further façade pieces of fixed length (e.g. a short return beside a core). */
  extra: readonly number[] = [],
): number {
  const levels = roomLevels(t, rules);
  const bins = Math.max(1, Math.round(sides));
  const fits = (x: number) =>
    levels.every(
      (w) =>
        assignRooms(
          w,
          [...new Array<number>(bins).fill(x), ...extra.filter((e) => e > 0)],
          rules.interiorWall,
        ) !== null,
    );
  let lo = 0;
  let hi = requiredFacade(t, rules);
  if (fits(lo)) return 0;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const r = Math.round(hi * 100) / 100;
  return fits(r) ? r : Math.ceil(hi * 100 - 1e-6) / 100;
}

/** Dwellings per core and storey (gallery, corridor, point block): [min, max]. */
export function coreRange(settings: Pick<Settings, 'unitRules'>): [number, number] {
  const r = resolveUnitRules(settings);
  return [r.unitsPerCoreMin, Math.max(r.unitsPerCoreMin, r.unitsPerCoreMax)];
}
