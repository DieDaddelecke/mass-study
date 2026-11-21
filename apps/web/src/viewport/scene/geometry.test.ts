import type { ContextBuilding, Polygon } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { USAGE_COLORS, usageColor } from './colors';
import { cubeRegion, emptyBox, expandBox, fitBox, orthoZoomFor } from './cameraFit';
import {
  buildContextGeometry,
  contextIdAt,
  dashDotSegments,
  extrudePolygon,
  meshVolume,
  prismEdges,
  storeyLines,
} from './geometry';

const sq = (x0: number, y0: number, s: number): [number, number][] => [
  [x0, y0],
  [x0 + s, y0],
  [x0 + s, y0 + s],
  [x0, y0 + s],
];
const withHole: Polygon = { outer: sq(0, 0, 10), holes: [sq(4, 4, 2).reverse()] };

describe('extrudePolygon', () => {
  it('extrudes a rectangle with a hole to the right volume and z-range', () => {
    const g = extrudePolygon(withHole, 3, 6)!;
    expect(Math.abs(meshVolume(g))).toBeCloseTo((100 - 4) * 3, 6);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.z).toBeCloseTo(3);
    expect(g.boundingBox!.max.z).toBeCloseTo(6);
  });
  it('returns null for degenerate input', () => {
    expect(extrudePolygon(withHole, 2, 2)).toBeNull();
    expect(extrudePolygon({ outer: [[0, 0]] }, 0, 1)).toBeNull();
  });
});

describe('edges', () => {
  it('counts outline and corner edges', () => {
    // 2 rings × (4 bottom + 4 top + 4 vertical) = 24 segments, 6 floats each
    expect(prismEdges(withHole, 0, 3).length / 6).toBe(24);
    expect(prismEdges(withHole, 0, 3, { bottom: false, top: false }).length / 6).toBe(8);
  });
  it('skips vertical edges below the feature angle', () => {
    const poly: Polygon = {
      outer: [
        [0, 0],
        [5, 0],
        [10, 0.5], // ~5.7° kink
        [10, 10],
        [0, 10],
      ],
    };
    const v = prismEdges(poly, 0, 3, { bottom: false, top: false });
    expect(v.length / 6).toBe(4);
  });
  it('builds storey lines per level', () => {
    expect(storeyLines(withHole, [3, 6, 9]).length / 6).toBe(3 * 8);
  });
  it('dash-dot pattern covers the expected share of the outline', () => {
    const segs = dashDotSegments(sq(0, 0, 32), 0, [4, 1, 0.4, 1]); // perimeter 128 = 20 patterns
    let len = 0;
    for (let i = 0; i < segs.length; i += 6)
      len += Math.hypot(segs[i + 3]! - segs[i]!, segs[i + 4]! - segs[i + 1]!);
    expect(len).toBeCloseTo(128 * (4.4 / 6.4), 4);
  });
});

describe('context merge', () => {
  const b = (id: string, extra: Partial<ContextBuilding> = {}): ContextBuilding => ({
    id,
    footprint: { outer: sq(id.length * 20, 0, 10) },
    height: 9,
    source: 'ign',
    heightEstimated: false,
    ...extra,
  });
  it('merges visible buildings and maps triangles back to ids', () => {
    const single = extrudePolygon({ outer: sq(0, 0, 10) }, 0, 9)!;
    const n = single.getAttribute('position').count;
    const geo = buildContextGeometry([
      b('a'),
      b('bb', { heightEstimated: true }),
      b('ccc', { hidden: true }),
      b('dddd', { demolished: true }),
    ]);
    expect(geo.faces!.getAttribute('position').count).toBe(2 * n);
    expect(geo.ids).toEqual(['a', 'bb']);
    expect(contextIdAt(geo, 0)).toBe('a');
    expect(contextIdAt(geo, n / 3)).toBe('bb');
    expect(geo.edges.length / 6).toBe(12);
    expect(geo.edgesEstimated.length / 6).toBe(12);
    expect(geo.edgesDemolished.length / 6).toBe(12);
  });
});

describe('colours', () => {
  it('maps every usage to a distinct colour', () => {
    expect(usageColor('wohnen')).toBe(USAGE_COLORS.wohnen);
    expect(new Set(Object.values(USAGE_COLORS)).size).toBe(6);
  });
});

describe('camera fit', () => {
  it('fits a box so its bounding sphere fills the narrower fov', () => {
    const box = expandBox(expandBox(emptyBox(), -10, -10, 0), 10, 10, 0);
    const r = fitBox(box, [0, 0, 1], 90, 1, 1);
    expect(r.target).toEqual([0, 0, 0]);
    expect(r.distance).toBeCloseTo(Math.hypot(20, 20) / 2 / Math.sin(Math.PI / 4), 6);
    expect(r.position[2]).toBeCloseTo(r.distance);
    // portrait viewport → horizontal fov limits → farther away
    expect(fitBox(box, [0, 0, 1], 90, 0.5, 1).distance).toBeGreaterThan(r.distance);
  });
  it('computes ortho zoom and nav cube regions', () => {
    expect(orthoZoomFor(50, 90, 1000)).toBeCloseTo(10);
    expect(cubeRegion([0.1, -0.2, 0.5])).toEqual([0, 0, 1]);
    expect(cubeRegion([0.45, -0.5, 0.1])).toEqual([1, -1, 0]);
    expect(cubeRegion([-0.5, 0.4, 0.45])).toEqual([-1, 1, 1]);
  });
});
