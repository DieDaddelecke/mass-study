import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  defaultTypology,
  massDepth,
  massFootprints,
  polygonArea,
  polygonsArea,
  rect,
  typologySegments,
} from '../src/index.js';
import { mass } from './helpers.js';

describe('typology generators', () => {
  it('Solitär is centred', () => {
    const [s] = typologySegments({ kind: 'solitaer', length: 20, depth: 16 });
    expect(polygonArea(s!.local)).toBe(320);
    expect(s!.depth).toBe(16);
    expect(s!.local.outer[0]).toEqual([-10, -8]);
  });

  it('Zeile is split into staggered sections', () => {
    const segs = typologySegments({
      kind: 'zeile',
      length: 45,
      depth: 12,
      sections: 3,
      sectionOffset: 1.5,
    });
    expect(segs.map((s) => s.segment)).toEqual([0, 1, 2]);
    expect(segs.map((s) => polygonArea(s.local))).toEqual([180, 180, 180]);
    expect(segs[1]!.local.outer[0]).toEqual([15, -4.5]);
  });

  it('Reihe with wider end houses and alternating offset', () => {
    const segs = typologySegments({
      kind: 'reihe',
      count: 4,
      unitWidth: 6,
      depth: 10,
      alternatingOffset: 1,
      endUnitWidth: 7,
    });
    expect(segs.map((s) => s.length)).toEqual([7, 6, 6, 7]);
    expect(segs[3]!.local.outer[1]).toEqual([26, -4]);
    expect(segs[1]!.local.outer[0]![1]).toBe(-4);
  });

  it('Freiform polygon: rectangle depth = shorter side, other shapes = 2 × inradius', () => {
    expect(
      typologySegments({ kind: 'freePolygon', polygon: rect(0, 0, 30, 14) })[0]!.depth,
    ).toBeCloseTo(14);
    const l = {
      outer: [
        [0, 0],
        [30, 0],
        [30, 10],
        [10, 10],
        [10, 30],
        [0, 30],
      ] as [number, number][],
    };
    const d = typologySegments({ kind: 'freePolygon', polygon: l })[0]!.depth;
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(15);
  });

  it('Freiform line uses its depth parameter', () => {
    const t = defaultTypology('freeLine');
    expect(massDepth(t)).toBe(12);
    expect(polygonsArea(typologySegments(t).map((s) => s.local))).toBeCloseTo(360, 4);
  });

  it('defaults exist for every typology', () => {
    for (const k of ['solitaer', 'zeile', 'reihe', 'freeLine', 'freePolygon'] as const) {
      expect(typologySegments(defaultTypology(k)).length).toBeGreaterThan(0);
    }
  });

  it('templates produce valid footprints (Blockrand / Hofhaus with courtyard)', () => {
    expect(polygonsArea(massFootprints(mass(TEMPLATES.winkel())))).toBeGreaterThan(700);
    expect(polygonsArea(massFootprints(mass(TEMPLATES.uForm())))).toBeGreaterThan(1000);
    const block = massFootprints(mass(TEMPLATES.blockrand()));
    expect(block[0]!.holes).toHaveLength(1);
    expect(polygonArea(block[0]!)).toBeCloseTo((60 + 13) * (50 + 13) - (60 - 13) * (50 - 13), 3);
    expect(massFootprints(mass(TEMPLATES.hofhaus()))[0]!.holes).toHaveLength(1);
  });
});
