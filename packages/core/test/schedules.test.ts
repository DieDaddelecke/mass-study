import { describe, expect, it } from 'vitest';
import {
  allSchedules,
  analyzeProject,
  calculationSchedule,
  comparisonSchedule,
  kpiSchedule,
  surfacesSchedule,
  typologySchedule,
  type Schedule,
  type ScheduleRow,
} from '../src/index.js';
import { mass, referenceProject } from './helpers.js';

const rowsOf = (s: Schedule, kind: ScheduleRow['kind']) => s.rows.filter((r) => r.kind === kind);
const nameKey = (r: ScheduleRow) => (r.cells.name as { key: string }).key;

/** Every subtotal / total equals the sum of the rows it references. */
function expectConsistentSums(s: Schedule) {
  for (const r of s.rows) {
    if (!r.sums) continue;
    for (const c of s.columns.filter((c) => c.sum)) {
      const sum = r.sums.reduce((a, i) => a + Number(s.rows[i]!.cells[c.key] ?? 0), 0);
      expect(Number(r.cells[c.key])).toBeCloseTo(sum, 6);
    }
  }
}

describe('surfaces schedule – reference case (SPEC §17)', () => {
  const p = referenceProject('DE');
  const s = surfacesSchedule(p);

  it('groups variant › mass › storeys, top storey first', () => {
    expect(s.rows[0]).toMatchObject({ kind: 'group', depth: 0 });
    expect(s.rows[0]!.cells.name).toBe(p.variants[0]!.name);
    expect(s.rows[1]).toMatchObject({ kind: 'group', depth: 1, cells: { name: 'BK1' } });
    const storeys = rowsOf(s, 'row');
    expect(storeys).toHaveLength(5);
    expect(storeys.map((r) => r.cells.level)).toEqual([12.5, 9.5, 6.5, 3.5, 0]);
    storeys.forEach((r, i) => expect(r.cells.height).toBeCloseTo(i === 4 ? 3.5 : 3, 9));
    expect(storeys.every((r) => r.cells.fullStorey === true)).toBe(true);
    expect(storeys.every((r) => r.massId === 'm1')).toBe(true);
    for (const r of storeys) expect(r.cells.bgf).toBeCloseTo(480, 6);
  });

  it('variant total: BGF 2.400 m², BRI 7.440 m³', () => {
    const total = s.rows.at(-1)!;
    expect(total.kind).toBe('total');
    expect(total.cells.bgf).toBeCloseTo(2400, 6);
    expect(total.cells.bri).toBeCloseTo(7440, 6);
    expect(Number(total.cells.kgf) + Number(total.cells.nrf)).toBeCloseTo(2400, 6);
    expectConsistentSums(s);
  });

  it('separates above and below ground when there is a basement', () => {
    const q = referenceProject('DE');
    q.variants[0]!.masses[0]!.storeys.basement = { count: 1, height: 3 };
    const t = surfacesSchedule(q);
    const subs = rowsOf(t, 'subtotal');
    expect(subs.map(nameKey)).toEqual([
      'tables:row.aboveGround',
      'tables:row.belowGround',
      'tables:row.massTotal',
    ]);
    expect(subs[0]!.cells.bgf).toBeCloseTo(2400, 6);
    expect(subs[1]!.cells.bgf).toBeCloseTo(480, 6);
    expect(rowsOf(t, 'total')).toHaveLength(3);
    expectConsistentSums(t);
  });
});

describe('KPI schedule', () => {
  it('FR profile first: emprise, CES with target and status, R+n', () => {
    const p = referenceProject('FR');
    p.constraints.empriseMax = 0.25;
    const s = kpiSchedule(p);
    const row = (k: string) => s.rows.find((r) => nameKey(r) === `tables:kpi.${k}`)!;
    expect(row('emprise').cells.actual).toBeCloseTo(480, 6);
    expect(row('ces')).toMatchObject({ status: 'warning', cells: { target: 0.25 } });
    expect(row('formula').cells.actual).toBe('R+4');
    expect(row('hauteurEgout').cells.actual).toBeCloseTo(15.5, 6);
  });

  it('DE profile: GRZ, GFZ, Gebäudeklasse', () => {
    const s = kpiSchedule(referenceProject('DE'));
    const gfz = s.rows.find((r) => nameKey(r) === 'tables:kpi.gfz')!;
    expect(gfz.cells.actual).toBeCloseTo(1.2, 6);
    const cls = s.rows.find((r) => nameKey(r) === 'tables:kpi.buildingClass')!;
    expect(cls.cells.actual).toBe(4);
  });
});

describe('typology schedule and comparison', () => {
  it('lists depth, access, mix and a total row', () => {
    const p = referenceProject('FR');
    p.variants[0]!.masses.push(
      mass(
        { kind: 'solitaer', length: 20, depth: 20 },
        { id: 'm2', name: 'BK2', position: [15, 10] },
      ),
    );
    const s = typologySchedule(p);
    expect(s.rows).toHaveLength(3);
    expect(s.rows[0]!.cells.depth).toBe(12);
    expect(s.rows[0]!.cells.access).toEqual({ key: 'common:access.zweispaenner' });
    const mixSum = s.columns
      .filter((c) => c.key.startsWith('mix:'))
      .reduce((a, c) => a + Number(s.rows[0]!.cells[c.key]), 0);
    expect(mixSum).toBe(s.rows[0]!.cells.dwellings);
    expectConsistentSums(s);
  });

  it('compares all variants side by side', () => {
    const p = referenceProject('DE');
    p.variants.push({ id: 'v2', name: 'Variante B', masses: [] });
    const v1 = p.variants[0]!.id;
    const s = comparisonSchedule(p);
    expect(s.columns.map((c) => c.key)).toEqual(['name', 'unit', `v:${v1}`, 'v:v2']);
    const bgf = s.rows.find((r) => nameKey(r) === 'tables:kpi.bgf')!;
    expect(bgf.cells[`v:${v1}`]).toBeCloseTo(2400, 6);
    expect(bgf.cells['v:v2']).toBe(0);
    expect(allSchedules(p).map((x) => x.id)).toEqual([
      'surfaces',
      'kpis',
      'typologies',
      'calculation',
      'comparison',
    ]);
  });
});

