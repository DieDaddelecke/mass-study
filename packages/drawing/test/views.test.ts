import { describe, expect, it } from 'vitest';
import {
  analyzeProject,
  createMass,
  createProject,
  lonLatPolygonToLocal,
  pointInPolygon,
  ringCentroid,
  type Polygon,
  type Project,
  type StoreySolid,
} from '@kubatur/core';
import parcel from '../../../apps/server/test/fixtures/palaiseau/parcel-0518.json';
import bdtopo from '../../../apps/server/test/fixtures/palaiseau/bdtopo-batiment.json';
import {
  axonometry,
  chooseScale,
  defaultSections,
  drawingInput,
  elevation,
  formatLevel,
  lineIntervals,
  measureDrawing,
  renderSvg,
  roman,
  section,
  sitePlan,
  type DrawingModel,
} from '../src/index.js';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

function fakeProject(boundary: Polygon): Project {
  return {
    site: {
      parcels: [{ id: 'p', source: 'drawn', ref: '91477000H0518', polygon: boundary }],
      boundary,
    },
    context: [],
    constraints: {},
    geo: { crs: 'EPSG:2154', originCrs: [0, 0], originLonLat: [2, 48], groundElevation: 87.3 },
    settings: { profile: 'FR' },
  } as unknown as Project;
}

function solid(fp: Polygon, i: number, h = 3, massId = 'm'): StoreySolid {
  return {
    massId,
    storeyIndex: i,
    label: `R+${i}`,
    footprint: fp,
    z0: i * h,
    z1: (i + 1) * h,
    usage: 'wohnen',
    aboveGround: i >= 0,
    setback: false,
    top: false,
  };
}

describe('section', () => {
  it('cuts a courtyard building into two poché parts', () => {
    const court: Polygon = {
      outer: square(0, 0, 30, 30),
      holes: [square(10, 10, 20, 20).reverse()],
    };
    const solids = [0, 1, 2].map((i) => solid(court, i));
    solids[2]!.top = true;
    const p = fakeProject({ outer: square(-5, -5, 35, 35) });
    expect(lineIntervals([court.outer, ...court.holes!], [-10, 15], [40, 15])).toEqual([
      [10, 20],
      [30, 40],
    ]);
    const m = section(p, solids, { id: 'A', a: [-10, 15], b: [40, 15] }, 40, {
      masses: [{ massId: 'm', parapet: 0.5 }],
    });
    const poche = m.items.filter((i) => i.kind === 'fill' && i.fill === '#262626');
    expect(poche).toHaveLength(2);
    // poché reaches the parapet
    const ys = poche.flatMap((f) => (f.kind === 'fill' ? f.rings.flat().map((q) => q[1]) : []));
    expect(Math.max(...ys)).toBeCloseTo(9.5, 6);
    const kotes = m.items.filter((i) => i.kind === 'symbol' && i.type === 'level');
    expect(kotes.map((k) => (k.kind === 'symbol' ? k.label : ''))).toContain('+9,50');
  });
});

