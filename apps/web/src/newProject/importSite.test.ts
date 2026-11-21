import { createProject, polygonArea } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import {
  dedupeVertices,
  dxfToSite,
  ImportError,
  lonLatArea,
  parcelsToInput,
  parseDxfPolylines,
  parseGeoJsonSite,
  siteOutline,
  siteToInput,
} from './importSite';
import { parcel0518, parcel0519 } from './testFixtures';

const ring = [
  [2.1978, 48.713],
  [2.1988, 48.713],
  [2.1988, 48.7136],
  [2.1978, 48.713],
];
const polygon = { type: 'Polygon', coordinates: [ring] };

describe('GeoJSON import', () => {
  it('accepts Polygon, MultiPolygon, Feature and FeatureCollection', () => {
    expect(parseGeoJsonSite(JSON.stringify(polygon))).toHaveLength(1);
    expect(
      parseGeoJsonSite(JSON.stringify({ type: 'MultiPolygon', coordinates: [[ring], [ring]] })),
    ).toHaveLength(2);
    expect(
      parseGeoJsonSite(JSON.stringify({ type: 'Feature', properties: {}, geometry: polygon })),
    ).toHaveLength(1);
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: polygon },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [2, 48] } },
      ],
    };
    const res = parseGeoJsonSite(JSON.stringify(fc));
    expect(res).toHaveLength(1);
    expect(res[0]![0]![1]).toEqual([2.1988, 48.713]);
  });

  it('rejects invalid input', () => {
    const code = (s: string) => {
      try {
        parseGeoJsonSite(s);
      } catch (e) {
        return e instanceof ImportError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code('{nope')).toBe('invalidJson');
    expect(code(JSON.stringify({ type: 'Point', coordinates: [2, 48] }))).toBe('noPolygon');
    expect(
      code(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [640990, 6846180],
              [641000, 6846180],
              [641000, 6846190],
              [640990, 6846180],
            ],
          ],
        }),
      ),
    ).toBe('notWgs84');
  });
});

function dxf(points: [number, number][], closedFlag = 1, extra = ''): string {
  const v = points.map(([x, y]) => `10\n${x}\n20\n${y}`).join('\n');
  return `0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nGRUNDSTUECK\n90\n${points.length}\n70\n${closedFlag}\n${v}\n${extra}0\nENDSEC\n0\nEOF\n`;
}

describe('DXF import', () => {
  it('reads a closed LWPOLYLINE in mm (local coordinates)', () => {
    const text = dxf([
      [0, 0],
      [20000, 0],
      [20000, 30000],
      [0, 30000],
    ]);
    const pls = parseDxfPolylines(text);
    expect(pls).toHaveLength(1);
    expect(pls[0]!.area).toBeCloseTo(600e6);
    const site = dxfToSite(pls[0]!, 'mm', 'local', [2.198, 48.7131]);
    expect(site.kind).toBe('local');
    if (site.kind !== 'local') return;
    expect(polygonArea(site.polygon)).toBeCloseTo(600);
    const p = createProject({ name: 'DXF', ...siteToInput(site) });
    expect(polygonArea(p.site.boundary)).toBeCloseTo(600, 1);
    expect(p.site.parcels[0]!.source).toBe('drawn');
    expect(p.geo.originLonLat[0]).toBeCloseTo(2.198, 5);
    expect(p.geo.originLonLat[1]).toBeCloseTo(48.7131, 5);
    // outline for the map is around the placement point and has the right size
    expect(lonLatArea(siteOutline(site))).toBeCloseTo(600, -1);
  });

  it('reads Lambert-93 coordinates and converts them to WGS 84', () => {
    const text = dxf([
      [640980, 6846170],
      [641000, 6846170],
      [641000, 6846200],
      [640980, 6846200],
    ]);
    const site = dxfToSite(parseDxfPolylines(text)[0]!, 'm', 'lambert93', [0, 0]);
    expect(site.kind).toBe('lonlat');
    if (site.kind !== 'lonlat') return;
    const [lon, lat] = site.polygons[0]![0]![0]!;
    expect(lon).toBeCloseTo(2.1978, 3);
    expect(lat).toBeCloseTo(48.7131, 3);
    const p = createProject({ name: 'L93', ...siteToInput(site) });
    expect(p.geo.crs).toBe('EPSG:2154');
    expect(polygonArea(p.site.boundary)).toBeCloseTo(600, 0);
  });

  it('lists several closed polylines largest first and ignores open ones', () => {
    const small = dxf([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const big = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as [number, number][];
    const open = `0\nLWPOLYLINE\n8\n0\n90\n3\n70\n0\n10\n0\n20\n0\n10\n50\n20\n0\n10\n50\n20\n50\n`;
    const text = small.replace(
      '0\nENDSEC',
      dxf(big).split('ENTITIES\n')[1]!.split('0\nENDSEC')[0] + open + '0\nENDSEC',
    );
    const pls = parseDxfPolylines(text);
    expect(pls.map((p) => p.area)).toEqual([100, 0.5]);
  });

  it('fails clearly without a closed polyline', () => {
    const open = dxf(
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
      0,
    );
    expect(() => parseDxfPolylines(open)).toThrow(ImportError);
  });
});

describe('parcel merge', () => {
  it('turns selected parcels into parcelsLonLat and merges them in createProject', () => {
    const input = parcelsToInput([parcel0518, parcel0519])!;
    expect(input).toHaveLength(2);
    expect(input[0]!.ref).toBe('914770000H0518');
    expect(input[0]!.source).toBe('cadastre');
    const p = createProject({ name: 'Merge', parcelsLonLat: input });
    expect(p.site.parcels).toHaveLength(2);
    const single = createProject({ name: 'One', parcelsLonLat: parcelsToInput([parcel0518]) });
    // official area 3341 m²; projected area within 1 %
    expect(polygonArea(single.site.boundary)).toBeGreaterThan(3341 * 0.99);
    expect(polygonArea(single.site.boundary)).toBeLessThan(3341 * 1.01);
    expect(polygonArea(p.site.boundary)).toBeGreaterThan(polygonArea(single.site.boundary));
  });

  it('dedupes double-click vertices', () => {
    expect(
      dedupeVertices([
        [1, 1],
        [2, 2],
        [2, 2],
      ]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });
});
