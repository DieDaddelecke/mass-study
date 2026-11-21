import type { ContextBuildingLonLat, LonLat } from './contract.js';
import { type BBox, FRANCE_METRO_BBOX, geoJsonPolygons, inBBox, isRecord } from './geometry.js';
import { parseCount, parseMeters, resolveHeight } from './height.js';
import type { GeoHttp } from './http.js';
import type { ContextProvider } from './providers.js';

export const IGN_WFS_URL = 'https://data.geopf.fr/wfs/ows';

/** WFS 2.0 GetFeature URL for BDTOPO_V3:batiment (BBOX in lat,lon axis order). */
export function bdTopoUrl(b: BBox, base = IGN_WFS_URL): string {
  const [minLon, minLat, maxLon, maxLat] = b;
  return (
    `${base}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment` +
    `&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=1000` +
    `&BBOX=${minLat},${minLon},${maxLat},${maxLon},urn:ogc:def:crs:EPSG::4326`
  );
}

/** Maps a BD TOPO GeoJSON FeatureCollection to context buildings (z values ignored). */
export function mapBdTopo(data: unknown): ContextBuildingLonLat[] {
  const features = isRecord(data) && Array.isArray(data.features) ? data.features : [];
  return features.flatMap((f: unknown, i: number): ContextBuildingLonLat[] => {
    if (!isRecord(f)) return [];
    const p = isRecord(f.properties) ? f.properties : {};
    const polygons = geoJsonPolygons(f.geometry);
    if (!polygons.length) return [];
    const levels = parseCount(p.nombre_d_etages);
    const b: ContextBuildingLonLat = {
      id: `ign/${typeof f.id === 'string' ? f.id : typeof p.cleabs === 'string' ? p.cleabs : i}`,
      polygons,
      ...resolveHeight(parseMeters(p.hauteur), levels),
      source: 'ign',
    };
    if (levels !== undefined && levels > 0) b.levels = levels;
    if (p.etat_de_l_objet === 'En construction') b.underConstruction = true;
    return [b];
  });
}

/** IGN BD TOPO buildings (France, preferred context source). */
export class BdTopoContextProvider implements ContextProvider {
  readonly id = 'ign' as const;
  constructor(
    private readonly http: GeoHttp,
    private readonly base = IGN_WFS_URL,
  ) {}

  covers(lonLat: LonLat): boolean {
    return inBBox(lonLat, FRANCE_METRO_BBOX);
  }

  async buildings(bbox: BBox): Promise<ContextBuildingLonLat[]> {
    return mapBdTopo(await this.http.getJson(bdTopoUrl(bbox, this.base), { upstream: 'ign-wfs' }));
  }
}
