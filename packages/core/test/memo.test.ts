import { describe, expect, it } from 'vitest';
import { analyzeProject, massLayouts } from '../src/index.js';
import { mass, referenceProject } from './helpers.js';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function twoMasses() {
  const p = referenceProject('FR');
  p.variants[0]!.masses = [
    mass({ kind: 'zeile', length: 30, depth: 12, sections: 1, sectionOffset: 0 }, { id: 'a' }),
    mass(
      { kind: 'zeile', length: 20, depth: 12, sections: 1, sectionOffset: 0 },
      { id: 'b', position: [0, 40] },
    ),
  ];
  return p;
}

describe('per-mass memo (frozen editor states)', () => {
  it('reuses the analysis and layout of unchanged masses', () => {
    const p1 = deepFreeze(twoMasses());
    const a1 = analyzeProject(p1);
    // the editor's next state: same settings / mass b, new mass a (immer structural sharing)
    const [ma, mb] = p1.variants[0]!.masses;
    const moved = deepFreeze({ ...ma!, position: [5, 0] as [number, number] });
    const p2 = deepFreeze({ ...p1, variants: [{ ...p1.variants[0]!, masses: [moved, mb!] }] });
    const a2 = analyzeProject(p2);
    expect(a2.result.masses[1]).toBe(a1.result.masses[1]);
    expect(a2.layouts[1]).toBe(a1.layouts[1]);
    expect(a2.result.masses[0]).not.toBe(a1.result.masses[0]);
    expect(a2.result.masses[0]!.solids[0]!.solid.footprint).not.toEqual(
      a1.result.masses[0]!.solids[0]!.solid.footprint,
    );
    // same results as a fresh computation without memo
    const fresh = analyzeProject(JSON.parse(JSON.stringify(p2)) as typeof p2);
    expect(a2.result.areas).toEqual(fresh.result.areas);
    expect(a2.layouts).toEqual(fresh.layouts);
    expect(massLayouts(a2.result, p2.settings)[1]).toBe(a1.layouts[1]);
  });

  it('new settings recompute every mass', () => {
    const p1 = deepFreeze(twoMasses());
    const a1 = analyzeProject(p1);
    const p2 = deepFreeze({ ...p1, settings: { ...p1.settings } });
    const a2 = analyzeProject(p2);
    expect(a2.result.masses[0]).not.toBe(a1.result.masses[0]);
    expect(a2.layouts[0]).not.toBe(a1.layouts[0]);
  });

  it('never memoizes mutable (unfrozen) projects', () => {
    const p = twoMasses();
    const a1 = analyzeProject(p);
    p.variants[0]!.masses[0]!.storeys.upper.count += 2;
    const a2 = analyzeProject(p);
    expect(a2.result.masses[0]).not.toBe(a1.result.masses[0]);
    expect(a2.result.areas.bgf).toBeGreaterThan(a1.result.areas.bgf);
  });
});
