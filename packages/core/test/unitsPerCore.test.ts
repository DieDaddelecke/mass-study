import { describe, expect, it } from 'vitest';
import { defaultSettings, massLayout, massToSolids, resolveAccess } from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');

describe('dwellings per core set on the mass', () => {
  it('2 / 3 per landing pick the Zweispänner / Dreispänner', () => {
    const t = { kind: 'solitaer', length: 50, depth: 17 } as const;
    expect(resolveAccess(mass(t, { unitsPerCore: 2 }), settings)).toBe('zweispaenner');
    expect(resolveAccess(mass(t, { unitsPerCore: 3, access: 'zweispaenner' }), settings)).toBe(
      'dreispaenner',
    );
    // an explicit gallery / corridor stays
    expect(resolveAccess(mass(t, { unitsPerCore: 2, access: 'mittelflur' }), settings)).toBe(
      'mittelflur',
    );
    // 4 and more: no spänner
    const z = { kind: 'solitaer', length: 50, depth: 12 } as const;
    expect(resolveAccess(mass(z), settings)).toBe('zweispaenner');
    expect(resolveAccess(mass(z, { unitsPerCore: 5 }), settings)).not.toMatch(/spaenner/);
  });

  it('sets the number of cores of a corridor block', () => {
    const t = { kind: 'solitaer', length: 60, depth: 17 } as const;
    const per = (n?: number) => {
      const m = mass(t, { access: 'mittelflur', ...(n ? { unitsPerCore: n } : {}) });
      const ml = massLayout(m, massToSolids(m, settings), settings);
      const st = ml.storeys.find((s) => s.storeyIndex === 2)!;
      return { cores: st.cores.length, units: st.units.length, expected: ml.expectedUnitsPerCore };
    };
    const four = per(4);
    const eight = per(8);
    expect(four.cores).toBeGreaterThan(eight.cores);
    expect(four.units / four.cores).toBeLessThanOrEqual(4.5);
    expect(four.expected).toEqual([4, 4]);
  });
});
