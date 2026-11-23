import {
  effectiveParapet,
  isPitched,
  layoutStairs,
  massLayout,
  massRoofPieces,
  resolveStairRules,
  normalizePolygon,
  union,
  RESIDENCE_COMMON,
  type CoreStair,
  type SpaceKind,
  type Mass,
  type Polygon,
  type Project,
  type StoreySolid,
  type Usage,
  type Vec2,
  massToSolids,
} from '@kubatur/core';
import type {
  Coordinate2D,
  Coordinate3D,
  MorphBody,
  MorphData,
  RoofData,
  SlabData,
  StairData,
  TapirLibrary,
  TapirStory,
  WallData,
  ZoneData,
} from './tapir';
import {
  facadeWalls,
  interiorWalls,
  levelSlabs,
  nativeStair,
  planeRoof,
  type WallSegment,
} from './native';

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
  wohnheim: [0.92, 0.68, 0.36],
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
  /** One zone per dwelling, plus zones for cores, circulation and open floor areas. */
  zones: boolean;
  /** One zone per storey with its whole floor area (surface de plancher). */
  sdpZones: boolean;
  /** Façade walls and interior walls (cores, party walls). */
  walls: boolean;
  /** One slab per floor level (and roof slabs), with stair openings. */
  slabs: boolean;
  /** Pitched roofs as Archicad roofs. */
  roofs: boolean;
  /** Core stairs as Archicad stairs (morphs only where Archicad refuses one). */
  stairs: boolean;
  /** Storey volumes as morphs (massing study look). */
  morphs: boolean;
  /** Façade wall thickness, m. */
  facadeWall: number;
  /** Interior (party / corridor) wall thickness, m. */
  interiorWall: number;
}

