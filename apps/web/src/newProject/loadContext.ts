import { ringCentroid, type ContextBuilding, type Project } from '@kubatur/core';
import { api } from '../api/client';
import { bboxAround, toContextBuildings } from '../geo/context';

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
