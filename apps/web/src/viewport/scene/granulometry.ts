import {
  difference,
  intersection,
  polygonArea,
  type MassLayout,
  type Polygon,
  type StoreySolid,
  type UnitType,
} from '@kubatur/core';
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

/** Slab (of the storey above, or the roof) kept over a loggia, m. */
export const LOGGIA_SLAB = 0.3;

const big = (ps: Polygon[]) => ps.filter((p) => polygonArea(p) > 0.05);

export const storeyKey = (s: Pick<StoreySolid, 'massId' | 'storeyIndex'>) =>
  `${s.massId}#${s.storeyIndex}`;

export function colored(
  poly: Polygon,
  z0: number,
  z1: number,
  color: string,
): BufferGeometry | null {
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
      const add = (p: Polygon, color: string, outline: boolean, za = st.z0, zb = z1) => {
        const g = colored(p, za, zb, color);
        if (g) parts.push(g);
        if (outline) prismEdges(p, za, zb, { bottom: false }, edges);
      };
      for (const u of st.units) {
        const color = unitColor(u.typeId, mix);
        const cut = u.outdoor?.kind === 'loggia' ? (u.outdoor.cut ?? u.outdoor.polygon) : null;
        const zc = z1 - LOGGIA_SLAB;
        const loggia = cut && zc > st.z0 ? big(intersection([u.polygon], [cut])) : [];
        // a duplex reads as one volume over two storeys: no outline between its levels
        const edgeOpts = {
          bottom: false,
          ...(u.duplex?.part === 'lower' ? { top: false } : {}),
        };
        if (!cut || !loggia.length) {
          add(u.polygon, color, false);
          prismEdges(u.polygon, st.z0, z1, edgeOpts, edges);
          continue;
        }
        // the dwelling without its loggia, and the slab of the storey above over the loggia
        for (const p of big(difference([u.polygon], [cut]))) add(p, color, false);
        for (const p of loggia) {
          add(p, color, false, zc, z1);
          prismEdges(p, st.z0, zc, { bottom: false }, edges);
        }
        prismEdges(u.polygon, st.z0, z1, edgeOpts, edges);
      }
      for (const c of st.cores) add(c.polygon, GRANULO_COLORS.core, true);
      for (const c of st.circulation)
        if (c.kind === 'lift') add(c.polygon, GRANULO_COLORS.core, true);
        else add(c.polygon, GRANULO_COLORS.circulation, false);
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

// ---------------------------------------------------------------------------
// Outdoor spaces (all styles)

export interface OutdoorScene {
  /** Balcony slabs and terraces. */
  slabs: BufferGeometry | null;
  /** Balcony railings (glass), translucent. */
  rails: BufferGeometry | null;
  /** Top edge of the railings and slab outlines, flat xyz pairs. */
  edges: number[];
  /** Loggias cut out of the storey volumes, per `massId#storeyIndex`. */
  loggias: Map<string, Polygon[]>;
}

const SLAB = 0.2;
const RAIL = 1.05;

/** Balconies (slab + railing), terraces (paving) and loggias (cut-outs) of all dwellings. */
export function buildOutdoor(layouts: readonly MassLayout[]): OutdoorScene {
  const slabs: BufferGeometry[] = [];
  const rails: BufferGeometry[] = [];
  const edges: number[] = [];
  const loggias = new Map<string, Polygon[]>();
  for (const m of layouts)
    for (const st of m.storeys)
      for (const u of st.units) {
        const o = u.outdoor;
        if (!o) continue;
        const z = st.z0;
        if (o.kind === 'loggia') {
          const k = `${m.massId}#${st.storeyIndex}`;
          loggias.set(k, [...(loggias.get(k) ?? []), o.cut ?? o.polygon]);
          continue;
        }
        if (o.kind === 'terrasse') {
          const g = extrudePolygon(o.polygon, z, z + 0.06);
          if (g) slabs.push(g);
          prismEdges(o.polygon, z + 0.06, z + 0.06, { bottom: false, vertical: false }, edges);
          continue;
        }
        const g = extrudePolygon(o.polygon, z - SLAB, z);
        if (g) slabs.push(g);
        const r = extrudePolygon(o.polygon, z, z + RAIL);
        if (r) rails.push(r);
        prismEdges(o.polygon, z - SLAB, z + RAIL, { vertical: false }, edges);
        prismEdges(o.polygon, z, z, { top: false, vertical: false }, edges);
      }
  const merge = (gs: BufferGeometry[]) => {
    if (!gs.length) return null;
    const out = mergeGeometries(
      gs.map((g) => (g.index ? g.toNonIndexed() : g)),
      false,
    );
    for (const g of gs) g.dispose();
    return out;
  };
  return { slabs: merge(slabs), rails: merge(rails), edges, loggias };
}
