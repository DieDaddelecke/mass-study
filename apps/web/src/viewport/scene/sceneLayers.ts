import { useMemo } from 'react';
import { useViewportStore, type ContextLayers } from '../viewportStore';

/**
 * Dev-only URL override of the context layers, for screenshots without the layers panel:
 * `?layers=basemap:plan,trees:0,parcels:1` (keys of ContextLayers; booleans as 0/1).
 */
function urlOverride(): Partial<ContextLayers> {
  if (!import.meta.env.DEV || typeof window === 'undefined') return {};
  const raw = new URLSearchParams(window.location.search).get('layers');
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split(':');
    if (!k || v == null) continue;
    out[k] = k === 'basemap' ? v : v === '1' || v === 'true';
  }
  return out as Partial<ContextLayers>;
}

const OVERRIDE = urlOverride();

/** Effective context layer visibility for the scene. */
export function useLayers(): ContextLayers {
  const layers = useViewportStore((s) => s.layers);
  return useMemo(() => ({ ...layers, ...OVERRIDE }), [layers]);
}
