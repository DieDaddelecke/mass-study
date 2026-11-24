import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  massLayout,
  massToSolids,
  polygonArea,
  resolveAccess,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');

describe('dwellings per core set on the mass', () => {
  it('2 / 3 / 4 per landing pick the Zwei-, Drei-, Vierspänner', () => {
    const t = { kind: 'solitaer', length: 50, depth: 17 } as const;
    expect(resolveAccess(mass(t, { unitsPerCore: 2 }), settings)).toBe('zweispaenner');
    expect(resolveAccess(mass(t, { unitsPerCore: 3, access: 'zweispaenner' }), settings)).toBe(
      'dreispaenner',
    );
    expect(resolveAccess(mass(t, { unitsPerCore: 4 }), settings)).toBe('vierspaenner');
    // an explicit gallery / corridor stays
    expect(resolveAccess(mass(t, { unitsPerCore: 2, access: 'mittelflur' }), settings)).toBe(
      'mittelflur',
    );
    // 5 and more: no spänner
    const z = { kind: 'solitaer', length: 50, depth: 12 } as const;
    expect(resolveAccess(mass(z), settings)).toBe('zweispaenner');
    expect(resolveAccess(mass(z, { unitsPerCore: 6 }), settings)).not.toMatch(/spaenner/);
  });

  it('sets the number of cores of a corridor block', () => {
    const t = { kind: 'solitaer', length: 60, depth: 17 } as const;
    const per = (n?: number) => {
      const m = mass(t, { access: 'mittelflur', ...(n ? { unitsPerCore: n } : {}) });
      const ml = massLayout(m, massToSolids(m, settings), settings);
      const st = ml.storeys.find((s) => s.storeyIndex === 2)!;
      return { cores: st.cores.length, units: st.units.length, expected: ml.expectedUnitsPerCore };
    };
    const four = per(5);
    const eight = per(8);
    expect(four.cores).toBeGreaterThan(eight.cores);
    expect(four.units / four.cores).toBeLessThanOrEqual(5.5);
    expect(four.expected).toEqual([5, 5]);
  });
});

describe('spänner sections of library dwellings', () => {
  const layoutOf = (depth: number, unitsPerCore: number, length = 50) => {
    const m = mass({ kind: 'solitaer', length, depth }, { unitsPerCore });
    const ml = massLayout(m, massToSolids(m, settings), settings);
    return { ml, st: ml.storeys.find((s) => s.storeyIndex === 2)! };
  };
  const rectangular = (p: { outer: [number, number][] }) => {
    const xs = p.outer.map((q) => q[0]);
    const ys = p.outer.map((q) => q[1]);
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return Math.abs(polygonArea(p) - box) < 0.05;
  };

  it('Mittelflur: a short corridor per core with a traversant dwelling at both ends', () => {
    const m = mass({ kind: 'solitaer', length: 67.5, depth: 15 }, { access: 'mittelflur' });
    const st = massLayout(m, massToSolids(m, settings), settings).storeys.find(
      (s) => s.storeyIndex === 2,
    )!;
    const corridors = st.circulation.filter((c) => c.kind === 'corridor');
    expect(corridors.length).toBe(st.cores.length);
    const trav = st.units.filter((u) => (u.orientations?.length ?? 0) >= 2);
    expect(trav.length).toBe(2 * st.cores.length);
    for (const u of trav) {
      expect(rectangular(u.polygon)).toBe(true);
      expect(u.accessOk).toBe(true);
    }
  });

  it('Vierspänner: core in the middle, 2 traversant and 2 small dwellings per landing', () => {
    const { ml, st } = layoutOf(14, 4, 67.5);
    expect(ml.access).toBe('vierspaenner');
    expect(st.units.length).toBe(4 * st.cores.length);
    for (const u of st.units) expect(rectangular(u.polygon)).toBe(true);
    expect(st.circulation.some((c) => c.kind === 'lift')).toBe(true);
    // half of them traversant (T3+), the others small (T1/T2) in front of and behind the core
    const trav = st.units.filter((u) => (u.orientations?.length ?? 0) >= 2);
    expect(trav.length).toBe(2 * st.cores.length);
    for (const u of trav) expect(Number(u.typeId.replace(/\D/g, ''))).toBeGreaterThanOrEqual(3);
    for (const u of st.units.filter((x) => !trav.includes(x)))
      expect(Number(u.typeId.replace(/\D/g, ''))).toBeLessThanOrEqual(2);
    expect(ml.expectedUnitsPerCore).toEqual([4, 4]);
  });

  it('Dreispänner: the third dwelling behind the landing, all rectangles', () => {
    const { st } = layoutOf(14, 3);
    expect(st.units.length).toBe(3 * st.cores.length);
    for (const u of st.units) expect(rectangular(u.polygon)).toBe(true);
  });
});

describe('orientation rule in the generator', () => {
  it('from T3 every dwelling has two orientations (one-sided places take T1 / T2)', () => {
    const cases: [number, number, 'vierspaenner' | 'dreispaenner' | 'mittelflur'][] = [
      [50, 14, 'vierspaenner'],
      [70, 15, 'vierspaenner'],
      [55, 15, 'dreispaenner'],
      [60, 17, 'mittelflur'],
      [42, 19, 'mittelflur'],
    ];
    for (const [length, depth, access] of cases) {
      const m = mass({ kind: 'solitaer', length, depth }, { access });
      const st = massLayout(m, massToSolids(m, settings), settings).storeys.find(
        (s) => s.storeyIndex === 2,
      )!;
      for (const u of st.units) {
        const rooms = Number(u.typeId.replace(/\D/g, ''));
        if (rooms >= 3)
          expect(
            u.orientations?.length ?? 0,
            `${access} ${length}×${depth} ${u.label}`,
          ).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
