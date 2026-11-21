import { describe, expect, it } from 'vitest';
import {
  assignRooms,
  minUnitWidth,
  roomMinWidths,
  roomsFit,
  DEFAULT_UNIT_MIX_DE,
  DEFAULT_UNIT_MIX_FR,
  DEFAULT_UNIT_RULES,
  defaultSettings,
  facadeOf,
  massToSolids,
  polygonEdges,
  rect,
  requiredFacade,
  storeyLayout,
  unitRooms,
  type AccessType,
  type Settings,
  type Typology,
} from '../src/index.js';
import { mass } from './helpers.js';

describe('requiredFacade', () => {
  it('T1 3.60, T2 6.50, T3 9.10, T4 11.70, T5 14.30 m', () => {
    expect(DEFAULT_UNIT_MIX_FR.map((t) => requiredFacade(t))).toEqual([3.6, 6.5, 9.1, 11.7, 14.3]);
    expect(DEFAULT_UNIT_MIX_DE.map((t) => requiredFacade(t, DEFAULT_UNIT_RULES))).toEqual([
      3.6, 6.5, 9.1, 11.7, 14.3,
    ]);
  });

  it('room count falls back to the digit in label or id', () => {
    expect(unitRooms({ id: 'x', label: 'T4' })).toBe(4);
    expect(unitRooms({ id: '3zi', label: 'Familie' })).toBe(3);
    expect(unitRooms({ id: 'studio', label: 'Studio' })).toBe(1);
    expect(unitRooms({ id: 't5', label: 'T5', rooms: 2 })).toBe(2);
  });
});

describe('facadeOf', () => {
  const fp = polygonEdges([rect(0, 0, 30, 12)]);
  it('through-unit gets both façades', () => {
    expect(facadeOf(rect(10, 0, 18, 12), fp).length).toBeCloseTo(16, 6);
  });
  it('corner unit gets the gable too', () => {
    expect(facadeOf(rect(0, 0, 8, 12), fp).length).toBeCloseTo(28, 6);
  });
  it('unit behind a core: only its south side', () => {
    const f = facadeOf(rect(12, 6.01, 18, 12), fp);
    expect(f.length).toBeCloseTo(6, 6);
    expect(f.segments).toHaveLength(1);
  });
  it('ignores seams where a hole touches the outer ring', () => {
    // section 10–18 expressed as 0–18 minus a hole 0–10 that shares three edges with the outer ring
    const u = {
      outer: rect(0, 0, 18, 12).outer,
      holes: [rect(0, 0, 10, 12).outer.slice().reverse()],
    };
    expect(facadeOf(u, fp).length).toBeCloseTo(16, 6);
  });
  it('tolerates 2 cm and ignores interior edges', () => {
    expect(facadeOf(rect(10, 0.015, 18, 6), fp).length).toBeCloseTo(8, 6);
    expect(facadeOf(rect(10, 1, 18, 6), fp).length).toBe(0);
  });
});

function layout(t: Typology, access: AccessType, settings: Settings = defaultSettings('FR')) {
  const m = mass(t, { access });
  return storeyLayout(
    m,
    massToSolids(m, settings).filter((s) => s.storeyIndex === 2),
    settings,
  );
}

describe('room-based widths', () => {
  const t = (n: number) => ({ id: `T${n}`, label: `T${n}` });
  it('assigns rooms to façade pieces without splitting them', () => {
    expect(roomMinWidths(t(4))).toEqual([3.6, 2.8, 2.5, 2.5]);
    expect(assignRooms([3.6, 2.8], [3.5, 3.5], 0.1)).toBeNull();
    expect(assignRooms([3.6, 2.8], [3.6, 2.8], 0.1)).toEqual([0, 1]);
    expect(roomsFit(t(3), [6.2, 2.8])).toBe(true);
    expect(roomsFit(t(3), [4.5, 4.6])).toBe(false);
  });
  it('minimum widths with one or two façades', () => {
    expect(minUnitWidth(t(1), 1)).toBeCloseTo(3.6);
    expect(minUnitWidth(t(1), 2)).toBeCloseTo(3.6);
    expect(minUnitWidth(t(2), 2)).toBeCloseTo(3.6);
    // T3: séjour on one side, PMR + chambre (2.80 + 0.10 + 2.50) on the other
    expect(minUnitWidth(t(3), 2)).toBeCloseTo(5.4);
    expect(minUnitWidth(t(4), 1)).toBeCloseTo(11.7);
  });
});

describe('layout meets the façade rules', () => {
  const cases: [AccessType, number, number][] = [
    ['zweispaenner', 40, 12],
    ['zweispaenner', 55, 13],
    ['zweispaenner', 60, 14],
    ['dreispaenner', 50, 14],
    ['dreispaenner', 60, 12],
    ['dreispaenner', 45, 13],
    ['laubengang', 60, 10],
    ['laubengang', 45, 10],
    ['mittelflur', 60, 14],
    ['punkthaus', 20, 20],
    ['punkthaus', 24, 22],
  ];
  for (const profile of ['FR', 'DE'] as const)
    for (const [access, length, depth] of cases)
      it(`${profile} ${access} ${length} × ${depth} m`, () => {
        const l = layout({ kind: 'solitaer', length, depth }, access, defaultSettings(profile));
        expect(l.units.length).toBeGreaterThan(1);
        expect(l.summary.facadeViolations).toBe(0);
        for (const u of l.units) {
          expect(u.facadeOk).toBe(true);
          expect(u.facade).toBeGreaterThanOrEqual(u.facadeRequired - 1e-6);
        }
      });

  it('the dreispänner unit behind the core has its south façade only and complies', () => {
    const l = layout({ kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner');
    const back = l.units.filter((u) => u.facadeSegments.length === 1);
    expect(back.length).toBeGreaterThan(0);
    for (const u of back) expect(u.facade).toBeGreaterThanOrEqual(u.facadeRequired);
  });

  it('gallery side counts by default and can be switched off', () => {
    const s = defaultSettings('FR');
    expect(DEFAULT_UNIT_RULES.galleryCountsAsFacade).toBe(true);
    const on = layout({ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang', s);
    const off = layout({ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang', {
      ...s,
      unitRules: { ...DEFAULT_UNIT_RULES, galleryCountsAsFacade: false },
    });
    expect(off.summary.facadeViolations).toBe(0);
    const sum = (l: typeof on) => l.units.reduce((a, u) => a + u.facade, 0);
    expect(sum(on)).toBeGreaterThan(sum(off) * 1.5);
    expect(on.summary.facadeViolations).toBe(0);
  });

  it('settings without unitRules (older files) use the defaults', () => {
    const s: Settings = defaultSettings('FR');
    delete s.unitRules;
    const l = layout({ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner', s);
    expect(l.units.every((u) => u.facadeRequired > 0 && u.facadeOk)).toBe(true);
  });

  it('stricter rules: smaller types, a flag only where even the smallest type cannot comply', () => {
    const s = defaultSettings('FR');
    const l = layout({ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner', {
      ...s,
      unitRules: { ...DEFAULT_UNIT_RULES, livingMinFacade: 9 },
    });
    // a séjour needs 9 m on one façade piece: units without such a piece are flagged
    const longest = (u: (typeof l.units)[number]) =>
      Math.max(...u.facadeSegments.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (const u of l.units) expect(u.facadeOk || longest(u) < 9).toBe(true);
    expect(l.summary.facadeViolations).toBe(l.units.filter((u) => !u.facadeOk).length);
  });
});
