import { defaultTypology, massFootprints, createMass, type Vec2 } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import type { SnapSettings } from '../../store/tools';
import {
  applySideGrip,
  freeLinePlacement,
  heightGripCount,
  isClosingClick,
  isRepeatClick,
  mirrorMass,
  moveVertex,
  pointAtLength,
  rotateAbout,
  selectionCentroid,
  twoClickPlacement,
} from './math';
import { snapAngle, snapPoint, type SnapGeometry } from './snap';

const S: SnapSettings = {
  enabled: true,
  endpoints: true,
  midpoints: true,
  edges: true,
  angle: true,
  angleStep: 15,
  grid: true,
  gridSize: 0.5,
};
const geom: SnapGeometry = {
  edges: [
    [
      [0, 0],
      [10, 0],
    ],
  ],
  siteEdges: [],
};
const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 6);
  expect(a[1]).toBeCloseTo(b[1], 6);
};

describe('snap', () => {
  it('snaps to endpoints first', () => {
    const r = snapPoint([0.3, 0.2], geom, S, 1);
    expect(r.kind).toBe('endpoint');
    close(r.point, [0, 0]);
  });
  it('snaps to midpoints', () => {
    const r = snapPoint([5.2, 0.3], geom, S, 1);
    expect(r.kind).toBe('midpoint');
    close(r.point, [5, 0]);
  });
  it('snaps to the nearest point on an edge', () => {
    const r = snapPoint([3.3, 0.4], geom, S, 1);
    expect(r.kind).toBe('edge');
    close(r.point, [3.3, 0]);
  });
  it('endpoint wins over midpoint when both are in tolerance', () => {
    const g: SnapGeometry = {
      edges: [
        [
          [0, 0],
          [1, 0],
        ],
      ],
      siteEdges: [],
    };
    expect(snapPoint([0.4, 0], g, S, 1).kind).toBe('endpoint');
  });
  it('angle snapping relative to the previous point', () => {
    const r = snapPoint([20, 20.3], geom, S, 1, [10, 10]);
    expect(r.kind).toBe('angle');
    close(r.point, [20.15, 20.15]);
  });
  it('snaps parallel / perpendicular to site edges', () => {
    const e: [Vec2, Vec2] = [
      [0, 0],
      [Math.cos(0.1), Math.sin(0.1)],
    ];
    const r = snapAngle([10, 1.05], [0, 0], 15, 0.2, [e]);
    expect(r?.ref).toBe(e);
    expect(Math.atan2(r!.point[1], r!.point[0])).toBeCloseTo(0.1, 6);
    const p = snapAngle([-1.0, 10.05], [0, 0], 15, 0.2, [e]);
    expect(Math.atan2(p!.point[1], p!.point[0])).toBeCloseTo(0.1 + Math.PI / 2, 6);
  });
  it('grid snapping and flags', () => {
    const r = snapPoint([30.2, 40.9], geom, S, 1);
    expect(r.kind).toBe('grid');
    close(r.point, [30, 41]);
    expect(snapPoint([0.1, 0], geom, { ...S, enabled: false }, 1).kind).toBe('none');
    expect(snapPoint([0.1, 0.1], geom, { ...S, endpoints: false }, 1).kind).toBe('edge');
  });
});

describe('placement', () => {
  it('two clicks give position, rotation and Zeile length', () => {
    const p = twoClickPlacement(defaultTypology('zeile'), [10, 5], [10, 35]);
    close(p.position, [10, 5]);
    expect(p.rotation).toBeCloseTo(Math.PI / 2);
    expect(p.typology.kind === 'zeile' && p.typology.length).toBeCloseTo(30);
  });
  it('keeps the parameter length below 1 m', () => {
    const p = twoClickPlacement(defaultTypology('zeile'), [0, 0], [0.5, 0]);
    expect(p.typology.kind === 'zeile' && p.typology.length).toBe(40);
    const r = twoClickPlacement(defaultTypology('reihe'), [0, 0], [-24, 0]);
    expect(r.typology.kind === 'reihe' && r.typology.count).toBe(4);
    expect(r.rotation).toBeCloseTo(Math.PI);
  });
  it('typed length', () => {
    close(pointAtLength([1, 1], [1, 100], 12), [1, 13]);
  });
  it('free line finishing and closing', () => {
    const pts: Vec2[] = [
      [10, 10],
      [30, 10],
      [30, 30],
    ];
    expect(isClosingClick(pts, [10.2, 10.1], 0.5)).toBe(true);
    expect(isClosingClick(pts.slice(0, 2), [10, 10], 0.5)).toBe(false);
    expect(isRepeatClick(pts, [30, 30])).toBe(true);
    const pl = freeLinePlacement(pts, true, defaultTypology('freeLine'));
    close(pl.position, [10, 10]);
    expect(pl.typology).toMatchObject({ kind: 'freeLine', closed: true, depth: 12 });
    expect(pl.typology.kind === 'freeLine' && pl.typology.points[2]).toEqual([20, 20]);
    const open = freeLinePlacement(pts.slice(0, 2), true, defaultTypology('freeLine'));
    expect(open.typology.kind === 'freeLine' && open.typology.closed).toBe(false);
  });
});

describe('modify', () => {
  it('rotates about the centroid of the selection', () => {
    const a = createMass('solitaer', { position: [10, 0] });
    const b = createMass('solitaer', { position: [-10, 0] });
    const c = selectionCentroid([a, b]);
    close(c, [0, 0]);
    const r = rotateAbout(a, c, Math.PI / 2);
    close(r.position, [0, 10]);
    expect(r.rotation).toBeCloseTo(Math.PI / 2);
  });
  it('mirrors a mass about an axis', () => {
    const m = createMass('zeile', { position: [5, 0] });
    const r = mirrorMass(m, [0, 0], [0, 1]);
    close(r.position, [-5, 0]);
    expect(Math.cos(r.rotation)).toBeCloseTo(-1);
  });
});

describe('grips', () => {
  it('depth grip +2 m keeps the opposite side', () => {
    const m = createMass('solitaer', { position: [0, 0] });
    const r = applySideGrip(m, { axis: 'depth', sign: 1 }, 2);
    expect(r.typology.kind === 'solitaer' && r.typology.depth).toBe(22);
    close(r.position, [0, 1]);
    const minY = (mm: typeof m) => Math.min(...massFootprints(mm)[0]!.outer.map((p) => p[1]));
    expect(minY({ ...m, ...r })).toBeCloseTo(minY(m));
  });
  it('rotated Zeile start grip moves the origin', () => {
    const m = createMass('zeile', { position: [0, 0], rotation: Math.PI / 2 });
    const r = applySideGrip(m, { axis: 'length', sign: -1 }, 5);
    expect(r.typology.kind === 'zeile' && r.typology.length).toBe(45);
    close(r.position, [0, -5]);
    const d = applySideGrip(m, { axis: 'depth', sign: -1 }, 2);
    close(d.position, [1, 0]);
  });
  it('Reihe length grip changes unit width', () => {
    const m = createMass('reihe');
    const r = applySideGrip(m, { axis: 'length', sign: 1 }, 6);
    expect(r.typology.kind === 'reihe' && r.typology.unitWidth).toBeCloseTo(7);
  });
  it('vertex grip and height grip', () => {
    const m = createMass('freeLine', { position: [10, 10] });
    const t = moveVertex(m, 1, [50, 10]);
    expect(t.kind === 'freeLine' && t.points[1]).toEqual([40, 0]);
    expect(heightGripCount(4, 6.2, 3)).toBe(6);
    expect(heightGripCount(1, -10, 3)).toBe(0);
  });
});
