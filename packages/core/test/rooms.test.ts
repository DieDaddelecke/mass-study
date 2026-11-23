import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  intersection,
  massToSolids,
  polygonArea,
  rect,
  resolveUnitRules,
  roomProgram,
  storeyLayout,
  union,
  unitRoomLayout,
  unitRooms,
  isFacadeRoom,
  type AccessType,
  type StoreyLayout,
  type Typology,
} from '../src/index.js';
import { mass } from './helpers.js';

const settings = defaultSettings('FR');
const rules = resolveUnitRules(settings);

function layoutOf(t: Typology, access: AccessType | 'auto', storey = 2): StoreyLayout {
  const m = mass(t, { access });
  const solids = massToSolids(m, settings).filter((s) => s.storeyIndex === storey);
  return storeyLayout(m, solids, settings);
}

const area = (ps: { polygon: Parameters<typeof polygonArea>[0] }[]) =>
  ps.reduce((s, p) => s + polygonArea(p.polygon), 0);

describe('rooms of a dwelling', () => {
  it('program follows the office rules', () => {
    expect(roomProgram(1, rules).map((r) => r.kind)).toEqual(['sejour']);
    expect(roomProgram(4, rules).map((r) => [r.kind, r.min])).toEqual([
      ['sejour', 3.6],
      ['chambrePmr', 2.8],
      ['chambre', 2.5],
      ['chambre', 2.5],
    ]);
  });

  it('places rooms along one façade with partitions', () => {
    const unit = rect(0, 0, 12, 10);
    const rooms = unitRoomLayout(
      unit,
      [
        [
          [0, 0],
          [12, 0],
        ],
      ],
      4,
      rules,
    );
    expect(rooms.filter(isFacadeRoom).map((r) => r.kind)).toEqual([
      'sejour',
      'chambrePmr',
      'chambre',
      'chambre',
    ]);
    expect(rooms.every((r) => r.facadeOk)).toBe(true);
    // disjoint, at least one partition apart
    const total = area(rooms);
    const merged = union(rooms.map((r) => r.polygon));
    expect(merged.length).toBe(rooms.length);
    expect(merged.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(total, 3);
  });

  it('flags rooms without enough façade', () => {
    const rooms = unitRoomLayout(
      rect(0, 0, 7, 10),
      [
        [
          [0, 0],
          [7, 0],
        ],
      ],
      3,
      rules,
    );
    // the third room has no façade left: missing or flagged
    const main = rooms.filter(isFacadeRoom);
    expect(main.length < 3 || main.some((r) => !r.facadeOk)).toBe(true);
  });

  for (const [t, access] of [
    [{ kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner'],
    [{ kind: 'solitaer', length: 60, depth: 10 }, 'laubengang'],
    [{ kind: 'solitaer', length: 40, depth: 12 }, 'zweispaenner'],
    [{ kind: 'solitaer', length: 60, depth: 17 }, 'mittelflur'],
    [{ kind: 'solitaer', length: 55, depth: 13 }, 'zweispaenner'],
    [{ kind: 'solitaer', length: 50, depth: 13 }, 'dreispaenner'],
    [{ kind: 'solitaer', length: 24, depth: 22 }, 'punkthaus'],
  ] as [Typology, AccessType][])
    it(`every dwelling of a ${access} storey gets its rooms`, () => {
      const l = layoutOf(t, access);
      expect(l.units.length).toBeGreaterThan(0);
      for (const u of l.units) {
        const type = settings.unitMix.find((x) => x.id === u.typeId)!;
        const n = unitRooms(type);
        expect(u.rooms.filter((r) => r.kind === 'sejour').length).toBe(1);
        if (n >= 2) expect(u.rooms.filter((r) => r.kind === 'chambrePmr').length).toBe(1);
        expect(u.rooms.filter(isFacadeRoom).length).toBe(n);
        expect(u.rooms.filter((r) => r.kind === 'gaine').length).toBe(1);
        // every room is one rectangle (no L shapes), not long and narrow
        for (const r of u.rooms) {
          if (r.kind === 'degagement') continue;
          // the séjour (day zone) may be an L or T: séjour + one rectangle behind it
          if (r.kind === 'sejour') expect(r.polygon.outer.length).toBeLessThanOrEqual(8);
          else expect(r.polygon.outer).toHaveLength(4);
          expect(r.polygon.holes ?? []).toHaveLength(0);
          if (r.kind === 'chambre' || r.kind === 'chambrePmr') {
            const [a, b, c] = r.polygon.outer;
            const e1 = Math.hypot(b![0] - a![0], b![1] - a![1]);
            const e2 = Math.hypot(c![0] - b![0], c![1] - b![1]);
            expect(Math.max(e1, e2) / Math.min(e1, e2)).toBeLessThan(1.65);
          }
        }
        // inside the dwelling and disjoint
        const inside = intersection(
          u.rooms.map((r) => r.polygon),
          [u.polygon],
        ).reduce((s, p) => s + polygonArea(p), 0);
        expect(inside).toBeCloseTo(area(u.rooms), 1);
        const merged = union(u.rooms.map((r) => r.polygon));
        expect(merged.reduce((s, p) => s + polygonArea(p), 0)).toBeCloseTo(area(u.rooms), 1);
        for (const r of u.rooms) expect(r.facadeOk).toBe(r.facade >= r.facadeRequired - 0.02);
      }
      // the dwelling widths follow the rooms, so every room gets its minimum façade
      for (const u of l.units) {
        expect(u.facadeOk).toBe(true);
        expect(u.rooms.every((r) => r.facadeOk)).toBe(true);
      }
    });
});
