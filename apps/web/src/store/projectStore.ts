import type {
  Constraints,
  ContextBuilding,
  Mass,
  PlantingZone,
  Project,
  Settings,
  Surroundings,
  Variant,
} from '@kubatur/core';
import { freeze, produce, type Draft } from 'immer';
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
        // deep-frozen like every later immer state: the analysis memoizes per (frozen) mass
        set((s) => ({ project: p && freeze(p, true), revision: s.revision + 1 }));
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
      if (v.plantings) v.plantings = v.plantings.filter((z) => !ids.includes(z.id));
    });
  },
  addPlanting(z: PlantingZone) {
    useProjectStore.getState().update((p) => {
      const v = draftVariant(p);
      (v.plantings ??= []).push(z);
    });
  },
  updatePlanting(id: string, recipe: (z: Draft<PlantingZone>) => void) {
    useProjectStore.getState().update((p) => {
      const z = draftVariant(p).plantings?.find((x) => x.id === id);
      if (z) recipe(z);
    });
  },
  setContext(buildings: ContextBuilding[]) {
    useProjectStore.getState().update((p) => {
      p.context = buildings;
    });
  },
  setSurroundings(s: Surroundings) {
    useProjectStore.getState().update((p) => {
      p.surroundings = s;
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
  setActiveVariant(id: string) {
    useProjectStore.getState().update((p) => {
      if (p.variants.some((v) => v.id === id)) p.activeVariantId = id;
    });
  },
  updateInfo(recipe: (p: Draft<Project>) => void) {
    useProjectStore.getState().update(recipe);
  },
  rename(name: string) {
    useProjectStore.getState().update((p) => {
      p.name = name;
    });
  },
};
