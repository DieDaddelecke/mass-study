import type { Constraints, ContextBuilding, Mass, Project, Settings, Variant } from '@kubatur/core';
import { produce, type Draft } from 'immer';
import { temporal } from 'zundo';
import { create } from 'zustand';

/**
 * Document state: the project and nothing else. Every change goes through `update`
 * (immer recipe) so it is recorded in the undo history (≥ 100 steps).
 * UI state (selection, tool, view) lives in `uiStore` and is not undoable.
 */
export interface ProjectState {
  project: Project | null;
  /** Bumped on every change; used for autosave / dirty tracking. */
  revision: number;
  /** Replace the whole project (new / open). Clears the undo history. */
  load: (p: Project | null) => void;
  /** Generic undoable change. */
  update: (recipe: (draft: Draft<Project>) => void) => void;
}

export const UNDO_LIMIT = 200;

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set) => ({
      project: null,
      revision: 0,
      load: (p) => {
        set((s) => ({ project: p, revision: s.revision + 1 }));
        useProjectStore.temporal.getState().clear();
      },
      update: (recipe) =>
        set((s) =>
          s.project ? { project: produce(s.project, recipe), revision: s.revision + 1 } : s,
        ),
    }),
    {
      limit: UNDO_LIMIT,
      // only the document is part of the history
      partialize: (s) => ({ project: s.project }),
      equality: (a, b) => a.project === b.project,
    },
  ),
);

export const undo = () => useProjectStore.temporal.getState().undo();
export const redo = () => useProjectStore.temporal.getState().redo();

// ---------------------------------------------------------------------------
// Selectors and typed actions (thin wrappers around `update`)
// ---------------------------------------------------------------------------

export function activeVariant(p: Project): Variant {
  return p.variants.find((v) => v.id === p.activeVariantId) ?? p.variants[0]!;
}

function draftVariant(p: Draft<Project>): Draft<Variant> {
  return p.variants.find((v) => v.id === p.activeVariantId) ?? p.variants[0]!;
}

export const actions = {
  addMass(m: Mass) {
    useProjectStore.getState().update((p) => {
      draftVariant(p).masses.push(m);
    });
  },
  updateMass(id: string, recipe: (m: Draft<Mass>) => void) {
    useProjectStore.getState().update((p) => {
      const m = draftVariant(p).masses.find((x) => x.id === id);
      if (m) recipe(m);
    });
  },
  updateMasses(ids: readonly string[], recipe: (m: Draft<Mass>) => void) {
    useProjectStore.getState().update((p) => {
      for (const m of draftVariant(p).masses) if (ids.includes(m.id)) recipe(m);
    });
  },
  deleteMasses(ids: readonly string[]) {
    useProjectStore.getState().update((p) => {
      const v = draftVariant(p);
      v.masses = v.masses.filter((m) => !ids.includes(m.id));
    });
  },
  setContext(buildings: ContextBuilding[]) {
    useProjectStore.getState().update((p) => {
      p.context = buildings;
    });
  },
  updateContextBuilding(id: string, recipe: (c: Draft<ContextBuilding>) => void) {
    useProjectStore.getState().update((p) => {
      const c = p.context.find((x) => x.id === id);
      if (c) recipe(c);
    });
  },
  setConstraints(c: Constraints) {
    useProjectStore.getState().update((p) => {
      p.constraints = c;
    });
  },
  updateSettings(recipe: (s: Draft<Settings>) => void) {
    useProjectStore.getState().update((p) => recipe(p.settings));
  },
  rename(name: string) {
    useProjectStore.getState().update((p) => {
      p.name = name;
    });
  },
};
