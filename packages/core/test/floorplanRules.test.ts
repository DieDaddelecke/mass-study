import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  isFacadeRoom,
  massLayout,
  massToSolids,
  overlapArea,
  polygonDistance,
  rect,
  resolveUnitRules,
  ringCentroid,
  unitRoomLayout,
  tubeLike,
  unitsPerCoreRange,
  type AccessType,
  type LayoutRoom,
  type Typology,
  type Vec2,
} from '../src/index.js';
import { mass } from './helpers.js';

// Office floor-plan guide (docs/GRUNDRISS_REGELN.md)
const settings = defaultSettings('FR');
const rules = resolveUnitRules(settings);
type Seg = [Vec2, Vec2];
const S: Seg = [
  [0, 0],
  [12, 0],
];
const kinds = (rs: LayoutRoom[]) => rs.map((r) => r.kind);
const of = (rs: LayoutRoom[], k: string) => rs.filter((r) => r.kind === k);
const cx = (r: LayoutRoom) => ringCentroid(r.polygon.outer)[0];

describe('floor-plan guide', () => {
  it('chain along the façade: séjour, PMR, chambres; wet core next to the PMR bedroom', () => {
    const S14: Seg = [
      [0, 0],
      [14, 0],
    ];
    const rooms = unitRoomLayout(rect(0, 0, 14, 10), [S14], 4, rules);
    const main = rooms.filter(isFacadeRoom);
    expect(kinds(main)).toEqual(['sejour', 'chambrePmr', 'chambre', 'chambre']);
    // séjour at one end, then the PMR bedroom next to it, the other bedrooms further on
    const xs = main.map(cx);
    const dir = Math.sign(xs[1]! - xs[0]!);
    for (let i = 1; i < xs.length; i++) expect(Math.sign(xs[i]! - xs[i - 1]!)).toBe(dir);
    // T4: SDB + WC + SDE, one shaft of 60 × 60 cm
    expect(of(rooms, 'gaine')).toHaveLength(1);
    expect(of(rooms, 'gaine')[0]!.area).toBeCloseTo(0.36, 2);
    for (const k of ['sdb', 'wc', 'sde']) expect(of(rooms, k)).toHaveLength(1);
    const pmr = of(rooms, 'chambrePmr')[0]!;
    expect(polygonDistance(of(rooms, 'sdb')[0]!.polygon, pmr.polygon)).toBeLessThan(0.2);
    // minimum areas
    for (const r of rooms) if (r.areaRequired > 0) expect(r.areaOk).toBe(true);
    expect(of(rooms, 'sejour')[0]!.areaRequired).toBe(25);
    expect(pmr.areaRequired).toBe(12);
  });

  it('wet rooms by type: T2 bath, T3 + WC', () => {
    const t2 = unitRoomLayout(rect(0, 0, 12, 10), [S], 2, rules);
    expect(kinds(t2).filter((k) => ['sdb', 'wc', 'sde'].includes(k))).toEqual(['sdb']);
    const t3 = unitRoomLayout(rect(0, 0, 12, 10), [S], 3, rules);
    expect(kinds(t3).filter((k) => ['sdb', 'wc', 'sde'].includes(k))).toEqual(['sdb', 'wc']);
  });

  it('séjour in the corner of a corner dwelling', () => {
    const E: Seg = [
      [12, 0],
      [12, 10],
    ];
    const rooms = unitRoomLayout(rect(0, 0, 12, 10), [S, E], 3, rules);
    const sej = of(rooms, 'sejour')[0]!;
    // façade on both the south and the east side
    const bb = sej.polygon.outer;
    expect(Math.max(...bb.map((p) => p[0]))).toBeCloseTo(12, 3);
    expect(Math.min(...bb.map((p) => p[1]))).toBeCloseTo(0, 3);
  });

  it('séjour to the south rather than the north', () => {
    const N: Seg = [
      [12, 12],
      [0, 12],
    ];
    const rooms = unitRoomLayout(rect(0, 0, 12, 12), [S, N], 2, rules, { exterior: [S, N] });
    const sej = of(rooms, 'sejour')[0]!;
    // on the south façade (the day zone may reach into the dwelling behind it)
    expect(Math.min(...sej.polygon.outer.map((p) => p[1]))).toBeLessThan(0.01);
    expect(sej.facadeOk).toBe(true);
  });

  it('bedrooms do not face the gallery while the exterior has room', () => {
    const G: Seg = [
      [12, 8],
      [0, 8],
    ];
    const rooms = unitRoomLayout(rect(0, 0, 12, 8), [S, G], 3, rules, { exterior: [S] });
    for (const r of rooms.filter((x) => x.kind === 'chambre' || x.kind === 'chambrePmr'))
      expect(r.onGallery).toBeFalsy();
    expect(Math.min(...of(rooms, 'sejour')[0]!.polygon.outer.map((p) => p[1]))).toBeLessThan(0.01);
  });

  it('séjours stack from storey to storey', () => {
    const m = mass({ kind: 'solitaer', length: 40, depth: 12 }, { access: 'zweispaenner' });
    const ml = massLayout(m, massToSolids(m, settings), settings);
    const sej = (i: number) =>
      ml.storeys
        .find((s) => s.storeyIndex === i)!
        .units.flatMap((u) => u.rooms.filter((r) => r.kind === 'sejour').map((r) => r.polygon));
    const a = sej(2);
    const b = sej(3);
    const area = a.reduce((s, p) => s + Math.abs(overlapArea([p], [p])), 0);
    expect(overlapArea(a, b) / area).toBeGreaterThan(0.9);
  });

  it('orientation check and dwellings per core', () => {
    const m = mass({ kind: 'solitaer', length: 40, depth: 12 }, { access: 'zweispaenner' });
    const ml = massLayout(m, massToSolids(m, settings), settings);
    for (const st of ml.storeys)
      for (const u of st.units) {
        expect(u.orientations!.length).toBeGreaterThan(0);
        if (u.orientations!.length >= 2) expect(u.orientationOk).toBe(true);
      }
    expect(unitsPerCoreRange('laubengang')).toEqual([3, 8]);
    expect(unitsPerCoreRange('zweispaenner')).toEqual([2, 2]);
  });

  it('every dwelling has a door and no dwelling exceeds what its façade allows (corners)', () => {
    const cases = [
      mass(
        {
          kind: 'freeLine',
          points: [
            [-20, 10],
            [20, 10],
            [20, -20],
          ],
          closed: false,
          depth: 13,
          alignment: 'center',
        },
        { access: 'dreispaenner' },
      ),
      mass({ kind: 'solitaer', length: 24, depth: 22 }, { access: 'punkthaus' }),
    ];
    for (const m of cases) {
      const ml = massLayout(m, massToSolids(m, settings), settings);
      for (const st of ml.storeys.filter((s) => s.usage === 'wohnen')) {
        const over: string[] = [];
        for (const u of st.units) {
          expect(u.accessOk).toBe(true);
          const type = settings.unitMix.find((t) => t.id === u.typeId)!;
          if (u.area > type.areaMax + 1) over.push(`${u.label} ${u.area.toFixed(0)}`);
        }
        // oversize only where nothing else fits (flagged with *), at most one per storey
        expect(over.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('puts the stair into the dark inner corner of an L instead of leaving it empty', () => {
    const m = mass(
      {
        kind: 'freeLine',
        points: [
          [-20, 10],
          [20, 10],
          [20, -20],
        ],
        closed: false,
        depth: 13,
        alignment: 'center',
      },
      { access: 'dreispaenner' },
    );
    const ml = massLayout(m, massToSolids(m, settings), settings);
    const st = ml.storeys.find((s) => s.usage === 'wohnen')!;
    // the ~44 m² dark inner corner is no longer left empty
    expect(st.open.filter((o) => o.area > 25)).toHaveLength(0);
    // the corner stair still has its stair box (drawn with flights)
    for (const c of st.cores) expect(c.box).toBeDefined();
  });

  it('no tube-like dwellings and no tube-like wet rooms (Soheyl 23.11.2026)', () => {
    const W: Typology = {
      kind: 'freeLine',
      points: [
        [-20, 10],
        [20, 10],
        [20, -20],
      ],
      closed: false,
      depth: 13,
      alignment: 'center',
    };
    const cases: [Typology, AccessType][] = [
      [W, 'laubengang'],
      [W, 'dreispaenner'],
      [W, 'zweispaenner'],
      [W, 'mittelflur'],
      [{ kind: 'solitaer', length: 50, depth: 13 }, 'dreispaenner'],
      [{ kind: 'solitaer', length: 60, depth: 17 }, 'mittelflur'],
      [{ kind: 'solitaer', length: 24, depth: 22 }, 'punkthaus'],
    ];
    for (const [t, access] of cases) {
      const m = mass(t, { access });
      const ml = massLayout(m, massToSolids(m, settings), settings);
      const st = ml.storeys.find((s) => s.usage === 'wohnen')!;
      for (const u of st.units) {
        expect(tubeLike(u.polygon), `${access} ${u.label} ${u.area.toFixed(0)}`).toBe(false);
        for (const r of u.rooms.filter((x) => ['sdb', 'sde'].includes(x.kind))) {
          const [a, b, c] = r.polygon.outer;
          const e1 = Math.hypot(b![0] - a![0], b![1] - a![1]);
          const e2 = Math.hypot(c![0] - b![0], c![1] - b![1]);
          expect(
            Math.max(e1, e2) / Math.min(e1, e2),
            `${access} ${u.label} ${r.kind}`,
          ).toBeLessThan(3);
        }
      }
    }
  });
});
