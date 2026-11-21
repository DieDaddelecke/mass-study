import { analyzeProject, createMass, createProject, massLayouts, rect } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { meshVolume } from './geometry';
import { buildGranulometry, storeyKey } from './granulometry';

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
});
