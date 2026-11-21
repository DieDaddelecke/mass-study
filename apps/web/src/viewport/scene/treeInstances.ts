import type { ContextTree } from '@kubatur/core';
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
