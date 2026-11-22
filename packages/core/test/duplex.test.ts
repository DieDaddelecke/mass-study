import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  duplexMix,
  massLayout,
  massToSolids,
  polygonArea,
  requiredFacade,
  roomsFit,
  type AccessType,
  type DuplexConfig,
  type Mass,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const ON: DuplexConfig = { enabled: true, fromStorey: 3, entry: 'lower' };

function building(access: AccessType, duplex?: Partial<DuplexConfig>, depth = 11): Mass {
  const m = mass({ kind: 'solitaer', length: 48, depth }, { access });
  m.storeys.upper.count = 6;
  if (duplex) m.duplex = { ...ON, ...duplex };
  return m;
}
const layoutOf = (m: Mass) => massLayout(m, massToSolids(m, settings), settings);

describe('duplex rules', () => {
  it('façade per level: séjour + PMR on the entrance level, further bedrooms upstairs', () => {
    const [t3, t4, t5] = duplexMix(settings.unitMix, ['t3', 't4', 't5']).filter((t) => t.duplex);
    // jour level 3.60 + 0.10 + 2.80 = 6.50; T5 nuit level 3 × 2.50 + 2 × 0.10 = 7.70
    expect(requiredFacade(t3!)).toBeCloseTo(6.5);
    expect(requiredFacade(t4!)).toBeCloseTo(6.5);
    expect(requiredFacade(t5!)).toBeCloseTo(7.7);
    expect(roomsFit(t4!, [6.6])).toBe(true);
    expect(roomsFit(t5!, [6.6])).toBe(false);
  });

  it('duplex mix: duplex level = half area + half stair; simplex types half share', () => {
    const mix = duplexMix(settings.unitMix, ['t4']);
    const d = mix.find((t) => t.id === 't4' && t.duplex)!;
    expect(d.areaTarget).toBeCloseTo(82 / 2 + 2);
    expect(mix.find((t) => t.id === 't2')!.share).toBeCloseTo(0.15);
    // a simplex T4 stays available for dwellings too large for a duplex level
    expect(mix.some((t) => t.id === 't4' && !t.duplex)).toBe(true);
  });
});

describe('duplex layout', () => {
  it('off by default: no duplex', () => {
    const ml = layoutOf(building('laubengang'));
    expect(ml.storeys.some((s) => s.units.some((u) => u.duplex))).toBe(false);
  });

  for (const access of ['laubengang', 'mittelflur'] as AccessType[])
    it(`${access}: pairs R+3/R+4 and R+5/R+6, entrance on the séjour level`, () => {
      const ml = layoutOf(building(access, {}, access === 'mittelflur' ? 13 : 11));
      const at = (i: number) => ml.storeys.find((s) => s.storeyIndex === i)!;
      for (const i of [0, 1, 2]) expect(at(i).units.some((u) => u.duplex)).toBe(false);
      for (const [lo, hi] of [
        [3, 4],
        [5, 6],
      ] as const) {
        const L = at(lo).units.filter((u) => u.duplex);
        const U = at(hi).units.filter((u) => u.duplex);
        expect(L.length).toBeGreaterThan(0);
        expect(U).toHaveLength(L.length);
        for (const u of L) {
          expect(u.duplex!.level).toBe('jour');
          expect(u.duplex!.part).toBe('lower');
          expect(u.duplex!.storeys).toEqual([lo, hi]);
          expect(u.rooms.map((r) => r.kind)).toEqual(['sejour', 'chambrePmr']);
          expect(u.facadeOk).toBe(true);
          // same polygon on both levels, total = both levels
          const v = U.find(
            (x) => Math.abs(polygonArea(x.polygon) - polygonArea(u.polygon)) < 1e-6,
          )!;
          expect(v.duplex!.level).toBe('nuit');
          expect(v.rooms.every((r) => r.kind === 'chambre')).toBe(true);
          expect(v.outdoor).toBeUndefined();
          expect(u.duplex!.totalArea).toBeCloseTo(u.area + v.area);
          expect(u.duplex!.stair).toBeDefined();
          expect(polygonArea(u.duplex!.stair!)).toBeCloseTo(2.6);
        }
      }
      // a duplex counts once: on its entrance level
      const nuit = at(4).units.filter((u) => u.duplex?.level === 'nuit').length;
      expect(at(4).summary.units).toBe(at(4).units.length - nuit);
      const dpx = ml.totals.byType.reduce((s, b) => s + (b.duplex ?? 0), 0);
      const jour = ml.storeys.reduce(
        (s, st) => s + st.units.filter((u) => u.duplex?.level === 'jour').length,
        0,
      );
      expect(dpx).toBe(jour);
      expect(ml.totals.units).toBe(ml.storeys.reduce((s, st) => s + st.summary.units, 0));
    });

  it('duplex descendant: entrance and séjour on the upper level', () => {
    const ml = layoutOf(building('laubengang', { entry: 'upper' }));
    const lo = ml.storeys.find((s) => s.storeyIndex === 3)!.units.filter((u) => u.duplex);
    const hi = ml.storeys.find((s) => s.storeyIndex === 4)!.units.filter((u) => u.duplex);
    expect(lo.every((u) => u.duplex!.level === 'nuit')).toBe(true);
    expect(hi.every((u) => u.duplex!.level === 'jour' && u.duplex!.part === 'upper')).toBe(true);
    expect(hi.every((u) => u.rooms[0]?.kind === 'sejour')).toBe(true);
  });

  it('cores stay where they are on the duplex storeys (Zweispänner, Dreispänner)', () => {
    for (const access of ['zweispaenner', 'dreispaenner'] as AccessType[]) {
      const ml = layoutOf(building(access, {}, 13));
      const key = (i: number) =>
        ml.storeys
          .find((s) => s.storeyIndex === i)!
          .cores.map((c) =>
            c.polygon.outer.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(';'),
          )
          .join('|');
      for (const i of [3, 4, 5, 6]) expect(key(i)).toBe(key(2));
    }
  });

  it('from R+5 only: one pair; the top storey alone stays simplex', () => {
    const ml = layoutOf(building('laubengang', { fromStorey: 5 }));
    const has = (i: number) =>
      ml.storeys.find((s) => s.storeyIndex === i)!.units.some((u) => u.duplex);
    expect([3, 4].map(has)).toEqual([false, false]);
    expect([5, 6].map(has)).toEqual([true, true]);
    const ml2 = layoutOf(building('laubengang', { fromStorey: 6 }));
    expect(ml2.storeys.some((s) => s.units.some((u) => u.duplex))).toBe(false);
  });
});
