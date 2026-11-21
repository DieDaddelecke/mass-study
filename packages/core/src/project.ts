import { analyzeMasses, type VariantResult } from './analysis.js';
import { massLayouts } from './layout.js';
import { modelWarnings, type ModelWarning } from './checks.js';
import { greenKpis, type GreenKpis } from './green.js';
import { defaultTypology } from './generators.js';
import {
  normalizePolygon,
  polygonArea,
  ringCentroid,
  translatePolygon,
  union,
} from './geometry.js';
import { chooseCrs, lonLatPolygonToLocal, lonLatToCrs, localToLonLat } from './projection.js';
import {
  constraintRows,
  kpisDE,
  kpisFR,
  type ConstraintRow,
  type KpisDE,
  type KpisFR,
} from './rules.js';
import { defaultSettings, defaultStoreys } from './settings.js';
import type {
  Mass,
  Parcel,
  Polygon,
  Project,
  RuleProfileId,
  TypologyKind,
  Usage,
  Vec2,
} from './types.js';

export const SCHEMA_VERSION = 1;

let counter = 0;
/** Short unique id (no crypto dependency so it runs everywhere). */
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export interface NewProjectInput {
  name: string;
  /** Parcels as GeoJSON-style rings in [lon, lat]. */
  parcelsLonLat?: { ref?: string; source?: Parcel['source']; rings: [number, number][][] }[];
  /** Alternatively a boundary already in a local metric frame (drawn / DXF). */
  localBoundary?: Polygon;
  /** Reference location (address point); required if no parcels are given. */
  lonLat?: [number, number];
  profile?: RuleProfileId;
  address?: string;
  date?: string;
}

/**
 * Create a project. Parcels are projected into the national CRS; the local origin is the centroid
 * of the merged site so all model coordinates stay small.
 */
export function createProject(input: NewProjectInput): Project {
  const firstPoint = input.parcelsLonLat?.[0]?.rings[0]?.[0] ?? input.lonLat ?? [2.35, 48.85];
  const profile = input.profile ?? (chooseCrs(firstPoint) === 'EPSG:2154' ? 'FR' : 'DE');
  const crs = chooseCrs(firstPoint);
  const anchor = lonLatToCrs(crs, firstPoint);
  const frame0 = { crs, originCrs: anchor };

  let parcels: Parcel[] = (input.parcelsLonLat ?? []).map((p, i) => {
    const parcel: Parcel = {
      id: `parcel_${i + 1}`,
      source: p.source ?? 'cadastre',
      polygon: normalizePolygon(lonLatPolygonToLocal(frame0, p.rings)),
    };
    if (p.ref) parcel.ref = p.ref;
    return parcel;
  });
  if (!parcels.length && input.localBoundary) {
    parcels = [{ id: 'parcel_1', source: 'drawn', polygon: normalizePolygon(input.localBoundary) }];
  }
  const merged = union(parcels.map((p) => p.polygon));
  const boundary0 = merged.sort((a, b) => polygonArea(b) - polygonArea(a))[0] ?? {
    outer: [] as Vec2[],
  };
  const c = boundary0.outer.length ? ringCentroid(boundary0.outer) : ([0, 0] as Vec2);
  // re-centre on the site centroid
  const shift = (p: Polygon) => translatePolygon(p, -c[0], -c[1]);
  parcels = parcels.map((p) => ({ ...p, polygon: shift(p.polygon) }));
  const originCrs: Vec2 = [anchor[0] + c[0], anchor[1] + c[1]];
  const boundary = boundary0.outer.length ? shift(boundary0) : boundary0;
  const settings = defaultSettings(profile);
  const variantId = newId('var');
  const info: Project['info'] = {
    date: input.date ?? new Date().toISOString().slice(0, 10),
    revision: 'A',
    phase: profile === 'FR' ? 'Étude de capacité' : 'Massenstudie',
  };
  if (input.address) info.address = input.address;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    name: input.name,
    info,
    geo: { crs, originCrs, originLonLat: localToLonLat({ crs, originCrs }, [0, 0]) },
    site: { parcels, boundary },
    context: [],
    variants: [{ id: variantId, name: profile === 'FR' ? 'Variante A' : 'Variante A', masses: [] }],
    activeVariantId: variantId,
    views: [],
    sheets: [],
    settings,
    constraints: {},
  };
}

export function createMass(
  kind: TypologyKind,
  opts: { position?: Vec2; rotation?: number; usage?: Usage; name?: string } = {},
): Mass {
  const usage = opts.usage ?? 'wohnen';
  return {
    id: newId('mass'),
    name: opts.name ?? 'BK',
    typology: defaultTypology(kind),
    position: opts.position ?? [0, 0],
    rotation: opts.rotation ?? 0,
    storeys: defaultStoreys(usage),
    usage,
    access: 'auto',
  };
}

export interface ProjectAnalysis {
  result: VariantResult;
  de: KpisDE;
  fr: KpisFR;
  constraints: ConstraintRow[];
  warnings: ModelWarning[];
  /** Vegetation zones of the variant. */
  green: GreenKpis;
}

/** Full live analysis of one variant (default: the active one). */
export function analyzeProject(
  project: Project,
  variantId = project.activeVariantId,
): ProjectAnalysis {
  const variant = project.variants.find((v) => v.id === variantId);
  if (!variant) throw new Error(`Unknown variant ${variantId}`);
  const result = analyzeMasses(variant.masses, project.settings);
  const siteArea = project.site.boundary.outer.length ? polygonArea(project.site.boundary) : 0;
  const de = kpisDE(result, siteArea, project.settings);
  const fr = kpisFR(result, siteArea, project.settings);
  const green = greenKpis(variant.plantings ?? [], project.site.boundary, result);
  const constraints = constraintRows(project.settings.profile, project.constraints, de, fr, green);
  const site: { boundary: Polygon; buildable?: Polygon[] } = { boundary: project.site.boundary };
  const buildable = project.constraints.buildable ?? project.site.buildable;
  if (buildable) site.buildable = buildable;
  const warnings = modelWarnings(result, site, project.context, constraints);
  // office façade rules of the schematic unit layout
  const layouts = massLayouts(result, project.settings);
  let failing = 0;
  const failingMasses: string[] = [];
  for (const ml of layouts) {
    const n = ml.storeys.reduce((x, st) => x + st.summary.facadeViolations, 0);
    if (n) failingMasses.push(ml.massId);
    failing += n;
  }
  if (failing)
    warnings.push({
      code: 'unitFacade',
      severity: 'warning',
      massIds: failingMasses,
      data: { count: failing },
    });
  return { result, de, fr, constraints, warnings, green };
}

// ---------------------------------------------------------------------------
// File format (*.massing.json) and migrations
// ---------------------------------------------------------------------------

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a file from schemaVersion n to n + 1. */
const MIGRATIONS: Record<number, Migration> = {};

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export function parseProject(json: string): Project {
  let data = JSON.parse(json) as Record<string, unknown>;
  if (typeof data !== 'object' || data === null || typeof data.schemaVersion !== 'number') {
    throw new Error('Not a Kubatur project file (schemaVersion missing)');
  }
  let v = data.schemaVersion as number;
  if (v > SCHEMA_VERSION)
    throw new Error(`Project file is newer (v${v}) than this app (v${SCHEMA_VERSION})`);
  while (v < SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from schema v${v}`);
    data = { ...m(data), schemaVersion: v + 1 };
    v += 1;
  }
  const p = data as unknown as Project;
  if (!Array.isArray(p.variants) || !p.site || !p.settings) throw new Error('Invalid project file');
  return p;
}
