import { mapCadastreFeatures, type ApiCartoParcelProvider } from './apicarto.js';
import { IGN_WFS_URL, ignWfsUrl } from './bdtopo.js';
import type {
  ContextGreenLonLat,
  ContextLayersResponse,
  ContextRoadLonLat,
  ContextTreeLonLat,
  ContextWaterLonLat,
  GreenKind,
  LonLat,
  ParcelResult,
  RoadKind,
} from './contract.js';
import {
  type BBox,
  FRANCE_METRO_BBOX,
  bboxCenter,
  geoJsonPolygons,
  inBBox,
  isRecord,
  pointInPolygon,
  ringCentroid,
} from './geometry.js';
import { parseCount, parseMeters } from './height.js';
import type { GeoHttp } from './http.js';
import {
  type OverpassClient,
  type Tags,
  elementPolygons,
  overpassElements,
  readGeom,
  readTags,
} from './osm.js';
import type { ParcelProvider } from './providers.js';

type Layer = 'roads' | 'green' | 'trees' | 'water' | 'parcels';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Default carriageway / track widths (m) when no width or lane count is known. */
export const DEFAULT_ROAD_WIDTH: Record<RoadKind, number> = {
  motorway: 10.5,
  primary: 7,
  secondary: 6.5,
  tertiary: 6,
  residential: 5,
  service: 3.5,
  track: 3,
  cycleway: 2,
  footway: 2,
  path: 1.5,
  rail: 1.5,
  tram: 1.5,
};

/** Default tree height (m) when OSM has none; crown = 0.6 × height unless tagged. */
export const DEFAULT_TREE_HEIGHT_M = 10;
/** Spacing of trees sampled along a natural=tree_row (m). */
export const TREE_ROW_SPACING_M = 8;

/** Reads GeoJSON LineString / MultiLineString coordinates, dropping z values. */
export function geoJsonLines(geometry: unknown): LonLat[][] {
  if (!isRecord(geometry)) return [];
  const toLine = (l: unknown): LonLat[] =>
    Array.isArray(l)
      ? l.flatMap((c: unknown): LonLat[] =>
          Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number'
            ? [[c[0], c[1]]]
            : [],
        )
      : [];
  const lines =
    geometry.type === 'LineString'
      ? [toLine(geometry.coordinates)]
      : geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)
        ? geometry.coordinates.map(toLine)
        : [];
  return lines.filter((l) => l.length >= 2);
}

const SMALL_WORDS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'et',
  'à',
  'au',
  'aux',
  'sur',
  'sous',
  'en',
]);

/** "R DE LA REINE BATHILDE" → "R de la Reine Bathilde"; mixed-case input is kept as is. */
export function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      const elided = /^([ld]')(.+)$/.exec(w);
      if (elided?.[1] && elided[2]) {
        const head = i === 0 ? elided[1].toUpperCase() : elided[1];
        return head + elided[2].charAt(0).toUpperCase() + elided[2].slice(1);
      }
      return w.replace(/(^|-)(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
    })
    .join(' ');
}

function features(data: unknown): Record<string, unknown>[] {
  const f = isRecord(data) && Array.isArray(data.features) ? data.features : [];
  return f.filter(isRecord);
}

function featureId(f: Record<string, unknown>, p: Record<string, unknown>, i: number): string {
  return typeof f.id === 'string' ? f.id : typeof p.cleabs === 'string' ? p.cleabs : String(i);
}

/** Approximate length of a lon/lat segment in metres (equirectangular). */
function segmentMeters(a: LonLat, b: LonLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_574);
}

/** Points every `step` m along a polyline, starting at its first vertex. */
export function sampleLine(line: LonLat[], step: number): LonLat[] {
  const first = line[0];
  if (!first) return [];
  const out: LonLat[] = [first];
  let next = step;
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as LonLat;
    const b = line[i] as LonLat;
    const len = segmentMeters(a, b);
    while (len > 0 && next <= travelled + len + 1e-9) {
      const t = (next - travelled) / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += step;
    }
    travelled += len;
  }
  return out;
}

// ---------------------------------------------------------------------------
// BD TOPO (France)
// ---------------------------------------------------------------------------

function kindByImportance(importance: unknown): RoadKind {
  const n = parseCount(importance);
  if (n === 1 || n === 2) return 'primary';
  if (n === 3) return 'secondary';
  if (n === 4) return 'tertiary';
  return 'residential';
}

