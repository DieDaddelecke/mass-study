import type { ContextRoad, ContextTree, LocalFrame } from '@kubatur/core';
import { lonLatToCrs } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { syntheticSurroundings } from '../../demo/syntheticSurroundings';
import { mosaicQuad } from './Basemap';
import {
  buildRoadRibbons,
  flatArea,
  flatPolygonsGeometry,
  hedgeGeometry,
} from './surroundingsGeometry';
import { buildTreeInstances, scatterTreesInGreen } from './treeInstances';
import {
  lonLatToTile,
  mosaicCorners,
  tileRangeForLocalBox,
  tileToLonLat,
  zoomForRadius,
} from './tiles';

const road = (
  id: string,
  kind: ContextRoad['kind'],
  centerline: [number, number][],
  width: number,
  level: ContextRoad['level'] = 0,
): ContextRoad => ({
  id,
  kind,
  centerline,
  width,
  level,
  widthEstimated: false,
  source: 'manual',
});

describe('road ribbons', () => {
  it('builds a ribbon of length × width', () => {
    const r = buildRoadRibbons([
      road(
        'a',
        'residential',
        [
          [0, 0],
          [100, 0],
        ],
        8,
      ),
    ]);
    expect(r.groups).toHaveLength(1);
    const g = flatPolygonsGeometry(r.groups[0]!.polygons, 0)!;
    expect(flatArea(g)).toBeCloseTo(800, 0);
  });
  it('unions crossing roads of one class, separates classes and drops tunnels', () => {
    const r = buildRoadRibbons([
      road(
        'a',
        'residential',
        [
          [-50, 0],
          [50, 0],
        ],
        10,
      ),
      road(
        'b',
        'primary',
        [
          [0, -50],
          [0, 50],
        ],
        10,
      ),
      road(
        'c',
        'footway',
        [
          [-50, 10],
          [50, 10],
        ],
        2,
      ),
      road(
        'd',
        'motorway',
        [
          [0, 0],
          [10, 10],
        ],
        20,
        -1,
      ),
      road(
        'e',
        'rail',
        [
          [0, 30],
          [50, 30],
        ],
        4,
        1,
      ),
    ]);
    const cw = r.groups.find((g) => g.cls === 'carriageway')!;
    expect(flatArea(flatPolygonsGeometry(cw.polygons, 0)!)).toBeCloseTo(1900, 0);
    expect(r.groups.map((g) => `${g.cls}:${g.level}`).sort()).toEqual([
      'carriageway:0',
      'footway:0',
      'rail:1',
    ]);
  });
  it('triangulates polygons with holes', () => {
    const g = flatPolygonsGeometry(
      [
        {
          outer: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          holes: [
            [
              [2, 2],
              [4, 2],
              [4, 4],
              [2, 4],
            ],
          ],
        },
      ],
      0,
    )!;
    expect(flatArea(g)).toBeCloseTo(96, 5);
    expect(
      hedgeGeometry(
        [
          {
            outer: [
              [0, 0],
              [10, 0],
              [10, 1],
              [0, 1],
            ],
          },
        ],
        0.8,
      ),
    ).not.toBeNull();
  });
});

describe('tree instances', () => {
  const tree = (id: string, leafType?: ContextTree['leafType']): ContextTree => ({
    id,
    position: [1, 2],
    height: 10,
    crown: 6,
    heightEstimated: false,
    leafType,
    source: 'manual',
  });
  it('splits crowns by leaf type and makes one trunk per tree', () => {
    const t = buildTreeInstances([tree('a'), tree('b', 'needleleaved'), tree('c')], '#88aa88');
    expect(t.broad.count).toBe(2);
    expect(t.needle.count).toBe(1);
    expect(t.trunks.count).toBe(3);
    // crown centre at 0.65 × height
    expect(t.broad.matrices[14]).toBeCloseTo(6.5, 5);
    expect(t.broad.matrices[12]).toBe(1);
  });
  it('is deterministic and fast for 2000 trees', () => {
    const many = Array.from({ length: 2000 }, (_, i) => tree(`t${i}`));
    const t0 = performance.now();
    const a = buildTreeInstances(many, '#88aa88');
    expect(performance.now() - t0).toBeLessThan(200);
    expect(a.broad.count).toBe(2000);
    expect(buildTreeInstances(many, '#88aa88').broad.matrices).toEqual(a.broad.matrices);
  });
});

