/**
 * HTTP contract between apps/web and apps/server (`/api/*`). All coordinates are WGS 84 [lon, lat].
 * apps/server implements it (providers: IGN Géoplateforme, API Carto, BD TOPO, Overpass, Nominatim);
 * this file is the single source of truth for the shapes.
 */

export type LonLat = [number, number];
/** Polygon rings, first = outer, rest = holes. */
export type LonLatRings = LonLat[][];

export interface GeocodeResult {
  label: string;
  lonLat: LonLat;
  kind: 'address' | 'street' | 'locality' | 'municipality' | 'poi' | 'other';
  city?: string;
  postcode?: string;
  score?: number;
  provider: 'ign' | 'nominatim' | 'photon';
}

/** GET /api/geocode?q=…&limit=5  and  GET /api/geocode/complete?q=… (autocomplete) */
export interface GeocodeResponse {
  results: GeocodeResult[];
}

export interface ParcelResult {
  /** National parcel id, e.g. "914770000H0518" (IDU). */
  ref: string;
  /** Human label, e.g. "Palaiseau 0H 0518". */
  label: string;
  /** Official area (contenance) in m² if provided. */
  officialArea?: number;
  /** One entry per polygon of a MultiPolygon. */
  polygons: LonLatRings[];
  provider: 'apicarto' | 'wfs';
}

/** GET /api/parcels?lon=…&lat=…  → parcels at the point (usually one). */
export interface ParcelsResponse {
  parcels: ParcelResult[];
  /** false if no cadastre provider covers the location (UI then offers drawing / import). */
  covered: boolean;
}

export interface ContextBuildingLonLat {
  id: string;
  polygons: LonLatRings[];
  /** Height above ground (m), after the height rule: height → levels × 3.0 → 9 m (estimated). */
  height: number;
  baseHeight?: number;
  levels?: number;
  heightEstimated: boolean;
  source: 'osm' | 'ign';
  name?: string;
  underConstruction?: boolean;
}

/** GET /api/context?bbox=minLon,minLat,maxLon,maxLat */
export interface ContextResponse {
  buildings: ContextBuildingLonLat[];
  /** Which provider delivered the data (IGN BD TOPO preferred in France, OSM elsewhere / fallback). */
  provider: 'ign' | 'osm';
}

// ---------------------------------------------------------------------------
// Context layers (streets, vegetation, trees, water, neighbouring parcels)
// ---------------------------------------------------------------------------

export type RoadKind =
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service'
  | 'track'
  | 'cycleway'
  | 'footway'
  | 'path'
  | 'rail'
  | 'tram';

export interface ContextRoadLonLat {
  id: string;
  /** Centre line. */
  line: LonLat[];
  /** Carriageway / track width in m (BD TOPO largeur_de_chaussee, OSM width or lanes, else by kind). */
  width: number;
  widthEstimated: boolean;
  kind: RoadKind;
  name?: string;
  /** -1 tunnel / below ground, 0 at grade, 1 bridge. */
  level: -1 | 0 | 1;
  source: 'ign' | 'osm';
}

export type GreenKind =
  'wood' | 'park' | 'grass' | 'garden' | 'pitch' | 'scrub' | 'hedge' | 'other';

export interface ContextGreenLonLat {
  id: string;
  polygons: LonLatRings[];
  kind: GreenKind;
  source: 'ign' | 'osm';
}

export interface ContextTreeLonLat {
  id: string;
  lonLat: LonLat;
  /** Tree height in m (OSM height, else default 10 m → heightEstimated). */
  height: number;
  /** Crown diameter in m (OSM diameter_crown, else 0.6 × height). */
  crown: number;
  heightEstimated: boolean;
  leafType?: 'broadleaved' | 'needleleaved';
  source: 'osm';
}

export interface ContextWaterLonLat {
  id: string;
  polygons: LonLatRings[];
  source: 'ign' | 'osm';
}

/**
 * GET /api/context/layers?bbox=minLon,minLat,maxLon,maxLat
 * Each layer is fetched independently; a failing upstream leaves its layer empty and adds an entry
 * to `errors` instead of failing the whole request.
 */
export interface ContextLayersResponse {
  roads: ContextRoadLonLat[];
  green: ContextGreenLonLat[];
  trees: ContextTreeLonLat[];
  water: ContextWaterLonLat[];
  /** Cadastral parcels intersecting the bbox (neighbours; the site parcels are included too). */
  parcels: ParcelResult[];
  providers: Partial<
    Record<'roads' | 'green' | 'trees' | 'water' | 'parcels', 'ign' | 'osm' | 'apicarto'>
  >;
  errors?: { layer: 'roads' | 'green' | 'trees' | 'water' | 'parcels'; message: string }[];
}

/** Base map for the ground texture: GET /api/tiles/{basemap}/{z}/{x}/{y} (web mercator, 256 px). */
export type Basemap = 'plan' | 'ortho';

export interface ApiError {
  error: 'bad_request' | 'not_found' | 'upstream_error' | 'rate_limited';
  message: string;
}

export const API = {
  geocode: '/api/geocode',
  geocodeComplete: '/api/geocode/complete',
  parcels: '/api/parcels',
  context: '/api/context',
  contextLayers: '/api/context/layers',
  tiles: '/api/tiles',
  health: '/api/health',
  render: '/api/render',
  renderProviders: '/api/render/providers',
} as const;

// --- AI rendering (mirrors apps/server/src/render/contract.ts) ---

export type RenderProviderId = 'gemini' | 'openrouter' | 'stability' | 'openai';
export const RENDER_PROVIDERS: readonly RenderProviderId[] = [
  'gemini',
  'openrouter',
  'stability',
  'openai',
];

/** GET /api/render/providers */
export interface RenderProvidersResponse {
  providers: { id: RenderProviderId; serverKey: boolean; defaultModel: string }[];
}

/** POST /api/render (user key in the `X-Render-Key` header). */
export interface RenderRequest {
  provider: RenderProviderId;
  model?: string;
  prompt: string;
  negativePrompt?: string;
  /** data URL of the 3D view */
  image: string;
  /** 0–1: how strictly the geometry is kept */
  fidelity?: number;
  /** width / height */
  aspect?: number;
}

export interface RenderResponse {
  image: string;
  provider: RenderProviderId;
  model: string;
}

export interface RenderApiError {
  error:
    | 'bad_request'
    | 'no_key'
    | 'invalid_key'
    | 'payment_required'
    | 'rate_limited'
    | 'upstream_error'
    | 'blocked';
  message: string;
}
