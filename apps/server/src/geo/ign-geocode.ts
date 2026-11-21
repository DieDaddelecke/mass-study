import type { GeocodeResult } from './contract.js';
import { isRecord } from './geometry.js';
import type { GeoHttp } from './http.js';
import type { GeocodeProvider } from './providers.js';

export const IGN_GEOCODE_BASE = 'https://data.geopf.fr/geocodage';

const KIND: Record<string, GeocodeResult['kind']> = {
  housenumber: 'address',
  street: 'street',
  locality: 'locality',
  municipality: 'municipality',
  poi: 'poi',
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** IGN Géoplateforme geocoding (BAN-based, France). */
export class IgnGeocodeProvider implements GeocodeProvider {
  readonly id = 'ign';
  constructor(
    private readonly http: GeoHttp,
    private readonly base = IGN_GEOCODE_BASE,
  ) {}

  async search(q: string, limit: number): Promise<GeocodeResult[]> {
    const url = `${this.base}/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const data = await this.http.getJson(url, { upstream: 'ign-geocodage' });
    const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
    return features.flatMap((f: unknown): GeocodeResult[] => {
      if (!isRecord(f) || !isRecord(f.geometry) || !isRecord(f.properties)) return [];
      const c = f.geometry.coordinates;
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return [];
      const p = f.properties;
      const r: GeocodeResult = {
        label: str(p.label) ?? str(p.name) ?? '',
        lonLat: [c[0], c[1]],
        kind: KIND[str(p.type) ?? ''] ?? 'other',
        provider: 'ign',
      };
      const city = str(p.city);
      const postcode = str(p.postcode);
      if (city) r.city = city;
      if (postcode) r.postcode = postcode;
      if (typeof p.score === 'number') r.score = p.score;
      return [r];
    });
  }

  async complete(q: string, limit: number): Promise<GeocodeResult[]> {
    const url = `${this.base}/completion?text=${encodeURIComponent(q)}&type=StreetAddress&maximumResponses=${limit}`;
    const data = await this.http.getJson(url, { upstream: 'ign-completion' });
    const results = isRecord(data) && Array.isArray(data.results) ? data.results : [];
    return results.flatMap((x: unknown): GeocodeResult[] => {
      if (!isRecord(x) || typeof x.x !== 'number' || typeof x.y !== 'number') return [];
      const r: GeocodeResult = {
        label: str(x.fulltext) ?? '',
        lonLat: [x.x, x.y],
        kind: KIND[str(x.kind) ?? ''] ?? 'other',
        provider: 'ign',
      };
      const city = str(x.city);
      const postcode = str(x.zipcode);
      if (city) r.city = city;
      if (postcode) r.postcode = postcode;
      return [r];
    });
  }
}
