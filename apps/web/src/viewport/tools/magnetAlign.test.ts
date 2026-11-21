import { describe, expect, it } from 'vitest';
import { rect, massFootprints, polygonArea, type Mass } from '@kubatur/core';
import { facadeMagnet, magnetSnap } from './magnet';
import { alignFacade, alignVolume, moveEdgeOntoLine, pickEdge, type PickableEdge } from './align';
import { polygonEdges, type Segment } from './snap';

const target = polygonEdges(rect(0, 0, 20, 10));

describe('magnetSnap', () => {
  it('pulls a façade flush onto a parallel edge and the corner in line', () => {
    // box 10 × 10 right of the target, 0.4 m gap, 0.3 m shifted up
    const r = magnetSnap([rect(20.4, 0.3, 30.4, 10.3)], target, { tol: 1 });
    expect(r.delta[0]).toBeCloseTo(-0.4);
    expect(r.delta[1]).toBeCloseTo(-0.3);
    expect(r.kind === 'corner' || r.kind === 'flush2').toBe(true);
  });

  it('rotates an almost parallel volume', () => {
    const a = (3 * Math.PI) / 180;
    const c: [number, number] = [25.5, 5];
    const box = rect(20.5, 0, 30.5, 10).outer.map(([x, y]): [number, number] => {
      const dx = x - c[0];
      const dy = y - c[1];
      return [
        c[0] + dx * Math.cos(a) - dy * Math.sin(a),
        c[1] + dx * Math.sin(a) + dy * Math.cos(a),
      ];
    });
    const r = magnetSnap([{ outer: box }], target, { tol: 1, rotate: true, pivot: c });
    expect(r.rotation).toBeCloseTo(-a, 6);
  });

  it('does nothing far away', () => {
    expect(magnetSnap([rect(40, 40, 50, 50)], target, { tol: 1 }).kind).toBe('none');
  });

  it('façade grip snaps flush on a parallel edge', () => {
    const f: Segment = [
      [19.6, 2],
      [19.6, 8],
    ];
    const r = facadeMagnet(f, [1, 0], target, 1);
    expect(r?.offset).toBeCloseTo(0.4);
  });
});

const mass = (over: Partial<Mass> = {}): Mass => ({
  id: 'm',
  name: 'V1',
  typology: { kind: 'solitaer', length: 20, depth: 10 },
  position: [0, 0],
  rotation: 0,
  storeys: {
    basement: { count: 0, height: 3 },
    ground: { height: 3 },
    upper: { count: 2, height: 3 },
    parapet: 0.5,
    slabThickness: 0.3,
  },
  ...over,
});

describe('align', () => {
  it('moves a parallel façade with the side grip (typology kept)', () => {
    const m = mass();
    const r = alignFacade(
      m,
      [
        [10, -5],
        [10, 5],
      ],
      [
        [14, -20],
        [14, 20],
      ],
    );
    expect(r?.typology).toMatchObject({ kind: 'solitaer', length: 24 });
  });

  it('inclines a façade onto an oblique reference (free polygon)', () => {
    const m = mass();
    const r = alignFacade(
      m,
      [
        [10, -5],
        [10, 5],
      ],
      [
        [12, -5],
        [14, 5],
      ],
    );
    expect(r?.typology.kind).toBe('freePolygon');
    const fp = massFootprints({ ...m, ...r! })[0]!;
    expect(polygonArea(fp)).toBeCloseTo(20 * 10 + 10 * 3);
  });

  it('moveEdgeOntoLine slides the end points along the neighbours', () => {
    const ring = rect(0, 0, 10, 10).outer;
    const out = moveEdgeOntoLine(ring, 1, [12, 0], [0, 1]);
    expect(out[1]).toEqual([12, 0]);
    expect(out[2]).toEqual([12, 10]);
  });

  it('aligns the whole volume (rotation + translation)', () => {
    const r = alignVolume(
      mass(),
      [
        [10, -5],
        [10, 5],
      ],
      [
        [20, 0],
        [21, 10],
      ],
    );
    expect(Math.abs(r.rotation)).toBeCloseTo(Math.atan(0.1), 6);
  });

  it('picks the wall hit by the ray', () => {
    const edges: PickableEdge[] = [
      {
        seg: [
          [0, 0],
          [10, 0],
        ],
        z0: 0,
        z1: 9,
        kind: 'mass',
        massId: 'a',
      },
      {
        seg: [
          [0, 5],
          [10, 5],
        ],
        z0: 0,
        z1: 9,
        kind: 'mass',
        massId: 'b',
      },
    ];
    const hit = pickEdge(edges, [5, -20, 4], [0, 1, 0], 0.5);
    expect(hit?.massId).toBe('a');
  });
});

describe('align multi-section Zeile', () => {
  it('turns the sections into one clean outline', () => {
    const m = mass({
      typology: { kind: 'zeile', length: 30, depth: 10, sections: 3, sectionOffset: 0 },
    });
    const r = alignFacade(
      m,
      [
        [0, 5],
        [0, -5],
      ],
      [
        [-2, -5],
        [-4, 5],
      ],
    );
    expect(r?.typology.kind).toBe('freePolygon');
    if (r?.typology.kind === 'freePolygon') expect(r.typology.polygon.outer).toHaveLength(4);
  });
});

describe('magnet on an oblique boundary', () => {
  // site edge at −10°, volume at +7° (17° apart), 0.8 m away
  const a = (-10 * Math.PI) / 180;
  const edge: Segment = [
    [-40 * Math.cos(a), -40 * Math.sin(a)],
    [40 * Math.cos(a), 40 * Math.sin(a)],
  ];
  const box = (rot: number, off: number) =>
    rect(-15, 0, 15, 12).outer.map(([x, y]): [number, number] => {
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      return [x * c - y * s, x * s + y * c + off];
    });
  it('turns the volume parallel when it is close', () => {
    const r = magnetSnap([{ outer: box((7 * Math.PI) / 180, 5.3) }], [edge], {
      tol: 2,
      rotate: true,
      pivot: [0, 9],
    });
    expect((r.rotation * 180) / Math.PI).toBeCloseTo(-17, 0);
    // and the façade lies on the boundary afterwards
    expect(r.kind === 'flush' || r.kind === 'flush2' || r.kind === 'corner').toBe(true);
  });
  it('puts a corner on the boundary without rotation', () => {
    const r = magnetSnap([{ outer: box((7 * Math.PI) / 180, 5.3) }], [edge], {
      tol: 2,
      rotate: false,
    });
    expect(r.kind).toBe('onEdge');
  });
});
