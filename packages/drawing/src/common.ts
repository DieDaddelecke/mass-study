import {
  intersection,
  orientedExtents,
  ringCentroid,
  rotatePoint,
  union,
  type ContextBuilding,
  type Polygon,
  type Project,
  type ProjectLevel,
  type RoofPiece,
  type StoreySolid,
  type VariantResult,
  type Vec2,
} from '@kubatur/core';
import { orientPrism, prismFromPolygon, type Prism } from './hidden.js';
import type { ColorScheme, DItem, LineType, Pen } from './model.js';

/** Per-mass information the generators use for texts (from the analysis). */
export interface MassInfo {
  massId: string;
  name?: string;
  /** Storey formula, e.g. "R+4" or "IV". */
  formula?: string;
  /** Top of parapet above ±0,00 (m). */
  top?: number;
  /** Parapet height on top of the top storey (m). */
  parapet?: number;
}

/** Options shared by all generators. */
export interface CommonOptions {
  scheme?: ColorScheme;
  /** Show neighbouring buildings (default true). */
  neighbours?: boolean;
  /** Per-mass info (formula, top, parapet) – see `massInfoFromResult`. */
  masses?: MassInfo[];
  /** Project levels for kotes – see `VariantResult.levels`. */
  levels?: ProjectLevel[];
  /** Context radius around the site (m). */
  contextMargin?: number;
  /** Localised texts written into the drawing (defaults: French). */
  texts?: Partial<DrawingTexts>;
  /** Pitched roof faces (see `VariantResult.roofs`). */
  roofs?: RoofPiece[];
}

export interface DrawingTexts {
  /** Sub-label of the top-of-parapet kote. */
  parapet: string;
  /** Datum name of absolute levels (NGF / NHN). */
  datum: string;
  /** Sub-label of the ridge kote (pitched roofs). */
  ridge: string;
}

export const DEFAULT_TEXTS: DrawingTexts = { parapet: 'acrotère', datum: 'NGF', ridge: 'faîtage' };

/** Collect mass info (formula, top of parapet, parapet height) from an analysis result. */
export function massInfoFromResult(result: VariantResult): MassInfo[] {
  return result.masses.map((m) => {
    const tops = m.solids.filter((s) => s.solid.aboveGround).map((s) => s.solid.z1);
    const slab = tops.length ? Math.max(...tops) : 0;
    return {
      massId: m.mass.id,
      name: m.mass.name,
      formula: m.formula,
      top: m.totalHeight,
      parapet: m.ridgeHeight > 0 ? 0 : Math.max(0, m.totalHeight - slab),
    };
  });
}

/** Solids, levels and mass info from an analysis result in one go. */
export function drawingInput(result: VariantResult): {
  solids: StoreySolid[];
  levels: ProjectLevel[];
  masses: MassInfo[];
  roofs: RoofPiece[];
} {
  return {
    solids: result.solids.map((s) => s.solid),
    levels: result.levels,
    masses: massInfoFromResult(result),
    roofs: result.roofs ?? [],
  };
}

export const COLORS = {
  ink: '#111111',
  grey: '#5c5c5c',
  lightGrey: '#9a9a9a',
  neighbourFill: '#d9d9d9',
  neighbourWall: '#e6e6e6',
  neighbourRoof: '#cfcfcf',
  neighbourCut: '#a3a3a3',
  wall: '#ffffff',
  green: '#e4eedb',
  greenLine: '#9cb58a',
  water: '#d8e6f2',
  waterLine: '#8fb0cc',
  road: '#f1f1ef',
  roadLine: '#b9b9b9',
  tree: '#7f9e6c',
};

export function schemeColors(scheme: ColorScheme = 'competition') {
  return scheme === 'permit'
    ? {
        massFill: '#e0453a',
        massText: '#ffffff',
        wall: '#fdeceb',
        roof: '#f2b8b2',
        poche: '#d7372c',
        outline: '#7a1610',
      }
    : {
        massFill: '#3b3b3b',
        massText: '#ffffff',
        wall: '#ffffff',
        roof: '#d6d6d6',
        poche: '#262626',
        outline: '#111111',
      };
}

