import {
  difference,
  offsetPolygons,
  polygonArea,
  union,
  type MassLayout,
  type Polygon,
  type StoreySolid,
  type UnitType,
  type Vec2,
} from '@kubatur/core';
import { roomColor, serviceColor, unitColor, unitLabelPoint } from '@kubatur/drawing';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colored, GRANULO_COLORS } from './granulometry';

/**
 * Storey cut of the 3D view ("coupe par étage"): everything above the chosen storey is hidden and
 * the chosen storey is cut like a floor plan, at about 1.20 m above its floor. Walls (façade,
 * party walls, room partitions) and stair cores stand up to the cut height with a dark cut face
 * (poché); the floor shows the dwellings and their rooms in the granulometry colours.
 * Pure (no WebGL).
 */

/** Height of the cut plane above the floor (plan convention), m. */
export const CUT_HEIGHT = 1.2;
/** Thickness of the walls drawn in the cut, m. */
export const WALLS = { facade: 0.3, party: 0.2, room: 0.1 } as const;
/** Colour of the cut faces (poché). */
export const CUT_COLOR = '#2f3035';
/** Floor of storeys without dwelling layout (commerce, parking, …). */
const PLAIN_FLOOR = '#e6e3dc';

const FLOOR = 0.03;
const ROOM = 0.05;
const CAP = 0.02;

export interface CutLabel {
  massId: string;
  at: [number, number, number];
  title: string;
  sub: string;
  warn: boolean;
}

export interface CutMass {
  massId: string;
  /** Floors, walls, cores and cut faces, with a per-vertex `color` attribute. */
  geometry: BufferGeometry;
}

export interface StoreyCutScene {
  masses: CutMass[];
  labels: CutLabel[];
}

/** Storey indices present in the solids, top first (for the slider). */
export function cutLevels(solids: readonly Pick<StoreySolid, 'storeyIndex'>[]): number[] {
  return [...new Set(solids.map((s) => s.storeyIndex))].sort((a, b) => b - a);
}

/** Default level of the cut: the highest storey with dwellings, else the highest storey. */
export function defaultCutLevel(
  solids: readonly Pick<StoreySolid, 'storeyIndex'>[],
  layouts: readonly MassLayout[] | null | undefined,
): number | null {
  let best: number | null = null;
  for (const m of layouts ?? [])
    for (const st of m.storeys)
      if (st.units.length && (best === null || st.storeyIndex > best)) best = st.storeyIndex;
  return best ?? cutLevels(solids)[0] ?? null;
}

/** Masses whose roof disappears with a cut at `level` (those reaching up to it). */
export function massesCutAt(
  solids: readonly Pick<StoreySolid, 'storeyIndex' | 'massId'>[],
  level: number,
): Set<string> {
  return new Set(solids.filter((s) => s.storeyIndex >= level).map((s) => s.massId));
}

const big = (ps: Polygon[], min = 0.02) => ps.filter((p) => polygonArea(p) > min);

/** Ring of thickness `t` along the inside of the outlines of `polys`. */
function wallRing(polys: readonly Polygon[], t: number): Polygon[] {
  if (!polys.length) return [];
  return big(difference(polys, offsetPolygons(polys, -t)));
}

/**
 * Geometry of the storey `level` of every mass that has it, cut at CUT_HEIGHT.
 * `loggias` are the loggia cut shapes per `massId#storeyIndex` (outdoor, no wall across them).
 */
export function buildStoreyCut(
  solids: readonly StoreySolid[],
  layouts: readonly MassLayout[] | null | undefined,
  level: number,
  mix: readonly UnitType[],
  wallColor: string,
  loggias: ReadonlyMap<string, Polygon[]> = new Map(),
): StoreyCutScene {
  const layoutOf = new Map<string, MassLayout['storeys'][number]>();
  for (const m of layouts ?? [])
    for (const st of m.storeys) if (st.storeyIndex === level) layoutOf.set(m.massId, st);

  // the solids of this storey per mass (several sections share one storey layout)
  const byMass = new Map<string, StoreySolid[]>();
  for (const s of solids) {
    if (s.storeyIndex !== level) continue;
    byMass.set(s.massId, [...(byMass.get(s.massId) ?? []), s]);
  }

  const masses: CutMass[] = [];
  const labels: CutLabel[] = [];
  for (const [massId, ss] of byMass) {
    const z0 = Math.min(...ss.map((s) => s.z0));
    const h = Math.min(...ss.map((s) => s.z1 - s.z0));
    const zc = z0 + Math.min(CUT_HEIGHT, h * 0.6);
    const parts: BufferGeometry[] = [];
    const add = (polys: readonly Polygon[], za: number, zb: number, color: string) => {
      for (const p of polys) {
        const g = colored(p, za, zb, color);
        if (g) parts.push(g);
      }
    };
    const wall = (polys: Polygon[]) => {
      add(polys, z0, zc, wallColor);
      add(polys, zc, zc + CAP, CUT_COLOR);
    };

    const footprints = union(ss.map((s) => s.footprint));
    const cut = loggias.get(`${massId}#${level}`) ?? [];
    const enclosed = cut.length ? big(difference(footprints, cut)) : footprints;
    const st = layoutOf.get(massId);

    // floors
    if (st && (st.units.length || st.open.length || st.circulation.length)) {
      add(footprints, z0, z0 + FLOOR * 0.5, PLAIN_FLOOR);
      for (const c of st.circulation) add([c.polygon], z0, z0 + FLOOR, GRANULO_COLORS.circulation);
      for (const o of st.open) add([o.polygon], z0, z0 + FLOOR, GRANULO_COLORS.circulation);
      for (const u of st.units) {
        const color = unitColor(u.typeId, mix);
        const inside = cut.length ? big(difference([u.polygon], cut)) : [u.polygon];
        add(inside, z0, z0 + FLOOR, serviceColor(color));
        for (const r of u.rooms ?? []) add([r.polygon], z0, z0 + ROOM, roomColor(color, r.kind));
        // party walls around the dwelling, partitions around its rooms
        wall(wallRing(inside, WALLS.party / 2));
        for (const r of u.rooms ?? []) wall(wallRing([r.polygon], WALLS.room / 2));
        const at: Vec2 = unitLabelPoint(u.polygon, u.rooms ?? []);
        labels.push({
          massId,
          at: [at[0], at[1], zc + 0.4],
          title: `${u.label}${u.outOfRange ? '*' : ''}${u.facadeOk ? '' : ' !'}`,
          sub: `${Math.round(u.area)} m²`,
          warn: !u.facadeOk,
        });
      }
      // stair cores: solid up to the cut (poché)
      for (const c of st.cores) {
        add([c.polygon], z0, zc, GRANULO_COLORS.core);
        add([c.polygon], zc, zc + CAP, CUT_COLOR);
      }
    } else add(footprints, z0, z0 + FLOOR, PLAIN_FLOOR);

    // façade walls
    wall(wallRing(enclosed, WALLS.facade));

    if (!parts.length) continue;
    const geometry = mergeGeometries(
      parts.map((g) => (g.index ? g.toNonIndexed() : g)),
      false,
    );
    for (const g of parts) g.dispose();
    if (geometry) masses.push({ massId, geometry });
  }
  return { masses, labels };
}
