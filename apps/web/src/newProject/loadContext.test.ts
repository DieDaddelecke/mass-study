import { createProject } from '@kubatur/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { parcelsToInput } from './importSite';
import { loadContextForProject } from './loadContext';
import { contextResponse, parcel0518 } from './testFixtures';

describe('loadContextForProject', () => {
  afterEach(() => vi.restoreAllMocks());

  const project = () =>
    createProject({ name: 'Palaiseau', parcelsLonLat: parcelsToInput([parcel0518]) });

  it('requests a bbox around the site and marks buildings on the site as demolished', async () => {
    const spy = vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    const p = project();
    const buildings = await loadContextForProject(p, 150);
    const [minLon, minLat, maxLon, maxLat] = spy.mock.calls[0]![0];
    const [lon] = p.geo.originLonLat;
    expect(minLon).toBeLessThan(lon);
    expect(maxLon).toBeGreaterThan(lon);
    expect((maxLat - minLat) * 111_320).toBeCloseTo(300, 0);
    expect(buildings.length).toBeGreaterThan(0);
    const residence = buildings.find((b) => b.id === 'batiment.16296576');
    expect(residence?.demolished).toBe(true);
    expect(residence?.height).toBeCloseTo(16.8);
    expect(buildings.filter((b) => b.demolished)).toHaveLength(1);
  });

  it('drops buildings outside the radius', async () => {
    vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    const p = project();
    const all = await loadContextForProject(p, 500);
    const near = await loadContextForProject(p, 50);
    expect(near.length).toBeLessThan(all.length);
    expect(near.some((b) => b.id === 'batiment.16296576')).toBe(true);
  });

  it('propagates API errors', async () => {
    vi.spyOn(api, 'context').mockRejectedValue(new Error('boom'));
    await expect(loadContextForProject(project(), 150)).rejects.toThrow('boom');
  });
});

describe('createProjectWithContext', () => {
  afterEach(() => vi.restoreAllMocks());
  it('still creates the project when the context request fails', async () => {
    const { createProjectWithContext } = await import('./createFlow');
    const { useProjectStore } = await import('../store/projectStore');
    vi.spyOn(api, 'context').mockRejectedValue(new Error('offline'));
    const phases: string[] = [];
    const { project, contextError } = await createProjectWithContext(
      { name: 'X', site: { kind: 'parcels', parcels: [parcel0518] }, radius: 150 },
      (ph) => phases.push(ph),
    );
    expect(contextError).toBeInstanceOf(Error);
    expect(project.context).toEqual([]);
    expect(useProjectStore.getState().project).toBe(project);
    expect(phases).toEqual(['creating', 'context']);
  });
});
