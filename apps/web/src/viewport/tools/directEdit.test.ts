import { createMass, type Vec2 } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import {
  applyFace,
  massFaces,
  offsetRingEdge,
  parseTyped,
  ringEdgeNormal,
  screenAxisDelta,
  sideSize,
} from './math';

const square: Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('direct editing geometry', () => {
  it('outward normals for both orientations', () => {
    expect(ringEdgeNormal(square, 0)).toEqual([0, -1]);
    const cw = [...square].reverse();
    // cw edge 0: (0,10) → (10,10), outward is +y
    const n = ringEdgeNormal(cw, 0);
    expect(n[0]).toBeCloseTo(0);
    expect(n[1]).toBeCloseTo(1);
  });

  it('pushes a polygon edge keeping neighbours straight', () => {
    const r = offsetRingEdge(square, 0, 2);
    expect(r).toEqual([
      [0, -2],
      [10, -2],
      [10, 10],
      [0, 10],
    ]);
    const pulled = offsetRingEdge(square, 1, -3);
    expect(pulled[1]).toEqual([7, 0]);
    expect(pulled[2]).toEqual([7, 10]);
  });

  it('slides end points along oblique neighbours', () => {
    const trap: Vec2[] = [
      [0, 0],
      [10, 0],
      [8, 5],
      [2, 5],
    ];
    const r = offsetRingEdge(trap, 2, 1); // top edge up by 1
    expect(r[2]![1]).toBeCloseTo(6);
    expect(r[3]![1]).toBeCloseTo(6);
    // end points stay on the extended oblique sides
    expect(r[2]![0]).toBeCloseTo(7.6);
    expect(r[3]![0]).toBeCloseTo(1.6 + 0.8);
  });

  it('collinear neighbour: extends along the normal', () => {
    const r: Vec2[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const o = offsetRingEdge(r, 1, 2); // edge (5,0)→(10,0), neighbour (0,0)→(5,0) is collinear
    expect(o[1]).toEqual([5, -2]);
    expect(o[2]).toEqual([10, -2]);
  });

  it('faces of a Zeile are its four sides, pushing one changes the size', () => {
    const m = createMass('zeile', { position: [0, 0], rotation: 0 });
    const faces = massFaces(m);
    expect(faces).toHaveLength(4);
    const depthPlus = faces.find(
      (f) => f.kind === 'side' && f.grip.axis === 'depth' && f.grip.sign === 1,
    )!;
    expect(depthPlus.normal).toEqual([0, 1]);
    const d0 = sideSize(m.typology, 'depth')!;
    const r = applyFace(m, depthPlus, 2.5);
    expect(sideSize(r.typology, 'depth')).toBeCloseTo(d0 + 2.5);
  });

  it('faces of a free polygon are its edges, pushing keeps the others', () => {
    const m = createMass('freePolygon', { position: [100, 50], rotation: Math.PI / 2 });
    m.typology = { kind: 'freePolygon', polygon: { outer: square } };
    const faces = massFaces(m);
    expect(faces).toHaveLength(4);
    // local normal (0,-1) rotated by 90° → (1, 0)
    expect(faces[0]!.normal[0]).toBeCloseTo(1);
    const r = applyFace(m, faces[0]!, 3);
    expect(r.typology.kind === 'freePolygon' && r.typology.polygon.outer[0]).toEqual([0, -3]);
  });

  it('refuses to collapse a polygon', () => {
    const m = createMass('freePolygon', { position: [0, 0], rotation: 0 });
    m.typology = { kind: 'freePolygon', polygon: { outer: square } };
    const r = applyFace(m, massFaces(m)[0]!, -10);
    expect(r.typology).toBe(m.typology);
  });

  it('screen axis delta', () => {
    expect(screenAxisDelta([0, 0], [10, 0], [25, 7])).toBeCloseTo(2.5);
    expect(screenAxisDelta([0, 0], [0, -20], [3, 40])).toBeCloseTo(-2);
    expect(screenAxisDelta([0, 0], [0.5, 0.5], [10, 10])).toBeNull();
  });

  it('parses typed numbers', () => {
    expect(parseTyped('12,5')).toBe(12.5);
    expect(parseTyped('-3')).toBe(-3);
    expect(parseTyped('-')).toBeNull();
  });
});
