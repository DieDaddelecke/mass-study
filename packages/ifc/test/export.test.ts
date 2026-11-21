import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { analyzeProject, createProject, rect, type Mass, type Project } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import * as WebIFC from 'web-ifc';
import {
  IFC_GUID_PATTERN,
  compoundAngle,
  decodeStr,
  exportIfc,
  guidFactory,
  hashIfcGuid,
  real,
  str,
} from '../src/index.js';

function mass(id: string, name: string, over: Partial<Mass>): Mass {
  return {
    id,
    name,
    typology: { kind: 'solitaer', length: 20, depth: 12 },
    position: [0, 0],
    rotation: 0,
    storeys: {
      basement: { count: 0, height: 3 },
      ground: { height: 3.5 },
      upper: { count: 3, height: 3 },
      parapet: 0.5,
      slabThickness: 0.3,
    },
    usage: 'wohnen',
    access: 'auto',
    ...over,
  };
}

/** Two masses: a block with a courtyard and a basement, and a plain bar. */
function testProject(): Project {
  const p = createProject({
    name: 'Test – Îlot ²',
    localBoundary: rect(-60, -40, 60, 40),
    lonLat: [2.2155, 48.7134],
    profile: 'FR',
  });
  const courtyard = mass('m1', 'BK1', {
    typology: {
      kind: 'freePolygon',
      polygon: {
        outer: [
          [-15, -15],
          [15, -15],
          [15, 15],
          [-15, 15],
        ],
        holes: [
          [
            [-7, -7],
            [-7, 7],
            [7, 7],
            [7, -7],
          ],
        ],
      },
    },
    position: [-25, 0],
  });
  courtyard.storeys.basement = { count: 1, height: 3 };
  courtyard.usageByStorey = { 0: 'gewerbe' };
  const bar = mass('m2', 'BK2', { position: [30, 0], usage: 'buero' });
  p.variants[0]!.name = 'Variante A';
  p.variants[0]!.masses.push(courtyard, bar);
  p.context.push({
    id: 'ctx1',
    footprint: rect(40, 25, 55, 35),
    height: 12,
    source: 'manual',
    heightEstimated: false,
  });
  return p;
}

const FIXED = { guidSeed: 'test', timestamp: new Date('2026-01-01T00:00:00Z') };

describe('STEP encoding', () => {
  it('encodes strings', () => {
    expect(str("l'été ±²")).toBe("'l''\\X2\\00E9\\X0\\t\\X2\\00E9\\X0\\ \\X2\\00B100B2\\X0\\'");
    expect(decodeStr(str("l'été ±² a\\b"))).toBe("l'été ±² a\\b");
  });
  it('encodes reals', () => {
    expect(real(3)).toBe('3.');
    expect(real(-0.5)).toBe('-0.5');
    expect(real(1e-7)).toBe('1.E-7');
    expect(real(1e-15)).toBe('0.');
  });
  it('builds compound angles', () => {
    expect(compoundAngle(48.5)).toEqual([48, 30, 0, 0]);
    expect(compoundAngle(-2.25)).toEqual([-2, -15, 0, 0]);
  });
});

describe('GUIDs', () => {
  it('are 22 chars of the IFC alphabet and deterministic with a seed', () => {
    expect(hashIfcGuid('a')).toMatch(IFC_GUID_PATTERN);
    expect(guidFactory()('x')).toMatch(IFC_GUID_PATTERN);
    const a = guidFactory('s');
    const b = guidFactory('s');
    expect(a('k')).toBe(b('k'));
    expect(a('k')).not.toBe(a('k')); // collisions are re-hashed
  });
});

