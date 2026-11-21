import { createProject, type Project } from '@kubatur/core';
import { useProjectStore } from '../store/projectStore';
import { siteToInput, type SiteDraft } from './importSite';
import { loadAllContextForProject } from './loadContext';

export interface CreateRequest {
  name: string;
  site: SiteDraft;
  radius: number;
  address?: string;
}

export type CreatePhase = 'creating' | 'context';

/**
 * Create the project, load its context and put it into the project store. A failing context
 * or layer request does not prevent the project from being created: the errors are returned instead.
 */
export async function createProjectWithContext(
  req: CreateRequest,
  onPhase: (p: CreatePhase) => void = () => {},
): Promise<{ project: Project; contextError: unknown; layersError: unknown }> {
  onPhase('creating');
  const input: Parameters<typeof createProject>[0] = { name: req.name, ...siteToInput(req.site) };
  if (req.address) input.address = req.address;
  const project = createProject(input);
  onPhase('context');
  // Buildings and surroundings load in parallel; a failing layer request is non-blocking
  // (returned as layersError, the project simply has no surroundings).
  const r = await loadAllContextForProject(project, req.radius);
  if (r.buildings) project.context = r.buildings;
  if (r.surroundings) project.surroundings = r.surroundings;
  useProjectStore.getState().load(project);
  return { project, contextError: r.buildingsError, layersError: r.layersError };
}
