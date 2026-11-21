import { createProject, type Project } from '@kubatur/core';
import { useProjectStore } from '../store/projectStore';
import { siteToInput, type SiteDraft } from './importSite';
import { loadContextForProject, loadSurroundingsForProject } from './loadContext';

export interface CreateRequest {
  name: string;
  site: SiteDraft;
  radius: number;
  address?: string;
}

export type CreatePhase = 'creating' | 'context';

/** How long project creation waits for the context layers before opening the project anyway. */
export const LAYERS_GRACE_MS = 1500;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

/**
 * Create the project, load its context and put it into the project store. A failing context
 * or layer request does not prevent the project from being created: the errors are returned instead.
 * Buildings are awaited; the layers (streets, vegetation, parcels) are included when they arrive
 * within LAYERS_GRACE_MS, otherwise they are added to the open project when they arrive (slow
 * upstreams such as an overloaded Overpass server must not block opening the project).
 */
export async function createProjectWithContext(
  req: CreateRequest,
  onPhase: (p: CreatePhase) => void = () => {},
  graceMs = LAYERS_GRACE_MS,
): Promise<{ project: Project; contextError: unknown; layersError: unknown }> {
  onPhase('creating');
  const input: Parameters<typeof createProject>[0] = { name: req.name, ...siteToInput(req.site) };
  if (req.address) input.address = req.address;
  const project = createProject(input);
  onPhase('context');
  const layers = settle(loadSurroundingsForProject(project, req.radius));
  const buildings = await settle(loadContextForProject(project, req.radius));
  const early = await Promise.race([
    layers,
    new Promise<null>((r) => setTimeout(() => r(null), graceMs)),
  ]);
  if (buildings.ok) project.context = buildings.value;
  if (early?.ok) project.surroundings = early.value.surroundings;
  useProjectStore.getState().load(project);
  if (!early) {
    void layers.then((late) => {
      const store = useProjectStore.getState();
      if (!late.ok || store.project?.id !== project.id) return;
      // Not an edit of the user: keep it out of the undo history.
      const t = useProjectStore.temporal.getState();
      t.pause();
      store.update((p) => {
        p.surroundings = late.value.surroundings;
      });
      t.resume();
    });
  }
  return {
    project,
    contextError: buildings.ok ? null : buildings.error,
    layersError: early && !early.ok ? early.error : null,
  };
}
