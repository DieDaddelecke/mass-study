import { describe, expect, it } from 'vitest';
import type { Polygon, Project, RoofPiece, StoreySolid, Vec2 } from '@kubatur/core';
import {
  elevation,
  hiddenLine,
  horizontalProjection,
  prismFromPolygon,
  roofPrisms,
  section,
  sitePlan,
  axonometry,
  type DItem,
} from '../src/index.js';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
});

const fp = box(0, 0, 20, 10);
const solids: StoreySolid[] = [0, 1, 2].map((i) => ({
  massId: 'm',
  storeyIndex: i,
  label: `R+${i}`,
  footprint: fp,
  z0: i * 3,
  z1: (i + 1) * 3,
  usage: 'wohnen',
  aboveGround: true,
  setback: false,
  top: i === 2,
})) as StoreySolid[];
// gable along x, ridge at y = 5, z = 9 → 12.5
const roofs: RoofPiece[] = [
  {
    massId: 'm',
    polygon: box(0, 0, 20, 5),
    z0: 9,
    plane: [9, 0, 0.7],
    seams: [false, false, true, false],
  },
  {
    massId: 'm',
    polygon: box(0, 5, 20, 10),
    z0: 9,
    plane: [16, 0, -0.7],
    seams: [true, false, false, false],
  },
];
const project = {
  site: { parcels: [], boundary: box(-5, -5, 25, 15) },
  context: [],
  constraints: {},
  geo: { crs: 'EPSG:2154', originCrs: [0, 0], originLonLat: [2, 48] },
  settings: { profile: 'FR' },
  variants: [
    {
      id: 'v',
      name: 'v',
      masses: [],
      plantings: [
        {
          id: 'z',
          name: 'Jardin',
          kind: 'pleineTerre',
          polygon: box(-4, 11, 24, 24),
          treeSpacing: 6,
          treeHeight: 8,
        },
        { id: 'd', name: 'Dalle', kind: 'surDalle', polygon: box(21, -4, 24, 10) },
      ],
    },
  ],
  activeVariantId: 'v',
} as unknown as Project;
const masses = [{ massId: 'm', top: 12.5, parapet: 0 }];

const lines = (items: DItem[]) =>
  items.flatMap((i) => (i.kind === 'line' && i.pen === 3 && !i.color ? [i.pts] : []));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

describe('pitched roofs', () => {
  it('south elevation shows the ridge line and a faîtage kote', () => {
    const m = elevation(project, solids, 'S', { roofs, masses, neighbours: false });
    const ridge = lines(m.items).some(
      (p) =>
        near(p[0]![1], 12.5) &&
        near(p[1]![1], 12.5) &&
        Math.abs(Math.abs(p[1]![0] - p[0]![0]) - 20) < 1e-3,
    );
    expect(ridge).toBe(true);
    const subs = m.items.flatMap((i) => (i.kind === 'symbol' ? [i.sublabel] : []));
    expect(subs).toContain('faîtage');
    // the front roof face is filled with the roof colour
    expect(m.items.some((i) => i.kind === 'fill' && i.fill === '#d6d6d6')).toBe(true);
  });

  it('east elevation shows the sloped gable edges', () => {
    const m = elevation(project, solids, 'E', { roofs, masses, neighbours: false });
    const sloped = lines(m.items).filter((p) => {
      const dz = Math.abs(p[1]![1] - p[0]![1]);
      const dx = Math.abs(p[1]![0] - p[0]![0]);
      return dz > 3 && dx > 4.9 && dx < 5.1;
    });
    expect(sloped.length).toBe(2);
    // no vertical line through the gable at the ridge
    const vert = lines(m.items).filter(
      (p) => near(p[0]![0], p[1]![0]) && Math.max(p[0]![1], p[1]![1]) > 9.01,
    );
    expect(vert.length).toBe(0);
  });

  it('section through a gable roof cuts a sloped poché', () => {
    const m = section(project, solids, { id: 'A', a: [10, -10], b: [10, 20] }, 60, {
      roofs,
      masses,
      neighbours: false,
    });
    const poche = m.items.filter((i) => i.kind === 'fill' && i.fill === '#262626');
    const pts = poche.flatMap((i) => (i.kind === 'fill' ? i.rings.flat() : []));
    expect(pts.some((p: Vec2) => near(p[0], 15) && near(p[1], 12.5))).toBe(true);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(12.5, 3);
    const subs = m.items.flatMap((i) => (i.kind === 'symbol' ? [i.sublabel] : []));
    expect(subs).toContain('faîtage');
  });

  it('a roof piece hides what is behind it', () => {
    const P = horizontalProjection([0, 1]);
    const behind = prismFromPolygon(box(5, 20, 15, 25), 0, 11, 'mass', 'b');
    const solid = prismFromPolygon(fp, 0, 9, 'mass', 's');
    const { segments } = hiddenLine([solid, ...roofPrisms(roofs), behind], P);
    const top = segments.filter((s) => s.prism === behind && near(s.a[1], 11) && near(s.b[1], 11));
    expect(top.length).toBe(0);
    // without the roof, the top edge is visible
    const flat = hiddenLine([solid, behind], P).segments.filter(
      (s) => s.prism === behind && near(s.a[1], 11),
    );
    expect(flat.length).toBeGreaterThan(0);
  });

  it('axonometry draws the roof', () => {
    const m = axonometry(project, solids, 'SW', 'iso', { roofs, masses, neighbours: false });
    expect(m.items.some((i) => i.kind === 'fill' && i.fill === '#d6d6d6')).toBe(true);
  });

  it('site plan draws plantings, their trees and ridge lines', () => {
    const m = sitePlan(project, solids, { roofs, masses });
    expect(m.items.some((i) => i.kind === 'fill' && i.fill === '#e4eedb')).toBe(true);
    expect(m.items.some((i) => i.kind === 'fill' && !!i.hatch)).toBe(true);
    expect(
      m.items.filter((i) => i.kind === 'fill' && i.stroke === '#7f9e6c').length,
    ).toBeGreaterThan(2);
    const ridge = m.items.some(
      (i) =>
        i.kind === 'line' && i.pts.length === 2 && near(i.pts[0]![1], 5) && near(i.pts[1]![1], 5),
    );
    expect(ridge).toBe(true);
  });
});
