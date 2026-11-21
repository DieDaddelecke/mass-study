// mirror of apps/web/src/api/contract.ts – keep in sync

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

export interface ApiError {
  error: 'bad_request' | 'not_found' | 'upstream_error' | 'rate_limited';
  message: string;
}

export const API = {
  geocode: '/api/geocode',
  geocodeComplete: '/api/geocode/complete',
  parcels: '/api/parcels',
  context: '/api/context',
  health: '/api/health',
} as const;
