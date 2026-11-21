import { createProject, type Project } from '@kubatur/core';
import { useProjectStore } from '../store/projectStore';
import { siteToInput, type SiteDraft } from './importSite';
import { loadContextForProject } from './loadContext';

export interface CreateRequest {
  name: string;
  site: SiteDraft;
  radius: number;
  address?: string;
}

export type CreatePhase = 'creating' | 'context';

/**
 * Create the project, load its context and put it into the project store. A failing context
 * request does not prevent the project from being created: the error is returned instead.
 */
export async function createProjectWithContext(
  req: CreateRequest,
  onPhase: (p: CreatePhase) => void = () => {},
): Promise<{ project: Project; contextError: unknown }> {
  onPhase('creating');
  const input: Parameters<typeof createProject>[0] = { name: req.name, ...siteToInput(req.site) };
  if (req.address) input.address = req.address;
  const project = createProject(input);
  onPhase('context');
  let contextError: unknown = null;
  try {
    project.context = await loadContextForProject(project, req.radius);
  } catch (e) {
    contextError = e;
  }
  useProjectStore.getState().load(project);
  return { project, contextError };
}