describe('calculation steps', () => {
  const value = (s: Schedule, key: string) =>
    s.rows.filter((r) => nameKey(r) === `tables:calc.row.${key}`).map((r) => Number(r.cells.value));
  const one = (s: Schedule, key: string) => {
    const v = value(s, key);
    expect(v.length).toBeGreaterThan(0);
    return v[0]!;
  };

  function project() {
    const p = referenceProject('FR');
    const m = p.variants[0]!.masses[0]!;
    m.storeys.basement = { count: 1, height: 3 };
    p.variants[0]!.masses.push(
      mass(
        { kind: 'solitaer', length: 20, depth: 20 },
        { id: 'm2', name: 'BK2', position: [15, 10], usage: 'buero', access: 'buero' },
      ),
    );
    return p;
  }

  it('surface brute → surface utile adds up to the surfaces table', () => {
    const p = project();
    const a = analyzeProject(p);
    const s = calculationSchedule(p);
    const bgf = one(s, 'bgf');
    expect(bgf).toBeCloseTo(a.result.areas.bgf, 6);
    const nrf = one(s, 'nrf');
    expect(bgf + one(s, 'exteriorWalls') + one(s, 'interior')).toBeCloseTo(nrf, 6);
    expect(nrf).toBeCloseTo(a.result.areas.nrf, 6);
    // two masses with circulation: one total row and one row per mass
    const vf = value(s, 'vf');
    expect(vf).toHaveLength(1);
    const perMass = s.rows
      .filter((r) => r.depth === 2 && r.massId)
      .map((r) => Number(r.cells.value));
    expect(perMass).toHaveLength(2);
    expect(perMass[0]! + perMass[1]!).toBeCloseTo(vf[0]!, 6);
    const nuf = one(s, 'nuf');
    expect(nrf + vf[0]! + one(s, 'tf')).toBeCloseTo(nuf, 6);
    expect(nuf).toBeCloseTo(a.result.areas.nuf, 6);
    expect(one(s, 'livingArea')).toBeCloseTo(a.result.livingArea, 6);
    expect(one(s, 'dwellings')).toBe(a.result.dwellings);
    const bgfRow = s.rows.find((r) => nameKey(r) === 'tables:calc.row.bgf')!;
    expect(bgfRow.cells.share).toBeCloseTo(100, 9);
  });

  it('surface de plancher equals the KPI', () => {
    const p = project();
    const a = analyzeProject(p);
    const s = calculationSchedule(p);
    const sdp = one(s, 'sdp');
    expect(sdp).toBeCloseTo(a.fr.surfaceDePlancher, 6);
    expect(
      one(s, 'sdpGross') +
        one(s, 'sdpParking') +
        one(s, 'sdpWalls') +
        one(s, 'sdpTechnical') +
        one(s, 'sdpAbatement'),
    ).toBeCloseTo(sdp, 6);
    expect(one(s, 'sdpParking')).toBeLessThan(0);
  });

  it('car parking: demand and capacity as in the KPIs', () => {
    const p = project();
    const a = analyzeProject(p);
    const s = calculationSchedule(p);
    expect(one(s, 'parkDemand')).toBe(a.result.parking.demand);
    expect(one(s, 'parkCapacity')).toBe(a.result.parking.capacity);
    expect(one(s, 'parkDwellings')).toBe(a.result.dwellings);
    expect(one(s, 'parkOffice')).toBeCloseTo(a.result.usageNuf.buero / 40, 6);
    expect(one(s, 'parkBalance')).toBe(a.result.parking.capacity - a.result.parking.demand);
  });

  it('bicycle parking: 1 space up to T2, 2 from T3, 15 % of workplaces, 1.5 m² each', () => {
    const p = project();
    const a = analyzeProject(p);
    const s = calculationSchedule(p);
    const byType = new Map<string, number>();
    for (const m of a.result.masses)
      for (const t of m.dwellings.byType) byType.set(t.id, (byType.get(t.id) ?? 0) + t.count);
    const small = (byType.get('t1') ?? 0) + (byType.get('t2') ?? 0);
    const large = a.result.dwellings - small;
    expect(one(s, 'bikeSmall')).toBe(small);
    expect(one(s, 'bikeLarge')).toBe(2 * large);
    expect(one(s, 'bikeOffice')).toBeCloseTo(a.result.workplaces * 0.15, 6);
    const spaces = Math.ceil(small + 2 * large + a.result.workplaces * 0.15 - 1e-9);
    expect(one(s, 'bikeSpaces')).toBe(spaces);
    expect(one(s, 'bikeArea')).toBeCloseTo(spaces * 1.5, 6);
  });

  it('uses the bicycle settings of the project', () => {
    const p = project();
    p.settings.bikeParking = { perLargeDwelling: 3, areaPerSpace: 2 };
    const s = calculationSchedule(p);
    expect(one(s, 'bikeArea')).toBeCloseTo(one(s, 'bikeSpaces') * 2, 6);
  });
});
