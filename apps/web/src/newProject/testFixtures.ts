/**
 * Contract-shaped responses (apps/web/src/api/contract.ts) derived from the recorded upstream
 * responses in apps/server/test/fixtures/palaiseau. Test-only.
 */
import completion from '../../../server/test/fixtures/palaiseau/completion.json';
import bdtopo from '../../../server/test/fixtures/palaiseau/bdtopo-batiment.json';
import p0518 from '../../../server/test/fixtures/palaiseau/parcel-0518.json';
import p0519 from '../../../server/test/fixtures/palaiseau/parcel-0519.json';
import type {
  ContextResponse,
  GeocodeResponse,
  LonLat,
  LonLatRings,
  ParcelResult,
  ParcelsResponse,
} from '../api/contract';

const ll = (rings: number[][][]): LonLatRings =>
  rings.map((r) => r.map(([lon, lat]) => [lon!, lat!] as LonLat));

export const completionResponse: GeocodeResponse = {
  results: completion.results.map((r) => ({
    label: r.fulltext,
    lonLat: [r.x, r.y],
    kind: r.kind === 'housenumber' ? 'address' : r.kind === 'street' ? 'street' : 'other',
    city: r.city,
    postcode: r.zipcode,
    provider: 'ign',
  })),
};

function parcel(json: typeof p0518): ParcelResult {
  const f = json.features[0]!;
  return {
    ref: f.properties.idu,
    label: `${f.properties.nom_com} ${f.properties.section} ${f.properties.numero}`,
    officialArea: f.properties.contenance,
    polygons: (f.geometry.coordinates as number[][][][]).map(ll),
    provider: 'apicarto',
  };
}
export const parcel0518 = parcel(p0518);
export const parcel0519 = parcel(p0519 as typeof p0518);
export const parcelsResponse0518: ParcelsResponse = { parcels: [parcel0518], covered: true };

export const contextResponse: ContextResponse = {
  provider: 'ign',
  buildings: bdtopo.features.map((b) => ({
    id: b.id,
    polygons: (b.geometry.coordinates as number[][][][]).map(ll),
    height: b.properties.hauteur ?? 9,
    heightEstimated: b.properties.hauteur == null,
    source: 'ign',
  })),
};
