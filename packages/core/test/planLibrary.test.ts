import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  intersection,
  libraryWidths,
  massToSolids,
  matchTemplate,
  planTemplates,
  polygonArea,
  rect,
  resolveUnitRules,
  storeyLayout,
  union,
  type Typology,
  type Vec2,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const rules = resolveUnitRules(settings);
const area = (ps: { polygon: Parameters<typeof polygonArea>[0] }[]) =>
  ps.reduce((s, p) => s + polygonArea(p.polygon), 0);

describe('office plan library', () => {
  it('holds the checked plans of the DWG: outline, séjour and bedrooms per type', () => {
    const ts = planTemplates();
    expect(ts.length).toBeGreaterThan(60);
    for (const t of ts) {
      const n = Number(t.type.slice(1));
      expect(t.rooms).toBe(n);
      expect(t.spaces.filter((s) => s.kind === 'sejour')).toHaveLength(1);
      const beds = t.spaces.filter((s) => s.kind === 'chambre' || s.kind === 'chambrePmr');
      expect(beds).toHaveLength(n - 1);
      if (n >= 2) expect(t.spaces.filter((s) => s.kind === 'chambrePmr')).toHaveLength(1);
      expect(t.facades.length).toBeGreaterThan(0);
      expect(t.facades).toContain('front');
      // every corner of every room is a right angle
      for (const s of t.spaces)
        s.polygon.forEach((p, i) => {
          const q = s.polygon[(i + 1) % s.polygon.length]!;
          expect(Math.min(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]))).toBeLessThan(0.02);
        });
    }
  });

  it('maps a fitting plan into a rectangular dwelling (through dwelling, ±10 %)', () => {
    const unit = rect(0, 0, 8, 12);
    const facade: [Vec2, Vec2][] = [
      [
        [0, 0],
        [8, 0],
      ],
      [
        [8, 12],
        [0, 12],
      ],
    ];
    const access: [Vec2, Vec2][] = [
      [
        [0, 2],
        [0, 6],
      ],
    ];
    const m = matchTemplate(unit, facade, access, 4, rules)!;
    expect(m).toBeDefined();
    expect(m.template.type).toBe('T4');
    expect(Math.abs(m.template.stretch - 1)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(m.template.depthDelta)).toBeLessThanOrEqual(0.5);
    expect(m.rooms.filter((r) => r.kind === 'sejour')).toHaveLength(1);
    expect(m.rooms.filter((r) => r.kind === 'chambre' || r.kind === 'chambrePmr')).toHaveLength(3);
    // inside the dwelling, disjoint, séjour and bedrooms on the façade
    const inside = intersection(
      m.rooms.map((r) => r.polygon),
      [unit],
    ).reduce((s, p) => s + polygonArea(p), 0);
    expect(inside).toBeCloseTo(area(m.rooms), 1);
    expect(
      union(m.rooms.map((r) => r.polygon)).reduce((s, p) => s + polygonArea(p), 0),
    ).toBeCloseTo(area(m.rooms), 1);
    for (const r of m.rooms) if (r.kind !== 'cuisine') expect(r.facade).toBeGreaterThan(2);
  });

  it('takes no plan when nothing fits (the parametric layout takes over)', () => {
    const unit = rect(0, 0, 20, 3);
    const facade: [Vec2, Vec2][] = [
      [
        [0, 0],
        [20, 0],
      ],
    ];
    expect(matchTemplate(unit, facade, [], 3, rules)).toBeUndefined();
  });

  it('sizes a row so that its dwellings take library plans and fill it exactly', () => {
    // bedrooms widened to 2.50 m / 2.80 m: the plans need a little more width than drawn
    const r = libraryWidths([2, 3, 2], 26, 7.1, 1, false, false, [6.5, 9.1, 6.5])!;
    expect(r).toBeDefined();
    expect(r.widths.reduce((a, b) => a + b, 0)).toBeCloseTo(26, 6);
    expect(r.templates.every((x) => !!x)).toBe(true);
  });

  it('the floor plan takes library plans first and counts them', () => {
    const m = mass({ kind: 'solitaer', length: 60, depth: 17 } as Typology, {
      access: 'mittelflur',
    });
    const solids = massToSolids(m, settings).filter((s) => s.storeyIndex === 2);
    const l = storeyLayout(m, solids, settings);
    const lib = l.units.filter((u) => u.template);
    expect(lib.length).toBeGreaterThan(2);
    expect(l.summary.libraryUnits).toBe(lib.length);
    for (const u of lib) {
      expect(u.template!.type).toBe(u.label);
      const inside = intersection(
        u.rooms.map((r) => r.polygon),
        [u.polygon],
      ).reduce((s, p) => s + polygonArea(p), 0);
      expect(inside).toBeCloseTo(area(u.rooms), 1);
      expect(u.rooms.find((r) => r.kind === 'sejour')!.facade).toBeGreaterThan(2);
      // the library's ~2.40 m bedrooms are widened to the office's 2.50 m (PMR 2.80 m)
      for (const r of u.rooms.filter((x) => x.kind === 'chambre' || x.kind === 'chambrePmr'))
        expect(r.facade).toBeGreaterThanOrEqual(r.facadeRequired - 0.02);
    }
    // switched off: the parametric layout only
    const off = defaultSettings('FR');
    off.unitRules = { ...off.unitRules!, planLibrary: false };
    const l2 = storeyLayout(m, solids, off);
    expect(l2.units.some((u) => u.template)).toBe(false);
    expect(l2.summary.libraryUnits).toBe(0);
  });
});
