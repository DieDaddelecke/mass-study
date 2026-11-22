import { analyzeProject, createMass, createProject, massLayouts, rect } from '@kubatur/core';
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildStoreyCut, CUT_HEIGHT, cutLevels, defaultCutLevel, massesCutAt } from './storeyCut';

function project() {
  const p = createProject({
    name: 'C',
    localBoundary: rect(-40, -40, 40, 40),
    lonLat: [2.2, 48.7],
    profile: 'FR',
  });
  const m = createMass('solitaer', { position: [-20, -5] });
  m.typology = { kind: 'solitaer', length: 44, depth: 12 };
  m.access = 'zweispaenner';
  m.usageByStorey = { 0: 'gewerbe' };
  p.variants[0]!.masses.push(m);
  const a = analyzeProject(p);
  return {
    p,
    solids: a.result.solids.map((r) => r.solid),
    layouts: massLayouts(a.result, p.settings),
  };
}

describe('storey cut', () => {
  const { p, solids, layouts } = project();

  it('lists the storeys top first and defaults to the highest storey with dwellings', () => {
    const levels = cutLevels(solids);
    expect(levels[0]).toBe(Math.max(...solids.map((s) => s.storeyIndex)));
    expect([...levels].sort((a, b) => b - a)).toEqual(levels);
    const top = Math.max(
      ...layouts[0]!.storeys.filter((s) => s.units.length).map((s) => s.storeyIndex),
    );
    expect(defaultCutLevel(solids, layouts)).toBe(top);
    expect(defaultCutLevel(solids, [])).toBe(levels[0]);
    expect(massesCutAt(solids, 2).has(solids[0]!.massId)).toBe(true);
    expect(massesCutAt(solids, 99).size).toBe(0);
  });

  it('cuts a residential storey at plan height with labelled dwellings', () => {
    const s2 = solids.find((s) => s.storeyIndex === 2)!;
    const cut = buildStoreyCut(solids, layouts, 2, p.settings.unitMix, '#ffffff');
    expect(cut.masses).toHaveLength(1);
    const geo = cut.masses[0]!.geometry;
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count);
    const box = new Box3().setFromBufferAttribute(geo.getAttribute('position') as never);
    expect(box.min.z).toBeCloseTo(s2.z0, 3);
    // the stairs in the cores rise up to (just below) the next floor …
    expect(box.max.z).toBeGreaterThan(s2.z0 + CUT_HEIGHT + 1);
    expect(box.max.z).toBeLessThan(s2.z1);
    // … while without stair rules for a storey on top (no storey above) the walls end at the cut
    const top = Math.max(...solids.map((s) => s.storeyIndex));
    const st = solids.find((s) => s.storeyIndex === top)!;
    const cutTop = buildStoreyCut(solids, layouts, top, p.settings.unitMix, '#ffffff');
    const boxTop = new Box3().setFromBufferAttribute(
      cutTop.masses[0]!.geometry.getAttribute('position') as never,
    );
    expect(boxTop.max.z).toBeCloseTo(st.z0 + Math.min(CUT_HEIGHT, (st.z1 - st.z0) * 0.6) + 0.02, 3);
    const units = layouts[0]!.storeys.find((s) => s.storeyIndex === 2)!.units;
    expect(cut.labels).toHaveLength(units.length);
  });

  it('shows a plain floor for storeys without dwellings', () => {
    const cut = buildStoreyCut(solids, layouts, 0, p.settings.unitMix, '#ffffff');
    expect(cut.masses).toHaveLength(1);
    expect(cut.labels).toHaveLength(0);
  });
});