/** BD TOPO `nature` (+ `importance`) → road kind; undefined = not a road (ferry, …). */
export function bdTopoRoadKind(nature: unknown, importance: unknown): RoadKind | undefined {
  switch (nature) {
    case 'Autoroute':
    case 'Quasi-autoroute':
    case 'Type autoroutier':
      return 'motorway';
    case 'Route empierrée':
    case 'Chemin':
      return 'track';
    case 'Sentier':
    case 'Escalier':
      return 'path';
    case 'Piste cyclable':
      return 'cycleway';
    case 'Bac ou liaison maritime':
    case 'Bac':
      return undefined;
    default: // Bretelle, Route à 1/2 chaussée(s), Rond-point, unknown
      return kindByImportance(importance);
  }
}

/** BD TOPO natures that OSM covers better (dropped when OSM paths are available). */
const BDTOPO_TRAIL_NATURES = new Set(['Sentier', 'Escalier', 'Chemin']);

function levelOf(n: number | undefined): -1 | 0 | 1 {
  if (n === undefined || n === 0 || !Number.isFinite(n)) return 0;
  return n < 0 ? -1 : 1;
}

/** Maps BDTOPO_V3:troncon_de_route features to roads (one entry per line part). */
export function mapBdTopoRoads(
  data: unknown,
  opts: { dropTrails?: boolean } = {},
): ContextRoadLonLat[] {
  return features(data).flatMap((f, i): ContextRoadLonLat[] => {
    const p = isRecord(f.properties) ? f.properties : {};
    if (p.fictif === true || p.fictif === 'true') return [];
    if (opts.dropTrails && typeof p.nature === 'string' && BDTOPO_TRAIL_NATURES.has(p.nature))
      return [];
    const kind = bdTopoRoadKind(p.nature, p.importance);
    if (!kind) return [];
    const lines = geoJsonLines(f.geometry);
    const explicit = parseMeters(p.largeur_de_chaussee);
    const lanes = parseCount(p.nombre_de_voies);
    let width = DEFAULT_ROAD_WIDTH[kind];
    let widthEstimated = true;
    if (explicit !== undefined && explicit > 0) {
      width = explicit;
      widthEstimated = false;
    } else if (lanes !== undefined && lanes > 0) {
      width = lanes * 3.0;
      widthEstimated = false;
    }
    const pos = Number(p.position_par_rapport_au_sol);
    const rawName = [p.nom_voie_ban_gauche, p.nom_collaboratif_gauche].find(
      (x): x is string => typeof x === 'string' && x.trim() !== '',
    );
    const id = `ign/${featureId(f, p, i)}`;
    return lines.map((line, k) => {
      const r: ContextRoadLonLat = {
        id: lines.length > 1 ? `${id}#${k}` : id,
        line,
        width,
        widthEstimated,
        kind,
        level: levelOf(Number.isFinite(pos) ? pos : undefined),
        source: 'ign',
      };
      if (rawName) r.name = titleCase(rawName);
      return r;
    });
  });
}

/** BD TOPO zone_de_vegetation `nature` → green kind. */
export function bdTopoGreenKind(nature: unknown): GreenKind {
  if (typeof nature !== 'string') return 'other';
  if (nature.startsWith('Forêt') || nature.startsWith('Bois')) return 'wood';
  if (nature === 'Haie') return 'hedge';
  if (nature.startsWith('Lande') || nature === 'Broussailles') return 'scrub';
  return 'other'; // Verger, Vigne, Peupleraie, …
}

/** Maps zone_de_vegetation (kind by nature) or haie (`kind` forced) features to green areas. */
export function mapBdTopoGreen(data: unknown, kind?: GreenKind): ContextGreenLonLat[] {
  return features(data).flatMap((f, i): ContextGreenLonLat[] => {
    const p = isRecord(f.properties) ? f.properties : {};
    const polygons = geoJsonPolygons(f.geometry);
    if (!polygons.length) return [];
    return [
      {
        id: `ign/${featureId(f, p, i)}`,
        polygons,
        kind: kind ?? bdTopoGreenKind(p.nature),
        source: 'ign',
      },
    ];
  });
}

