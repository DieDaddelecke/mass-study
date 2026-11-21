import { createProject, lonLatToLocal, polygonArea } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import { palaiseauDemo } from '../demo/palaiseau';
import { parcelsToInput } from '../newProject/importSite';
import { layersResponse, parcel0518 } from '../newProject/testFixtures';
import { toSurroundings } from './context';

describe('toSurroundings', () => {
  const project = createProject({ name: 'P', parcelsLonLat: parcelsToInput([parcel0518]) });
  const s = toSurroundings(layersResponse, project.geo, ['914770000H0518']);

  it('converts roads to local centre lines and drops degenerate lines', () => {
    expect(s.roads).toHaveLength(1);
    const r = s.roads[0]!;
    expect(r).toMatchObject({ id: 'ign/TRONROUT1', kind: 'tertiary', width: 5, level: 0 });
    expect(r.name).toBe('Boulevard Thomas Gobert');
    expect(r.centerline[0]).toEqual(lonLatToLocal(project.geo, [2.1975, 48.7125]));
    // 0.001° of longitude ≈ 73 m
    expect(
      Math.hypot(
        ...([0, 1].map((i) => r.centerline[1]![i]! - r.centerline[0]![i]!) as [number, number]),
      ),
    ).toBeCloseTo(73.5, 0);
  });

  it('splits multipolygons, keeps holes and normalises orientation', () => {
    expect(s.green.map((g) => g.id)).toEqual(['osm/relation/9#0', 'osm/relation/9#1']);
    const wood = s.green[0]!;
    expect(wood.kind).toBe('wood');
    expect(wood.footprint.holes).toHaveLength(1);
    expect(polygonArea({ outer: wood.footprint.outer })).toBeGreaterThan(0);
  });

  it('converts trees and drops the site parcels', () => {
    expect(s.trees[0]).toMatchObject({
      id: 'osm/node/1',
      height: 10,
      crown: 6,
      leafType: 'broadleaved',
    });
    expect(s.trees[0]!.position).toEqual(lonLatToLocal(project.geo, [2.1979, 48.7131]));
    expect(s.parcels.map((p) => p.ref)).toEqual(['914770000H0519']);
    expect(s.parcels[0]?.label).toBeTruthy();
    expect(s.water).toEqual([]);
  });
});

describe('Palaiseau demo surroundings', () => {
  it('carries the generated real layers in the demo frame', () => {
    const p = palaiseauDemo(false);
    const s = p.surroundings!;
    expect(s.roads.some((r) => r.name === 'Boulevard Thomas Gobert')).toBe(true);
    expect(s.green.some((g) => g.kind === 'wood' && g.source === 'ign')).toBe(true);
    expect(s.trees.length).toBeGreaterThan(0);
    expect(s.parcels.some((x) => x.ref === '914770000H0518')).toBe(false);
    // the site lies inside the surroundings (local origin = site centroid)
    const xs = s.roads.flatMap((r) => r.centerline.map((v) => v[0]));
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(0);
  });
});
