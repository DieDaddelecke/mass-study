import { describe, expect, it } from 'vitest';
import {
  analyzeMasses,
  defaultSettings,
  massToSolids,
  polygonArea,
  projectLevels,
  storeyFormula,
  storeyLabel,
} from '../src/index.js';
import { mass } from './helpers.js';

const de = defaultSettings('DE');
const fr = defaultSettings('FR');
const solitaer = { kind: 'solitaer' as const, length: 20, depth: 20 };

describe('massToSolids', () => {
  it('creates one solid per storey with stacked levels', () => {
    const s = massToSolids(mass(solitaer), de);
    expect(s.map((x) => x.label)).toEqual(['EG', '1.OG', '2.OG', '3.OG', '4.OG']);
    expect(s.map((x) => x.z0)).toEqual([0, 3.5, 6.5, 9.5, 12.5]);
    expect(s.at(-1)!.z1).toBeCloseTo(15.5);
    expect(s.at(-1)!.top).toBe(true);
  });

  it('adds basements below ±0,00 with parking usage', () => {
    const m = mass(solitaer);
    m.storeys.basement = { count: 2, height: 3 };
    const s = massToSolids(m, fr);
    expect(s.slice(0, 2).map((x) => [x.label, x.z0, x.usage, x.aboveGround])).toEqual([
      ['SS2', -6, 'parken', false],
      ['SS1', -3, 'parken', false],
    ]);
    expect(s[2]!.label).toBe('RDC');
  });

  it('applies height overrides', () => {
    const m = mass(solitaer);
    m.storeys.heightOverrides = [{ index: 1, height: 4 }];
    const s = massToSolids(m, de);
    expect(s.map((x) => x.z0)).toEqual([0, 3.5, 7.5, 10.5, 13.5]);
  });

  it('sets back the top storey uniformly', () => {
    const m = mass(solitaer);
    m.storeys.setback = { storeys: 1, distance: 2 };
    const s = massToSolids(m, de);
    expect(polygonArea(s.at(-1)!.footprint)).toBeCloseTo(16 * 16, 3);
    expect(s.at(-1)!.label).toBe('SG');
    expect(s.at(-1)!.setback).toBe(true);
    expect(polygonArea(s.at(-2)!.footprint)).toBeCloseTo(400, 6);
  });

  it('sets back per side', () => {
    const m = mass(solitaer);
    m.storeys.setback = { storeys: 1, distance: { front: 3, back: 0, left: 1, right: 1 } };
    const s = massToSolids(m, de);
    expect(polygonArea(s.at(-1)!.footprint)).toBeCloseTo(18 * 17, 6);
  });

  it('honours section overrides of a Zeile', () => {
    const m = mass({ kind: 'zeile', length: 36, depth: 12, sections: 3, sectionOffset: 2 });
    m.segmentOverrides = { 1: { upper: { count: 6, height: 3 } } };
    const s = massToSolids(m, de);
    expect(s.filter((x) => x.segment === 0)).toHaveLength(5);
    expect(s.filter((x) => x.segment === 1)).toHaveLength(7);
    // staggered section is shifted by 2 m in y
    const seg1 = s.find((x) => x.segment === 1)!.footprint.outer.map((p) => p[1]);
    expect(Math.min(...seg1)).toBeCloseTo(-4);
  });

  it('uses usage per storey', () => {
    const m = mass(solitaer, { usageByStorey: { 0: 'gewerbe' } });
    const s = massToSolids(m, de);
    expect(s[0]!.usage).toBe('gewerbe');
    expect(s[1]!.usage).toBe('wohnen');
  });

  it('rotates and positions in world coordinates', () => {
    const m = mass(
      { kind: 'zeile', length: 10, depth: 4, sections: 1, sectionOffset: 0 },
      {
        position: [100, 50],
        rotation: Math.PI / 2,
      },
    );
    const fp = massToSolids(m, de)[0]!.footprint.outer;
    const xs = fp.map((p) => p[0]);
    const ys = fp.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(98);
    expect(Math.max(...xs)).toBeCloseTo(102);
    expect(Math.min(...ys)).toBeCloseTo(50);
    expect(Math.max(...ys)).toBeCloseTo(60);
  });
});

describe('labels, formula and levels', () => {
  it('formats storey formulas in three notations', () => {
    const m = mass(solitaer);
    m.storeys.setback = { storeys: 1, distance: 2 };
    m.storeys.basement.count = 1;
    expect(storeyFormula(m.storeys, 'fr')).toBe('SS+R+3+C');
    expect(storeyFormula(m.storeys, 'de')).toBe('UG + EG + 3 OG + SG');
    expect(storeyFormula(m.storeys, 'roman')).toBe('IV + S');
    expect(storeyLabel(2, 'roman', false)).toBe('III');
  });

  it('merges levels of several masses within tolerance', () => {
    const a = mass(solitaer, { id: 'a' });
    const b = mass(solitaer, { id: 'b', position: [50, 0] });
    b.storeys.ground.height = 3.52; // within 5 cm
    b.storeys.upper.count = 1;
    const solids = [...massToSolids(a, fr), ...massToSolids(b, fr)];
    const levels = projectLevels(solids, fr);
    expect(levels.map((l) => l.name)).toEqual(['RDC', 'R+1', 'R+2', 'R+3', 'R+4']);
    expect(levels[1]!.elevation).toBeCloseTo(3.51, 3);
  });

  it('names mixed levels by elevation', () => {
    const a = mass(solitaer, { id: 'a' });
    const b = mass(solitaer, { id: 'b', position: [50, 0] });
    b.storeys.basement.count = 1;
    b.storeys.basement.height = 3.5;
    b.storeys.ground.height = 4;
    const levels = projectLevels([...massToSolids(a, de), ...massToSolids(b, de)], de);
    expect(levels.map((l) => l.name)).toContain('Ebene +4,00');
    expect(levels[0]!.name).toBe('UG');
  });
});

describe('Vollgeschoss rule (DE)', () => {
  const withSetbackRatio = (ratio: number) => {
    const m = mass({ kind: 'solitaer', length: 20, depth: 10 });
    m.storeys.setback = {
      storeys: 1,
      distance: { front: 0, back: 10 * (1 - ratio), left: 0, right: 0 },
    };
    return analyzeMasses([m], de).masses[0]!;
  };

  it('setback storey with 60 % of the area below is not a full storey', () => {
    expect(withSetbackRatio(0.6).fullStoreys).toBe(4);
  });

  it('setback storey with 70 % of the area below is a full storey', () => {
    expect(withSetbackRatio(0.7).fullStoreys).toBe(5);
  });

  it('a low storey (clear height < 2.30 m) is not a full storey', () => {
    const m = mass(solitaer);
    m.storeys.heightOverrides = [{ index: 4, height: 2.5 }];
    expect(analyzeMasses([m], de).masses[0]!.fullStoreys).toBe(4);
  });
});
