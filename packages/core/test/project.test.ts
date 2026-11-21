import { describe, expect, it } from 'vitest';
import {
  chooseCrs,
  createMass,
  createProject,
  crsToLonLat,
  lonLatToCrs,
  localToLonLat,
  parseProject,
  polygonArea,
  serializeProject,
  SCHEMA_VERSION,
} from '../src/index.js';

/** Palaiseau, section 0H n° 0518 as returned by IGN API Carto (contenance 3 341 m²). */
const PALAISEAU_0518: [number, number][][] = [
  [
    [2.19788422, 48.71317102],
    [2.1987887, 48.71307023],
    [2.19869012, 48.71268253],
    [2.19867704, 48.71263117],
    [2.19777258, 48.71273195],
    [2.19777885, 48.712757],
    [2.19788422, 48.71317102],
  ],
];

describe('projection', () => {
  it('chooses national systems', () => {
    expect(chooseCrs([2.198, 48.713])).toBe('EPSG:2154');
    expect(chooseCrs([6.96, 50.94])).toBe('EPSG:25832'); // Köln
    expect(chooseCrs([13.4, 52.5])).toBe('EPSG:25833'); // Berlin
    expect(chooseCrs([7.75, 48.58])).toBe('EPSG:2154'); // Strasbourg
    expect(chooseCrs([-9.14, 38.72])).toBe('EPSG:25829'); // Lisbon
    expect(chooseCrs([-74, 40.7])).toBe('EPSG:32618');
    expect(chooseCrs([151.2, -33.9])).toBe('EPSG:32756');
  });

  it('matches the IGN Lambert-93 coordinates of the test address', () => {
    // IGN geocoder: x 640990.6, y 6846180.5 for 2.197965, 48.713064
    const [x, y] = lonLatToCrs('EPSG:2154', [2.197965, 48.713064]);
    expect(x).toBeCloseTo(640990.6, 0);
    expect(y).toBeCloseTo(6846180.5, 0);
    const back = crsToLonLat('EPSG:2154', [x, y]);
    expect(back[0]).toBeCloseTo(2.197965, 7);
  });
});

describe('project', () => {
  it('creates a FR project from a cadastral parcel, centred on the site', () => {
    const p = createProject({
      name: 'Palaiseau',
      parcelsLonLat: [{ ref: '914770000H0518', rings: PALAISEAU_0518 }],
      date: '2026-11-21',
    });
    expect(p.geo.crs).toBe('EPSG:2154');
    expect(p.settings.profile).toBe('FR');
    expect(p.settings.notation).toBe('fr');
    // cadastral "contenance" is 3 341 m² (rounded, from the legal survey) – geometry is within 1 %
    expect(Math.abs(polygonArea(p.site.boundary) - 3341) / 3341).toBeLessThan(0.01);
    const [lon, lat] = localToLonLat(p.geo, [0, 0]);
    expect(lon).toBeCloseTo(2.1983, 3);
    expect(lat).toBeCloseTo(48.7129, 3);
    expect(p.site.parcels[0]!.ref).toBe('914770000H0518');
  });

  it('creates a drawn project', () => {
    const p = createProject({
      name: 'Skizze',
      lonLat: [6.96, 50.94],
      localBoundary: {
        outer: [
          [0, 0],
          [30, 0],
          [30, 20],
          [0, 20],
        ],
      },
    });
    expect(p.settings.profile).toBe('DE');
    expect(p.site.parcels[0]!.source).toBe('drawn');
    expect(polygonArea(p.site.boundary)).toBeCloseTo(600, 6);
  });

  it('round-trips through JSON and rejects bad files', () => {
    const p = createProject({ name: 'X', lonLat: [2.2, 48.7] });
    p.variants[0]!.masses.push(createMass('zeile', { usage: 'buero' }));
    const back = parseProject(serializeProject(p));
    expect(back).toEqual(p);
    expect(back.schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => parseProject('{}')).toThrow();
    expect(() => parseProject(JSON.stringify({ ...p, schemaVersion: 99 }))).toThrow(/newer/);
    expect(() => parseProject(JSON.stringify({ schemaVersion: 1 }))).toThrow(/Invalid/);
  });

  it('createMass uses usage defaults', () => {
    const m = createMass('solitaer', { usage: 'buero' });
    expect(m.storeys.upper.height).toBe(3.5);
    expect(createMass('solitaer', { usage: 'gewerbe' }).storeys.ground.height).toBe(4);
  });
});
