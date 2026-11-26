import { describe, expect, it } from 'vitest';
import {
  analyzeMasses,
  defaultSettings,
  massLayouts,
  offsetPolygons,
  overlapArea,
  programmeDeviation,
  programmeMix,
  programmeResult,
  programmeShares,
  resolveProgramme,
  ringCentroid,
  unitOutdoors,
  type ProgrammeConfig,
  type Settings,
  type StoreyLayout,
} from '../src/index.js';
import { mass } from './helpers.js';

// Soheyl 26.11.2026: a standard programme for the whole building (example 35 / 30 / 15 / 5
// dwellings), storeys may differ even with the same massing
const PROGRAMME: ProgrammeConfig = {
  enabled: true,
  mode: 'count',
  entries: [
    { typeIds: ['t1', 't2'], value: 35 },
    { typeIds: ['t3'], value: 30 },
    { typeIds: ['t4'], value: 15 },
    { typeIds: ['t5'], value: 5 },
  ],
};
const base = defaultSettings('FR');
const withProgramme: Settings = { ...base, programme: PROGRAMME };
const zeile = (access: 'laubengang' | 'vierspaenner') =>
  mass({ kind: 'zeile', length: 60, depth: 13, sections: 3, sectionOffset: 0 }, { access });
const layoutOf = (s: Settings, access: 'laubengang' | 'vierspaenner' = 'laubengang') =>
  massLayouts(analyzeMasses([zeile(access)], s), s)[0]!;
const counts = (l: ReturnType<typeof layoutOf>) =>
  new Map(l.totals.byType.map((t) => [t.typeId, t.count]));
const centres = (st: StoreyLayout) =>
  st.cores
    .map((c) =>
      ringCentroid(c.polygon.outer)
        .map((v) => v.toFixed(2))
        .join(','),
    )
    .sort();

describe('housing programme', () => {
  it('counts become shares, a group splits by the mix shares', () => {
    const sh = programmeShares(PROGRAMME, base.unitMix);
    expect(sh.map((e) => e.label)).toEqual(['T1/T2', 'T3', 'T4', 'T5']);
    expect(sh.map((e) => Math.round(e.share * 1000) / 10)).toEqual([41.2, 35.3, 17.6, 5.9]);
    const mix = programmeMix(PROGRAMME, base.unitMix);
    const t1 = mix.find((t) => t.id === 't1')!.share;
    const t2 = mix.find((t) => t.id === 't2')!.share;
    // T1 10 % : T2 30 % in the mix → a quarter of the group goes to T1
    expect(t1 + t2).toBeCloseTo(35 / 85, 6);
    expect(t1 / (t1 + t2)).toBeCloseTo(0.25, 6);
  });

  it('off by default and when disabled', () => {
    expect(resolveProgramme(undefined, base)).toBeUndefined();
    expect(
      resolveProgramme({ programme: { ...PROGRAMME, enabled: false } }, withProgramme),
    ).toBeUndefined();
    expect(resolveProgramme({}, withProgramme)).toBe(PROGRAMME);
  });

  it('deviation: dwellings that would have to change type', () => {
    const sh = programmeShares(PROGRAMME, base.unitMix);
    // 85 dwellings exactly as the programme
    const exact = new Map([
      ['t1', 10],
      ['t2', 25],
      ['t3', 30],
      ['t4', 15],
      ['t5', 5],
    ]);
    expect(programmeDeviation(sh, exact)).toBeCloseTo(0, 6);
    const r = programmeResult(PROGRAMME, base.unitMix, exact);
    expect(r.entries[0]!.achieved).toBe(35);
    expect(r.deviation).toBeCloseTo(0, 6);
    // five T3 built as T4
    exact.set('t3', 25);
    exact.set('t4', 20);
    expect(programmeDeviation(sh, exact)).toBeCloseTo(5, 6);
  });

  for (const access of ['laubengang', 'vierspaenner'] as const)
    it(`${access}: storeys of the same massing differ to meet the programme of the building`, () => {
      const sh = programmeShares(PROGRAMME, base.unitMix);
      const before = layoutOf(base, access);
      const l = layoutOf(withProgramme, access);
      expect(l.programme).toBeDefined();
      // much closer to the programme than identical storeys with the default mix
      expect(l.programme!.deviation).toBeLessThan(programmeDeviation(sh, counts(before)) / 2);
      expect(l.programme!.deviation).toBeLessThanOrEqual(4);
      // the storeys do not all look the same
      const plans = new Set(
        l.storeys.map((st) => st.summary.byType.map((b) => `${b.typeId}${b.count}`).join()),
      );
      expect(plans.size).toBeGreaterThan(1);
      // stair cores in place and number on every storey
      const ref = centres(l.storeys[1]!);
      for (const st of l.storeys) expect(centres(st)).toEqual(ref);
      // no markedly more dead area than the storeys of the default plan
      const dead = Math.max(...before.storeys.map((st) => st.summary.openArea));
      for (const st of l.storeys) expect(st.summary.openArea).toBeLessThanOrEqual(dead + 16);
    });

  it('outdoor spaces repeat over the storeys, a larger dwelling takes several', () => {
    const l = layoutOf(withProgramme);
    const upper = l.storeys.filter((st) => st.storeyIndex > 0);
    const spaces = (st: StoreyLayout) => st.units.flatMap((u) => unitOutdoors(u));
    for (const a of upper)
      for (const b of upper) {
        if (a === b) continue;
        // an outdoor space of storey a lying in front of one dwelling of storey b only is
        // repeated there (one across the party wall of two dwellings of b cannot be)
        for (const o of spaces(a)) {
          const grown = offsetPolygons([o.polygon], 0.2);
          const touching = b.units.filter((u) => overlapArea(grown, [u.polygon]) > 0.05);
          if (touching.length !== 1) continue;
          expect(spaces(b).some((x) => overlapArea([x.polygon], [o.polygon]) > 0.2 * o.area)).toBe(
            true,
          );
        }
      }
    // a dwelling above two smaller ones has their outdoor spaces (T4 over two T2)
    expect(upper.some((st) => st.units.some((u) => (u.outdoorExtra?.length ?? 0) > 0))).toBe(true);
  });

  it('without a programme the layout stays as it was', () => {
    const l = layoutOf(base);
    expect(l.programme).toBeUndefined();
    const sigs = new Set(l.storeys.filter((s) => s.storeyIndex > 0).map((s) => s.signature));
    expect(sigs.size).toBe(1);
  });
});
