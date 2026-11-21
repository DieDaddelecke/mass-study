import type { LonLat, ParcelResult } from './contract.js';
import { FRANCE_METRO_BBOX, geoJsonPolygons, inBBox, isRecord } from './geometry.js';
import type { GeoHttp } from './http.js';
import type { ParcelProvider } from './providers.js';

export const APICARTO_CADASTRE_URL = 'https://apicarto.ign.fr/api/cadastre/parcelle';

/** IGN API Carto, module cadastre (France). */
export class ApiCartoParcelProvider implements ParcelProvider {
  readonly id = 'apicarto';
  constructor(
    private readonly http: GeoHttp,
    private readonly url = APICARTO_CADASTRE_URL,
  ) {}

  covers(lonLat: LonLat): boolean {
    return inBBox(lonLat, FRANCE_METRO_BBOX);
  }

  async parcelsAt(lonLat: LonLat): Promise<ParcelResult[]> {
    const geom = JSON.stringify({ type: 'Point', coordinates: lonLat });
    const data = await this.http.getJson(`${this.url}?geom=${encodeURIComponent(geom)}`, {
      upstream: 'apicarto-cadastre',
    });
    const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
    return features.flatMap((f: unknown): ParcelResult[] => {
      if (!isRecord(f) || !isRecord(f.properties)) return [];
      const p = f.properties;
      if (typeof p.idu !== 'string') return [];
      const polygons = geoJsonPolygons(f.geometry);
      if (!polygons.length) return [];
      const label = [p.nom_com, p.section, p.numero]
        .filter((x) => typeof x === 'string' && x)
        .join(' ');
      const r: ParcelResult = { ref: p.idu, label: label || p.idu, polygons, provider: 'apicarto' };
      if (typeof p.contenance === 'number') r.officialArea = p.contenance;
      return [r];
    });
  }
}
