import type { LonLat, ParcelResult } from './contract.js';
import { type BBox, FRANCE_METRO_BBOX, geoJsonPolygons, inBBox, isRecord } from './geometry.js';
import type { GeoHttp } from './http.js';
import type { ParcelProvider } from './providers.js';

export const APICARTO_CADASTRE_URL = 'https://apicarto.ign.fr/api/cadastre/parcelle';

/**
 * Maps French cadastre features (API Carto module cadastre or the WFS
 * CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle — same properties: idu, nom_com, section, numero,
 * contenance) to parcel results.
 */
export function mapCadastreFeatures(
  data: unknown,
  provider: ParcelResult['provider'] = 'apicarto',
): ParcelResult[] {
  const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
  const seen = new Set<string>();
  return features.flatMap((f: unknown): ParcelResult[] => {
    if (!isRecord(f) || !isRecord(f.properties)) return [];
    const p = f.properties;
    if (typeof p.idu !== 'string' || seen.has(p.idu)) return [];
    const polygons = geoJsonPolygons(f.geometry);
    if (!polygons.length) return [];
    seen.add(p.idu);
    const label = [p.nom_com, p.section, p.numero]
      .filter((x) => typeof x === 'string' && x)
      .join(' ');
    const r: ParcelResult = { ref: p.idu, label: label || p.idu, polygons, provider };
    if (typeof p.contenance === 'number') r.officialArea = p.contenance;
    return [r];
  });
}

/** Closed GeoJSON polygon of a bbox. */
export function bboxPolygon(b: BBox): { type: 'Polygon'; coordinates: LonLat[][] } {
  const [w, s, e, n] = b;
  return {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  };
}

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
    return mapCadastreFeatures(data);
  }

  /** All parcels intersecting the bbox (`geom` = bbox polygon, up to 1000 features). */
  async parcelsInBBox(bbox: BBox): Promise<ParcelResult[]> {
    const geom = JSON.stringify(bboxPolygon(bbox));
    const data = await this.http.getJson(
      `${this.url}?geom=${encodeURIComponent(geom)}&_limit=1000`,
      { upstream: 'apicarto-cadastre' },
    );
    return mapCadastreFeatures(data);
  }
}
