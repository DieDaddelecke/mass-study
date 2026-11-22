import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STAIR_RULES,
  coreStair,
  defaultSettings,
  difference,
  flightProfile,
  layoutStairs,
  massLayout,
  massToSolids,
  polygonArea,
  union,
  type Polygon,
  type Typology,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');

function layoutsOf(t: Typology, access: 'auto' | 'zweispaenner' | 'dreispaenner' = 'auto') {
  const m = mass(t, { access });
  return [massLayout(m, massToSolids(m, settings), settings)];
}

const inside = (p: Polygon, outer: Polygon) =>
  polygonArea(p) > 0 && difference([p], [outer]).reduce((s, q) => s + polygonArea(q), 0) < 1e-4;

describe('stairs in the cores', () => {
  it('flight profile: closed, steps on top, risers ≤ rule', () => {
    const p = flightProfile(8, 0.167, 0.28, 0.18);
    expect(p[0]).toEqual([0, 0]);
    // top step at 8 × riser
    expect(Math.max(...p.map((q) => q[1]))).toBeCloseTo(8 * 0.167);
    // counter-clockwise (positive signed area)
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i]!;
      const [x1, y1] = p[(i + 1) % p.length]!;
      a += x0 * y1 - x1 * y0;
    }
    expect(a).toBeGreaterThan(0);
  });

  it('Zweispänner bar: one stair per core and storey, none on the top storey', () => {
    const layouts = layoutsOf(
      { kind: 'zeile', length: 40, depth: 12, sections: 1, sectionOffset: 0 },
      'zweispaenner',
    );
    const stairs = layoutStairs(layouts, settings);
    const m = layouts[0]!;
    const top = Math.max(...m.storeys.map((s) => s.storeyIndex));
    for (const st of m.storeys) {
      const list = stairs.get(`${m.massId}#${st.storeyIndex}`) ?? [];
      if (st.storeyIndex === top) expect(list).toHaveLength(0);
      else expect(list).toHaveLength(st.cores.length);
      for (const s of list) {
        const core = st.cores[s.coreIndex]!;
        expect(s.fits).toBe(true);
        expect(s.riser).toBeLessThanOrEqual(DEFAULT_STAIR_RULES.maxRiser + 1e-9);
        expect(s.going).toBeGreaterThanOrEqual(0.28 - 1e-9);
        expect(s.flights).toHaveLength(2);
        expect(s.z1 - s.z0).toBeCloseTo(st.z1 - st.z0);
        // flights rise from the floor to the landing and on to the floor above
        expect(s.flights[0]!.z0).toBeCloseTo(st.z0);
        expect(s.flights[1]!.z1).toBeCloseTo(st.z1);
        expect(s.flights[0]!.z1).toBeCloseTo(s.landings[0]!.z);
        // everything stays inside the core and does not overlap
        const parts = [
          ...s.flights.map((f) => f.polygon),
          ...s.landings.map((l) => l.polygon),
          ...(s.lift ? [s.lift] : []),
        ];
        for (const p of parts) expect(inside(p, core.polygon)).toBe(true);
        const sum = parts.reduce((a, p) => a + polygonArea(p), 0);
        const uni = union(parts).reduce((a, p) => a + polygonArea(p), 0);
        expect(sum - uni).toBeLessThan(1e-4);
        // default 5.5 × 6 m core holds the lift too
        expect(s.lift).toBeDefined();
      }
    }
  });

  it.each([
    ['punkthaus', { kind: 'solitaer', length: 20, depth: 20 }, 'auto'],
    ['dreispaenner', { kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner'],
    ['laubengang', { kind: 'solitaer', length: 60, depth: 10 }, 'laubengang'],
    ['mittelflur', { kind: 'solitaer', length: 60, depth: 17 }, 'mittelflur'],
    [
      'L-shape',
      {
        kind: 'freeLine',
        points: [
          [0, 0],
          [40, 0],
          [40, 30],
        ],
        closed: false,
        depth: 12,
        alignment: 'center',
      },
      'auto',
    ],
  ] as const)('%s: flights opposite, `side` right-handed, inside the core', (_n, t, acc) => {
    const layouts = layoutsOf(t as unknown as Typology, acc as 'auto');
    const all = [...layoutStairs(layouts, settings).values()].flat();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      const [a, b] = s.flights;
      expect(a!.dir[0] * b!.dir[0] + a!.dir[1] * b!.dir[1]).toBeCloseTo(-1);
      for (const f of s.flights) {
        expect(f.side[0]).toBeCloseTo(f.dir[1]);
        expect(f.side[1]).toBeCloseTo(-f.dir[0]);
        expect(f.treads).toHaveLength(f.risers - 1);
        expect(inside(f.polygon, s.outline)).toBe(true);
      }
    }
  });

  it('a too small core compresses the stair and flags it', () => {
    const core: Polygon = {
      outer: [
        [0, 0],
        [3, 0],
        [3, 3.5],
        [0, 3.5],
      ],
    };
    const s = coreStair(
      { polygon: core, box: { o: [0, 0], u: [1, 0], n: [0, 1], w: 3, d: 3.5 }, index: 0 },
      0,
      3,
    )!;
    expect(s.fits).toBe(false);
    expect(s.lift).toBeUndefined();
    for (const f of s.flights) expect(inside(f.polygon, core)).toBe(true);
  });
});

describe('cores stack through a commercial ground floor', () => {
  it('RDC commerce takes the cores of the dwellings above, so the stair starts at RDC', () => {
    const m = mass(
      { kind: 'solitaer', length: 50, depth: 14 },
      { access: 'dreispaenner', usageByStorey: { 0: 'gewerbe' } },
    );
    const l = massLayout(m, massToSolids(m, settings), settings);
    const rdc = l.storeys.find((s) => s.storeyIndex === 0)!;
    const r1 = l.storeys.find((s) => s.storeyIndex === 1)!;
    expect(rdc.units).toHaveLength(0);
    expect(rdc.cores.length).toBe(r1.cores.length);
    const stairs = layoutStairs([l], settings);
    expect(stairs.get(`${m.id}#0`)?.length).toBe(rdc.cores.length);
    // open area + cores still cover the RDC footprint
    const covered = [...rdc.cores, ...rdc.open, ...rdc.circulation].reduce((a, x) => a + x.area, 0);
    const fp = rdc.footprints.reduce((a, p) => a + polygonArea(p), 0);
    expect(covered).toBeCloseTo(fp, 1);
  });
});
