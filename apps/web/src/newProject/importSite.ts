import {
  chooseCrs,
  crsToLonLat,
  lonLatToCrs,
  ringCentroid,
  signedRingArea,
  type NewProjectInput,
  type Polygon,
  type Vec2,
} from '@kubatur/core';
import DxfParser from 'dxf-parser';
import type { LonLat, LonLatRings, ParcelResult } from '../api/contract';

/**
 * Pure helpers for the "Nouveau projet" dialog: parse imported site files (GeoJSON / DXF) and
 * turn the chosen site (parcels, drawn or imported polygon) into `createProject` input.
 */

/** Error with an i18n key (namespace `newProject`, prefix `import.errors.`). */
export class ImportError extends Error {
  constructor(public code: 'invalidJson' | 'noPolygon' | 'notWgs84' | 'invalidDxf' | 'noClosed') {
    super(code);
  }
}

/** The site chosen in the dialog. */
export type SiteDraft =
  /** Cadastral parcels (merged). */
  | { kind: 'parcels'; parcels: ParcelResult[] }
  /** WGS 84 polygons (drawn on the map, GeoJSON, DXF in Lambert-93). */
  | { kind: 'lonlat'; source: 'drawn' | 'import'; polygons: LonLatRings[] }
  /** Local metric polygon centred on (0,0), placed at `lonLat` (DXF in local coordinates). */
  | { kind: 'local'; polygon: Polygon; lonLat: LonLat };

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

type Json = unknown;

function isObj(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toRings(coords: unknown): LonLatRings {
  if (!Array.isArray(coords)) throw new ImportError('noPolygon');
  return coords.map((ring: unknown) => {
    if (!Array.isArray(ring)) throw new ImportError('noPolygon');
    return ring.map((p: unknown) => {
      if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number')
        throw new ImportError('noPolygon');
      const [lon, lat] = p as [number, number];
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) throw new ImportError('notWgs84');
      return [lon, lat] as LonLat;
    });
  });
}

function collect(g: Json, out: LonLatRings[]): void {
  if (!isObj(g)) return;
  switch (g.type) {
    case 'FeatureCollection':
      if (Array.isArray(g.features)) for (const f of g.features) collect(f, out);
      break;
    case 'Feature':
      collect(g.geometry, out);
      break;
    case 'GeometryCollection':
      if (Array.isArray(g.geometries)) for (const x of g.geometries) collect(x, out);
      break;
    case 'Polygon':
      out.push(toRings(g.coordinates));
      break;
    case 'MultiPolygon':
      if (Array.isArray(g.coordinates)) for (const p of g.coordinates) out.push(toRings(p));
      break;
  }
}

/** Parse a GeoJSON text (Polygon, MultiPolygon, Feature, FeatureCollection; WGS 84). */
export function parseGeoJsonSite(text: string): LonLatRings[] {
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError('invalidJson');
  }
  const out: LonLatRings[] = [];
  collect(json, out);
  const valid = out.filter((r) => (r[0]?.length ?? 0) >= 3);
  if (!valid.length) throw new ImportError('noPolygon');
  return valid;
}

// ---------------------------------------------------------------------------
// DXF
// ---------------------------------------------------------------------------

export interface DxfPolyline {
  /** Index in the entity list (stable id for the picker). */
  index: number;
  type: 'LWPOLYLINE' | 'POLYLINE';
  layer: string;
  /** Vertices in drawing units, without closing duplicate. */
  points: Vec2[];
  /** Area in drawing units². */
  area: number;
}

export type DxfUnit = 'm' | 'cm' | 'mm';
export const UNIT_SCALE: Record<DxfUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };
export type DxfReference = 'local' | 'lambert93';

