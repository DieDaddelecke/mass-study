import { describe, expect, it } from 'vitest';
import {
  TEMPLATES,
  analyzeProject,
  createMass,
  createProject,
  massLayouts,
  rect,
  type AccessType,
  type Project,
  type Typology,
} from '@kubatur/core';
import {
  chooseScale,
  distinctStoreyGroups,
  drawingInput,
  floorPlan,
  renderSvg,
  unitColor,
} from '../src/index.js';

function project(typology: Typology, access: AccessType | 'auto'): Project {
  const p = createProject({
    name: 'FP',
    localBoundary: rect(-40, -40, 40, 40),
    lonLat: [2.2, 48.7],
    profile: 'FR',
  });
  const m = createMass(typology.kind, { position: [-20, -5] });
  m.typology = typology;
  m.access = access;
  m.usageByStorey = { 0: 'gewerbe' };
  p.variants[0]!.masses.push(m);
  return p;
}

describe('floorPlan', () => {
  const cases: [string, Typology, AccessType | 'auto'][] = [
    ['zweispaenner', { kind: 'solitaer', length: 44, depth: 12 }, 'zweispaenner'],
    ['dreispaenner', { kind: 'solitaer', length: 50, depth: 14 }, 'dreispaenner'],
    ['laubengang', { kind: 'solitaer', length: 50, depth: 10 }, 'laubengang'],
    ['mittelflur', { kind: 'solitaer', length: 50, depth: 17 }, 'mittelflur'],
    ['punkthaus', { kind: 'solitaer', length: 22, depth: 22 }, 'auto'],
    ['uform', TEMPLATES.uForm(), 'auto'],
    ['blockrand', TEMPLATES.blockrand(), 'auto'],
  ];
  for (const [name, t, access] of cases)
    it(`draws a schematic plan (${name})`, () => {
      const p = project(t, access);
      const a = analyzeProject(p);
      const layouts = massLayouts(a.result, p.settings);
      const { solids } = drawingInput(a.result);
      const model = floorPlan(p, solids, 1, layouts);
      expect(model.kind).toBe('floorPlan');
      const st = layouts[0]!.storeys.find((s) => s.storeyIndex === 1)!;
      const fills = model.items.filter((i) => i.kind === 'fill');
      const colours = new Set(st.units.map((u) => unitColor(u.typeId, p.settings.unitMix)));
      for (const c of colours)
        expect(fills.some((f) => f.kind === 'fill' && f.fill === c)).toBe(true);
      const texts = model.items.filter((i) => i.kind === 'text');
      expect(texts.length).toBe(st.units.length * 2);
      const scale = chooseScale(model, 380, 250, [200, 250, 500]);
      const svg = renderSvg(model, { scale });
      expect(svg).toContain('<svg');
      // ground floor: open commerce area with cores, no units
      const gf = floorPlan(p, solids, 0, layouts);
      expect(gf.items.filter((i) => i.kind === 'text')).toHaveLength(0);
    });

  it('groups identical storeys', () => {
    const p = project({ kind: 'solitaer', length: 44, depth: 12 }, 'zweispaenner');
    const layouts = massLayouts(p);
    const groups = distinctStoreyGroups(layouts, (s) => s.units.length > 0);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.labels[0]).toBe('R+1');
  });
});
