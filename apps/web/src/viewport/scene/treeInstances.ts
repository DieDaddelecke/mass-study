import {
  pointInPolygon,
  ringBBox,
  type ContextGreen,
  type ContextTree,
  type Polygon,
  type Vec2,
} from '@kubatur/core';
import { Color, Matrix4, Quaternion, Vector3 } from 'three';

/** Deterministic 0..1 hash of a string (FNV-1a). */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface TreeInstanceSet {
  count: number;
  /** 16 floats per instance (column-major Matrix4). */
  matrices: Float32Array;
  /** 3 floats per instance (linear RGB multiplier around 1). */
  colors: Float32Array;
}

export interface TreeInstances {
  broad: TreeInstanceSet;
  needle: TreeInstanceSet;
  trunks: TreeInstanceSet;
}

function set(n: number): TreeInstanceSet {
  return { count: 0, matrices: new Float32Array(n * 16), colors: new Float32Array(n * 3) };
}

/**
 * Instance transforms for tree crowns (unit sphere / unit cone of radius 1, height 2 centred at
 * the origin) and trunks (unit cylinder of radius 1, height 1 centred at the origin, y-up rotated
 * to z-up). Crown centre at 0.65 × height; small per-id variation of scale and tint.
 */
export function buildTreeInstances(trees: readonly ContextTree[], base: string): TreeInstances {
  const broad = set(trees.length);
  const needle = set(trees.length);
  const trunks = set(trees.length);
  const m = new Matrix4();
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2); // y-up → z-up
  const qz = new Quaternion();
  const c0 = new Color(base);
  const c = new Color();
  const pos = new Vector3();
  const scl = new Vector3();
  for (const t of trees) {
    const h = Math.max(2, t.height || 8);
    const v = 0.9 + 0.2 * hash01(t.id, 1);
    const r = Math.max(0.8, (t.crown || h * 0.5) / 2) * v;
    const needleT = t.leafType === 'needleleaved';
    const target = needleT ? needle : broad;
    const i = target.count++;
    const rot = qz.setFromAxisAngle(new Vector3(0, 0, 1), hash01(t.id, 2) * Math.PI * 2);
    if (needleT) {
      // cone: crown from 0.3 h to the top
      const ch = h * 0.75;
      pos.set(t.position[0], t.position[1], h - ch / 2);
      scl.set(r * 0.8, ch / 2, r * 0.8);
      m.compose(pos, rot.clone().multiply(q), scl);
    } else {
      const cz = Math.max(r * 0.85, 0.65 * h);
      pos.set(t.position[0], t.position[1], cz);
      scl.set(r, r, r * 0.85);
      m.compose(pos, rot, scl);
    }
    m.toArray(target.matrices, i * 16);
    const l = 0.88 + 0.24 * hash01(t.id, 3);
    c.copy(c0).offsetHSL((hash01(t.id, 4) - 0.5) * 0.04, 0, (l - 1) * 0.15);
    c.toArray(target.colors, i * 3);
    // trunk
    const j = trunks.count++;
    const th = needleT ? h * 0.35 : 0.65 * h;
    const tr = Math.max(0.12, h * 0.018);
    pos.set(t.position[0], t.position[1], th / 2);
    scl.set(tr, th, tr);
    m.compose(pos, q, scl);
    m.toArray(trunks.matrices, j * 16);
  }
  return { broad, needle, trunks };
}

/** Spacing (m) and height range of trees scattered into vegetation areas, per kind. */
const SCATTER: Partial<Record<ContextGreen['kind'], { spacing: number; h: [number, number] }>> = {
  wood: { spacing: 7, h: [13, 20] },
  park: { spacing: 15, h: [8, 14] },
  scrub: { spacing: 6, h: [3, 5] },
};
const MAX_SCATTERED = 3000;

/**
 * Trees for areas that are mapped as woods / parks / scrub but have no individual trees (BD TOPO
 * has no tree points and OSM rarely maps them): a jittered grid inside each polygon, deterministic
 * per polygon id. Points inside `exclude` polygons (site, buildings) are skipped.
 */
export function scatterTreesInGreen(
  green: readonly ContextGreen[],
  exclude: readonly Polygon[] = [],
  /** Only within this circle (large forests reach far beyond the context area). */
  within?: { center: Vec2; radius: number },
): ContextTree[] {
  const out: ContextTree[] = [];
  for (const g of green) {
    const cfg = SCATTER[g.kind];
    const ring = g.footprint.outer;
    if (!cfg || ring.length < 3) continue;
    let { minX, minY, maxX, maxY } = ringBBox(ring);
    if (within) {
      const [cx, cy] = within.center;
      minX = Math.max(minX, cx - within.radius);
      minY = Math.max(minY, cy - within.radius);
      maxX = Math.min(maxX, cx + within.radius);
      maxY = Math.min(maxY, cy + within.radius);
    }
    const s = cfg.spacing;
    for (let x = minX + s / 2, i = 0; x < maxX; x += s, i++) {
      for (let y = minY + s / 2, j = 0; y < maxY; y += s, j++) {
        if (out.length >= MAX_SCATTERED) return out;
        const key = `${g.id}:${i}:${j}`;
        const p: Vec2 = [
          x + (hash01(key, 3) - 0.5) * s * 0.8,
          y + (hash01(key, 4) - 0.5) * s * 0.8,
        ];
        if (within && Math.hypot(p[0] - within.center[0], p[1] - within.center[1]) > within.radius)
          continue;
        if (!pointInPolygon(p, g.footprint) || exclude.some((e) => pointInPolygon(p, e))) continue;
        const height = cfg.h[0] + (cfg.h[1] - cfg.h[0]) * hash01(key, 5);
        out.push({
          id: `scatter/${key}`,
          position: p,
          height,
          crown: height * 0.55,
          heightEstimated: true,
          source: 'manual',
        });
      }
    }
  }
  return out;
}
