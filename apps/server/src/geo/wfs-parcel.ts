import type { LonLat, ParcelResult } from './contract.js';
import { type BBox, geoJsonPolygons, inBBox, isRecord, pointInPolygon } from './geometry.js';
import type { GeoHttp } from './http.js';
import type { ParcelProvider } from './providers.js';

/** Configuration of a generic WFS 2.0 cadastre (e.g. ALKIS / INSPIRE parcels of a German Land). */
export interface WfsParcelConfig {
  id: string;
  /** WFS endpoint without query string. */
  url: string;
  typeName: string;
  /** Output CRS; must yield WGS 84 lon/lat GeoJSON (no reprojection). Default EPSG:4326. */
  srsName?: string;
  outputFormat?: string;
  /** Axis order of the BBOX parameter. EPSG:4326 in WFS 2.0 is lat,lon (default). */
  bboxAxisOrder?: 'latlon' | 'lonlat';
  /** Area served by this provider [minLon, minLat, maxLon, maxLat]. */
  coverage: BBox;
  /** Search half-size around the click point in degrees (default 0.0002 ≈ 20 m). */
  searchRadiusDeg?: number;
  fields: { ref: string; label?: string[]; area?: string };
}

/** Generic WFS parcel provider with configurable field mapping. Not enabled by default. */
export class WfsParcelProvider implements ParcelProvider {
  readonly id: string;
  constructor(
    private readonly http: GeoHttp,
    private readonly cfg: WfsParcelConfig,
  ) {
    this.id = cfg.id;
  }

  covers(lonLat: LonLat): boolean {
    return inBBox(lonLat, this.cfg.coverage);
  }

  buildUrl(lonLat: LonLat): string {
    const r = this.cfg.searchRadiusDeg ?? 0.0002;
    const srs = this.cfg.srsName ?? 'EPSG:4326';
    const [lon, lat] = lonLat;
    const box =
      (this.cfg.bboxAxisOrder ?? 'latlon') === 'latlon'
        ? [lat - r, lon - r, lat + r, lon + r]
        : [lon - r, lat - r, lon + r, lat + r];
    const crsUrn = `urn:ogc:def:crs:${srs.replace(':', '::')}`;
    const params = [
      'SERVICE=WFS',
      'VERSION=2.0.0',
      'REQUEST=GetFeature',
      `TYPENAMES=${encodeURIComponent(this.cfg.typeName)}`,
      `OUTPUTFORMAT=${encodeURIComponent(this.cfg.outputFormat ?? 'application/json')}`,
      `SRSNAME=${srs}`,
      `BBOX=${box.map((n) => n.toFixed(7)).join(',')},${crsUrn}`,
    ];
    const sep = this.cfg.url.includes('?') ? '&' : '?';
    return `${this.cfg.url}${sep}${params.join('&')}`;
  }

  async parcelsAt(lonLat: LonLat): Promise<ParcelResult[]> {
    const data = await this.http.getJson(this.buildUrl(lonLat), { upstream: `wfs:${this.id}` });
    const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
    const { fields } = this.cfg;
    return features.flatMap((f: unknown): ParcelResult[] => {
      if (!isRecord(f) || !isRecord(f.properties)) return [];
      const p = f.properties;
      const ref = p[fields.ref];
      if (typeof ref !== 'string' && typeof ref !== 'number') return [];
      const polygons = geoJsonPolygons(f.geometry);
      if (!polygons.some((poly) => pointInPolygon(lonLat, poly))) return [];
      const label = (fields.label ?? [])
        .map((k) => p[k])
        .filter((v) => (typeof v === 'string' && v) || typeof v === 'number')
        .join(' ');
      const r: ParcelResult = {
        ref: String(ref),
        label: label || String(ref),
        polygons,
        provider: 'wfs',
      };
      const area = fields.area !== undefined ? Number(p[fields.area]) : NaN;
      if (Number.isFinite(area)) r.officialArea = area;
      return [r];
    });
  }
}
