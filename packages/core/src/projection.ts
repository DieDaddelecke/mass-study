import proj4 from 'proj4';
import type { Polygon, Vec2 } from './types.js';

const LAMBERT93 =
  '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs';

proj4.defs('EPSG:2154', LAMBERT93);

/** proj4 definition string of a UTM zone on ETRS89/WGS84 (EPSG:258xx in Europe, 326xx/327xx elsewhere). */
function utmDef(zone: number, south: boolean): string {
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs`;
}

/** Metropolitan France (incl. Corsica), generous bounding box. */
function inFrance([lon, lat]: [number, number]): boolean {
  return lon >= -5.5 && lon <= 10 && lat >= 41 && lat <= 51.5;
}

function inGermany([lon, lat]: [number, number]): boolean {
  return lon >= 5.5 && lon <= 15.5 && lat >= 47 && lat <= 55.2;
}

/**
 * Rough Franco-German border: true if the point lies on the French side.
 * Rhine from Basel to Lauterbourg, then the Palatinate/Saarland line to the Luxembourg tripoint.
 * Only used to pick a default CRS; the project stores its CRS explicitly.
 */
function frenchSideOfBorder([lon, lat]: [number, number]): boolean {
  if (lat < 47.6) return lon < 7.6;
  if (lat < 48.97) return lon < 7.6 + ((lat - 47.6) * (8.2 - 7.6)) / (48.97 - 47.6);
  if (lat < 49.2) return lon < 7.4;
  if (lat < 49.5) return lon < 6.6;
  return lon < 6.1;
}

/**
 * Choose the projected CRS for a location:
 * France → EPSG:2154 (Lambert-93), Germany → EPSG:25832/25833 (split at 12° E),
 * elsewhere the matching UTM zone (ETRS89 in Europe, WGS 84 elsewhere).
 */
export function chooseCrs(lonLat: [number, number]): string {
  const [lon, lat] = lonLat;
  const fr = inFrance(lonLat);
  const de = inGermany(lonLat);
  if (fr && (!de || frenchSideOfBorder(lonLat))) return 'EPSG:2154';
  if (de) return lon < 12 ? 'EPSG:25832' : 'EPSG:25833';
  const zone = Math.floor((lon + 180) / 6) + 1;
  const europe = lat > 34 && lat < 72 && lon > -30 && lon < 45;
  if (europe) return `EPSG:${25800 + zone}`;
  return `EPSG:${lat >= 0 ? 32600 + zone : 32700 + zone}`;
}

/** Make sure proj4 knows the CRS and return its code. */
export function ensureCrs(code: string): string {
  if (proj4.defs(code)) return code;
  const n = Number(code.split(':')[1]);
  if (n >= 25801 && n <= 25860) proj4.defs(code, utmDef(n - 25800, false));
  else if (n >= 32601 && n <= 32660) proj4.defs(code, utmDef(n - 32600, false));
  else if (n >= 32701 && n <= 32760) proj4.defs(code, utmDef(n - 32700, true));
  else throw new Error(`Unknown CRS ${code}`);
  return code;
}

export interface LocalFrame {
  crs: string;
  /** Origin in projected coordinates. */
  originCrs: Vec2;
}

export function lonLatToCrs(crs: string, lonLat: [number, number]): Vec2 {
  const [x, y] = proj4('EPSG:4326', ensureCrs(crs), lonLat);
  return [x, y];
}

export function crsToLonLat(crs: string, p: Vec2): [number, number] {
  const [lon, lat] = proj4(ensureCrs(crs), 'EPSG:4326', p);
  return [lon, lat];
}

export function lonLatToLocal(frame: LocalFrame, lonLat: [number, number]): Vec2 {
  const [x, y] = lonLatToCrs(frame.crs, lonLat);
  return [x - frame.originCrs[0], y - frame.originCrs[1]];
}

export function localToLonLat(frame: LocalFrame, p: Vec2): [number, number] {
  return crsToLonLat(frame.crs, [p[0] + frame.originCrs[0], p[1] + frame.originCrs[1]]);
}

/** Convert a GeoJSON-style polygon (rings of [lon, lat]) into local coordinates. */
export function lonLatPolygonToLocal(
  frame: LocalFrame,
  rings: readonly (readonly [number, number])[][],
): Polygon {
  const toLocal = (ring: readonly (readonly [number, number])[]) =>
    ring.map((p) => lonLatToLocal(frame, [p[0], p[1]]));
  const [outer, ...holes] = rings;
  const poly: Polygon = { outer: toLocal(outer ?? []) };
  if (holes.length) poly.holes = holes.map(toLocal);
  return poly;
}
