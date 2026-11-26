import { describe, expect, it } from 'vitest';
import {
  analyzeMasses,
  analyzeProject,
  defaultSettings,
  massLayouts,
  ringCentroid,
  type AccessType,
  type Mass,
  type StoreyLayout,
} from '../src/index.js';
import { mass, referenceProject } from './helpers.js';

// Soheyl 26.11.2026: the tronçons of a Zeile are its stair cores, and the cores keep their place
// and number on every storey, the attique included
const settings = defaultSettings('FR');
const centres = (st: StoreyLayout) =>
  st.cores
    .map((c) =>
      ringCentroid(c.polygon.outer)
        .map((v) => v.toFixed(2))
        .join(','),
    )
    .sort();
const layoutOf = (m: Mass) => massLayouts(analyzeMasses([m], settings), settings)[0]!;

const ACCESS: AccessType[] = [
  'zweispaenner',
  'dreispaenner',
  'vierspaenner',
  'laubengang',
  'mittelflur',
];

describe('tronçons = stair cores', () => {
  for (const access of ACCESS)
    for (const sections of [2, 3, 4])
      it(`${access}: ${sections} tronçons give ${sections} cores on every storey`, () => {
        const m = mass(
          { kind: 'zeile', length: 67.48, depth: 14, sections, sectionOffset: 0 },
          { access },
        );
        const l = layoutOf(m);
        for (const st of l.storeys) expect(st.cores).toHaveLength(sections);
      });

  it('staggered tronçons: one core in each', () => {
    const m = mass(
      { kind: 'zeile', length: 60, depth: 13, sections: 3, sectionOffset: 4 },
      { access: 'laubengang' },
    );
    const l = layoutOf(m);
    const st = l.storeys[1]!;
    expect(st.cores).toHaveLength(3);
    const xs = st.cores.map((c) => ringCentroid(c.polygon.outer)[0]).sort((a, b) => a - b);
    xs.forEach((x, i) => {
      expect(x).toBeGreaterThan(i * 20);
      expect(x).toBeLessThan((i + 1) * 20);
    });
  });

  it('too few tronçons for the escape distance: warning', () => {
    const p = referenceProject('FR');
    const m = p.variants[0]!.masses[0]!;
    m.typology = { kind: 'zeile', length: 90, depth: 13, sections: 1, sectionOffset: 0 };
    const w = analyzeProject(p).warnings.find((x) => x.code === 'tronconsEscape');
    expect(w?.data).toEqual({ actual: 1, required: 2 });
    m.typology.sections = 2;
    expect(analyzeProject(p).warnings.some((x) => x.code === 'tronconsEscape')).toBe(false);
  });
});

describe('stair cores stay in place on the attique', () => {
  for (const access of ACCESS)
    for (const sections of [1, 2, 3])
      for (const distance of [2, 3])
        it(`Zeile ${access}, ${sections} tronçon(s), attique set back ${distance} m`, () => {
          const m = mass(
            { kind: 'zeile', length: 67.48, depth: 14, sections, sectionOffset: 0 },
            { access },
          );
          m.storeys.setback = { storeys: 1, distance };
          const l = layoutOf(m);
          const ref = centres(l.storeys[1]!);
          const attique = l.storeys.at(-1)!;
          expect(attique.setback).toBe(true);
          expect(attique.units.length).toBeGreaterThan(0);
          for (const st of l.storeys) expect(centres(st)).toEqual(ref);
        });

  for (const access of [...ACCESS, 'auto'] as const)
    it(`L-shaped building ${access}: attique keeps the cores`, () => {
      const m = mass(
        {
          kind: 'freeLine',
          points: [
            [0, 0],
            [45, 0],
            [45, 35],
          ],
          closed: false,
          depth: 13,
          alignment: 'center',
        },
        { access },
      );
      m.storeys.setback = { storeys: 1, distance: { front: 2, back: 0, left: 3, right: 0 } };
      const l = layoutOf(m);
      const ref = centres(l.storeys[1]!);
      for (const st of l.storeys) expect(centres(st)).toEqual(ref);
    });

  it('terraced storeys keep the cores of the Regelgeschoss', () => {
    const m = mass(
      { kind: 'zeile', length: 50, depth: 13, sections: 2, sectionOffset: 0 },
      { access: 'dreispaenner' },
    );
    m.storeys.terraces = [{ fromStorey: 3, distance: { front: 2, back: 0, left: 4, right: 0 } }];
    const l = layoutOf(m);
    const ref = centres(l.storeys[0]!);
    for (const st of l.storeys) expect(centres(st)).toEqual(ref);
  });
});
