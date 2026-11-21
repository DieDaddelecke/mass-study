import { describe, expect, it } from 'vitest';
import {
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

  it('gallery side counts only when enabled', () => {
    const s = defaultSettings('FR');
    const off = layout({ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang', s);
    const on = layout({ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang', {
      ...s,
      unitRules: { ...DEFAULT_UNIT_RULES, galleryCountsAsFacade: true },
    });
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
    for (const u of l.units) expect(u.facadeOk || u.facade < 9).toBe(true);
    expect(l.summary.facadeViolations).toBe(l.units.filter((u) => !u.facadeOk).length);
  });
});
