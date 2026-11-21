import { createMass, createProject, type Project } from '@kubatur/core';
import parcel from '../../../server/test/fixtures/palaiseau/parcel-0518.json';
import bdtopo from '../../../server/test/fixtures/palaiseau/bdtopo-batiment.json';
import type { ContextBuildingLonLat, LonLat } from '../api/contract';
import { toContextBuildings } from '../geo/context';
import { syntheticSurroundings } from './syntheticSurroundings';

/**
 * Offline demo project built from recorded real data (parcel 0H 0518 in Palaiseau + BD TOPO
 * buildings). Open the app with `?demo=palaiseau` – used for development and screenshots,
 * because the dev container cannot reach the geodata services.
 */
export function palaiseauDemo(withMass = true): Project {
  const f = parcel.features[0]!;
  const rings = f.geometry.coordinates[0] as LonLat[][];
  const p = createProject({
    name: 'Palaiseau – Bd Thomas Gobert',
    parcelsLonLat: [{ ref: f.properties.idu, rings }],
    address: '27 Boulevard Thomas Gobert, 91120 Palaiseau',
  });
  const buildings: ContextBuildingLonLat[] = bdtopo.features.map((b) => ({
    id: b.id,
    polygons: (b.geometry.coordinates as number[][][][]).map((poly) =>
      poly.map((ring) => ring.map(([lon, lat]) => [lon!, lat!] as LonLat)),
    ),
    height: b.properties.hauteur ?? 9,
    heightEstimated: b.properties.hauteur == null,
    source: 'ign',
  }));
  p.context = toContextBuildings({ buildings }, p.geo, p.site.boundary);
  p.surroundings ??= syntheticSurroundings();
  if (withMass) {
    const m = createMass('zeile', { position: [-25, -6], rotation: 0.12, name: 'BK1' });
    m.typology = { kind: 'zeile', length: 50, depth: 13, sections: 3, sectionOffset: 0 };
    m.usageByStorey = { 0: 'gewerbe' };
    p.variants[0]!.masses.push(m);
  }
  return p;
}