export const DEFAULT_OPTIONS: PlanOptions = {
  zones: true,
  sdpZones: true,
  walls: true,
  slabs: true,
  roofs: true,
  stairs: true,
  morphs: false,
  facadeWall: 0.2,
  interiorWall: 0.18,
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

export type ItemKind = 'zone' | 'slab' | 'wall' | 'roof' | 'morph' | 'stair';

/** What a zone stands for: a dwelling, a core, circulation, an open floor area or a whole storey (SDP). */
export type ZoneRole = 'unit' | 'core' | 'circulation' | 'open' | 'sdp';

/** Zone category of a zone item ("MS - Logement", "MS - SDP" …). */
export interface ZoneCategoryDef {
  name: string;
  code: string;
  color: [number, number, number];
}

export interface PlanItem {
  /** Stable key, stored as user data: `${massId}|${part}|${storeyIndex}|${kind}` */
  key: string;
  kind: ItemKind;
  massName: string;
  storeyLabel: string;
  usage: Usage;
  area: number;
  /** Absolute finished-floor level of the storey (m). */
  z0: number;
  zone?: ZoneData;
  role?: ZoneRole;
  category?: ZoneCategoryDef;
  slab?: SlabData;
  wall?: WallData;
  roof?: RoofData;
  stair?: StairData;
  morph?: MorphData;
  /** Morphs that stand in for a stair Archicad refuses (flights and landing). */
  fallback?: MorphData[];
}

export type PlanWarning =
  | { code: 'noStories' }
  | { code: 'levelWithoutStory'; elevation: number; label: string; storyName: string }
  | { code: 'belowLowestStory'; elevation: number; label: string }
  | { code: 'librariesMissing'; names: string[] }
  | { code: 'sharedStory'; storyName: string; labels: string[] }
  | { code: 'teamwork' }
  | { code: 'noMasses' };

export interface PlanCounts {
  zones: number;
  sdpZones: number;
  walls: number;
  slabs: number;
  roofs: number;
  morphs: number;
  stairs: number;
  storeys: number;
}

export interface TransferPlan {
  storeys: StoreyMatch[];
  items: PlanItem[];
  /** Zone categories the zones use. */
  categories: ZoneCategoryDef[];
  warnings: PlanWarning[];
  counts: PlanCounts;
}

/** Zone names of the residence / office rooms (French, as the plans). */
export const SPACE_ZONE_NAMES: Record<SpaceKind, string> = {
  sde: "Salle d'eau",
  entree: 'Entrée',
  kitchenette: 'Kitchenette',
  gaine: 'Gaine',
  accueil: 'Accueil',
  laverie: 'Laverie',
  salleCommune: 'Salle commune',
  openSpace: 'Open space',
  bureau: 'Bureau',
  reunion: 'Salle de réunion',
  sanitaires: 'Sanitaires',
  hall: "Hall d'accueil",
};
const SPACE_ZONE_CODES: Record<SpaceKind, string> = {
  sde: 'SDE',
  entree: 'E',
  kitchenette: 'K',
  gaine: 'G',
  accueil: 'ACC',
  laverie: 'LAV',
  salleCommune: 'SC',
  openSpace: 'OS',
  bureau: 'B',
  reunion: 'R',
  sanitaires: 'WC',
  hall: 'HALL',
};
const COMMON_COLOR: [number, number, number] = [0.8, 0.72, 0.9];

/** Names of the non-dwelling zones, localised by the caller. */
export interface ZoneLabels {
  core: string;
  circulation: string;
  sdp: string;
}

export const DEFAULT_ZONE_LABELS: ZoneLabels = {
  core: "Cage d'escalier",
  circulation: 'Circulations',
  sdp: 'SDP',
};

export interface PlanInput {
  project: Project;
  masses: readonly Mass[];
  stories: readonly TapirStory[];
  libraries?: readonly TapirLibrary[];
  isTeamwork?: boolean;
  options: PlanOptions;
  /** Localised usage names ("Logement"…), used for zone names. */
  usageLabel: (u: Usage) => string;
  zoneLabels?: ZoneLabels;
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

/**
 * Closed prism for CreateMorphs from a planar ring (any plane) swept by the vector `e`.
 * The ring is reoriented so that its normal points along `e`; faces are then counter-clockwise
 * seen from outside, as in `extrudeBody`.
 */
export function prismBody(ring: readonly Coordinate3D[], e: Coordinate3D): MorphBody {
  // Newell normal of the ring
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const r = nx * e.x + ny * e.y + nz * e.z < 0 ? [...ring].reverse() : [...ring];
  const vertices: Coordinate3D[] = [];
  const b = r.map((p) => vertices.push({ x: round(p.x), y: round(p.y), z: round(p.z) }) - 1);
  const t = r.map(
    (p) => vertices.push({ x: round(p.x + e.x), y: round(p.y + e.y), z: round(p.z + e.z) }) - 1,
  );
  const polygons: MorphBody['polygons'] = [{ vertexIds: t }, { vertexIds: [...b].reverse() }];
  for (let i = 0; i < b.length; i++) {
    const j = (i + 1) % b.length;
    polygons.push({ vertexIds: [b[i]!, b[j]!, t[j]!, t[i]!] });
  }
  return { bodyType: 'Solid', vertices, polygons };
}

/** Rotates a plan vector by the placement rotation (no offset). */
function placeVector(v: Vec2, o: PlacementOptions): Coordinate2D {
  const a = (o.rotationDeg * Math.PI) / 180;
  return { x: v[0] * Math.cos(a) - v[1] * Math.sin(a), y: v[0] * Math.sin(a) + v[1] * Math.cos(a) };
}

/**
 * Morph bodies of a core stair (one per flight and per landing), local to a base point at
 * (0, 0, stair.z0), in placed coordinates.
 */
export function stairBodies(
  stair: CoreStair,
  o: PlacementOptions,
): { part: string; body: MorphBody }[] {
  const out: { part: string; body: MorphBody }[] = [];
  stair.flights.forEach((f, i) => {
    if (f.profile.length < 3) return;
    const ring = f.profile.map(([sx, z]) => {
      const p = placePoint([f.origin[0] + f.dir[0] * sx, f.origin[1] + f.dir[1] * sx], o);
      return { x: p.x, y: p.y, z: f.z0 - stair.z0 + z };
    });
    const side = placeVector([f.side[0] * f.width, f.side[1] * f.width], o);
    out.push({ part: `f${i + 1}`, body: prismBody(ring, { ...side, z: 0 }) });
  });
  stair.landings.forEach((l, i) => {
    const poly = normalizePolygon(l.polygon);
    const outer = poly.outer.map((p) => placePoint(p, o));
    const body = extrudeBody(outer, [], l.thickness);
    const dz = l.z - l.thickness - stair.z0;
    for (const v of body.vertices) v.z = round(v.z + dz);
    out.push({ part: `l${i + 1}`, body });
  });
  return out;
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

const SDP_COLOR: [number, number, number] = [0.85, 0.85, 0.85];
const CIRCULATION_COLOR: [number, number, number] = [0.8, 0.8, 0.72];

const placeRing = (ring: readonly Vec2[], o: PlacementOptions) => ring.map((p) => placePoint(p, o));

function placedPolygon(p: Polygon, o: PlacementOptions) {
  const poly = normalizePolygon(p);
  return {
    outer: placeRing(poly.outer, o),
    holes: (poly.holes ?? []).map((h) => placeRing(h, o)),
    area: round(netArea(poly)),
  };
}

export function buildPlan(input: PlanInput): TransferPlan {
  const { options: o } = input;
  const labels = input.zoneLabels ?? DEFAULT_ZONE_LABELS;
  const warnings: PlanWarning[] = [];
  const items: PlanItem[] = [];
  const storeys = new Map<string, StoreyMatch>();
  const categories = new Map<string, ZoneCategoryDef>();
  const zoneStoreys = new Set<string>();

  if (!input.stories.length) warnings.push({ code: 'noStories' });
  if (!input.masses.length) warnings.push({ code: 'noMasses' });
  if (input.isTeamwork) warnings.push({ code: 'teamwork' });
  const missingLibs = (input.libraries ?? []).filter((l) => !l.available).map((l) => l.name);
  if ((o.zones || o.sdpZones) && missingLibs.length)
    warnings.push({ code: 'librariesMissing', names: missingLibs });

  const lowest = [...input.stories].sort((a, b) => a.level - b.level)[0];
  const home = (z: number) => matchStory(z, input.stories)?.story ?? lowest;
  const category = (name: string, code: string, color: [number, number, number]) => {
    const c = { name: categoryName(name), code, color };
    categories.set(c.name, c);
    return c;
  };
  const usageCategory = (u: Usage) => category(input.usageLabel(u), `MS-${u}`, USAGE_COLORS[u]);

  /** Registers the level of a storey (preview table, warnings). Null without any story. */
  const storeyMatch = (z0: number, label: string): StoreyMatch | null => {
    const sk = `${round(z0)}`;
    const known = storeys.get(sk);
    if (known) return known;
    let match = matchStory(z0, input.stories);
    if (!match) {
      if (!lowest) return null;
      warnings.push({ code: 'belowLowestStory', elevation: z0, label });
      match = { story: lowest, exact: false };
    }
    const { story } = match;
    const m: StoreyMatch = {
      elevation: round(z0),
      label,
      storyIndex: story.index,
      storyName: story.name,
      storyLevel: story.level,
      offset: round(z0 - story.level),
      exact: match.exact,
    };
    storeys.set(sk, m);
    if (!match.exact && story.level <= z0)
      warnings.push({ code: 'levelWithoutStory', elevation: z0, label, storyName: story.name });
    return m;
  };

  for (const mass of input.masses) {
    const solids = massToSolids(mass, input.project.settings).filter((s) => s.z1 - s.z0 > 0);
    const slabT = mass.storeys.slabThickness > 0 ? mass.storeys.slabThickness : 0.25;
    const tag = mass.name.replace(/\s+/g, '');
    const layout =
      o.zones || o.walls || o.stairs || o.slabs
        ? massLayout(mass, solids, input.project.settings)
        : null;
    const stairs: CoreStair[] = layout
      ? [...layoutStairs([layout], input.project.settings).values()].flat()
      : [];
    const labelOf = (storeyIndex: number) =>
      solids.find((x) => x.storeyIndex === storeyIndex)?.label ?? '';

    for (const s of solids) storeyMatch(s.z0, s.label);

    // --- zones: dwellings, cores, circulation, open areas -------------------------------
    if (o.zones && layout)
      for (const st of layout.storeys) {
        const m = storeyMatch(st.z0, st.label);
        if (!m) continue;
        const height = round(st.z1 - st.z0);
        zoneStoreys.add(`${m.storyIndex}|${m.elevation}`);
        const base = {
          massName: mass.name,
          storeyLabel: st.label,
          usage: st.usage,
          z0: round(st.z0),
          kind: 'zone' as const,
        };
        const zone = (
          part: string,
          poly: Polygon,
          name: string,
          number: string,
          role: ZoneRole,
          cat: ZoneCategoryDef,
        ) => {
          const pp = placedPolygon(poly, o);
          if (pp.outer.length < 3) return;
          items.push({
            ...base,
            key: `${mass.id}|${part}|${st.storeyIndex}|zone`,
            area: pp.area,
            role,
            category: cat,
            zone: {
              floorIndex: m.storyIndex,
              name,
              numberStr: number,
              height,
              bottomOffset: m.offset,
              // Tapir's overlap check ignores holes: the cores inside an open floor area would
              // count as overlapping, so a zone with holes skips it (created after the others)
              allowOverlap: pp.holes.length > 0,
              geometry: {
                polygonCoordinates: pp.outer,
                ...(pp.holes.length ? { holes: pp.holes.map((h) => ({ polygonOutline: h })) } : {}),
              },
            },
          });
        };
        const prefix = `${tag}-${st.label}`.replace(/\s+/g, '');
        st.units.forEach((u, i) =>
          zone(
            `u${i}`,
            u.polygon,
            u.label,
            `${prefix}-${String(i + 1).padStart(2, '0')}`,
            'unit',
            usageCategory(st.usage),
          ),
        );
        st.open.forEach((a, i) =>
          zone(
            `o${i}`,
            a.polygon,
            input.usageLabel(st.usage),
            `${prefix}-${st.units.length + i + 1}`,
            'open',
            usageCategory(st.usage),
          ),
        );
        const circ = category(labels.circulation, 'MS-circulation', CIRCULATION_COLOR);
        st.cores.forEach((c, i) =>
          zone(`k${i}`, c.polygon, labels.core, `${prefix}-ESC${i + 1}`, 'core', circ),
        );
        // residence / office rooms (shafts and kitchenettes lie inside the units: no zone)
        const common = category(SPACE_ZONE_NAMES.salleCommune, 'MS-commun', COMMON_COLOR);
        (st.spaces ?? [])
          .filter((sp) => !sp.overlay && sp.kind !== 'gaine')
          .forEach((sp, i) =>
            zone(
              `s${i}`,
              sp.polygon,
              SPACE_ZONE_NAMES[sp.kind],
              `${prefix}-${SPACE_ZONE_CODES[sp.kind]}${i + 1}`,
              'open',
              RESIDENCE_COMMON.includes(sp.kind) ? common : usageCategory(st.usage),
            ),
          );
        st.circulation.forEach((c, i) =>
          zone(`c${i}`, c.polygon, labels.circulation, `${prefix}-C${i + 1}`, 'circulation', circ),
        );
      }

    // --- SDP zone per storey, and storey volumes (morphs) -----------------------------------
    for (const s of solids) {
      const m = storeyMatch(s.z0, s.label);
      if (!m) continue;
      const pp = placedPolygon(s.footprint, o);
      if (pp.outer.length < 3) continue;
      const height = round(s.z1 - s.z0);
      const number = `MS-${tag}-${s.label}`.replace(/\s+/g, '');
      const base = {
        massName: mass.name,
        storeyLabel: s.label,
        usage: s.usage,
        area: pp.area,
        z0: round(s.z0),
      };
      const holes2d = pp.holes.map((h) => ({ polygonOutline: h }));
      if (o.sdpZones) {
        zoneStoreys.add(`${m.storyIndex}|${m.elevation}`);
        items.push({
          ...base,
          key: itemKey(s, 'zone').replace(/\|zone$/, '|sdp|zone'),
          kind: 'zone',
          role: 'sdp',
          category: category(labels.sdp, 'MS-SDP', SDP_COLOR),
          zone: {
            floorIndex: m.storyIndex,
            name: `${labels.sdp} ${input.usageLabel(s.usage)}`,
            numberStr: `${number}-SDP`,
            height,
            bottomOffset: m.offset,
            // dwelling zones lie inside: the SDP zone overlaps them on purpose
            allowOverlap: o.zones,
            geometry: {
              polygonCoordinates: pp.outer,
              ...(holes2d.length ? { holes: holes2d } : {}),
            },
          },
        });
      }
      if (o.morphs)
        items.push({
          ...base,
          key: itemKey(s, 'morph'),
          kind: 'morph',
          morph: {
            basePoint: { x: 0, y: 0, z: round(s.z0) },
            floorIndex: m.storyIndex,
            body: extrudeBody(pp.outer, pp.holes, height),
            id: number,
          },
        });
    }

    // --- walls ---------------------------------------------------------------------------
    if (o.walls) {
      const parapet = effectiveParapet(mass, mass.storeys);
      // sections of one storey with the same levels share their façade (no double walls)
      const groups = new Map<string, StoreySolid[]>();
      for (const s of solids) {
        const k = `${s.storeyIndex}|${s.z0.toFixed(3)}|${s.z1.toFixed(3)}`;
        groups.set(k, [...(groups.get(k) ?? []), s]);
      }
      const segs: { seg: WallSegment; s: StoreySolid; top: boolean; n: string }[] = [];
      for (const list of groups.values()) {
        const s = list[0]!;
        const fps = list.length > 1 ? union(list.map((x) => x.footprint)) : [s.footprint];
        const top = list.every((x) => x.top);
        fps.forEach((fp, k) =>
          facadeWalls(fp, o.facadeWall).forEach((seg, i) =>
            segs.push({ seg, s, top, n: `f${s.segment ?? 0}.${k}.${i}` }),
          ),
        );
      }
      if (layout) {
        const coreT = resolveCoreWall(input.project);
        for (const st of layout.storeys) {
          const s = solids.find(
            (x) => x.storeyIndex === st.storeyIndex && Math.abs(x.z0 - st.z0) < 1e-6,
          );
          if (!s) continue;
          interiorWalls(st, { interior: o.interiorWall, core: coreT }).forEach((seg, i) =>
            segs.push({ seg, s: { ...s, z1: st.z1 }, top: false, n: `i${i}` }),
          );
        }
      }
      for (const { seg, s, top, n } of segs) {
        const m = storeyMatch(s.z0, s.label);
        if (!m) continue;
        const a = placePoint(seg.a, o);
        const b = placePoint(seg.b, o);
        // up to the underside of the slab above; flat-roof façades rise to the parapet top
        const up = seg.kind === 'facade' && top && parapet > 0 ? parapet : -slabT;
        const height = round(s.z1 - s.z0 + up);
        if (height <= 0) continue;
        items.push({
          key: `${mass.id}|${n}|${s.storeyIndex}|wall`,
          kind: 'wall',
          massName: mass.name,
          storeyLabel: s.label,
          usage: s.usage,
          area: 0,
          z0: round(s.z0),
          wall: {
            begCoordinate: a,
            endCoordinate: b,
            floorIndex: m.storyIndex,
            zCoordinate: m.offset,
            height,
            thickness: round(seg.thickness),
            referenceLineLocation: 'Center',
            structureType: 'Basic',
          },
        });
      }
    }

    // --- slabs: one per floor level, roof slabs, stair openings ------------------------------
    if (o.slabs)
      levelSlabs(solids, stairs).forEach((sl, i) => {
        const pp = placedPolygon(sl.polygon, o);
        if (pp.outer.length < 3) return;
        const story = home(sl.z);
        if (!story) return;
        items.push({
          key: `${mass.id}|s${i}|${sl.storeyIndex}|slab`,
          kind: 'slab',
          massName: mass.name,
          storeyLabel: labelOf(sl.storeyIndex),
          usage: solids.find((x) => x.storeyIndex === sl.storeyIndex)?.usage ?? 'wohnen',
          area: pp.area,
          z0: round(sl.z),
          slab: {
            floorIndex: story.index,
            level: round(sl.z),
            thickness: slabT,
            structureType: 'Basic',
            referencePlaneLocation: 'Top',
            polygonCoordinates: pp.outer,
            ...(pp.holes.length ? { holes: pp.holes.map((h) => ({ polygonOutline: h })) } : {}),
            id: `MS-${tag}-${sl.roof ? 'TOIT' : 'PH'}-${labelOf(sl.storeyIndex)}`.replace(
              /\s+/g,
              '',
            ),
          },
        });
      });

    // --- pitched roofs -------------------------------------------------------------------------
    if (o.roofs && isPitched(mass.roof))
      massRoofPieces(mass, solids).forEach((piece, i) => {
        const r = planeRoof(piece);
        const story = home(piece.z0);
        if (!r || !story) return;
        const pp = placedPolygon(r.polygon, o);
        if (pp.outer.length < 3) return;
        items.push({
          key: `${mass.id}|r${i}|top|roof`,
          kind: 'roof',
          massName: mass.name,
          storeyLabel: '',
          usage: 'wohnen',
          area: pp.area,
          z0: round(r.level),
          roof: {
            level: round(r.level),
            floorIndex: story.index,
            thickness: slabT,
            structureType: 'Basic',
            polygonCoordinates: pp.outer,
            ...(pp.holes.length ? { holes: pp.holes.map((h) => ({ polygonOutline: h })) } : {}),
            pivotLine: {
              begCoordinate: placePoint(r.pivot[0], o),
              endCoordinate: placePoint(r.pivot[1], o),
            },
            angle: round(r.angle),
          },
        });
      });

    // --- stairs: native U-shaped stairs, morphs as fallback ----------------------------------
    if (o.stairs)
      for (const st of stairs) {
        const story = home(st.z0);
        if (!story) continue;
        const label = labelOf(st.storeyIndex);
        const id = `MS-${tag}-${label}-ESC${st.coreIndex + 1}`.replace(/\s+/g, '');
        const fallback = stairBodies(st, o).map(({ body }): MorphData => ({
          basePoint: { x: 0, y: 0, z: round(st.z0) },
          floorIndex: story.index,
          body,
          id,
        }));
        const n = nativeStair(st);
        const item: PlanItem = {
          key: `${mass.id}|stair${st.coreIndex}|${st.storeyIndex}|stair`,
          kind: 'stair',
          massName: mass.name,
          storeyLabel: label,
          usage: 'wohnen',
          area: 0,
          z0: round(st.z0),
          fallback,
        };
        if (n)
          item.stair = {
            baseLinePoints: n.points.map((p) => placePoint(p, o)),
            baselinePosition: n.baseline,
            zCoordinate: round(n.z0),
            floorIndex: story.index,
            totalHeight: round(n.height),
            flightWidth: round(n.flightWidth),
            stepNum: n.risers,
            riserHeight: round(n.riser),
            treadDepth: round(n.going),
            baseLineEdges: [
              { segmentType: 'Flight' },
              { segmentType: 'Landing' },
              { segmentType: 'Flight' },
            ],
            baseLineVertices: [
              { turnType: 'None' },
              { turnType: 'Landing' },
              { turnType: 'Landing' },
              { turnType: 'None' },
            ],
            id,
          };
        items.push(item);
      }
  }

  const sortedStoreys = [...storeys.values()].sort((a, b) => a.elevation - b.elevation);
  if (o.zones || o.sdpZones) {
    // Zones of several levels on one Archicad story overlap in plan: Archicad refuses them.
    const byStory = new Map<number, StoreyMatch[]>();
    for (const m of sortedStoreys)
      if (zoneStoreys.has(`${m.storyIndex}|${m.elevation}`))
        byStory.set(m.storyIndex, [...(byStory.get(m.storyIndex) ?? []), m]);
    for (const list of byStory.values())
      if (list.length > 1)
        warnings.push({
          code: 'sharedStory',
          storyName: list[0]!.storyName,
          labels: list.map((m) => m.label),
        });
  }
  const count = (k: ItemKind, f: (i: PlanItem) => boolean = () => true) =>
    items.filter((i) => i.kind === k && f(i)).length;
  return {
    storeys: sortedStoreys,
    items,
    categories: [...categories.values()],
    warnings,
    counts: {
      zones: count('zone', (i) => i.role !== 'sdp'),
      sdpZones: count('zone', (i) => i.role === 'sdp'),
      walls: count('wall'),
      slabs: count('slab'),
      roofs: count('roof'),
      morphs: count('morph'),
      stairs: count('stair'),
      storeys: sortedStoreys.length,
    },
  };
}

function resolveCoreWall(project: Project): number {
  return resolveStairRules(project.settings).wall;
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

// ---------------------------------------------------------------------------
// Story proposal ("Préparer Archicad")
// ---------------------------------------------------------------------------

/** One entry of Tapir's SetStories input (matched positionally from the bottom). */
export interface StorySetting {
  index?: number;
  name: string;
  level: number;
  dispOnSections: boolean;
}

export interface StoryChange {
  /** Existing story (undefined = new story). */
  before?: { name: string; level: number };
  after: { name: string; level: number };
}

export interface StoryProposal {
  /** Full story list for SetStories. */
  stories: StorySetting[];
  changes: StoryChange[];
  /** True when the Archicad stories already match every app level. */
  matches: boolean;
}

/** Default height for Archicad stories kept above the app's top level. */
const DEFAULT_STORY_HEIGHT = 3;

/**
 * Archicad stories that give every app level its own story at the exact height.
 * Stories below the lowest app level stay as they are; the following stories take
 * the app levels and names in order; surplus stories above are kept (raised if needed),
 * so the number of stories never shrinks and no story with elements is removed.
 */
export function proposeStories(
  levels: readonly { elevation: number; label: string }[],
  stories: readonly TapirStory[],
): StoryProposal {
  const sorted = [...stories].sort((a, b) => a.level - b.level);
  const app = [...levels].sort((a, b) => a.elevation - b.elevation);
  const matches = app.every((l) =>
    sorted.some((s) => Math.abs(s.level - l.elevation) <= LEVEL_TOL),
  );
  if (!app.length) return { stories: [], changes: [], matches: true };
  const min = app[0]!.elevation;
  const below = sorted.filter((s) => s.level < min - LEVEL_TOL);
  const rest = sorted.slice(below.length);
  const out: StorySetting[] = [];
  const changes: StoryChange[] = [];
  const disp = (s?: TapirStory) => s?.dispOnSections ?? true;

  for (const s of below) out.push({ name: s.name, level: s.level, dispOnSections: disp(s) });
  app.forEach((l, i) => {
    const old = rest[i];
    // masses with different floor heights give one label several levels: keep names unique
    const dup = app.filter((x) => x.label === l.label).length > 1;
    const name = dup ? `${l.label} (${l.elevation.toFixed(2)})` : l.label;
    const next = { name, level: round(l.elevation) };
    out.push({ ...next, dispOnSections: disp(old) });
    if (!old || old.name !== next.name || Math.abs(old.level - next.level) > 1e-6)
      changes.push({
        ...(old ? { before: { name: old.name, level: old.level } } : {}),
        after: next,
      });
  });
  // surplus stories above: shifted up together (keeping their heights) only if the
  // top app level would otherwise be lower than DEFAULT_STORY_HEIGHT
  const surplus = rest.slice(app.length);
  const top = out[out.length - 1]!.level;
  const shift = surplus[0] ? Math.max(0, top + DEFAULT_STORY_HEIGHT - surplus[0].level) : 0;
  for (const old of surplus) {
    const level = round(old.level + shift);
    out.push({ name: old.name, level, dispOnSections: disp(old) });
    if (shift)
      changes.push({
        before: { name: old.name, level: old.level },
        after: { name: old.name, level },
      });
  }
  // pin the numbering so basements keep their negative indices
  if (sorted[0]) out[0] = { ...out[0]!, index: sorted[0].index };
  return { stories: out, changes, matches };
}