export function line(
  pts: Vec2[],
  pen: Pen,
  type: LineType = 'solid',
  color?: string,
  closed?: boolean,
): DItem {
  const l: DItem = { kind: 'line', pts, pen, type };
  if (color) l.color = color;
  if (closed) l.closed = true;
  return l;
}

/** Parapet per mass: from `masses` (default 0). */
export function parapetOf(masses: MassInfo[] | undefined, massId: string): number {
  return masses?.find((m) => m.massId === massId)?.parapet ?? 0;
}

/**
 * Prisms of the masses: storeys with the same mass and z-range are unioned (no joint lines
 * between sections of the same height); the parapet is added to top storeys.
 */
export function massPrisms(
  solids: readonly StoreySolid[],
  masses: MassInfo[] | undefined,
  filter: (s: StoreySolid) => boolean = (s) => s.aboveGround,
  clip?: Polygon[],
): Prism[] {
  const groups = new Map<string, { massId: string; z0: number; z1: number; polys: Polygon[] }>();
  for (const s of solids) {
    if (!filter(s)) continue;
    const z1 = s.z1 + (s.top ? parapetOf(masses, s.massId) : 0);
    const k = `${s.massId}|${s.z0.toFixed(3)}|${z1.toFixed(3)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { massId: s.massId, z0: s.z0, z1, polys: [] }));
    g.polys.push(s.footprint);
  }
  const out: Prism[] = [];
  for (const g of groups.values()) {
    let polys = g.polys.length > 1 ? union(g.polys) : g.polys;
    if (clip) polys = intersection(polys, clip);
    polys.forEach((p, i) => out.push(prismFromPolygon(p, g.z0, g.z1, 'mass', `${g.massId}#${i}`)));
  }
  return out;
}

/**
 * Prisms with a sloped top for pitched roof pieces (group 'mass', kind of face 'roof'). With
 * `clip`, the pieces are intersected with the clip polygons; edges on an original seam stay seams.
 */
export function roofPrisms(roofs: readonly RoofPiece[] | undefined, clip?: Polygon[]): Prism[] {
  const out: Prism[] = [];
  (roofs ?? []).forEach((r, k) => {
    const ring = [...r.polygon.outer];
    let seams = [...r.seams];
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (ring.length > 1 && f && l && Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) {
      ring.pop();
      seams = seams.slice(0, ring.length);
    }
    const polys: { outer: Vec2[]; holes: Vec2[][]; seams: boolean[] }[] = [];
    if (clip) {
      const segs: [Vec2, Vec2][] = [];
      ring.forEach((a, i) => {
        if (seams[i]) segs.push([a, ring[(i + 1) % ring.length]!]);
      });
      for (const p of intersection([{ outer: ring, holes: r.polygon.holes ?? [] }], clip)) {
        const o = p.outer;
        polys.push({
          outer: o,
          holes: p.holes ?? [],
          seams: o.map((a, i) => {
            const b = o[(i + 1) % o.length]!;
            const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            return segs.some(([c, d]) => onSegment(m, c, d) && onSegment(a, c, d, true));
          }),
        });
      }
    } else polys.push({ outer: ring, holes: r.polygon.holes ?? [], seams });
    polys.forEach((p, i) => {
      if (p.outer.length < 3) return;
      const zs = p.outer.map((q) => r.plane[0] + r.plane[1] * q[0] + r.plane[2] * q[1]);
      const z1 = Math.max(...zs);
      if (z1 - r.z0 < 1e-6) return;
      out.push(
        orientPrism({
          outer: p.outer,
          holes: p.holes,
          z0: r.z0,
          z1,
          group: 'mass',
          id: `${r.massId}#roof${k}.${i}`,
          top: [...r.plane],
          seams: p.seams,
        }),
      );
    });
  });
  return out;
}

