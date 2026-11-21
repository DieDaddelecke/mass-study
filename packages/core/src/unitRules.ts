/**
 * Office rules for dwellings (règles de l'agence / Büro-Regeln): minimum façade lengths.
 *
 * Every dwelling has a living room (séjour) with ≥ 3.60 m of façade; every dwelling with a
 * bedroom has one PMR bedroom with ≥ 2.80 m; T3/T4/T5 have 1/2/3 further bedrooms with ≥ 2.50 m;
 * 10 cm per partition (cloison) between the rooms along the façade.
 */
import type { Polygon, Settings, UnitRules, UnitType, Vec2 } from './types.js';

export const DEFAULT_UNIT_RULES: UnitRules = {
  livingMinFacade: 3.6,
  pmrBedroomMinFacade: 2.8,
  bedroomMinFacade: 2.5,
  interiorWall: 0.1,
  // office decision 2026-11-21: the coursive side counts as façade
  galleryCountsAsFacade: true,
};

/** Rules of the settings with defaults for missing values (older project files). */
export function resolveUnitRules(settings: Pick<Settings, 'unitRules'>): UnitRules {
  return { ...DEFAULT_UNIT_RULES, ...(settings.unitRules ?? {}) };
}

/** Number of main rooms of a type: `rooms`, else the first digit in the id or label, else 1. */
export function unitRooms(t: Pick<UnitType, 'id' | 'label' | 'rooms'>): number {
  if (t.rooms !== undefined && Number.isFinite(t.rooms) && t.rooms >= 1) return Math.round(t.rooms);
  const m = /(\d+)/.exec(t.label) ?? /(\d+)/.exec(t.id);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 ? n : 1;
}

/** Minimum façade length of a dwelling type under the rules, m. */
export function requiredFacade(
  t: Pick<UnitType, 'id' | 'label' | 'rooms'>,
  rules: UnitRules = DEFAULT_UNIT_RULES,
): number {
  const r = unitRooms(t);
  const v =
    rules.livingMinFacade +
    (r >= 2 ? rules.pmrBedroomMinFacade : 0) +
    Math.max(0, r - 2) * rules.bedroomMinFacade +
    (r - 1) * rules.interiorWall;
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