export function mapBdTopoWater(data: unknown): ContextWaterLonLat[] {
  return features(data).flatMap((f, i): ContextWaterLonLat[] => {
    const p = isRecord(f.properties) ? f.properties : {};
    const polygons = geoJsonPolygons(f.geometry);
    return polygons.length ? [{ id: `ign/${featureId(f, p, i)}`, polygons, source: 'ign' }] : [];
  });
}

// ---------------------------------------------------------------------------
// OSM (Overpass)
// ---------------------------------------------------------------------------

const re = (values: string[]) => `^(${values.join('|')})$`;
const GREEN_LEISURE = ['park', 'garden', 'pitch', 'playground'];
const GREEN_LANDUSE = [
  'grass',
  'meadow',
  'recreation_ground',
  'village_green',
  'forest',
  'cemetery',
  'allotments',
];
const GREEN_NATURAL = ['wood', 'scrub', 'grassland', 'heath'];

/** One combined query for streets, rail, green areas, trees and water (Overpass usage policy). */
export function overpassLayersQuery(b: BBox): string {
  const [w, s, e, n] = b;
  const box = `(${s},${w},${n},${e})`;
  const area = (key: string, values: string[]) =>
    `way["${key}"~"${re(values)}"]${box};relation["${key}"~"${re(values)}"]${box};`;
  return (
    `[out:json][timeout:25];(` +
    `way["highway"]${box};way["railway"~"^(rail|tram|light_rail)$"]${box};` +
    `node["natural"="tree"]${box};way["natural"="tree_row"]${box};` +
    area('leisure', GREEN_LEISURE) +
    area('landuse', GREEN_LANDUSE) +
    area('natural', [...GREEN_NATURAL, 'water']) +
    area('waterway', ['riverbank']) +
    `);out geom;`
  );
}

/** OSM `highway` / `railway` → road kind; undefined for areas, construction, platforms, … */
export function osmRoadKind(tags: Tags): RoadKind | undefined {
  if (tags.area === 'yes') return undefined;
  const rail = tags.railway;
  if (rail === 'rail' || rail === 'light_rail') return 'rail';
  if (rail === 'tram') return 'tram';
  switch (tags.highway?.replace(/_link$/, '')) {
    case 'motorway':
      return 'motorway';
    case 'trunk':
    case 'primary':
      return 'primary';
    case 'secondary':
      return 'secondary';
    case 'tertiary':
      return 'tertiary';
    case 'residential':
    case 'unclassified':
    case 'living_street':
    case 'road':
    case 'busway':
      return 'residential';
    case 'service':
      return 'service';
    case 'track':
      return 'track';
    case 'cycleway':
      return 'cycleway';
    case 'footway':
    case 'pedestrian':
    case 'steps':
      return 'footway';
    case 'path':
    case 'bridleway':
      return 'path';
    default:
      return undefined;
  }
}

const MOTORISED: ReadonlySet<RoadKind> = new Set([
  'motorway',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'service',
]);

export function osmRoadWidth(
  tags: Tags,
  kind: RoadKind,
): { width: number; widthEstimated: boolean } {
  const w = parseMeters(tags.width);
  if (w !== undefined && w > 0) return { width: w, widthEstimated: false };
  const lanes = parseCount(tags.lanes);
  if (MOTORISED.has(kind) && lanes !== undefined && lanes > 0)
    return { width: lanes * 3.25, widthEstimated: false };
  return { width: DEFAULT_ROAD_WIDTH[kind], widthEstimated: true };
}

