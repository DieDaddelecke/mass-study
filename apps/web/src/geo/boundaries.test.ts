import { analyzeProject, classifyBoundary } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { palaiseauDemo } from '../demo/palaiseau';

describe('site boundaries of the Palaiseau parcel (real cadastre + BD TOPO)', () => {
  it('finds the three streets and the neighbour to the north', () => {
    const p = palaiseauDemo();
    const segs = classifyBoundary(p.site, p.surroundings);
    const long = segs.filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 20);
    expect(long.map((s) => `${s.kind}:${s.name ?? ''}`)).toEqual([
      'road:Rue Jean Pacilly',
      'neighbour:',
      'road:Rue Rosalind Franklin',
      'road:Boulevard Thomas Gobert',
    ]);
  });

  it('keeps the façade towards the neighbour blind when the building comes close', () => {
    const p = palaiseauDemo();
    p.variants[0]!.masses[0]!.position = [-25, 12];
    const st = analyzeProject(p).layouts[0]!.storeys.find((s) => s.storeyIndex === 2)!;
    expect(st.blindFacades?.length).toBeGreaterThan(0);
    // the demo position (20 m away) keeps all windows
    const far = analyzeProject(palaiseauDemo()).layouts[0]!.storeys;
    expect(far.every((s) => !s.blindFacades)).toBe(true);
  });
});