describe('exportIfc', () => {
  const project = testProject();
  const { result } = analyzeProject(project);
  const text = exportIfc(project, result, { ...FIXED, context: true, massProxies: true });

  it('has a valid header and reference integrity', () => {
    expect(text.startsWith('ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(')).toBe(true);
    expect(text).toContain("FILE_SCHEMA(('IFC4'));");
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
    const data = text.slice(text.indexOf('DATA;') + 5, text.lastIndexOf('ENDSEC;'));
    const lines = data.trim().split('\n');
    const ids = new Set<number>();
    lines.forEach((l, i) => {
      const m = /^#(\d+)=([A-Z0-9]+)\(.*\);$/.exec(l);
      expect(m, l).not.toBeNull();
      expect(Number(m![1])).toBe(i + 1);
      ids.add(Number(m![1]));
    });
    // strip string literals before scanning references
    const noStrings = data.replace(/'(?:[^']|'')*'/g, "''");
    for (const r of noStrings.matchAll(/#(\d+)/g)) expect(ids.has(Number(r[1]))).toBe(true);
    expect(/[^\x20-\x7e\n]/.test(text)).toBe(false); // pure ASCII
  });

  it('writes valid GlobalIds', () => {
    const guids = [...text.matchAll(/^#\d+=IFC[A-Z]+\('([^']{22})',#/gm)].map((m) => m[1]!);
    expect(guids.length).toBeGreaterThan(20);
    for (const g of guids) expect(g).toMatch(IFC_GUID_PATTERN);
    expect(new Set(guids).size).toBe(guids.length);
  });

  it('is deterministic with a seed', () => {
    expect(exportIfc(project, result, { ...FIXED, context: true, massProxies: true })).toBe(text);
  });

  it('uses voids for courtyards and georeferences the site', () => {
    expect(text).toContain('IFCARBITRARYPROFILEDEFWITHVOIDS');
    expect(text).toContain("IFCPROJECTEDCRS('EPSG:2154'");
    expect(text).toContain('IFCMAPCONVERSION');
    expect(text).toContain(str('Étude de capacité – Variante A'));
  });

  it('parses with web-ifc: storeys, spaces and areas match the analysis', async () => {
    // web-ifc's Node build loads its WASM relative to SetWasmPath (absolute = true).
    const require = createRequire(import.meta.url);
    const wasmDir = dirname(require.resolve('web-ifc')) + '/';
    const api = new WebIFC.IfcAPI();
    api.SetWasmPath(wasmDir, true);
    await api.Init();
    const model = api.OpenModel(new TextEncoder().encode(text));
    try {
      expect(api.GetModelSchema(model)).toBe('IFC4');
      const count = (t: number) => api.GetLineIDsWithType(model, t).size();
      expect(count(WebIFC.IFCBUILDINGSTOREY)).toBe(result.levels.length);
      expect(count(WebIFC.IFCSPACE)).toBe(result.solids.length);
      expect(count(WebIFC.IFCSLAB)).toBe(result.solids.length);
      expect(count(WebIFC.IFCBUILDINGELEMENTPROXY)).toBe(
        result.solids.length + project.context.length,
      );
      expect(count(WebIFC.IFCSITE)).toBe(1);

      let gfa = 0;
      let nfa = 0;
      const qs = api.GetLineIDsWithType(model, WebIFC.IFCQUANTITYAREA);
      for (let i = 0; i < qs.size(); i++) {
        const q = api.GetLine(model, qs.get(i));
        if (q.Name.value === 'GrossFloorArea') gfa += q.AreaValue.value;
        if (q.Name.value === 'NetFloorArea') nfa += q.AreaValue.value;
      }
      expect(gfa).toBeCloseTo(result.areas.bgf, 3);
      expect(nfa).toBeCloseTo(result.areas.nrf, 3);

      const names: string[] = [];
      const sp = api.GetLineIDsWithType(model, WebIFC.IFCSPACE);
      for (let i = 0; i < sp.size(); i++) names.push(api.GetLine(model, sp.get(i)).Name.value);
      expect(names).toContain('BK1-S1');
      expect(names).toContain('BK2-03');

      // geometry is meshable (courtyard profile with voids included)
      let meshes = 0;
      api.StreamAllMeshes(model, () => meshes++);
      expect(meshes).toBeGreaterThanOrEqual(result.solids.length);
    } finally {
      api.CloseModel(model);
    }
  });
});

describe('exportIfc – pitched roofs and plantings', () => {
  const project = testProject();
  const bar = project.variants[0]!.masses[1]!;
  bar.roof = { kind: 'gable', pitch: 35, ridge: 'length' };
  project.variants[0]!.plantings = [
    {
      id: 'z1',
      name: 'Jardin',
      kind: 'pleineTerre',
      polygon: rect(-50, -35, -20, -20),
      treeSpacing: 6,
    },
  ];
  const { result } = analyzeProject(project);
  const text = exportIfc(project, result, FIXED);

  it('writes roofs as IfcRoof with a faceted B-rep and the planting', async () => {
    const pieces = result.masses.find((m) => m.mass.id === 'm2')!.roofs;
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    expect(text.match(/=IFCROOF\(/g)?.length).toBe(pieces.length);
    expect(text).toContain('.GABLE_ROOF.');
    expect(text).toContain('IFCFACETEDBREP');
    expect(text).toContain('IFCGEOGRAPHICELEMENT');
    expect(text).toContain(str('Jardin'));

    const require = createRequire(import.meta.url);
    const api = new WebIFC.IfcAPI();
    api.SetWasmPath(dirname(require.resolve('web-ifc')) + '/', true);
    await api.Init();
    const model = api.OpenModel(new TextEncoder().encode(text));
    try {
      expect(api.GetLineIDsWithType(model, WebIFC.IFCROOF).size()).toBe(pieces.length);
      expect(api.GetLineIDsWithType(model, WebIFC.IFCGEOGRAPHICELEMENT).size()).toBe(1);
      const ids = new Set<number>();
      const roofIds = api.GetLineIDsWithType(model, WebIFC.IFCROOF);
      for (let i = 0; i < roofIds.size(); i++) ids.add(roofIds.get(i));
      let roofMeshes = 0;
      api.StreamAllMeshes(model, (m) => {
        if (ids.has(m.expressID)) roofMeshes++;
      });
      expect(roofMeshes).toBe(pieces.length);
    } finally {
      api.CloseModel(model);
    }
  });
});