/** All closed (LW)POLYLINEs of a DXF, largest first. Bulges (arcs) are ignored. */
export function parseDxfPolylines(text: string): DxfPolyline[] {
  let dxf;
  try {
    dxf = new DxfParser().parseSync(text);
  } catch {
    throw new ImportError('invalidDxf');
  }
  if (!dxf) throw new ImportError('invalidDxf');
  const out: DxfPolyline[] = [];
  dxf.entities.forEach((e, index) => {
    if (e.type !== 'LWPOLYLINE' && e.type !== 'POLYLINE') return;
    const ent = e as typeof e & { shape?: boolean; vertices?: { x: number; y: number }[] };
    const pts: Vec2[] = (ent.vertices ?? []).map((v) => [v.x, v.y]);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const explicitlyClosed =
      pts.length > 3 && first && last && first[0] === last[0] && first[1] === last[1];
    if (explicitlyClosed) pts.pop();
    if (!(ent.shape || explicitlyClosed) || pts.length < 3) return;
    out.push({
      index,
      type: e.type,
      layer: e.layer ?? '0',
      points: pts,
      area: Math.abs(signedRingArea(pts)),
    });
  });
  if (!out.length) throw new ImportError('noClosed');
  return out.sort((a, b) => b.area - a.area);
}

/**
 * Turn a DXF polyline into a site. Local coordinates are centred on the polygon centroid and
 * placed at `placeAt`; Lambert-93 coordinates are converted to WGS 84.
 */
export function dxfToSite(
  pl: DxfPolyline,
  unit: DxfUnit,
  reference: DxfReference,
  placeAt: LonLat,
): SiteDraft {
  const s = UNIT_SCALE[unit];
  const pts: Vec2[] = pl.points.map(([x, y]) => [x * s, y * s]);
  if (reference === 'lambert93') {
    const ring = pts.map((p) => crsToLonLat('EPSG:2154', p));
    ring.push(ring[0]!);
    return { kind: 'lonlat', source: 'import', polygons: [[ring]] };
  }
  const c = ringCentroid(pts);
  return {
    kind: 'local',
    polygon: { outer: pts.map(([x, y]) => [x - c[0], y - c[1]]) },
    lonLat: placeAt,
  };
}

// ---------------------------------------------------------------------------
// Site → createProject input / display
// ---------------------------------------------------------------------------

/** Merge selected parcels into the `parcelsLonLat` input of `createProject`. */
export function parcelsToInput(parcels: readonly ParcelResult[]): NewProjectInput['parcelsLonLat'] {
  return parcels.flatMap((p) =>
    p.polygons.map((rings) => ({ ref: p.ref, source: 'cadastre' as const, rings })),
  );
}

export function siteToInput(
  site: SiteDraft,
): Pick<NewProjectInput, 'parcelsLonLat' | 'localBoundary' | 'lonLat'> {
  switch (site.kind) {
    case 'parcels':
      return { parcelsLonLat: parcelsToInput(site.parcels) };
    case 'lonlat':
      return { parcelsLonLat: site.polygons.map((rings) => ({ source: site.source, rings })) };
    case 'local':
      return { localBoundary: site.polygon, lonLat: site.lonLat };
  }
}

/** Polygons in WGS 84 for showing the site on the map. */
export function siteOutline(site: SiteDraft): LonLatRings[] {
  switch (site.kind) {
    case 'parcels':
      return site.parcels.flatMap((p) => p.polygons);
    case 'lonlat':
      return site.polygons;
    case 'local': {
      const crs = chooseCrs(site.lonLat);
      const o = lonLatToCrs(crs, site.lonLat);
      const conv = (r: readonly Vec2[]) => {
        const ring = r.map(([x, y]) => crsToLonLat(crs, [x + o[0], y + o[1]]));
        return [...ring, ring[0]!];
      };
      return [[conv(site.polygon.outer), ...(site.polygon.holes ?? []).map(conv)]];
    }
  }
}

/** Approximate area (m²) of a WGS 84 site outline (local equirectangular projection). */
export function lonLatArea(polygons: readonly LonLatRings[]): number {
  let total = 0;
  for (const rings of polygons) {
    const ref = rings[0]?.[0];
    if (!ref) continue;
    const kx = 111_320 * Math.cos((ref[1] * Math.PI) / 180);
    const toM = (r: readonly LonLat[]): Vec2[] =>
      r.map(([lon, lat]) => [(lon - ref[0]) * kx, (lat - ref[1]) * 110_574]);
    rings.forEach((r, i) => {
      const a = Math.abs(signedRingArea(toM(r)));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

/** Remove consecutive near-duplicate vertices (double-click adds the last point twice). */
export function dedupeVertices(pts: readonly LonLat[], eps = 1e-7): LonLat[] {
  const out: LonLat[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) out.push(p);
  }
  return out;
}
