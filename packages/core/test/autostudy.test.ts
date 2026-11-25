import { describe, expect, it } from 'vitest';
import {
  autoEnvelope,
  autoLevelHeight,
  autoMaxLevels,
  autoRulesFromConstraints,
  boundaryEdgeKey,
  constraintsWithAutoRules,
  DEFAULT_AUTO_RULES,
  defaultAutoOptions,
  defaultSettings,
  massFootprints,
  massDepth,
  outsideArea,
  polygonArea,
  polygonDistance,
  polygonsArea,
  rect,
  runAutoStudy,
  analyzeMasses,
  distanceWarnings,
  type AutoStudyRules,
  type BoundaryKind,
  type BoundarySegment,
  type Polygon,
} from '../src/index.js';

const settings = defaultSettings('FR');

/** Edges of a rectangle site; `kinds` in ring order (south, east, north, west). */
function edgesOf(site: Polygon, kinds: BoundaryKind[]): BoundarySegment[] {
  const r = site.outer;
  return r.map((a, i) => {
    const b = r[(i + 1) % r.length]!;
    const kind = kinds[i] ?? 'neighbour';
    return { a, b, kind, auto: kind, overridden: false, edge: i, key: boundaryEdgeKey(a, b) };
  });
}

const rules = (over: Partial<AutoStudyRules> = {}): AutoStudyRules => ({
  ...DEFAULT_AUTO_RULES,
  hauteurMax: 16,
  ...over,
});

