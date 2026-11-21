import { describe, expect, it } from 'vitest';
import {
  cleanRing,
  convexHull,
  difference,
  inscribedRadius,
  intersection,
  normalizePolygon,
  offsetPolygons,
  offsetPolyline,
  orientedExtents,
  pointInPolygon,
  polygonArea,
  polygonDistance,
  polygonPerimeter,
  polygonsArea,
  rect,
  ringCentroid,
  shiftPolyline,
  signedRingArea,
  transformPolygon,
  union,
} from '../src/index.js';

describe('rings', () => {
  it('area, orientation, perimeter, centroid', () => {
    const r = rect(0, 0, 10, 4);
    expect(signedRingArea(r.outer)).toBe(40);
    expect(signedRingArea([...r.outer].reverse())).toBe(-40);
    expect(polygonPerimeter(r)).toBe(28);
    expect(ringCentroid(r.outer)).toEqual([5, 2]);
  });

  it('normalises orientation and removes closing points', () => {
    const p = normalizePolygon({
      outer: [
        [0, 0],
        [0, 10],
        [10, 10],
        [10, 0],
        [0, 0],
      ],
      holes: [rect(2, 2, 4, 4).outer],
    });
    expect(p.outer).toHaveLength(4);
    expect(signedRingArea(p.outer)).toBeGreaterThan(0);
    expect(signedRingArea(p.holes![0]!)).toBeLessThan(0);
    expect(polygonArea(p)).toBe(96);
    expect(
      cleanRing([
        [0, 0],
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toHaveLength(3);
  });
});

describe('boolean operations', () => {
  it('union of overlapping squares', () => {
    const u = union([rect(0, 0, 10, 10), rect(5, 0, 15, 10)]);
    expect(u).toHaveLength(1);
    expect(polygonsArea(u)).toBeCloseTo(150, 6);
  });

  it('union keeps courtyards as holes', () => {
    const u = union([
      rect(0, 0, 30, 10),
      rect(0, 20, 30, 30),
      rect(0, 0, 10, 30),
      rect(20, 0, 30, 30),
    ]);
    expect(u).toHaveLength(1);
    expect(u[0]!.holes).toHaveLength(1);
    expect(polygonArea(u[0]!)).toBeCloseTo(800, 6);
  });

  it('intersection and difference', () => {
    expect(polygonsArea(intersection([rect(0, 0, 10, 10)], [rect(5, 5, 15, 15)]))).toBeCloseTo(
      25,
      6,
    );
    expect(polygonsArea(difference([rect(0, 0, 10, 10)], [rect(5, 5, 15, 15)]))).toBeCloseTo(75, 6);
    expect(intersection([], [rect(0, 0, 1, 1)])).toEqual([]);
  });

  it('offsets polygons with mitred corners', () => {
    expect(polygonsArea(offsetPolygons([rect(0, 0, 10, 10)], 1))).toBeCloseTo(144, 4);
    expect(polygonsArea(offsetPolygons([rect(0, 0, 10, 10)], -2))).toBeCloseTo(36, 4);
    expect(offsetPolygons([rect(0, 0, 2, 2)], -2)).toEqual([]);
  });
});

describe('polyline bands', () => {
  it('open L-shaped line, centred, with mitre', () => {
    const band = offsetPolyline(
      [
        [0, 0],
        [30, 0],
        [30, 20],
      ],
      false,
      10,
      'center',
    );
    expect(band).toHaveLength(1);
    // centre-line length 50 → 50 × 10 (mitred corner keeps the area exact)
    expect(polygonsArea(band)).toBeCloseTo(500, 3);
  });

  it('left / right alignment keeps the area and moves the band', () => {
    const left = offsetPolyline(
      [
        [0, 0],
        [20, 0],
      ],
      false,
      6,
      'left',
    );
    const right = offsetPolyline(
      [
        [0, 0],
        [20, 0],
      ],
      false,
      6,
      'right',
    );
    expect(polygonsArea(left)).toBeCloseTo(120, 4);
    expect(Math.min(...left[0]!.outer.map((p) => p[1]))).toBeCloseTo(0, 4);
    expect(Math.max(...right[0]!.outer.map((p) => p[1]))).toBeCloseTo(0, 4);
  });

  it('closed line produces a courtyard', () => {
    const band = offsetPolyline(rect(0, 0, 40, 40).outer, true, 10, 'center');
    expect(band).toHaveLength(1);
    expect(band[0]!.holes).toHaveLength(1);
    expect(polygonArea(band[0]!)).toBeCloseTo(50 * 50 - 30 * 30, 3);
  });

  it('closed line aligned inside keeps the outer edge', () => {
    const band = offsetPolyline(rect(0, 0, 40, 40).outer, true, 10, 'left');
    expect(polygonArea(band[0]!)).toBeCloseTo(1600 - 400, 3);
  });

  it('shiftPolyline offsets to the left', () => {
    expect(
      shiftPolyline(
        [
          [0, 0],
          [10, 0],
        ],
        2,
      ),
    ).toEqual([
      [0, 2],
      [10, 2],
    ]);
  });

  it('degenerate input', () => {
    expect(offsetPolyline([[0, 0]], false, 5, 'center')).toEqual([]);
    expect(
      offsetPolyline(
        [
          [0, 0],
          [1, 0],
        ],
        true,
        5,
        'center',
      ),
    ).toEqual([]);
  });
});

describe('queries', () => {
  it('inscribed radius and oriented extents', () => {
    expect(inscribedRadius(rect(0, 0, 20, 12))).toBeCloseTo(6, 1);
    const rot = transformPolygon(rect(0, 0, 30, 10), [5, 5], 0.5);
    const e = orientedExtents(rot.outer);
    expect(e.length).toBeCloseTo(30, 6);
    expect(e.width).toBeCloseTo(10, 6);
    expect(
      convexHull([
        [0, 0],
        [1, 1],
        [2, 0],
        [1, 0.2],
        [1, -1],
      ]),
    ).toHaveLength(4);
  });

  it('point in polygon respects holes', () => {
    const p = { outer: rect(0, 0, 10, 10).outer, holes: [rect(4, 4, 6, 6).outer.reverse()] };
    expect(pointInPolygon([1, 1], p)).toBe(true);
    expect(pointInPolygon([5, 5], p)).toBe(false);
    expect(pointInPolygon([11, 5], p)).toBe(false);
  });

  it('distance between polygons', () => {
    expect(polygonDistance(rect(0, 0, 10, 10), rect(13, 0, 20, 10))).toBeCloseTo(3);
    expect(polygonDistance(rect(0, 0, 10, 10), rect(5, 5, 20, 10))).toBe(0);
  });
});
