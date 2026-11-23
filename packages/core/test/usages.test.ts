import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  massLayout,
  massToSolids,
  overlapArea,
  polygonArea,
  type Mass,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const layoutOf = (m: Mass) => massLayout(m, massToSolids(m, settings), settings);

describe('residence', () => {
  it('lays out studios, PMR, corners, shafts and common rooms', () => {
    const m = mass({ kind: 'solitaer', length: 48, depth: 14 }, { usage: 'wohnheim' });
    const l = layoutOf(m);
    const up = l.storeys[1]!;
    expect(up.units.length).toBeGreaterThan(20);
    expect(up.summary.byType.find((t) => t.typeId === 'rs-pmr')?.count).toBeGreaterThanOrEqual(1);
    expect(up.summary.byType.find((t) => t.typeId === 'rs-corner')?.count).toBeGreaterThanOrEqual(
      2,
    );
    expect(l.storeys[0]!.residence!.commonArea).toBeGreaterThan(59);
    // no overlap between units
    for (const [i, a] of up.units.entries())
      for (const b of up.units.slice(i + 1))
        expect(overlapArea([a.polygon], [b.polygon])).toBeLessThan(0.01);
    const s = up.units.find((u) => u.typeId === 'rs-studio')!;
    // studio: main room on the façade, entrée + salle d'eau behind, kitchenette drawn inside
    expect(s.rooms.map((r) => r.kind)).toEqual(['sejour']);
    expect(s.spaces!.map((x) => x.kind).sort()).toEqual(['entree', 'kitchenette', 'sde']);
    expect(s.area).toBeGreaterThan(17);
    expect(s.area).toBeLessThan(24);
    // one shaft per mirrored pair of studios
    const shafts = up.spaces!.filter((x) => x.kind === 'gaine').length;
    expect(shafts).toBeLessThanOrEqual(Math.ceil(up.units.length / 2) + 4);
  });
});

describe('office', () => {
  for (const layout of ['openSpace', 'cellulaire', 'mixte'] as const)
    it(`plateau ${layout}`, () => {
      const m = mass({ kind: 'solitaer', length: 54, depth: 13.5 }, { usage: 'buero' });
      m.office = { layout };
      const l = layoutOf(m);
      for (const st of [l.storeys[0]!, l.storeys[1]!]) {
        const all = [
          ...st.cores.map((c) => c.polygon),
          ...st.circulation.map((c) => c.polygon),
          ...st.spaces!.map((s) => s.polygon),
        ];
        const sum = all.reduce((a, p) => a + polygonArea(p), 0);
        expect(sum).toBeLessThanOrEqual(st.summary.footprintArea + 0.5);
        for (const [i, a] of all.entries())
          for (const b of all.slice(i + 1)) expect(overlapArea([a], [b])).toBeLessThan(0.05);
      }
      expect(l.storeys[1]!.office!.desks).toBeGreaterThan(30);
    });
});
