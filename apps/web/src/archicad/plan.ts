import {
  normalizePolygon,
  type Mass,
  type Polygon,
  type Project,
  type StoreySolid,
  type Usage,
  type Vec2,
  massToSolids,
  USAGES,
} from '@kubatur/core';
import type {
  Coordinate2D,
  Coordinate3D,
  MorphBody,
  MorphData,
  SlabData,
  TapirLibrary,
  TapirStory,
  ZoneData,
} from './tapir';

/**
 * Pure transfer planning: project → the Archicad elements to create.
 * No I/O here; `transfer.ts` executes a plan through the local bridge.
 */

/** Prefix of every user-data key Kubatur writes on Archicad elements. */
export const USER_DATA_PREFIX = 'kubatur.';
export const KEY_PROJECT = 'kubatur.projectId';
export const KEY_ITEM = 'kubatur.item';
export const KEY_REV = 'kubatur.rev';

export const LAYER_NAME = 'MS - Massenstudie';
/** Zone category per usage: "MS - Logement" etc. Colours follow the app's usage colours loosely. */
export const USAGE_COLORS: Record<Usage, [number, number, number]> = {
  wohnen: [0.96, 0.8, 0.45],
  buero: [0.55, 0.72, 0.92],
  gewerbe: [0.92, 0.55, 0.55],
  gemeinbedarf: [0.7, 0.6, 0.88],
  parken: [0.72, 0.72, 0.72],
  technik: [0.6, 0.8, 0.6],
};
export function categoryName(usageLabel: string): string {
  return `MS - ${usageLabel}`;
}

/** Story matching tolerance (m), same as the project-level tolerance default. */
const LEVEL_TOL = 0.05;

export interface PlacementOptions {
  /** Translation added after rotation, in Archicad project coordinates (m). */
  offsetX: number;
  offsetY: number;
  /** Rotation about the app origin, counter-clockwise, degrees. */
  rotationDeg: number;
}

export interface PlanOptions extends PlacementOptions {
  zones: boolean;
  slabs: boolean;
  morphs: boolean;
}

export const DEFAULT_OPTIONS: PlanOptions = {
  zones: true,
  slabs: false,
  morphs: true,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
};

export interface StoreyMatch {
  elevation: number;
  label: string;
  storyIndex: number;
  storyName: string;
  storyLevel: number;
  /** elevation − storyLevel; ≠ 0 means the zone sits above its home story. */
  offset: number;
  exact: boolean;
}

export type ItemKind = 'zone' | 'slab' | 'morph';

export interface PlanItem {
  /** Stable key, stored as user data: `${massId}|${segment}|${storeyIndex}|${kind}` */
  key: string;
  kind: ItemKind;
  massName: string;
  storeyLabel: string;
  usage: Usage;
  area: number;
  /** Absolute finished-floor level of the storey (m). */
  z0: number;
  zone?: ZoneData;
  slab?: SlabData;
  morph?: MorphData;
}

export type PlanWarning =
  | { code: 'noStories' }
  | { code: 'levelWithoutStory'; elevation: number; label: string; storyName: string }
  | { code: 'belowLowestStory'; elevation: number; label: string }
  | { code: 'librariesMissing'; names: string[] }
  | { code: 'teamwork' }
  | { code: 'noMasses' };

export interface TransferPlan {
  storeys: StoreyMatch[];
  items: PlanItem[];
  usages: Usage[];
  warnings: PlanWarning[];
  counts: { zones: number; slabs: number; morphs: number; storeys: number };
}

