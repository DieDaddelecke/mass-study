import type { MassLayout, Polygon, StoreySolid, UnitType } from '@kubatur/core';
import { unitColor } from '@kubatur/drawing';
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { extrudePolygon, prismEdges } from './geometry';

/**
 * Granulometry style of the 3D view: every residential storey is cut into its dwellings
 * (coloured by type, as in the floor plan), stair cores and circulation. Pure (no WebGL).
 */

export const GRANULO_COLORS = {
  core: '#4a4c52',
  circulation: '#dedbd3',
} as const;

export interface GranuloMass {
  massId: string;
  /** Merged prisms with a per-vertex `color` attribute. */
  geometry: BufferGeometry;
  /** Outlines of the dwellings per storey (thin lines), flat xyz pairs. */
  edges: number[];
}

export interface GranuloScene {
  masses: GranuloMass[];
  /** Keys (`massId#storeyIndex`) of the storey solids replaced by the granulometry. */
  covered: Set<string>;
}

export const storeyKey = (s: Pick<StoreySolid, 'massId' | 'storeyIndex'>) =>
  `${s.massId}#${s.storeyIndex}`;

function colored(poly: Polygon, z0: number, z1: number, color: string): BufferGeometry | null {
  const g = extrudePolygon(poly, z0, z1);
  if (!g) return null;
  const n = g.getAttribute('position').count;
  const c = new Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

/**
 * Dwellings, cores and circulation of every storey with dwellings as coloured prisms from the
 * floor level to the floor above. Storeys without dwellings keep their plain volume.
 */
export function buildGranulometry(
  layouts: readonly MassLayout[],
  solids: readonly StoreySolid[],
  mix: readonly UnitType[],
): GranuloScene {
  const z1Of = new Map<string, number>();
  for (const s of solids) {
    const k = storeyKey(s);
    z1Of.set(k, Math.max(z1Of.get(k) ?? -Infinity, s.z1));
  }
  const covered = new Set<string>();
  const masses: GranuloMass[] = [];
  for (const m of layouts) {
    const parts: BufferGeometry[] = [];
    const edges: number[] = [];
    for (const st of m.storeys) {
      if (!st.units.length) continue;
      const key = `${m.massId}#${st.storeyIndex}`;
      const z1 = z1Of.get(key);
      if (z1 === undefined || !(z1 > st.z0)) continue;
      covered.add(key);
      const add = (p: Polygon, color: string, outline: boolean) => {
        const g = colored(p, st.z0, z1, color);
        if (g) parts.push(g);
        if (outline) prismEdges(p, st.z0, z1, { bottom: false }, edges);
      };
      for (const u of st.units) add(u.polygon, unitColor(u.typeId, mix), true);
      for (const c of st.cores) add(c.polygon, GRANULO_COLORS.core, true);
      for (const c of st.circulation) add(c.polygon, GRANULO_COLORS.circulation, false);
      for (const o of st.open) add(o.polygon, GRANULO_COLORS.circulation, false);
    }
    if (!parts.length) continue;
    const geometry = mergeGeometries(
      parts.map((g) => (g.index ? g.toNonIndexed() : g)),
      false,
    );
    for (const g of parts) g.dispose();
    if (geometry) masses.push({ massId: m.massId, geometry, edges });
  }
  return { masses, covered };
}
