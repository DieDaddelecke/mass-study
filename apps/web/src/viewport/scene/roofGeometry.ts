import { roofZ, type RoofPiece, type Vec2 } from '@kubatur/core';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';

/**
 * 3D geometry of pitched roof faces: the sloped top of every piece plus the gable / eaves walls
 * between the top slab and the roof plane (seam edges are internal and get no wall).
 */
export function roofGeometry(pieces: readonly RoofPiece[]): {
  geometry: BufferGeometry | null;
  edges: number[];
} {
  const pos: number[] = [];
  const edges: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (const pc of pieces) {
    const outer = pc.polygon.outer;
    if (outer.length < 3) continue;
    const z = (p: Vec2) => roofZ(pc, p);
    const holes = pc.polygon.holes ?? [];
    const faces = ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p[0], p[1])),
      holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))),
    );
    const all = [...outer, ...holes.flat()];
    const ccw = ShapeUtils.isClockWise(outer.map((p) => new Vector2(p[0], p[1]))) ? -1 : 1;
    for (const f of faces) {
      const [a, b, c] = f.map((i) => all[i]!) as [Vec2, Vec2, Vec2];
      const A = [a[0], a[1], z(a)];
      const B = [b[0], b[1], z(b)];
      const C = [c[0], c[1], z(c)];
      if (ccw > 0) tri(A, B, C);
      else tri(A, C, B);
    }
    const rings = [outer, ...holes];
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const za = z(a);
        const zb = z(b);
        const seam = ri === 0 && pc.seams[i];
        edges.push(a[0], a[1], za, b[0], b[1], zb);
        if (seam) continue;
        if (za - pc.z0 < 1e-3 && zb - pc.z0 < 1e-3) continue;
        // wall from the slab up to the roof plane (both orientations: double-sided material)
        const a0 = [a[0], a[1], pc.z0];
        const b0 = [b[0], b[1], pc.z0];
        const a1 = [a[0], a[1], za];
        const b1 = [b[0], b[1], zb];
        tri(a0, b0, b1);
        tri(a0, b1, a1);
        // vertical edges where the wall has height and the neighbour edge is a seam or a corner
        if (za - pc.z0 > 1e-3) edges.push(a[0], a[1], pc.z0, a[0], a[1], za);
        if (zb - pc.z0 > 1e-3) edges.push(b[0], b[1], pc.z0, b[0], b[1], zb);
      }
    });
  }
  if (!pos.length) return { geometry: null, edges };
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geometry: g, edges };
}
