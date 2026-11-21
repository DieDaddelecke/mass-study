import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  defaultSettings,
  intersection,
  massToSolids,
  polygonArea,
  storeyLayout,
  massLayout,
  massLayouts,
  union,
  type AccessType,
  type Mass,
  type StoreyLayout,
  type Typology,
} from '../src/index.js';
import { mass, referenceProject } from './helpers.js';

const settings = defaultSettings('FR');

function layoutOf(
  t: Typology,
  access: AccessType | 'auto',
  storey = 2,
  over: Partial<Mass> = {},
): StoreyLayout {
  const m = mass(t, { access, ...over });
  const solids = massToSolids(m, settings).filter((s) => s.storeyIndex === storey);
  return storeyLayout(m, solids, settings);
}

function checkPartition(l: StoreyLayout): void {
  const pieces = [
    ...l.units.map((u) => u.polygon),
    ...l.cores.map((c) => c.polygon),
    ...l.circulation.map((c) => c.polygon),
    ...l.open.map((c) => c.polygon),
  ];
  const fp = l.summary.footprintArea;
  const sum = pieces.reduce((s, p) => s + polygonArea(p), 0);
  expect(Math.abs(sum - fp) / fp).toBeLessThan(0.005);
  // no overlaps: area of the union = sum of the areas
  const merged = union(pieces);
  const u = merged.reduce((s, p) => s + polygonArea(p), 0);
  expect(Math.abs(u - sum) / fp).toBeLessThan(0.005);
  // inside the footprint
  const inside = intersection(merged, l.footprints).reduce((s, p) => s + polygonArea(p), 0);
  expect(Math.abs(inside - u) / fp).toBeLessThan(0.005);
}

function mixDeviation(l: StoreyLayout): number {
  const target = l.units.reduce(
    (s, u) => s + settings.unitMix.find((t) => t.id === u.typeId)!.areaTarget,
    0,
  );
  return Math.abs(l.summary.unitArea - target) / target;
}

describe('storeyLayout', () => {
  it('Zweispänner bar 40 × 12 m with 2 cores → 4 units', () => {
    const l = layoutOf({ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner');
    expect(l.cores).toHaveLength(2);
    expect(l.units).toHaveLength(4);
    expect(l.unitsPerCore).toBe(2);
    checkPartition(l);
  });

  it('Dreispänner: 3 units per core', () => {
    const l = layoutOf({ kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner');
    expect(l.cores).toHaveLength(2);
    expect(l.units).toHaveLength(6);
    for (let c = 0; c < 2; c++) expect(l.units.filter((u) => u.coreIndex === c)).toHaveLength(3);
    checkPartition(l);
  });

  it('Laubengang follows the mix within ±5 %', () => {
    const l = layoutOf({ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang');
    expect(l.circulation.some((c) => c.kind === 'gallery')).toBe(true);
    expect(l.units.length).toBeGreaterThan(5);
    expect(mixDeviation(l)).toBeLessThan(0.05);
    checkPartition(l);
  });

  it('Mittelflur follows the mix within ±5 %', () => {
    const l = layoutOf({ kind: 'solitaer', length: 60, depth: 17 }, 'mittelflur');
    expect(l.circulation.some((c) => c.kind === 'corridor')).toBe(true);
    expect(mixDeviation(l)).toBeLessThan(0.05);
    checkPartition(l);
  });

  it('Punkthaus 20 × 20 → 4–6 units around one core', () => {
    const l = layoutOf({ kind: 'solitaer', length: 20, depth: 20 }, 'auto');
    expect(l.access).toBe('punkthaus');
    expect(l.cores).toHaveLength(1);
    expect(l.units.length).toBeGreaterThanOrEqual(4);
    expect(l.units.length).toBeLessThanOrEqual(6);
    checkPartition(l);
  });

  it('Winkel, U-shape, Blockrand and Hofhaus fill the footprint without overlaps', () => {
    for (const id of ['winkel', 'uForm', 'blockrand', 'hofhaus'] as const) {
      const l = layoutOf(TEMPLATES[id](), 'auto');
      expect(l.units.length).toBeGreaterThan(2);
      expect(l.cores.length).toBeGreaterThan(0);
      checkPartition(l);
    }
  });

  it('rotated Zeile, Reihe, courtyard polygon and set-back storey', () => {
    checkPartition(
      layoutOf({ kind: 'zeile', length: 45, depth: 12, sections: 3, sectionOffset: 2 }, 'auto', 1, {
        rotation: 0.4,
        position: [10, -5],
      }),
    );
    const rh = layoutOf(
      { kind: 'reihe', count: 5, unitWidth: 6, depth: 10, alternatingOffset: 0 },
      'auto',
      0,
    );
    expect(rh.units).toHaveLength(5);
    expect(rh.cores).toHaveLength(0);
    const court = layoutOf(
      {
        kind: 'freePolygon',
        polygon: {
          outer: [
            [0, 0],
            [40, 0],
            [40, 30],
            [0, 30],
          ],
          holes: [
            [
              [12, 10],
              [12, 20],
              [28, 20],
              [28, 10],
            ],
          ],
        },
      },
      'auto',
    );
    checkPartition(court);
    const base = mass({ kind: 'solitaer', length: 1, depth: 1 }).storeys;
    const sb = layoutOf({ kind: 'solitaer', length: 40, depth: 13 }, 'zweispaenner', 4, {
      storeys: { ...base, setback: { storeys: 1, distance: 2 } },
    });
    expect(sb.setback).toBe(true);
    checkPartition(sb);
  });

  it('non-residential storeys: cores and one open area', () => {
    const l = layoutOf({ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner', 0, {
      usageByStorey: { 0: 'gewerbe' },
    });
    expect(l.units).toHaveLength(0);
    expect(l.open).toHaveLength(1);
    checkPartition(l);
  });
});

describe('massLayouts', () => {
  it('reference project: per storey and per mass totals plus area-based count', () => {
    const [ml] = massLayouts(referenceProject('FR'));
    expect(ml!.storeys).toHaveLength(5);
    expect(ml!.totals.units).toBe(ml!.storeys.reduce((s, x) => s + x.summary.units, 0));
    expect(ml!.areaBasedDwellings).toBeGreaterThan(0);
    expect(ml!.storeys[1]!.signature).toBe(ml!.storeys[2]!.signature);
  });

  it('terraced houses count once per house', () => {
    const m = mass({ kind: 'reihe', count: 4, unitWidth: 6, depth: 10, alternatingOffset: 0 });
    const ml = massLayout(m, massToSolids(m, settings), settings);
    expect(ml.totals.units).toBe(4);
  });
});