export interface PlanInput {
  project: Project;
  masses: readonly Mass[];
  stories: readonly TapirStory[];
  libraries?: readonly TapirLibrary[];
  isTeamwork?: boolean;
  options: PlanOptions;
  /** Localised usage names ("Logement"…), used for zone names. */
  usageLabel: (u: Usage) => string;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function placePoint(p: Vec2, o: PlacementOptions): Coordinate2D {
  const a = (o.rotationDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: round(p[0] * c - p[1] * s + o.offsetX), y: round(p[0] * s + p[1] * c + o.offsetY) };
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function ringArea(r: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area of a normalised polygon (outer CCW, holes CW). */
export function netArea(p: Polygon): number {
  return ringArea(p.outer) + (p.holes ?? []).reduce((s, h) => s + ringArea(h), 0);
}

/**
 * Closed extruded body for CreateMorphs: faces counter-clockwise seen from outside,
 * face holes clockwise (Tapir MorphBody / MorphPolygonHole).
 * Expects a normalised polygon (outer CCW, holes CW) in placed coordinates.
 */
export function extrudeBody(
  outer: Coordinate2D[],
  holes: Coordinate2D[][],
  height: number,
): MorphBody {
  const vertices: Coordinate3D[] = [];
  const rings = [outer, ...holes];
  const bottom: number[][] = [];
  const top: number[][] = [];
  for (const ring of rings) {
    const b: number[] = [];
    const t: number[] = [];
    for (const p of ring) {
      b.push(vertices.push({ x: p.x, y: p.y, z: 0 }) - 1);
    }
    for (const p of ring) {
      t.push(vertices.push({ x: p.x, y: p.y, z: round(height) }) - 1);
    }
    bottom.push(b);
    top.push(t);
  }
  const polygons: MorphBody['polygons'] = [];
  // top: outer CCW from above, holes CW from above
  polygons.push({
    vertexIds: top[0]!,
    ...(holes.length ? { holes: top.slice(1).map((h) => ({ vertexIds: h })) } : {}),
  });
  // bottom: seen from below the orientation flips
  polygons.push({
    vertexIds: [...bottom[0]!].reverse(),
    ...(holes.length
      ? { holes: bottom.slice(1).map((h) => ({ vertexIds: [...h].reverse() })) }
      : {}),
  });
  // walls: every ring keeps the solid on its left, so [a↓, b↓, b↑, a↑] is CCW from outside
  for (let r = 0; r < rings.length; r++) {
    const b = bottom[r]!;
    const t = top[r]!;
    for (let i = 0; i < b.length; i++) {
      const j = (i + 1) % b.length;
      polygons.push({ vertexIds: [b[i]!, b[j]!, t[j]!, t[i]!] });
    }
  }
  return { bodyType: 'Solid', vertices, polygons };
}

// ---------------------------------------------------------------------------
// Story matching
// ---------------------------------------------------------------------------

/**
 * Home story of an elevation: the highest story whose level is at or below it (within
 * tolerance). Never changes the Archicad story structure.
 */
export function matchStory(
  elevation: number,
  stories: readonly TapirStory[],
): { story: TapirStory; exact: boolean } | null {
  const sorted = [...stories].sort((a, b) => a.level - b.level);
  let best: TapirStory | null = null;
  for (const s of sorted) if (s.level <= elevation + LEVEL_TOL) best = s;
  if (!best) return null;
  return { story: best, exact: Math.abs(best.level - elevation) <= LEVEL_TOL };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function itemKey(
  s: Pick<StoreySolid, 'massId' | 'segment' | 'storeyIndex'>,
  kind: ItemKind,
) {
  return `${s.massId}|${s.segment ?? 0}|${s.storeyIndex}|${kind}`;
}

export function buildPlan(input: PlanInput): TransferPlan {
  const { options: o } = input;
  const warnings: PlanWarning[] = [];
  const items: PlanItem[] = [];
  const storeys = new Map<string, StoreyMatch>();
  const usages = new Set<Usage>();

  if (!input.stories.length) warnings.push({ code: 'noStories' });
  if (!input.masses.length) warnings.push({ code: 'noMasses' });
  if (input.isTeamwork) warnings.push({ code: 'teamwork' });
  const missingLibs = (input.libraries ?? []).filter((l) => !l.available).map((l) => l.name);
  if (o.zones && missingLibs.length)
    warnings.push({ code: 'librariesMissing', names: missingLibs });

  const lowest = [...input.stories].sort((a, b) => a.level - b.level)[0];

  for (const mass of input.masses) {
    const solids = massToSolids(mass, input.project.settings);
    for (const s of solids) {
      const height = round(s.z1 - s.z0);
      if (height <= 0) continue;
      let match = matchStory(s.z0, input.stories);
      if (!match) {
        if (!lowest) continue;
        warnings.push({ code: 'belowLowestStory', elevation: s.z0, label: s.label });
        match = { story: lowest, exact: false };
      }
      const { story } = match;
      const sk = `${round(s.z0)}`;
      if (!storeys.has(sk)) {
        storeys.set(sk, {
          elevation: round(s.z0),
          label: s.label,
          storyIndex: story.index,
          storyName: story.name,
          storyLevel: story.level,
          offset: round(s.z0 - story.level),
          exact: match.exact,
        });
        if (!match.exact && story.level <= s.z0)
          warnings.push({
            code: 'levelWithoutStory',
            elevation: s.z0,
            label: s.label,
            storyName: story.name,
          });
      }

      const poly = normalizePolygon(s.footprint);
      if (poly.outer.length < 3) continue;
      const outer = poly.outer.map((p) => placePoint(p, o));
      const holes = (poly.holes ?? []).map((h) => h.map((p) => placePoint(p, o)));
      const area = round(netArea(poly));
      const number = `MS-${mass.name}-${s.label}`.replace(/\s+/g, '');
      const base = {
        massName: mass.name,
        storeyLabel: s.label,
        usage: s.usage,
        area,
        z0: round(s.z0),
      };
      usages.add(s.usage);
      const holes2d = holes.map((h) => ({ polygonOutline: h }));

      if (o.zones)
        items.push({
          ...base,
          key: itemKey(s, 'zone'),
          kind: 'zone',
          zone: {
            floorIndex: story.index,
            name: input.usageLabel(s.usage),
            numberStr: number,
            height,
            bottomOffset: round(s.z0 - story.level),
            allowOverlap: false,
            geometry: { polygonCoordinates: outer, ...(holes.length ? { holes: holes2d } : {}) },
          },
        });
      if (o.slabs)
        items.push({
          ...base,
          key: itemKey(s, 'slab'),
          kind: 'slab',
          slab: {
            floorIndex: story.index,
            level: round(s.z0),
            thickness: mass.storeys.slabThickness > 0 ? mass.storeys.slabThickness : 0.25,
            structureType: 'Basic',
            referencePlaneLocation: 'Top',
            polygonCoordinates: outer,
            ...(holes.length ? { holes: holes2d } : {}),
            id: number,
          },
        });
      if (o.morphs)
        items.push({
          ...base,
          key: itemKey(s, 'morph'),
          kind: 'morph',
          morph: {
            basePoint: { x: 0, y: 0, z: round(s.z0) },
            floorIndex: story.index,
            body: extrudeBody(outer, holes, height),
            id: number,
          },
        });
    }
  }

  const sortedStoreys = [...storeys.values()].sort((a, b) => a.elevation - b.elevation);
  return {
    storeys: sortedStoreys,
    items,
    usages: USAGES.filter((u) => usages.has(u)),
    warnings,
    counts: {
      zones: items.filter((i) => i.kind === 'zone').length,
      slabs: items.filter((i) => i.kind === 'slab').length,
      morphs: items.filter((i) => i.kind === 'morph').length,
      storeys: sortedStoreys.length,
    },
  };
}

/** Morph stand-in for a zone that Archicad refused (e.g. missing zone stamp). */
export function morphForZone(item: PlanItem): MorphData | null {
  const z = item.zone;
  if (!z) return null;
  return {
    basePoint: { x: 0, y: 0, z: item.z0 },
    floorIndex: z.floorIndex,
    body: extrudeBody(
      z.geometry.polygonCoordinates,
      (z.geometry.holes ?? []).map((h) => h.polygonOutline),
      z.height ?? 3,
    ),
    id: z.numberStr,
  };
}
