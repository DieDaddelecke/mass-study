import { describe, expect, it } from 'vitest';
import type { Polygon, Vec2 } from '@kubatur/core';
import {
  axoProjection,
  hiddenLine,
  horizontalProjection,
  prismFromPolygon,
  projectPoint,
  type Prism,
  type Projection,
  type VisibleSegment,
} from '../src/index.js';

const box = (x0: number, y0: number, x1: number, y1: number): Polygon => ({
  outer: [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ],
});
const prism = (p: Polygon, z0: number, z1: number, id = 'p'): Prism =>
  prismFromPolygon(p, z0, z1, 'mass', id);
const len = (s: VisibleSegment) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
/** Visible length along the projected 3D segment p→q. */
function visibleAlong(
  segs: VisibleSegment[],
  P: Projection,
  p: [number, number, number],
  q: [number, number, number],
) {
  const a = projectPoint(P, p);
  const b = projectPoint(P, q);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  let total = 0;
  for (const s of segs) {
    const on = (x: Vec2) => Math.abs((x[0] - a[0]) * -uy + (x[1] - a[1]) * ux) < 1e-6;
    if (!on(s.a) || !on(s.b)) continue;
    const t0 = (s.a[0] - a[0]) * ux + (s.a[1] - a[1]) * uy;
    const t1 = (s.b[0] - a[0]) * ux + (s.b[1] - a[1]) * uy;
    total += Math.max(0, Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)));
  }
  return total;
}

describe('hidden-line removal', () => {
  it('two boxes one behind the other: only the part above the front box is visible', () => {
    // viewer in the south (looks north): screen x = x
    const P = horizontalProjection([0, 1]);
    const front = prism(box(0, 0, 10, 10), 0, 10, 'front');
    const back = prism(box(-5, 20, 15, 30), 0, 20, 'back');
    const { segments } = hiddenLine([front, back], P);
    const backSegs = segments.filter((s) => s.prism === back);
    expect(backSegs.length).toBeGreaterThan(0);
    // nothing of the back box inside the front box's silhouette
    for (const s of backSegs) {
      for (const t of [0.01, 0.5, 0.99]) {
        const x = s.a[0] + (s.b[0] - s.a[0]) * t;
        const z = s.a[1] + (s.b[1] - s.a[1]) * t;
        expect(x > 0.001 && x < 9.999 && z < 9.999).toBe(false);
      }
    }
    // outer vertical edges fully visible, bottom edge only beside the front box, top edge fully
    expect(visibleAlong(backSegs, P, [-5, 20, 0], [-5, 20, 20])).toBeCloseTo(20, 2);
    expect(visibleAlong(backSegs, P, [15, 20, 0], [15, 20, 20])).toBeCloseTo(20, 2);
    expect(visibleAlong(backSegs, P, [-5, 20, 0], [15, 20, 0])).toBeCloseTo(10, 2);
    expect(visibleAlong(backSegs, P, [-5, 20, 20], [15, 20, 20])).toBeCloseTo(20, 2);
    // front box fully visible: 4 sides of the rectangle
    const frontLen = segments.filter((s) => s.prism === front).reduce((a, s) => a + len(s), 0);
    expect(frontLen).toBeCloseTo(40, 2);
  });

  it('L-shape: the inner corner is visible from the NE and hidden from the SE', () => {
    const L: Polygon = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 8],
        [8, 8],
        [8, 20],
        [0, 20],
      ],
    };
    const pr = prism(L, 0, 10);
    const ne = axoProjection('NE', 'iso');
    const r1 = hiddenLine([pr], ne);
    expect(visibleAlong(r1.segments, ne, [8, 8, 0], [8, 8, 10])).toBeCloseTo(
      Math.hypot(
        ...(projectPoint(ne, [0, 0, 10]).map((v, i) => v - projectPoint(ne, [0, 0, 0])[i]!) as [
          number,
          number,
        ]),
      ),
      2,
    );
    const se = axoProjection('SE', 'iso');
    expect(visibleAlong(hiddenLine([pr], se).segments, se, [8, 8, 0], [8, 8, 10])).toBeLessThan(
      0.002,
    );
    const sw = axoProjection('SW', 'iso');
    const r2 = hiddenLine([pr], sw);
    // the SW corner is fully visible from the SW
    expect(visibleAlong(r2.segments, sw, [0, 0, 0], [0, 0, 10])).toBeGreaterThan(5);
  });

  it('courtyard: far inner corner visible only above the sight line over the roof edge', () => {
    const court: Polygon = {
      outer: box(0, 0, 30, 30).outer,
      holes: [
        [
          [12, 12],
          [12, 18],
          [18, 18],
          [18, 12],
        ],
      ],
    };
    const pr = prism(court, 0, 10);
    const P = axoProjection('SW', 'iso');
    const { segments } = hiddenLine([pr], P);
    const full = Math.hypot(
      ...(projectPoint(P, [0, 0, 10]).map((v, i) => v - projectPoint(P, [0, 0, 0])[i]!) as [
        number,
        number,
      ]),
    );
    // sight line: tan(35.26°) = 1/√2, diagonal 6√2 → hidden up to z = 10 − 6√2/√2... = 4
    const vis = visibleAlong(segments, P, [18, 18, 0], [18, 18, 10]);
    expect(vis / full).toBeCloseTo(0.6, 3);
    // near inner corner (12,12) is a back corner: hidden
    expect(visibleAlong(segments, P, [12, 12, 0], [12, 12, 10])).toBeLessThan(0.002);
  });

  it('set-back storey: roof edge of the base visible, shared storey line optional', () => {
    const base = prism(box(0, 0, 20, 10), 0, 3, 'base');
    const top = prism(box(0, 0, 20, 6), 3, 6, 'top');
    const N = horizontalProjection([0, -1]);
    const rN = hiddenLine([base, top], N);
    // viewer in the north: screen x = −x
    expect(
      rN.segments.some(
        (s) =>
          s.prism === base &&
          Math.abs(s.a[1] - 3) < 1e-9 &&
          Math.abs(s.b[1] - 3) < 1e-9 &&
          len(s) > 19.99,
      ),
    ).toBe(true);
    expect(
      rN.segments.some((s) => s.prism === top && Math.abs(s.a[1] - 6) < 1e-9 && len(s) > 19.99),
    ).toBe(true);
    const S = horizontalProjection([0, 1]);
    const withLines = hiddenLine([base, top], S, { storeyLines: true });
    expect(withLines.segments.filter((s) => s.cls === 'storey').length).toBeGreaterThan(0);
    const noLines = hiddenLine([base, top], S, { storeyLines: false });
    expect(
      noLines.segments.some((s) => Math.abs(s.a[1] - 3) < 1e-9 && Math.abs(s.b[1] - 3) < 1e-9),
    ).toBe(false);
  });
});
