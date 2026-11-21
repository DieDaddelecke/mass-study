import type { GeocodeResult } from './contract.js';
import { isRecord } from './geometry.js';
import { Throttle, type GeoHttp } from './http.js';
import type { GeocodeProvider } from './providers.js';

export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

function kindOf(addresstype: string, category: string): GeocodeResult['kind'] {
  if (['house', 'building'].includes(addresstype) || category === 'building') return 'address';
  if (addresstype === 'road') return 'street';
  if (['city', 'town', 'village', 'municipality'].includes(addresstype)) return 'municipality';
  if (['suburb', 'hamlet', 'neighbourhood', 'quarter', 'locality'].includes(addresstype))
    return 'locality';
  if (category === 'amenity' || category === 'tourism' || category === 'shop') return 'poi';
  return 'other';
}

/** Nominatim (OSM) search, max. 1 request/s (usage policy). No autocomplete. */
export class NominatimGeocodeProvider implements GeocodeProvider {
  readonly id = 'nominatim';
  constructor(
    private readonly http: GeoHttp,
    private readonly throttle = new Throttle(1000),
    private readonly base = NOMINATIM_BASE,
  ) {}

  async search(q: string, limit: number): Promise<GeocodeResult[]> {
    const url = `${this.base}/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}`;
    const data = await this.http.getJson(url, { upstream: 'nominatim', throttle: this.throttle });
    if (!Array.isArray(data)) return [];
    return data.flatMap((x: unknown): GeocodeResult[] => {
      if (!isRecord(x)) return [];
      const lon = Number(x.lon);
      const lat = Number(x.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
      const r: GeocodeResult = {
        label: typeof x.display_name === 'string' ? x.display_name : '',
        lonLat: [lon, lat],
        kind: kindOf(String(x.addresstype ?? ''), String(x.category ?? '')),
        provider: 'nominatim',
      };
      if (typeof x.importance === 'number') r.score = x.importance;
      return [r];
    });
  }
}
