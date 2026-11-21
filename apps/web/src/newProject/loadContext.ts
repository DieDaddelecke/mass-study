import { ringCentroid, type ContextBuilding, type Project, type Surroundings } from '@kubatur/core';
import { api } from '../api/client';
import type { ContextLayersResponse } from '../api/contract';
import { bboxAround, toContextBuildings, toSurroundings } from '../geo/context';

/**
 * Load the surrounding buildings for a project (radius in m around the site centre) and convert
 * them to local coordinates. Buildings whose centroid lies on the site are flagged `demolished`;
 * buildings whose centroid is farther than `radius` from the site centre are dropped.
 * Also used by the ribbon command "Recharger le contexte".
 */
export async function loadContextForProject(
  project: Project,
  radius: number,
  signal?: AbortSignal,
): Promise<ContextBuilding[]> {
  const [lon, lat] = project.geo.originLonLat;
  const res = await api.context(bboxAround(lon, lat, radius), signal);
  // The local origin is the site centroid, so the distance is simply |centroid|.
  return toContextBuildings(res, project.geo, project.site.boundary).filter((b) => {
    if (!b.footprint.outer.length) return false;
    const [x, y] = ringCentroid(b.footprint.outer);
    return Math.hypot(x, y) <= radius;
  });
}

export interface SurroundingsResult {
  surroundings: Surroundings;
  /** Layers the server could not load (the rest is still usable). */
  errors: NonNullable<ContextLayersResponse['errors']>;
}

/**
 * Load streets, vegetation, trees, water and neighbouring parcels (same bbox as the buildings)
 * in local coordinates. The site's own parcels are left out.
 */
export async function loadSurroundingsForProject(
  project: Project,
  radius: number,
  signal?: AbortSignal,
): Promise<SurroundingsResult> {
  const [lon, lat] = project.geo.originLonLat;
  const res = await api.contextLayers(bboxAround(lon, lat, radius), signal);
  const siteRefs = project.site.parcels.flatMap((p) => (p.ref ? [p.ref] : []));
  return { surroundings: toSurroundings(res, project.geo, siteRefs), errors: res.errors ?? [] };
}

/**
 * Buildings and surroundings in parallel, settled independently: a failing layer request never
 * fails the buildings and vice versa.
 */
export async function loadAllContextForProject(
  project: Project,
  radius: number,
  signal?: AbortSignal,
): Promise<{
  buildings: ContextBuilding[] | null;
  buildingsError: unknown;
  surroundings: Surroundings | null;
  layersError: unknown;
}> {
  const [b, s] = await Promise.allSettled([
    loadContextForProject(project, radius, signal),
    loadSurroundingsForProject(project, radius, signal),
  ]);
  return {
    buildings: b.status === 'fulfilled' ? b.value : null,
    buildingsError: b.status === 'rejected' ? (b.reason as unknown) : null,
    surroundings: s.status === 'fulfilled' ? s.value.surroundings : null,
    layersError: s.status === 'rejected' ? (s.reason as unknown) : null,
  };
}
