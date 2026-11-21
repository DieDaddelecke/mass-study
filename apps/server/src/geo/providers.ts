import type { ContextBuildingLonLat, GeocodeResult, LonLat, ParcelResult } from './contract.js';
import type { BBox } from './geometry.js';

export interface GeocodeProvider {
  id: string;
  search(q: string, limit: number): Promise<GeocodeResult[]>;
  /** Autocomplete; optional (Nominatim forbids autocomplete use). */
  complete?(q: string, limit: number): Promise<GeocodeResult[]>;
}

export interface ParcelProvider {
  id: string;
  covers(lonLat: LonLat): boolean;
  parcelsAt(lonLat: LonLat): Promise<ParcelResult[]>;
  /** Parcels intersecting a bbox (neighbourhood layer); optional. */
  parcelsInBBox?(bbox: BBox): Promise<ParcelResult[]>;
}

export interface ContextProvider {
  id: 'ign' | 'osm';
  covers(lonLat: LonLat): boolean;
  buildings(bbox: BBox): Promise<ContextBuildingLonLat[]>;
}

/** Picks providers by coverage, in priority order (first registered = preferred). */
export class ProviderRegistry {
  constructor(
    readonly geocoders: GeocodeProvider[],
    readonly parcels: ParcelProvider[],
    readonly context: ContextProvider[],
  ) {}

  /** Tries geocoders in order; falls through on empty result or error. */
  async geocode(q: string, limit: number): Promise<GeocodeResult[]> {
    let lastError: unknown;
    let anyOk = false;
    for (const p of this.geocoders) {
      try {
        const r = await p.search(q, limit);
        anyOk = true;
        if (r.length) return r.slice(0, limit);
      } catch (err) {
        lastError = err;
      }
    }
    if (!anyOk && lastError) throw lastError;
    return [];
  }

  async complete(q: string, limit: number): Promise<GeocodeResult[]> {
    let lastError: unknown;
    let anyOk = false;
    for (const p of this.geocoders) {
      if (!p.complete) continue;
      try {
        const r = await p.complete(q, limit);
        anyOk = true;
        if (r.length) return r.slice(0, limit);
      } catch (err) {
        lastError = err;
      }
    }
    if (!anyOk && lastError) throw lastError;
    return [];
  }

  parcelProviderFor(lonLat: LonLat): ParcelProvider | undefined {
    return this.parcels.find((p) => p.covers(lonLat));
  }

  /** Covering context providers; tried in order, later ones act as fallback. */
  async contextAt(
    bbox: BBox,
    center: LonLat,
  ): Promise<{ provider: ContextProvider['id']; buildings: ContextBuildingLonLat[] }> {
    const candidates = this.context.filter((p) => p.covers(center));
    let lastError: unknown = new Error('no context provider covers this location');
    for (const p of candidates) {
      try {
        return { provider: p.id, buildings: await p.buildings(bbox) };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