/** Is p on the segment c–d (within 1 mm); `line` only checks the supporting line. */
function onSegment(p: Vec2, c: Vec2, d: Vec2, line = false): boolean {
  const dx = d[0] - c[0];
  const dy = d[1] - c[1];
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return false;
  const off = Math.abs((p[0] - c[0]) * -dy + (p[1] - c[1]) * dx) / L;
  if (off > 1e-3) return false;
  if (line) return true;
  const t = ((p[0] - c[0]) * dx + (p[1] - c[1]) * dy) / L;
  return t > -1e-3 && t < L + 1e-3;
}

export function visibleContext(project: Project): ContextBuilding[] {
  return project.context.filter((c) => !c.hidden && !c.demolished);
}

export function contextPrisms(buildings: readonly ContextBuilding[], clip?: Polygon[]): Prism[] {
  const out: Prism[] = [];
  for (const c of buildings) {
    const z0 = Math.max(0, c.baseHeight ?? 0);
    if (c.height - z0 < 0.1) continue;
    const polys = clip ? intersection([c.footprint], clip) : [c.footprint];
    polys.forEach((p, i) => out.push(prismFromPolygon(p, z0, c.height, 'context', `${c.id}#${i}`)));
  }
  return out;
}

/** Bounding box of the site boundary (fallback: masses). */
export function siteBox(project: Project, solids: readonly StoreySolid[]) {
  const pts: Vec2[] = project.site.boundary.outer.length
    ? project.site.boundary.outer
    : solids.flatMap((s) => s.footprint.outer);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  if (!Number.isFinite(minX)) return { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  return { minX, minY, maxX, maxY };
}

export function bboxIntersects(
  poly: Polygon,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly.outer) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return !(x1 < b.minX || x0 > b.maxX || y1 < b.minY || y0 > b.maxY);
}

export interface SectionLine {
  id: string;
  a: Vec2;
  b: Vec2;
}

/**
 * Default sections through the site centroid: A along the long axis of the site (longitudinal),
 * B perpendicular (transverse). The viewer looks to the left of a→b.
 */
export function defaultSections(
  project: Project,
  solids: readonly StoreySolid[] = [],
): SectionLine[] {
  const ring = project.site.boundary.outer.length
    ? project.site.boundary.outer
    : solids.flatMap((s) => s.footprint.outer);
  if (ring.length < 3) {
    return [
      { id: 'A', a: [-30, 0], b: [30, 0] },
      { id: 'B', a: [0, 30], b: [0, -30] },
    ];
  }
  const c = ringCentroid(ring);
  const ext = orientedExtents(ring);
  const rot = ring.map((p) => rotatePoint([p[0] - c[0], p[1] - c[1]], -ext.angle));
  const w = Math.max(...rot.map((p) => p[0])) - Math.min(...rot.map((p) => p[0]));
  const h = Math.max(...rot.map((p) => p[1])) - Math.min(...rot.map((p) => p[1]));
  let ang = w >= h ? ext.angle : ext.angle + Math.PI / 2;
  // longitudinal direction pointing roughly east → viewer looks north-ish
  const d: Vec2 = [Math.cos(ang), Math.sin(ang)];
  if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && d[1] < 0)) ang += Math.PI;
  const u: Vec2 = [Math.cos(ang), Math.sin(ang)];
  const halfA = ext.length / 2 + 15;
  const halfB = ext.width / 2 + 15;
  // B: perpendicular, from north-ish to south-ish (viewer looks east-ish)
  const nB: Vec2 = [u[1], -u[0]];
  return [
    {
      id: 'A',
      a: [c[0] - u[0] * halfA, c[1] - u[1] * halfA],
      b: [c[0] + u[0] * halfA, c[1] + u[1] * halfA],
    },
    {
      id: 'B',
      a: [c[0] - nB[0] * halfB, c[1] - nB[1] * halfB],
      b: [c[0] + nB[0] * halfB, c[1] + nB[1] * halfB],
    },
  ];
}
