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
    expect(rooms.map((r) => r.kind)).toEqual(['sejour', 'chambrePmr', 'chambre', 'chambre']);
    expect(rooms.every((r) => r.facadeOk)).toBe(true);
    // disjoint, at least one partition apart
    const total = area(rooms);
    const merged = union(rooms.map((r) => r.polygon));
    expect(merged.length).toBe(4);
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
    expect(rooms.length < 3 || rooms.some((r) => !r.facadeOk)).toBe(true);
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
        expect(u.rooms.length).toBe(n);
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
