import type { LonLat, LonLatRings } from './contract.js';

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export function sameLonLat(a: LonLat, b: LonLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function closeRing(ring: LonLat[]): LonLat[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && !sameLonLat(first, last)) return [...ring, first];
  return ring;
}

/** Even-odd point-in-ring test. */
export function pointInRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: LonLat, rings: LonLatRings): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(p, outer)) return false;
  return !holes.some((h) => pointInRing(p, h));
}

/** Area-weighted centroid of a ring (falls back to the vertex mean for degenerate rings). */
export function ringCentroid(ring: LonLat[]): LonLat {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[j];
    const q = ring[i];
    if (!p || !q) continue;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-18) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Joins open polylines sharing end points into closed rings (OSM multipolygon members). */
export function joinIntoRings(lines: LonLat[][]): LonLat[][] {
  const rings: LonLat[][] = [];
  const open = lines.filter((l) => l.length >= 2).map((l) => [...l]);
  while (open.length) {
    let current = open.shift() as LonLat[];
    let progressed = true;
    while (progressed) {
      const first = current[0] as LonLat;
      const last = current[current.length - 1] as LonLat;
      if (current.length >= 4 && sameLonLat(first, last)) break;
      progressed = false;
      for (let i = 0; i < open.length; i++) {
        const l = open[i] as LonLat[];
        const lf = l[0] as LonLat;
        const ll = l[l.length - 1] as LonLat;
        if (sameLonLat(last, lf)) current = [...current, ...l.slice(1)];
        else if (sameLonLat(last, ll)) current = [...current, ...[...l].reverse().slice(1)];
        else if (sameLonLat(first, ll)) current = [...l, ...current.slice(1)];
        else if (sameLonLat(first, lf)) current = [...[...l].reverse(), ...current.slice(1)];
        else continue;
        open.splice(i, 1);
        progressed = true;
        break;
      }
    }
    const first = current[0] as LonLat;
    const last = current[current.length - 1] as LonLat;
    if (current.length >= 4 && sameLonLat(first, last)) rings.push(current);
  }
  return rings;
}

/** Approximate side lengths of a bbox in metres. */
export function bboxSizeMeters(b: BBox): { width: number; height: number } {
  const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  return {
    width: (b[2] - b[0]) * 111_320 * Math.cos(midLat),
    height: (b[3] - b[1]) * 110_574,
  };
}

export function bboxCenter(b: BBox): LonLat {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function inBBox(p: LonLat, b: BBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Rough coverage box of metropolitan France incl. Corsica (bbox test only). */
export const FRANCE_METRO_BBOX: BBox = [-5.3, 41.3, 9.7, 51.2];

/** Reads GeoJSON Polygon / MultiPolygon coordinates, dropping z values. */
export function geoJsonPolygons(geometry: unknown): LonLatRings[] {
  if (!isRecord(geometry)) return [];
  const toRings = (poly: unknown): LonLatRings | undefined => {
    if (!Array.isArray(poly)) return undefined;
    const rings = poly
      .map((ring: unknown) =>
        Array.isArray(ring)
          ? ring.flatMap((c: unknown): LonLat[] =>
              Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
                ? [[c[0], c[1]]]
                : [],
            )
          : [],
      )
      .filter((r) => r.length >= 3);
    return rings.length ? rings : undefined;
  };
  if (geometry.type === 'Polygon') {
    const r = toRings(geometry.coordinates);
    return r ? [r] : [];
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((p: unknown) => {
      const r = toRings(p);
      return r ? [r] : [];
    });
  }
  return [];
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
