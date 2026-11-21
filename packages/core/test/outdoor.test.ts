import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  facadeSide,
  intersection,
  massToSolids,
  placeOutdoor,
  polygonArea,
  rect,
  storeyLayout,
  union,
  DEFAULT_OUTDOOR_RULES,
  type AccessType,
  type Mass,
  type StoreyLayout,
  type Typology,
} from '../src/index.js';
import { mass } from './helpers.js';

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

describe('outdoor spaces', () => {
  it('orients façades by their outward normal', () => {
    const u = rect(0, 0, 10, 8);
    expect(
      facadeSide(
        [
          [0, 0],
          [10, 0],
        ],
        u,
      ),
    ).toBe('S');
    expect(
      facadeSide(
        [
          [10, 0],
          [10, 8],
        ],
        u,
      ),
    ).toBe('E');
    expect(
      facadeSide(
        [
          [0, 8],
          [10, 8],
        ],
        u,
      ),
    ).toBe('N');
    expect(
      facadeSide(
        [
          [0, 0],
          [0, 8],
        ],
        u,
      ),
    ).toBe('W');
  });

  it('puts a balcony in front of the séjour, outside the dwelling', () => {
    const unit = rect(0, 0, 10, 8);
    const sejour = rect(2, 0, 6.6, 5);
    const o = placeOutdoor(
      unit,
      sejour,
      [
        [
          [0, 0],
          [10, 0],
        ],
      ],
      { kind: 'balcon', depth: 1.6, groundTerrace: true },
      DEFAULT_OUTDOOR_RULES,
      false,
    )!;
    expect(o.kind).toBe('balcon');
    expect(o.position).toBe('front');
    expect(o.ok).toBe(true);
    expect(o.area).toBeCloseTo(4.6 * 1.6, 3);
    expect(intersection([o.polygon], [unit]).length).toBe(0);
  });

  it('raises the depth to the minimum and cuts loggias into the dwelling', () => {
    const unit = rect(0, 0, 10, 8);
    const o = placeOutdoor(
      unit,
      rect(2, 0, 6.6, 5),
      [
        [
          [0, 0],
          [10, 0],
        ],
      ],
      { kind: 'loggia', depth: 1.2, groundTerrace: true },
      DEFAULT_OUTDOOR_RULES,
      false,
    )!;
    expect(o.depth).toBeCloseTo(1.8);
    const inside = intersection([o.polygon], [unit]).reduce((s, p) => s + polygonArea(p), 0);
    expect(inside).toBeCloseTo(o.area, 3);
  });

  it('attaches the outdoor space next to the séjour when its façade has none', () => {
    const unit = rect(0, 0, 10, 8);
    // séjour on the south façade, outdoor spaces only on the east side
    const o = placeOutdoor(
      unit,
      rect(5.6, 0, 9.9, 5), // 10 cm from the east façade
      [
        [
          [0, 0],
          [10, 0],
        ],
        [
          [10, 0],
          [10, 8],
        ],
      ],
      {
        kind: 'none',
        depth: 1.6,
        groundTerrace: false,
        sides: { E: { kind: 'balcon', depth: 1.6 } },
      },
      DEFAULT_OUTDOOR_RULES,
      false,
    )!;
    expect(o.side).toBe('E');
    expect(o.position).toBe('side');
    expect(o.ok).toBe(true);
  });

  for (const [t, access] of [
    [{ kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner'],
    [{ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang'],
    [{ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner'],
    [{ kind: 'solitaer', length: 60, depth: 17 }, 'mittelflur'],
  ] as [Typology, AccessType][])
    it(`gives every dwelling of a ${access} storey a balcony at the séjour`, () => {
      const l = layoutOf(t, access);
      const out = l.units.map((u) => u.outdoor);
      expect(out.every((o) => o && o.kind === 'balcon')).toBe(true);
      expect(out.filter((o) => o!.ok).length).toBe(out.length);
      expect(out.filter((o) => o!.position === 'front').length / out.length).toBeGreaterThan(0.8);
      // disjoint and outside the footprint
      const polys = out.map((o) => o!.polygon);
      const sum = polys.reduce((s, p) => s + polygonArea(p), 0);
      expect(union(polys).reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(sum, 1);
      expect(
        intersection(polys, l.footprints).reduce((s, p) => s + polygonArea(p), 0),
      ).toBeLessThan(0.01);
    });

  it('ground floor: terraces; per-side kinds; none', () => {
    const t: Typology = { kind: 'solitaer', length: 40, depth: 12 };
    const gf = layoutOf(t, 'zweispaenner', 0);
    expect(gf.units.every((u) => u.outdoor?.kind === 'terrasse')).toBe(true);
    const lo = layoutOf(t, 'zweispaenner', 2, {
      outdoor: { kind: 'loggia', depth: 2, groundTerrace: true },
    });
    for (const u of lo.units) {
      expect(u.outdoor?.kind).toBe('loggia');
      const s = u.rooms.find((r) => r.kind === 'sejour')!;
      expect(
        intersection([s.polygon], [u.outdoor!.polygon]).reduce((a, p) => a + polygonArea(p), 0),
      ).toBeLessThan(0.01);
    }
    const none = layoutOf(t, 'zweispaenner', 2, {
      outdoor: { kind: 'none', depth: 1.6, groundTerrace: true },
    });
    expect(none.units.every((u) => !u.outdoor)).toBe(true);
    const south = layoutOf(t, 'zweispaenner', 2, {
      outdoor: {
        kind: 'none',
        depth: 1.6,
        groundTerrace: true,
        sides: { S: { kind: 'balcon', depth: 1.6 } },
      },
    });
    expect(south.units.every((u) => u.outdoor?.side === 'S')).toBe(true);
  });
});
