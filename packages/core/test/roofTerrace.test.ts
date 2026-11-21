import { describe, expect, it } from 'vitest';
import {
  analyzeMass,
  defaultSettings,
  greenKpis,
  massRoofPieces,
  massToSolids,
  polygonArea,
  rect,
  roofTop,
  roofVolume,
  roofZ,
  zoneTrees,
  analyzeMasses,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const box = { kind: 'solitaer', length: 20, depth: 10 } as const;

describe('terraces', () => {
  it('sets storeys back step by step from the full footprint', () => {
    const m = mass(box);
    m.storeys.upper.count = 4;
    m.storeys.terraces = [
      { fromStorey: 2, distance: { front: 2, back: 0, left: 0, right: 0 } },
      { fromStorey: 4, distance: { front: 4, back: 0, left: 0, right: 0 } },
    ];
    const area = (i: number) =>
      massToSolids(m, settings)
        .filter((s) => s.storeyIndex === i)
        .reduce((a, s) => a + polygonArea(s.footprint), 0);
    expect(area(1)).toBeCloseTo(200);
    expect(area(2)).toBeCloseTo(160);
    expect(area(3)).toBeCloseTo(160);
    expect(area(4)).toBeCloseTo(120);
  });

  it('combines with the attique (both from the full footprint)', () => {
    const m = mass(box);
    m.storeys.upper.count = 3;
    m.storeys.terraces = [{ fromStorey: 2, distance: { front: 3, back: 0, left: 0, right: 0 } }];
    m.storeys.setback = { storeys: 1, distance: { front: 0, back: 2, left: 0, right: 0 } };
    const top = massToSolids(m, settings).filter((s) => s.storeyIndex === 3);
    expect(top.reduce((a, s) => a + polygonArea(s.footprint), 0)).toBeCloseTo(20 * 5);
  });
});

describe('pitched roofs', () => {
  it('gable: ridge in the middle, two faces, eaves at slab height', () => {
    const m = mass(box);
    m.storeys.upper.count = 2;
    m.roof = { kind: 'gable', pitch: 45, ridge: 'length' };
    const solids = massToSolids(m, settings);
    const pieces = massRoofPieces(m, solids);
    expect(pieces).toHaveLength(2);
    const slab = Math.max(...solids.map((s) => s.z1));
    expect(roofTop(pieces)).toBeCloseTo(slab + 5);
    for (const p of pieces) {
      expect(polygonArea(p.polygon)).toBeCloseTo(100);
      // one seam (the ridge) per face
      expect(p.seams.filter(Boolean)).toHaveLength(1);
      expect(Math.min(...p.polygon.outer.map((q) => roofZ(p, q)))).toBeCloseTo(slab);
    }
    // prism with a triangular cross section: 20 · 10 · 5 / 2
    expect(roofVolume(pieces)).toBeCloseTo(500);
  });

  it('hip: four faces, ridge at half the depth; rotated masses keep their frame', () => {
    const m = mass(box, { rotation: 0.7, position: [30, -12] });
    m.roof = { kind: 'hip', pitch: 30, ridge: 'length' };
    const solids = massToSolids(m, settings);
    const pieces = massRoofPieces(m, solids);
    expect(pieces).toHaveLength(4);
    const slab = Math.max(...solids.map((s) => s.z1));
    expect(roofTop(pieces) - slab).toBeCloseTo(5 * Math.tan(Math.PI / 6));
    expect(pieces.reduce((a, p) => a + polygonArea(p.polygon), 0)).toBeCloseTo(200);
  });

  it('shed and analysis: no parapet, total height = ridge', () => {
    const m = mass(box);
    m.roof = { kind: 'shed', pitch: 10, ridge: 'length' };
    const r = analyzeMass(m, settings);
    expect(r.ridgeHeight).toBeCloseTo(r.eavesHeight + 10 * Math.tan(Math.PI / 18));
    expect(r.totalHeight).toBeCloseTo(r.ridgeHeight);
    expect(r.roofs).toHaveLength(1);
  });
});

describe('vegetation zones', () => {
  it('counts open ground without footprints above and below ground', () => {
    const m = mass(box);
    m.storeys.basement.count = 1;
    const result = analyzeMasses([m], settings);
    const site = rect(-50, -50, 50, 50);
    const g = greenKpis(
      [
        { id: 'a', name: 'A', kind: 'pleineTerre', polygon: rect(-30, -30, 30, 30) },
        { id: 'b', name: 'B', kind: 'surDalle', polygon: rect(40, 40, 60, 60) },
      ],
      site,
      result,
    );
    expect(g.pleineTerre).toBeCloseTo(3600 - 200);
    expect(g.espacesVerts).toBeCloseTo(3600 - 200 + 100);
    expect(g.pleineTerreRatio).toBeCloseTo(3400 / 10000);
  });

  it('plants trees on a grid inside the zone', () => {
    const t = zoneTrees({
      id: 'z',
      name: 'Z',
      kind: 'boise',
      polygon: rect(0, 0, 30, 20),
      treeSpacing: 6,
    });
    expect(t.length).toBeGreaterThan(8);
    for (const p of t) {
      expect(p[0]).toBeGreaterThan(0);
      expect(p[1]).toBeLessThan(20);
    }
  });
});