describe('tiles', () => {
  it('converts lon/lat ↔ tile coordinates', () => {
    expect(lonLatToTile(0, 0, 1)).toEqual([1, 1]);
    const [x, y] = lonLatToTile(2.1983, 48.7129, 17);
    expect(Math.floor(x)).toBe(66336);
    expect(Math.floor(y)).toBe(45171);
    const [lon, lat] = tileToLonLat(x, y, 17);
    expect(lon).toBeCloseTo(2.1983, 8);
    expect(lat).toBeCloseTo(48.7129, 8);
    expect(zoomForRadius(150)).toBe(18);
    expect(zoomForRadius(300)).toBe(17);
  });
  it('maps the mosaic corners into the local Lambert-93 frame', () => {
    const frame: LocalFrame = {
      crs: 'EPSG:2154',
      originCrs: lonLatToCrs('EPSG:2154', [2.1983, 48.7129]),
    };
    const r = tileRangeForLocalBox(frame, [-150, -150], [150, 150], 18);
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(2);
    const [nw, ne, se, sw] = mosaicCorners(frame, r);
    // covers the requested box
    expect(Math.min(nw[0], sw[0])).toBeLessThanOrEqual(-150);
    expect(Math.max(ne[0], se[0])).toBeGreaterThanOrEqual(150);
    expect(Math.min(sw[1], se[1])).toBeLessThanOrEqual(-150);
    expect(Math.max(nw[1], ne[1])).toBeGreaterThanOrEqual(150);
    // tile edge ≈ 101.8 m × cos(lat)… on the ground; Lambert-93 rotation is small but non-zero
    const w = Math.hypot(ne[0] - nw[0], ne[1] - nw[1]) / (r.x1 - r.x0 + 1);
    expect(w).toBeGreaterThan(95);
    expect(w).toBeLessThan(105);
    const g = mosaicQuad([nw, ne, se, sw], 0);
    expect(g.getIndex()!.count).toBe(6);
  });
});

describe('synthetic surroundings', () => {
  it('has streets, ~40+ trees, a park and parcels', () => {
    const s = syntheticSurroundings();
    expect(s.roads.some((r) => r.name === 'D 128')).toBe(true);
    expect(s.trees.length).toBeGreaterThanOrEqual(40);
    expect(s.green.some((g) => g.kind === 'park')).toBe(true);
    expect(s.parcels.length).toBeGreaterThan(3);
  });
});

describe('scatterTreesInGreen', () => {
  const wood = {
    id: 'w1',
    kind: 'wood' as const,
    source: 'ign' as const,
    footprint: {
      outer: [
        [0, 0],
        [70, 0],
        [70, 70],
        [0, 70],
      ] as [number, number][],
    },
  };
  it('fills woods on a jittered grid, deterministically, and skips excluded areas', () => {
    const a = scatterTreesInGreen([wood]);
    expect(a.length).toBe(100); // 70 / 7 = 10 × 10
    expect(scatterTreesInGreen([wood])).toEqual(a);
    expect(a.every((t) => t.height >= 13 && t.height <= 20)).toBe(true);
    const half = {
      outer: [
        [0, 0],
        [35, 0],
        [35, 70],
        [0, 70],
      ] as [number, number][],
    };
    const b = scatterTreesInGreen([wood], [half]);
    expect(b.length).toBeGreaterThan(30);
    expect(b.length).toBeLessThan(70);
  });
  it('ignores kinds without scatter rules', () => {
    expect(scatterTreesInGreen([{ ...wood, kind: 'grass' }])).toEqual([]);
  });
});
