import { createProject } from '@kubatur/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { parcelsToInput } from './importSite';
import {
  loadAllContextForProject,
  loadContextForProject,
  loadSurroundingsForProject,
} from './loadContext';
import { contextResponse, layersResponse, parcel0518 } from './testFixtures';

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

describe('loadSurroundingsForProject', () => {
  afterEach(() => vi.restoreAllMocks());
  const project = () =>
    createProject({ name: 'Palaiseau', parcelsLonLat: parcelsToInput([parcel0518]) });

  it('uses the same bbox as the buildings and drops the site parcel', async () => {
    const spy = vi.spyOn(api, 'contextLayers').mockResolvedValue(layersResponse);
    const ctx = vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    const p = project();
    const all = await loadAllContextForProject(p, 150);
    expect(spy.mock.calls[0]![0]).toEqual(ctx.mock.calls[0]![0]);
    expect(all.buildingsError).toBeNull();
    expect(all.layersError).toBeNull();
    expect(all.buildings?.length).toBeGreaterThan(0);
    expect(all.surroundings?.parcels.map((x) => x.ref)).toEqual(['914770000H0519']);
    const r = await loadSurroundingsForProject(p, 150);
    expect(r.errors).toEqual([{ layer: 'water', message: 'ign-wfs: HTTP 503' }]);
  });

  it('settles buildings and layers independently', async () => {
    vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    vi.spyOn(api, 'contextLayers').mockRejectedValue(new Error('layers down'));
    const a = await loadAllContextForProject(project(), 150);
    expect(a.buildings?.length).toBeGreaterThan(0);
    expect(a.surroundings).toBeNull();
    expect((a.layersError as Error).message).toBe('layers down');

    vi.spyOn(api, 'context').mockRejectedValue(new Error('buildings down'));
    vi.spyOn(api, 'contextLayers').mockResolvedValue(layersResponse);
    const b = await loadAllContextForProject(project(), 150);
    expect(b.buildings).toBeNull();
    expect((b.buildingsError as Error).message).toBe('buildings down');
    expect(b.surroundings?.roads).toHaveLength(1);
  });
});

describe('createProjectWithContext', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores surroundings and keeps buildings when the layers fail', async () => {
    const { createProjectWithContext } = await import('./createFlow');
    vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    vi.spyOn(api, 'contextLayers').mockResolvedValue(layersResponse);
    const ok = await createProjectWithContext({
      name: 'X',
      site: { kind: 'parcels', parcels: [parcel0518] },
      radius: 150,
    });
    expect(ok.project.surroundings?.roads).toHaveLength(1);
    expect(ok.layersError).toBeNull();
    vi.spyOn(api, 'contextLayers').mockRejectedValue(new Error('offline'));
    const bad = await createProjectWithContext({
      name: 'X',
      site: { kind: 'parcels', parcels: [parcel0518] },
      radius: 150,
    });
    expect(bad.contextError).toBeNull();
    expect(bad.layersError).toBeInstanceOf(Error);
    expect(bad.project.context.length).toBeGreaterThan(0);
    expect(bad.project.surroundings).toBeUndefined();
  });

  it('setSurroundings is undoable', async () => {
    const { useProjectStore, actions, undo } = await import('../store/projectStore');
    const p = createProject({ name: 'U', parcelsLonLat: parcelsToInput([parcel0518]) });
    useProjectStore.getState().load(p);
    const s = { roads: [], green: [], trees: [], water: [], parcels: [] };
    actions.setSurroundings(s);
    expect(useProjectStore.getState().project?.surroundings).toEqual(s);
    undo();
    expect(useProjectStore.getState().project?.surroundings).toBeUndefined();
  });

  it('still creates the project when the context request fails', async () => {
    const { createProjectWithContext } = await import('./createFlow');
    const { useProjectStore } = await import('../store/projectStore');
    vi.spyOn(api, 'context').mockRejectedValue(new Error('offline'));
    vi.spyOn(api, 'contextLayers').mockRejectedValue(new Error('offline'));
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

describe('createProjectWithContext with slow layers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the project without waiting and adds the layers later, outside the undo history', async () => {
    const { createProjectWithContext } = await import('./createFlow');
    const { useProjectStore } = await import('../store/projectStore');
    let resolve!: (v: typeof layersResponse) => void;
    vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    vi.spyOn(api, 'contextLayers').mockReturnValue(new Promise((r) => (resolve = r)));
    const { project, layersError } = await createProjectWithContext(
      { name: 'S', site: { kind: 'parcels', parcels: [parcel0518] }, radius: 150 },
      undefined,
      10,
    );
    expect(layersError).toBeNull();
    expect(useProjectStore.getState().project?.surroundings).toBeUndefined();
    resolve(layersResponse);
    await new Promise((r) => setTimeout(r, 0));
    const current = useProjectStore.getState().project;
    expect(current?.id).toBe(project.id);
    expect(current?.surroundings?.roads).toHaveLength(1);
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
