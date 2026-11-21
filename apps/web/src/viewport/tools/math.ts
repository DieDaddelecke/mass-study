import {
  massFootprints,
  normalizePolygon,
  polygonArea,
  ringCentroid,
  rotatePoint,
  type FreeLineTypology,
  type Mass,
  type StoreyStack,
  type Typology,
  type Vec2,
} from '@kubatur/core';
import { dist } from './snap';

/** Pure geometry for the modelling tools (placement, modify tools, grips). */

export const angleOf = (a: Vec2, b: Vec2): number => Math.atan2(b[1] - a[1], b[0] - a[0]);
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Point at distance `len` from `from` in the direction of `toward` (x axis if they coincide). */
export function pointAtLength(from: Vec2, toward: Vec2, len: number): Vec2 {
  const d = dist(from, toward);
  const a = d < 1e-9 ? 0 : angleOf(from, toward);
  return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
}

export interface Placement {
  position: Vec2;
  rotation: number;
  typology: Typology;
}

/** Minimum second-click distance for Zeile / Reihe to take over the length. */
export const MIN_DRAG_LENGTH = 1;

/**
 * Two-click placement (Solitär / Zeile / Reihe / template): p1 = insertion point,
 * p2 = direction. Zeile / Reihe take the length from |p1p2| if it is longer than 1 m.
 */
export function twoClickPlacement(typology: Typology, p1: Vec2, p2?: Vec2 | null): Placement {
  const d = p2 ? dist(p1, p2) : 0;
  const rotation = p2 && d > 1e-9 ? angleOf(p1, p2) : 0;
  let t: Typology = typology;
  if (d > MIN_DRAG_LENGTH) {
    if (typology.kind === 'zeile') t = { ...typology, length: d };
    else if (typology.kind === 'reihe')
      t = { ...typology, count: Math.max(1, Math.round(d / typology.unitWidth)) };
  }
  return { position: [p1[0], p1[1]], rotation, typology: t };
}

/** Free line from world points: position = first point, rotation 0. */
export function freeLinePlacement(
  world: readonly Vec2[],
  closed: boolean,
  base: Typology,
): Placement {
  const p0 = world[0] ?? [0, 0];
  const depth = base.kind === 'freeLine' || base.kind === 'zeile' ? base.depth : 12;
  const alignment = base.kind === 'freeLine' ? base.alignment : 'center';
  const t: FreeLineTypology = {
    kind: 'freeLine',
    points: world.map((p) => sub(p, p0)),
    closed: closed && world.length >= 3,
    depth,
    alignment,
  };
  return { position: [p0[0], p0[1]], rotation: 0, typology: t };
}

export function freePolygonPlacement(world: readonly Vec2[]): Placement {
  const p0 = world[0] ?? [0, 0];
  return {
    position: [p0[0], p0[1]],
    rotation: 0,
    typology: {
      kind: 'freePolygon',
      polygon: normalizePolygon({ outer: world.map((p) => sub(p, p0)) }),
    },
  };
}

/** Clicking on the first point (within tolerance) closes a line / polygon with ≥ 3 points. */
export function isClosingClick(points: readonly Vec2[], p: Vec2, tol: number): boolean {
  return points.length >= 3 && dist(points[0]!, p) <= tol;
}

/** A click on the last point again (double click) finishes a line. */
export function isRepeatClick(points: readonly Vec2[], p: Vec2, tol = 1e-6): boolean {
  const l = points[points.length - 1];
  return !!l && dist(l, p) <= tol;
}

/** Area-weighted centroid of the footprints of several masses. */
export function selectionCentroid(masses: readonly Mass[]): Vec2 {
  let a = 0;
  let x = 0;
  let y = 0;
  const pts: Vec2[] = [];
  for (const m of masses)
    for (const f of massFootprints(m)) {
      const ar = polygonArea(f);
      const c = ringCentroid(f.outer);
      pts.push(c);
      a += ar;
      x += c[0] * ar;
      y += c[1] * ar;
    }
  if (a > 1e-9) return [x / a, y / a];
  if (!pts.length) return masses[0]?.position ?? [0, 0];
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

export function rotateAbout(
  m: Pick<Mass, 'position' | 'rotation'>,
  c: Vec2,
  angle: number,
): { position: Vec2; rotation: number } {
  return { position: add(c, rotatePoint(sub(m.position, c), angle)), rotation: m.rotation + angle };
}

function reflectPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const phi = angleOf(a, b);
  const r = rotatePoint(sub(p, a), -phi);
  return add(a, rotatePoint([r[0], -r[1]], phi));
}

/** Mirror a mass about the axis a–b: M·R(θ) = R(2φ−θ)·diag(1,−1). */
export function mirrorMass(
  m: Pick<Mass, 'position' | 'rotation' | 'typology'>,
  a: Vec2,
  b: Vec2,
): { position: Vec2; rotation: number; typology: Typology } {
  const phi = angleOf(a, b);
  const position = reflectPoint(m.position, a, b);
  const rotation = 2 * phi - m.rotation;
  const t = m.typology;
  const flip = (p: Vec2): Vec2 => [p[0], -p[1]];
  let typology: Typology;
  switch (t.kind) {
    case 'solitaer':
      typology = t;
      break;
    case 'zeile':
      typology = { ...t, sectionOffset: -t.sectionOffset };
      break;
    case 'reihe':
      typology = { ...t, alternatingOffset: -t.alternatingOffset };
      break;
    case 'freeLine':
      typology = {
        ...t,
        points: t.points.map(flip),
        alignment: t.alignment === 'left' ? 'right' : t.alignment === 'right' ? 'left' : 'center',
      };
      break;
    case 'freePolygon':
      typology = {
        kind: 'freePolygon',
        polygon: normalizePolygon({
          outer: t.polygon.outer.map(flip),
          ...(t.polygon.holes ? { holes: t.polygon.holes.map((h) => h.map(flip)) } : {}),
        }),
      };
      break;
  }
  return { position, rotation, typology };
}

