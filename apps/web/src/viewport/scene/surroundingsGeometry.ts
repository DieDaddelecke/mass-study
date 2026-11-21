import {
  offsetPolyline,
  union,
  type ContextRoad,
  type ContextRoadKind,
  type Polygon,
  type Vec2,
} from '@kubatur/core';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { ringSegments } from './geometry';

/** Colour class of a road ribbon. */
export type RoadClass = 'carriageway' | 'footway' | 'rail';

export function roadClass(kind: ContextRoadKind): RoadClass {
  if (kind === 'footway' || kind === 'path' || kind === 'cycleway') return 'footway';
  if (kind === 'rail' || kind === 'tram') return 'rail';
  return 'carriageway';
}

/** Width used for drawing (rails are drawn as thin strips). */
function drawWidth(r: ContextRoad): number {
  if (roadClass(r.kind) === 'rail') return 0.6;
  return Math.max(0.5, r.width);
}

export interface RoadRibbons {
  /** Unioned ribbon polygons per class and level (0 at grade, 1 bridge). Level -1 is dropped. */
  groups: { cls: RoadClass; level: 0 | 1; polygons: Polygon[] }[];
}

/** Ribbons from centre lines + widths, unioned per colour class so overlaps do not flicker. */
export function buildRoadRibbons(roads: readonly ContextRoad[]): RoadRibbons {
  const buckets = new Map<string, { cls: RoadClass; level: 0 | 1; polys: Polygon[] }>();
  for (const r of roads) {
    if (r.level < 0 || r.centerline.length < 2) continue;
    const cls = roadClass(r.kind);
    const level = r.level === 1 ? 1 : 0;
    const key = `${cls}:${level}`;
    const b = buckets.get(key) ?? { cls, level, polys: [] };
    buckets.set(key, b);
    b.polys.push(...offsetPolyline(r.centerline, false, drawWidth(r), 'center'));
  }
  const groups: RoadRibbons['groups'] = [];
  for (const b of buckets.values()) {
    const polygons = b.polys.length > 1 ? union(b.polys) : b.polys;
    if (polygons.length) groups.push({ cls: b.cls, level: b.level, polygons });
  }
  return { groups };
}

/** Triangulated flat polygons at height z (one merged BufferGeometry), or null if empty. */
export function flatPolygonsGeometry(polys: readonly Polygon[], z: number): BufferGeometry | null {
  const pos: number[] = [];
  for (const p of polys) {
    if (p.outer.length < 3) continue;
    const outer = p.outer.map(([x, y]) => new Vector2(x, y));
    const holes = (p.holes ?? [])
      .filter((h) => h.length >= 3)
      .map((h) => h.map(([x, y]) => new Vector2(x, y)));
    if (ShapeUtils.isClockWise(outer)) outer.reverse();
    for (const h of holes) if (!ShapeUtils.isClockWise(h)) h.reverse();
    const all = [...outer, ...holes.flat()];
    for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes)) {
      for (const i of [a!, b!, c!]) pos.push(all[i]!.x, all[i]!.y, z);
    }
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 2; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new Float32BufferAttribute(n, 3));
  return g;
}

/** Area of a non-indexed flat triangle geometry (tests). */
export function flatArea(g: BufferGeometry): number {
  const p = g.getAttribute('position');
  let a = 0;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i),
      ay = p.getY(i);
    a +=
      Math.abs(
        (p.getX(i + 1) - ax) * (p.getY(i + 2) - ay) - (p.getX(i + 2) - ax) * (p.getY(i + 1) - ay),
      ) / 2;
  }
  return a;
}

/** Outline segments of polygons (outer + holes) at height z. */
export function polygonOutlineSegments(
  polys: readonly Polygon[],
  z: number,
  out: number[] = [],
): number[] {
  for (const p of polys) for (const r of [p.outer, ...(p.holes ?? [])]) ringSegments(r, z, out);
  return out;
}

/** Thin raised strip walls for hedges given as polygons: top surface + side walls. */
export function hedgeGeometry(polys: readonly Polygon[], height: number): BufferGeometry | null {
  const top = flatPolygonsGeometry(polys, height);
  const pos: number[] = top ? Array.from(top.getAttribute('position').array) : [];
  const nor: number[] = top ? Array.from(top.getAttribute('normal').array) : [];
  for (const p of polys)
    for (const r of [p.outer, ...(p.holes ?? [])]) {
      for (let i = 0; i < r.length; i++) {
        const a: Vec2 = r[i]!;
        const b: Vec2 = r[(i + 1) % r.length]!;
        const dx = b[0] - a[0],
          dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = dy / l,
          ny = -dx / l;
        pos.push(
          a[0],
          a[1],
          0,
          b[0],
          b[1],
          0,
          b[0],
          b[1],
          height,
          a[0],
          a[1],
          0,
          b[0],
          b[1],
          height,
          a[0],
          a[1],
          height,
        );
        for (let k = 0; k < 6; k++) nor.push(nx, ny, 0);
      }
    }
  top?.dispose();
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  return g;
}
