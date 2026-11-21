import { describe, expect, it } from 'vitest';
import { massFootprints } from '@kubatur/core';
import { palaiseauDemo } from '../../demo/palaiseau';
import { magnetSnap } from './magnet';
import { selectionCentroid } from './math';
import { collectSnapGeometry } from './snap';

/**
 * Regression (Soheyl, 2026-11-21): the volume of the Palaiseau project (rotated 6.9°, site
 * boundary at −10°) did not snap to the site boundary.
 */
describe('magnet on the Palaiseau site boundary', () => {
  const p = palaiseauDemo();
  const v = p.variants[0]!;
  const m = v.masses[0]!;
  const geom = collectSnapGeometry(p, v.masses, [m.id]);
  const fp = massFootprints(m);

  it('ignores demolished buildings', () => {
    const demolished = p.context.filter((c) => c.demolished);
    expect(demolished.length).toBeGreaterThan(0);
    for (const c of demolished)
      for (const q of c.footprint.outer) expect(geom.edges.some((e) => e[0] === q)).toBe(false);
  });

  for (const [i, [a, b]] of geom.siteEdges.entries()) {
    it(`snaps flush onto site edge ${i}`, () => {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n: [number, number] = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
      const off = (q: [number, number]) => (q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1];
      const pts = fp.flatMap((f) => f.outer);
      const nearest = Math.min(...pts.map((q) => Math.abs(off(q))));
      const sgn = Math.sign(pts.reduce((s, q) => s + off(q), 0));
      // nearest corner 0.8 m from the boundary line
      const d: [number, number] = [-sgn * n[0] * (nearest - 0.8), -sgn * n[1] * (nearest - 0.8)];
      const polys = massFootprints({
        ...m,
        position: [m.position[0] + d[0], m.position[1] + d[1]],
      });
      const c = selectionCentroid([m]);
      const r = magnetSnap(polys, geom.edges, {
        tol: 1.8,
        rotate: true,
        pivot: [c[0] + d[0], c[1] + d[1]],
        priority: geom.siteEdges,
      });
      expect(['flush', 'flush2', 'corner']).toContain(r.kind);
      expect(geom.siteEdges).toContain(r.guides[0]);
      expect((r.rotation * 180) / Math.PI).toBeCloseTo(-17, 0);
    });
  }
});
