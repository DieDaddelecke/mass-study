import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  massLayout,
  massToSolids,
  unitAreaTolerance,
  type AccessType,
  type ProgrammeConfig,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const programme: ProgrammeConfig = {
  enabled: true,
  mode: 'percent',
  entries: [
    { typeIds: ['t1', 't2'], value: 35 },
    { typeIds: ['t3'], value: 30 },
    { typeIds: ['t4'], value: 15 },
    { typeIds: ['t5'], value: 5 },
  ],
};

describe('upper area limit of a type is binding (Soheyl 26.11.2026)', () => {
  it('no dwelling above max + margin of its type, with and without programme', () => {
    const over: string[] = [];
    const accesses: (AccessType | 'auto')[] = [
      'zweispaenner',
      'dreispaenner',
      'vierspaenner',
      'laubengang',
      'mittelflur',
      'auto',
    ];
    for (const access of accesses)
      for (const depth of [13, 16])
        for (const prog of [false, true]) {
          const m = mass(
            { kind: 'zeile', length: 67.48, depth, sections: 3, sectionOffset: 0 },
            { access, ...(prog ? { programme } : {}) },
          );
          const l = massLayout(m, massToSolids(m, settings), settings);
          for (const st of l.storeys)
            for (const u of st.units) {
              const t = settings.unitMix.find((x) => x.id === u.typeId)!;
              const area = u.duplex?.totalArea ?? u.area;
              if (
                u.duplex?.level !== 'nuit' &&
                area > t.areaMax * (1 + unitAreaTolerance(t)) + 1e-6
              )
                over.push(`${access} ${depth} ${prog} ${u.label} ${area.toFixed(1)}`);
            }
        }
    expect(over).toEqual([]);
  }, 300000);
});
