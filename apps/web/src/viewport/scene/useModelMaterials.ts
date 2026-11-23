import type { Polygon, Project, SolidResult } from '@kubatur/core';
import { activeVariant } from '../../store/projectStore';
import { useEffect, useMemo, useRef } from 'react';
import type { MeshStandardMaterial } from 'three';
import {
  grainFrame,
  plasterMaterial,
  updateWood,
  woodMaterial,
  WOOD_SPECIES,
  type WoodBlock,
} from './modelMaterials';

export interface ModelMaterials {
  /** Wood of each mass (by id). */
  wood: ReadonlyMap<string, MeshStandardMaterial>;
  /** Wood of the balcony slabs (all masses together). */
  slabs: MeshStandardMaterial | null;
}

/**
 * Wood materials of the project masses for the model look. One material per mass, kept while the
 * mass exists and only re-parametrised (grain direction, origin) when it moves, so dragging a
 * mass neither allocates materials nor recompiles shaders.
 */
export function useWoodMaterials(
  project: Project,
  solids: readonly SolidResult[],
  enabled: boolean,
): ModelMaterials | null {
  const cache = useRef(new Map<string, MeshStandardMaterial>());
  const masses = activeVariant(project).masses;
  const result = useMemo(() => {
    const c = cache.current;
    if (!enabled) {
      for (const m of c.values()) m.dispose();
      c.clear();
      return null;
    }
    const fps = new Map<string, Polygon[]>();
    for (const { solid: s } of solids) {
      const l = fps.get(s.massId) ?? [];
      l.push(s.footprint);
      fps.set(s.massId, l);
    }
    const blocks = new Map<string, WoodBlock>();
    masses.forEach((m, i) => {
      const fp = fps.get(m.id);
      if (!fp) return;
      blocks.set(m.id, {
        ...grainFrame(fp),
        species: WOOD_SPECIES[i % WOOD_SPECIES.length]!,
        seed: i * 7 + 3,
      });
    });
    blocks.set(SLABS, {
      ...(blocks.values().next().value ?? { dir: [1, 0], origin: [0, 0] }),
      species: WOOD_SPECIES[0]!,
      seed: 41,
    });
    for (const [id, m] of c)
      if (!blocks.has(id)) {
        m.dispose();
        c.delete(id);
      }
    for (const [id, b] of blocks) {
      const m = c.get(id);
      if (m) updateWood(m, b);
      else c.set(id, woodMaterial(b));
    }
    const wood = new Map(c);
    const slabs = wood.get(SLABS) ?? null;
    wood.delete(SLABS);
    return { wood, slabs };
  }, [enabled, masses, solids]);
  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const m of c.values()) m.dispose();
      c.clear();
    };
  }, []);
  return result;
}

const SLABS = '\u0000slabs';

/** Cast plaster material of the neighbouring buildings (model look). */
export function usePlasterMaterial(color: string, enabled: boolean) {
  const m = useMemo(() => (enabled ? plasterMaterial(color) : null), [enabled, color]);
  useEffect(() => () => m?.dispose(), [m]);
  return m;
}