export function osmLevel(tags: Tags): -1 | 0 | 1 {
  if (tags.bridge && tags.bridge !== 'no') return 1;
  if (tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage') return -1;
  if (tags.location === 'underground') return -1;
  return levelOf(Number(tags.layer));
}

/** leisure > landuse > natural; undefined = not green. */
export function osmGreenKind(tags: Tags): GreenKind | undefined {
  switch (tags.leisure) {
    case 'park':
      return 'park';
    case 'garden':
      return 'garden';
    case 'pitch':
      return 'pitch';
    case 'playground':
      return 'other';
  }
  switch (tags.landuse) {
    case 'grass':
    case 'meadow':
    case 'village_green':
      return 'grass';
    case 'recreation_ground':
      return 'park';
    case 'forest':
      return 'wood';
    case 'allotments':
      return 'garden';
    case 'cemetery':
      return 'other';
  }
  switch (tags.natural) {
    case 'wood':
      return 'wood';
    case 'scrub':
    case 'heath':
      return 'scrub';
    case 'grassland':
      return 'grass';
  }
  return undefined;
}

function isWater(tags: Tags): boolean {
  return tags.natural === 'water' || tags.waterway === 'riverbank';
}

function treeProps(tags: Tags): Omit<ContextTreeLonLat, 'id' | 'lonLat'> {
  const h = parseMeters(tags.height) ?? parseMeters(tags.est_height);
  const known = h !== undefined && h > 0;
  const height = known ? h : DEFAULT_TREE_HEIGHT_M;
  const c = parseMeters(tags.diameter_crown);
  const t: Omit<ContextTreeLonLat, 'id' | 'lonLat'> = {
    height,
    crown: c !== undefined && c > 0 ? c : 0.6 * height,
    heightEstimated: !known,
    source: 'osm',
  };
  if (tags.leaf_type === 'broadleaved' || tags.leaf_type === 'needleleaved')
    t.leafType = tags.leaf_type;
  return t;
}

export interface OsmLayers {
  roads: ContextRoadLonLat[];
  green: ContextGreenLonLat[];
  trees: ContextTreeLonLat[];
  water: ContextWaterLonLat[];
}

/** Maps a combined Overpass `out geom` response (see overpassLayersQuery) to context layers. */
export function mapOsmLayers(data: unknown): OsmLayers {
  const out: OsmLayers = { roads: [], green: [], trees: [], water: [] };
  for (const e of overpassElements(data)) {
    const tags = readTags(e.tags);
    const id = `osm/${String(e.type)}/${String(e.id)}`;
    if (e.type === 'node') {
      if (tags.natural === 'tree' && typeof e.lon === 'number' && typeof e.lat === 'number')
        out.trees.push({ id, lonLat: [e.lon, e.lat], ...treeProps(tags) });
      continue;
    }
    if (e.type === 'way' && tags.natural === 'tree_row') {
      const props = treeProps(tags);
      sampleLine(readGeom(e.geometry), TREE_ROW_SPACING_M).forEach((lonLat, k) =>
        out.trees.push({ id: `${id}#${k}`, lonLat, ...props }),
      );
      continue;
    }
    if (e.type === 'way' && (tags.highway || tags.railway)) {
      const kind = osmRoadKind(tags);
      const line = readGeom(e.geometry);
      if (!kind || line.length < 2) continue;
      const r: ContextRoadLonLat = {
        id,
        line,
        ...osmRoadWidth(tags, kind),
        kind,
        level: osmLevel(tags),
        source: 'osm',
      };
      if (tags.name) r.name = tags.name;
      out.roads.push(r);
      continue;
    }
    if (isWater(tags)) {
      const polygons = elementPolygons(e);
      if (polygons.length) out.water.push({ id, polygons, source: 'osm' });
      continue;
    }
    const kind = osmGreenKind(tags);
    if (kind) {
      const polygons = elementPolygons(e);
      if (polygons.length) out.green.push({ id, polygons, kind, source: 'osm' });
    }
  }
  return out;
}

/** OSM road kinds added to BD TOPO roads in France (BD TOPO lacks most of them). */
const OSM_SUPPLEMENT_KINDS: ReadonlySet<RoadKind> = new Set([
  'footway',
  'cycleway',
  'path',
  'rail',
  'tram',
]);

/** Drops OSM areas whose centroid lies inside an IGN area (same feature in both sources). */
function withoutDuplicates<T extends { polygons: LonLat[][][] }>(osm: T[], ign: T[]): T[] {
  return osm.filter((o) => {
    const ring = o.polygons[0]?.[0];
    if (!ring) return false;
    const c = ringCentroid(ring);
    return !ign.some((i) => i.polygons.some((poly) => pointInPolygon(c, poly)));
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function settle<T>(p: Promise<T> | undefined): Promise<Settled<T> | undefined> {
  if (!p) return undefined;
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface LayersDeps {
  http: GeoHttp;
  overpass: OverpassClient;
  apicarto: ApiCartoParcelProvider;
  /** Other parcel providers (generic WFS) used outside France when they support bbox queries. */
  parcelProviders?: ParcelProvider[];
  ignWfsUrl?: string;
}

/** Fetches all context layers for a bbox, each independently; failures land in `errors`. */
export class ContextLayersService {
  constructor(private readonly deps: LayersDeps) {}

  private ign(typeName: string, bbox: BBox): Promise<unknown> {
    return this.deps.http.getJson(
      ignWfsUrl(typeName, bbox, 2000, this.deps.ignWfsUrl ?? IGN_WFS_URL),
      { upstream: 'ign-wfs' },
    );
  }

  private async franceParcels(
    bbox: BBox,
  ): Promise<{ parcels: ParcelResult[]; provider?: 'apicarto' | 'ign' }> {
    try {
      return { parcels: await this.deps.apicarto.parcelsInBBox(bbox), provider: 'apicarto' };
    } catch (err) {
      try {
        const data = await this.ign('CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle', bbox);
        return { parcels: mapCadastreFeatures(data, 'wfs'), provider: 'ign' };
      } catch {
        throw err;
      }
    }
  }

  async layers(bbox: BBox): Promise<ContextLayersResponse> {
    const center = bboxCenter(bbox);
    const fr = inBBox(center, FRANCE_METRO_BBOX);
    const otherParcels = fr
      ? undefined
      : this.deps.parcelProviders?.find((p) => p.parcelsInBBox && p.covers(center));
    const [osm, roads, vege, haie, water, parcels] = await Promise.all([
      settle(this.deps.overpass.query(overpassLayersQuery(bbox)).then(mapOsmLayers)),
      settle(fr ? this.ign('BDTOPO_V3:troncon_de_route', bbox) : undefined),
      settle(fr ? this.ign('BDTOPO_V3:zone_de_vegetation', bbox) : undefined),
      settle(fr ? this.ign('BDTOPO_V3:haie', bbox) : undefined),
      settle(fr ? this.ign('BDTOPO_V3:surface_hydrographique', bbox) : undefined),
      settle(
        fr
          ? this.franceParcels(bbox)
          : otherParcels?.parcelsInBBox?.(bbox).then((p) => ({ parcels: p, provider: undefined })),
      ),
    ]);

    const res: ContextLayersResponse = {
      roads: [],
      green: [],
      trees: [],
      water: [],
      parcels: [],
      providers: {},
    };
    const errors: NonNullable<ContextLayersResponse['errors']> = [];
    const fail = (layer: Layer, ...results: (Settled<unknown> | undefined)[]) => {
      for (const r of results) {
        if (!r || r.ok) continue;
        const m = message(r.error);
        if (!errors.some((e) => e.layer === layer && e.message === m))
          errors.push({ layer, message: m });
      }
    };
    const o = osm?.ok ? osm.value : undefined;

    // roads
    if (roads?.ok) {
      res.roads = mapBdTopoRoads(roads.value, { dropTrails: !!o });
      if (o) res.roads.push(...o.roads.filter((r) => OSM_SUPPLEMENT_KINDS.has(r.kind)));
      res.providers.roads = 'ign';
    } else if (o) {
      res.roads = o.roads;
      res.providers.roads = 'osm';
    }
    fail('roads', roads, osm);

    // green
    const ignGreen = [
      ...(vege?.ok ? mapBdTopoGreen(vege.value) : []),
      ...(haie?.ok ? mapBdTopoGreen(haie.value, 'hedge') : []),
    ];
    res.green = [...ignGreen, ...(o ? withoutDuplicates(o.green, ignGreen) : [])];
    if (vege?.ok || haie?.ok) res.providers.green = 'ign';
    else if (o) res.providers.green = 'osm';
    fail('green', vege, haie, osm);

    // trees (OSM only)
    if (o) {
      res.trees = o.trees;
      res.providers.trees = 'osm';
    }
    fail('trees', osm);

    // water
    const ignWater = water?.ok ? mapBdTopoWater(water.value) : [];
    res.water = [...ignWater, ...(o ? withoutDuplicates(o.water, ignWater) : [])];
    if (water?.ok) res.providers.water = 'ign';
    else if (o) res.providers.water = 'osm';
    fail('water', water, osm);

    // parcels
    if (parcels?.ok) {
      res.parcels = parcels.value.parcels;
      if (parcels.value.provider) res.providers.parcels = parcels.value.provider;
    }
    fail('parcels', parcels);

    if (errors.length) res.errors = errors;
    return res;
  }
}