describe('formatting and scale', () => {
  it('formats levels and roman numerals', () => {
    expect(formatLevel(0)).toBe('±0,00');
    expect(formatLevel(3.5)).toBe('+3,50');
    expect(formatLevel(-2.8)).toBe('−2,80');
    expect(roman(4)).toBe('IV');
    expect(roman(14)).toBe('XIV');
  });

  it('1:500 → 10 m = 20 mm on paper', () => {
    const model: DrawingModel = {
      kind: 'elevation',
      items: [
        {
          kind: 'line',
          pts: [
            [0, 0],
            [10, 0],
          ],
          pen: 3,
          type: 'solid',
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
      warnings: [],
    };
    const svg = renderSvg(model, { scale: 500, marginMm: 8 });
    expect(svg).toContain('d="M8 8L28 8"');
    expect(svg).toContain('width="36mm"');
    // pen 3 = 0.25 mm at 1:500
    expect(svg).toContain('stroke-width="0.25"');
    expect(renderSvg(model, { scale: 1000, marginMm: 8 })).toContain('d="M8 8L18 8"');
  });

  it('chooses the largest fitting standard scale', () => {
    const model: DrawingModel = {
      kind: 'site',
      items: [
        {
          kind: 'line',
          pts: [
            [0, 0],
            [100, 50],
          ],
          pen: 3,
          type: 'solid',
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
      warnings: [],
    };
    // 100 m at 1:500 = 200 mm (+16 margin) > 150; at 1:1000 = 100 mm
    expect(chooseScale(model, 150, 150)).toBe(1000);
    expect(chooseScale(model, 400, 300)).toBe(500);
    expect(chooseScale(model, 600, 300)).toBe(200);
    expect(chooseScale(model, 10, 10)).toBe(2000);
    expect(measureDrawing(model, 500).widthMm).toBeCloseTo(216, 6);
  });
});

function palaiseau(): Project {
  const f = parcel.features[0]!;
  const p = createProject({
    name: 'Palaiseau',
    parcelsLonLat: [
      { ref: f.properties.idu, rings: f.geometry.coordinates[0] as [number, number][][] },
    ],
  });
  p.context = bdtopo.features.map((b) => ({
    id: String(b.id),
    footprint: lonLatPolygonToLocal(
      p.geo,
      (b.geometry.coordinates as number[][][][])[0]!.map((r) =>
        r.map(([x, y]) => [x!, y!] as [number, number]),
      ),
    ),
    height: b.properties.hauteur ?? 9,
    heightEstimated: false,
    source: 'ign' as const,
  }));
  // existing buildings on the site are demolished (as in the app)
  for (const c of p.context)
    if (pointInPolygon(ringCentroid(c.footprint.outer), p.site.boundary)) c.demolished = true;
  const m = createMass('zeile', { position: [-25, -6], rotation: 0.12, name: 'BK1' });
  m.typology = { kind: 'zeile', length: 50, depth: 13, sections: 3, sectionOffset: 0 };
  p.variants[0]!.masses.push(m);
  return p;
}

describe('Palaiseau demo', () => {
  const p = palaiseau();
  const input = drawingInput(analyzeProject(p).result);

  it('draws all four elevations with kotes, quickly', () => {
    for (const dir of ['N', 'E', 'S', 'W'] as const) {
      const t0 = Date.now();
      const m = elevation(p, input.solids, dir, { levels: input.levels, masses: input.masses });
      expect(Date.now() - t0).toBeLessThan(1000);
      const lines = m.items.filter((i) => i.kind === 'line' && i.pen === 3);
      expect(lines.length).toBeGreaterThanOrEqual(4);
      const labels = m.items.flatMap((i) => (i.kind === 'symbol' ? [i.label] : []));
      expect(labels).toContain('±0,00');
      const top = input.masses[0]!.top!;
      expect(labels).toContain(formatLevel(top));
      // no mass line above the top of the parapet
      for (const l of lines)
        if (l.kind === 'line') for (const q of l.pts) expect(q[1]).toBeLessThanOrEqual(top + 1e-6);
      const svg = renderSvg(m, { scale: 500 });
      expect(svg.startsWith('<svg')).toBe(true);
    }
  });

  it('draws site plan, default sections and axonometry', () => {
    const secs = defaultSections(p, input.solids);
    expect(secs.map((s) => s.id)).toEqual(['A', 'B']);
    const site = sitePlan(p, input.solids, { masses: input.masses, sections: secs });
    expect(site.items.some((i) => i.kind === 'line' && i.pen === 6 && i.type === 'dashdot')).toBe(
      true,
    );
    expect(site.items.some((i) => i.kind === 'text' && i.text === 'H 0518')).toBe(true);
    expect(site.items.some((i) => i.kind === 'symbol' && i.type === 'north')).toBe(true);
    for (const s of secs) {
      const m = section(p, input.solids, s, 60, { levels: input.levels, masses: input.masses });
      expect(m.items.some((i) => i.kind === 'line' && i.pen === 5)).toBe(true);
    }
    for (const kind of ['iso', 'planOblique'] as const) {
      const m = axonometry(p, input.solids, 'SW', kind, { masses: input.masses });
      expect(m.items.some((i) => i.kind === 'fill' && i.fill === '#d6d6d6')).toBe(true);
    }
  });
});
