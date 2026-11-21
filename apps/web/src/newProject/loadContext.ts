import type { ContextBuilding, Project } from '@kubatur/core';

/**
 * Load the surrounding buildings for a project (radius in m around the site centre) and convert
 * them to local coordinates. Implemented by the newProject module; also used by the ribbon
 * command "Recharger le contexte".
 */
export async function loadContextForProject(
  _project: Project,
  _radius: number,
): Promise<ContextBuilding[]> {
  throw new Error('not implemented');
}