describe('automatic massing study', () => {
  const site = rect(0, 0, 80, 60);
  const edges = edgesOf(site, ['road', 'neighbour', 'neighbour', 'neighbour']);

  it('derives the number of levels from the height limit', () => {
    const h = [1, 2, 3, 4, 5, 6].map((n) => autoLevelHeight('wohnen', n, settings));
    expect(h[1]! - h[0]!).toBeCloseTo(3, 5);
    const max = autoMaxLevels('wohnen', rules({ hauteurMax: 16 }), settings);
    expect(autoLevelHeight('wohnen', max, settings)).toBeLessThanOrEqual(16);
    expect(autoLevelHeight('wohnen', max + 1, settings)).toBeGreaterThan(16);
    expect(autoMaxLevels('wohnen', rules({ hauteurMax: 40, niveauxMax: 4 }), settings)).toBe(4);
  });

  it('shrinks the envelope with height (prospect H/2 towards neighbours)', () => {
    const r = rules();
    const low = autoEnvelope(site, edges, r, 6);
    const high = autoEnvelope(site, edges, r, 20);
    // low: 4 m everywhere (recul voie 4, prospect min 4) → 72 × 52
    expect(polygonsArea(low)).toBeCloseTo(72 * 52, 0);
    // high: street 4 m, neighbours 10 m → 60 × 46
    expect(polygonsArea(high)).toBeCloseTo(60 * 46, 0);
  });

  it('per-edge override replaces the street set-back', () => {
    const r = rules({ edgeRecul: { [edges[0]!.key]: 10 } });
    const env = autoEnvelope(site, edges, r, 6);
    expect(polygonsArea(env)).toBeCloseTo(72 * 46, 0);
  });

  it('finds scenarios for every form, inside the envelope and within the rules', () => {
    const r = rules({ empriseMax: 0.4 });
    const res = runAutoStudy({
      boundary: site,
      edges,
      rules: r,
      options: defaultAutoOptions('wohnen'),
      settings,
    });
    const families = res.scenarios.map((s) => s.family).sort();
    expect(families).toEqual(['punkthaus', 'uForm', 'winkel', 'zeile', 'zeilen']);
    for (const s of res.scenarios) {
      expect(s.ces).toBeLessThanOrEqual(0.4 + 1e-3);
      expect(s.height).toBeLessThanOrEqual(16 + 1e-6);
      expect(s.surfaceDePlancher).toBeGreaterThan(0);
      for (const m of s.masses) {
        expect(outsideArea(massFootprints(m), s.envelope)).toBeLessThan(0.5);
        if (m.typology.kind !== 'solitaer') expect(massDepth(m.typology)).toBeLessThanOrEqual(15);
      }
      // distance between buildings: max(8, H/2)
      for (let i = 0; i < s.masses.length; i++)
        for (let j = i + 1; j < s.masses.length; j++) {
          const d = polygonDistance(
            massFootprints(s.masses[i]!)[0]!,
            massFootprints(s.masses[j]!)[0]!,
          );
          expect(d).toBeGreaterThanOrEqual(Math.max(8, s.height / 2) - 0.01);
        }
    }
    // sorted by surface de plancher
    const sdp = res.scenarios.map((s) => s.surfaceDePlancher);
    expect([...sdp].sort((a, b) => b - a)).toEqual(sdp);
    // the CES is the binding rule on this generous site
    expect(res.scenarios[0]!.limits).toContain('emprise');
    expect(res.scenarios[0]!.ces).toBeGreaterThan(0.35);
  });

  it('office bars may be deeper than housing bars', () => {
    const run = (usage: 'wohnen' | 'buero') =>
      runAutoStudy({
        boundary: rect(0, 0, 70, 30),
        edges: edgesOf(rect(0, 0, 70, 30), ['road', 'neighbour', 'neighbour', 'neighbour']),
        rules: rules({ prospectMin: 3, reculVoie: 0, hauteurMax: 10 }),
        options: { ...defaultAutoOptions(usage), families: ['zeile'] },
        settings,
      }).scenarios[0]!;
    const w = run('wohnen');
    const b = run('buero');
    expect(massDepth(w.masses[0]!.typology)).toBe(15);
    expect(massDepth(b.masses[0]!.typology)).toBeGreaterThan(15);
  });

  it('round-trips the rules through the project constraints', () => {
    const r = rules({ niveauxMax: 5, empriseMax: 0.5, edgeRecul: { k: 6 } });
    const c = constraintsWithAutoRules({ espacesVertsMin: 0.3, pleineTerreMin: 0.2 }, r);
    expect(c.espacesVertsMin).toBe(0.3);
    expect(autoRulesFromConstraints(c)).toEqual(r);
  });

  it('works on an irregular parcel', () => {
    const poly: Polygon = {
      outer: [
        [0, 0],
        [70, 8],
        [64, 55],
        [20, 62],
        [-6, 30],
      ],
    };
    const ring = poly.outer;
    const e = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length]!;
      const kind: BoundaryKind = i === 0 ? 'road' : 'neighbour';
      return { a, b, kind, auto: kind, overridden: false, edge: i, key: boundaryEdgeKey(a, b) };
    });
    const t0 = Date.now();
    const res = runAutoStudy({
      boundary: poly,
      edges: e,
      rules: rules({ empriseMax: 0.5 }),
      options: defaultAutoOptions('wohnen'),
      settings,
    });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(res.scenarios.length).toBeGreaterThanOrEqual(3);
    for (const s of res.scenarios)
      expect(s.footprintArea).toBeLessThanOrEqual(0.5 * polygonArea(poly) + 1);
  });

  it('checks prospect, street set-back and building distances of manual masses', () => {
    const site = rect(0, 0, 80, 60);
    const e = edgesOf(site, ['road', 'neighbour', 'neighbour', 'neighbour']);
    const res = runAutoStudy({
      boundary: site,
      edges: e,
      rules: rules(),
      options: { ...defaultAutoOptions('wohnen'), families: ['zeilen'] },
      settings,
    });
    const s = res.scenarios[0]!;
    const c = {
      reculVoie: 4,
      prospectRatio: 0.5,
      prospectMin: 4,
      distanceRatio: 0.5,
      distanceMin: 8,
    };
    // the study's own result is clean
    expect(distanceWarnings(analyzeMasses(s.masses, settings), e, c)).toEqual([]);
    // moved onto the street and towards each other → warnings
    const a = s.masses[0]!;
    const moved = [
      { ...a, position: [a.position[0], a.position[1] - 3] as [number, number] },
      { ...a, id: 'copy', position: [a.position[0], a.position[1] - 3 + 18] as [number, number] },
    ];
    expect(distanceWarnings(analyzeMasses(moved, settings), e, {})).toEqual([]);
  });
});