// ---------------------------------------------------------------------------
// Grips
// ---------------------------------------------------------------------------

export interface SideGrip {
  axis: 'length' | 'depth';
  sign: 1 | -1;
}

export const MIN_SIZE = 1;

function reiheLength(t: Extract<Typology, { kind: 'reihe' }>): number {
  const n = Math.max(1, Math.round(t.count));
  if (t.endUnitWidth === undefined || n === 1) return n * t.unitWidth;
  return (n - 2) * t.unitWidth + 2 * t.endUnitWidth;
}

/** Local extents [minX, maxX, minY, maxY] of a rectangular typology (offsets ignored). */
export function localExtents(t: Typology): [number, number, number, number] | null {
  switch (t.kind) {
    case 'solitaer':
      return [-t.length / 2, t.length / 2, -t.depth / 2, t.depth / 2];
    case 'zeile':
      return [0, t.length, -t.depth / 2, t.depth / 2];
    case 'reihe':
      return [0, reiheLength(t), -t.depth / 2, t.depth / 2];
    default:
      return null;
  }
}

/** Side grips (local position on the side middle and outward direction). */
export function sideGrips(t: Typology): { grip: SideGrip; local: Vec2; dir: Vec2 }[] {
  const e = localExtents(t);
  if (!e) return [];
  const [x0, x1, y0, y1] = e;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return [
    { grip: { axis: 'length', sign: 1 }, local: [x1, cy], dir: [1, 0] },
    { grip: { axis: 'length', sign: -1 }, local: [x0, cy], dir: [-1, 0] },
    { grip: { axis: 'depth', sign: 1 }, local: [cx, y1], dir: [0, 1] },
    { grip: { axis: 'depth', sign: -1 }, local: [cx, y0], dir: [0, -1] },
  ];
}

/** World-space outward direction of a side grip. */
export function gripWorldDir(m: Pick<Mass, 'rotation'>, g: SideGrip): Vec2 {
  return rotatePoint(g.axis === 'length' ? [g.sign, 0] : [0, g.sign], m.rotation);
}

/**
 * Apply a side grip drag. `delta` is the displacement of the grip along its outward direction (m).
 * The opposite side stays fixed.
 */
export function applySideGrip(
  m: Pick<Mass, 'position' | 'rotation' | 'typology'>,
  g: SideGrip,
  delta: number,
): { position: Vec2; typology: Typology } {
  const t = m.typology;
  const e = localExtents(t);
  if (!e) return { position: m.position, typology: t };
  const size = g.axis === 'length' ? e[1] - e[0] : e[3] - e[2];
  const ns = Math.max(MIN_SIZE, size + delta);
  const d = ns - size;
  let typology: Typology = t;
  let shift: Vec2;
  if (g.axis === 'depth') {
    if (t.kind === 'solitaer' || t.kind === 'zeile' || t.kind === 'reihe')
      typology = { ...t, depth: ns };
    shift = [0, (g.sign * d) / 2];
  } else {
    if (t.kind === 'solitaer') {
      typology = { ...t, length: ns };
      shift = [(g.sign * d) / 2, 0];
    } else {
      if (t.kind === 'zeile') typology = { ...t, length: ns };
      else if (t.kind === 'reihe') {
        const n = Math.max(1, Math.round(t.count));
        const uw =
          t.endUnitWidth !== undefined && n > 2 ? (ns - 2 * t.endUnitWidth) / (n - 2) : ns / n;
        typology = { ...t, unitWidth: Math.max(MIN_SIZE, uw) };
      }
      // origin is the start of the axis: only moves when the start side is dragged
      shift = g.sign === -1 ? [-d, 0] : [0, 0];
    }
  }
  return { position: add(m.position, rotatePoint(shift, m.rotation)), typology };
}

export function toLocal(m: Pick<Mass, 'position' | 'rotation'>, p: Vec2): Vec2 {
  return rotatePoint(sub(p, m.position), -m.rotation);
}

export function toWorldPoint(m: Pick<Mass, 'position' | 'rotation'>, p: Vec2): Vec2 {
  return add(m.position, rotatePoint(p, m.rotation));
}

/** Vertex grips (local) for free lines and free polygons. */
export function vertexGrips(t: Typology): Vec2[] {
  if (t.kind === 'freeLine') return t.points;
  if (t.kind === 'freePolygon') return t.polygon.outer;
  return [];
}

export function moveVertex(
  m: Pick<Mass, 'position' | 'rotation' | 'typology'>,
  index: number,
  world: Vec2,
): Typology {
  const t = m.typology;
  const l = toLocal(m, world);
  if (t.kind === 'freeLine') return { ...t, points: t.points.map((p, i) => (i === index ? l : p)) };
  if (t.kind === 'freePolygon')
    return {
      ...t,
      polygon: { ...t.polygon, outer: t.polygon.outer.map((p, i) => (i === index ? l : p)) },
    };
  return t;
}

/** Top of the upper storeys (OKFF + storey heights, overrides ignored). */
export function stackTop(s: StoreyStack): number {
  return s.ground.height + s.upper.count * s.upper.height;
}

/** Height grip: number of upper storeys after a vertical drag of `dz` metres. */
export function heightGripCount(startCount: number, dz: number, storeyHeight: number): number {
  return Math.max(0, Math.round(startCount + dz / Math.max(0.1, storeyHeight)));
}
