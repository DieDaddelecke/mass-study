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
  const layoutOf = (depth: number, unitsPerCore: number) => {
    const m = mass({ kind: 'solitaer', length: 50, depth }, { unitsPerCore });
    const ml = massLayout(m, massToSolids(m, settings), settings);
    return { ml, st: ml.storeys.find((s) => s.storeyIndex === 2)! };
  };
  const rectangular = (p: { outer: [number, number][] }) => {
    const xs = p.outer.map((q) => q[0]);
    const ys = p.outer.map((q) => q[1]);
    const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    return Math.abs(polygonArea(p) - box) < 0.05;
  };

  it('Vierspänner: 4 rectangular dwellings per landing, most of them library plans', () => {
    const { ml, st } = layoutOf(14, 4);
    expect(ml.access).toBe('vierspaenner');
    expect(st.units.length).toBe(4 * st.cores.length);
    for (const u of st.units) expect(rectangular(u.polygon)).toBe(true);
    // every dwelling reaches the landing of its core
    expect(st.circulation.some((c) => c.kind === 'lift')).toBe(true);
    expect(st.units.filter((u) => u.template).length).toBeGreaterThanOrEqual(
      st.units.length * 0.75,
    );
    expect(ml.expectedUnitsPerCore).toEqual([4, 4]);
  });

  it('Dreispänner: the third dwelling behind the landing, all rectangles', () => {
    const { st } = layoutOf(14, 3);
    expect(st.units.length).toBe(3 * st.cores.length);
    for (const u of st.units) expect(rectangular(u.polygon)).toBe(true);
  });
});
