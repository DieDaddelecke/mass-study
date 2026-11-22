import {
  analyzeProject,
  createMass,
  createProject,
  difference,
  massLayouts,
  offsetPolygons,
  polygonArea,
  polygonPerimeter,
  rect,
} from '@kubatur/core';
import { palaiseauDemo } from '../../demo/palaiseau';
import { describe, expect, it } from 'vitest';
import { meshVolume } from './geometry';
import { buildGranulometry, buildOutdoor, LOGGIA_SLAB, storeyKey } from './granulometry';

describe('buildGranulometry', () => {
  it('replaces the residential storeys by coloured dwellings, cores and circulation', () => {
    const p = createProject({
      name: 'G',
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
    const layouts = massLayouts(a.result, p.settings);
    const solids = a.result.solids.map((r) => r.solid);
    const g = buildGranulometry(layouts, solids, p.settings.unitMix);
    expect(g.masses).toHaveLength(1);
    // ground floor (commerce) keeps its plain volume, upper storeys are replaced
    const gf = solids.find((s) => s.storeyIndex === 0)!;
    expect(g.covered.has(storeyKey(gf))).toBe(false);
    const upper = solids.filter((s) => s.storeyIndex > 0 && s.aboveGround);
    for (const s of upper) expect(g.covered.has(storeyKey(s))).toBe(true);
    // same volume as the storeys it replaces, with a colour per vertex
    const geo = g.masses[0]!.geometry;
    const vol = upper.reduce((v, s) => v + 44 * 12 * (s.z1 - s.z0), 0);
    expect(Math.abs(meshVolume(geo))).toBeCloseTo(vol, 0);
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count);
    expect(g.masses[0]!.edges.length).toBeGreaterThan(0);
  });

  it('cuts loggias out of the dwellings, below the slab of the storey above', () => {
    const p = createProject({
      name: 'L',
      localBoundary: rect(-40, -40, 40, 40),
      lonLat: [2.2, 48.7],
      profile: 'FR',
    });
    p.settings.outdoor = { kind: 'loggia', depth: 1.8, groundTerrace: true };
    const m = createMass('solitaer', { position: [-20, -5] });
    m.typology = { kind: 'solitaer', length: 44, depth: 12 };
    m.access = 'zweispaenner';
    m.usageByStorey = { 0: 'gewerbe' };
    p.variants[0]!.masses.push(m);
    const a = analyzeProject(p);
    const layouts = massLayouts(a.result, p.settings);
    const solids = a.result.solids.map((r) => r.solid);
    const upper = solids.filter((s) => s.storeyIndex > 0 && s.aboveGround);
    let loggiaVol = 0;
    for (const st of layouts[0]!.storeys)
      for (const u of st.units)
        if (u.outdoor?.kind === 'loggia') {
          const s = upper.find((x) => x.storeyIndex === st.storeyIndex)!;
          loggiaVol += u.outdoor.area * (s.z1 - s.z0 - LOGGIA_SLAB);
        }
    expect(loggiaVol).toBeGreaterThan(0);
    const g = buildGranulometry(layouts, solids, p.settings.unitMix);
    const vol = upper.reduce((v, s) => v + 44 * 12 * (s.z1 - s.z0), 0);
    expect(Math.abs(meshVolume(g.masses[0]!.geometry))).toBeCloseTo(vol - loggiaVol, 0);
  });
});

describe('loggias of the Palaiseau demo', () => {
  const p = palaiseauDemo();
  p.settings.outdoor = { kind: 'loggia', depth: 1.8, groundTerrace: true };
  const a = analyzeProject(p);
  const layouts = massLayouts(a.result, p.settings);

  it('open the façade: the cut storeys have no enclosed holes', () => {
    const cuts = buildOutdoor(layouts).loggias;
    expect(cuts.size).toBeGreaterThan(0);
    for (const { solid: s } of a.result.solids) {
      const cut = cuts.get(storeyKey(s));
      if (!cut) continue;
      for (const q of difference([s.footprint], cut)) expect(q.holes ?? []).toHaveLength(0);
    }
  });

  it('dwellings have no zero-width spikes along the façade', () => {
    for (const st of layouts[0]!.storeys)
      for (const u of st.units) {
        const opened = offsetPolygons(offsetPolygons([u.polygon], -0.01), 0.01);
        const per = opened.reduce((x, q) => x + polygonPerimeter(q), 0);
        expect(per).toBeCloseTo(polygonPerimeter(u.polygon), 0);
        expect(polygonArea(u.polygon)).toBeGreaterThan(0);
      }
  });
});
