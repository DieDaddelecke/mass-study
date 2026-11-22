import { create } from 'zustand';
import type { Basemap } from '../api/contract';
import { SCENE_LOOKS, type SceneLook } from './scene/looks';

const LOOK_KEY = 'kubatur.sceneLook';

function readLook(): SceneLook {
  if (typeof window === 'undefined') return 'maquette';
  // `?look=…` overrides the stored choice (screenshots, links).
  const q = new URLSearchParams(window.location.search).get('look');
  if (q && (SCENE_LOOKS as readonly string[]).includes(q)) return q as SceneLook;
  try {
    const v = localStorage.getItem(LOOK_KEY);
    if (v && (SCENE_LOOKS as readonly string[]).includes(v)) return v as SceneLook;
  } catch {
    /* storage unavailable */
  }
  return 'maquette';
}

/** Visibility of context layers in the 3D view (per session; not stored in the project). */
export interface ContextLayers {
  buildings: boolean;
  roads: boolean;
  green: boolean;
  trees: boolean;
  water: boolean;
  parcels: boolean;
  /** Ground texture from IGN tiles, or none. */
  basemap: Basemap | 'none';
}

export const DEFAULT_LAYERS: ContextLayers = {
  buildings: true,
  roads: true,
  green: true,
  trees: true,
  water: true,
  parcels: true,
  basemap: 'none',
};

/**
 * Coordination between the 3D scene (viewport/*) and the modelling tools (viewport/tools/*).
 * Owned by the scene module; tools may only call the setters documented here.
 */
export interface ViewportState {
  /** Camera controls are disabled while a tool drags (grips, move). */
  controlsEnabled: boolean;
  setControlsEnabled: (v: boolean) => void;
  /** Incremented to request "zoom extents" (ZF) from anywhere (ribbon, shortcut). */
  zoomExtentsRequest: number;
  requestZoomExtents: () => void;
  /** Incremented to request the Home view (SW isometric fitting site + masses + nearby context). */
  homeRequest: number;
  requestHome: () => void;
  /** Sun light with shadows (used by the "realistic" visual style). */
  sunEnabled: boolean;
  setSunEnabled: (v: boolean) => void;
  /** Context layer visibility (layers panel in the shell, rendering in viewport/scene). */
  layers: ContextLayers;
  setLayer: <K extends keyof ContextLayers>(key: K, value: ContextLayers[K]) => void;
  /** Ambiance of the 3D view (lighting, colours, soft shadows, ambient occlusion); per browser. */
  look: SceneLook;
  setLook: (look: SceneLook) => void;
}

export const useViewportStore = create<ViewportState>()((set) => ({
  controlsEnabled: true,
  setControlsEnabled: (controlsEnabled) => set({ controlsEnabled }),
  zoomExtentsRequest: 0,
  requestZoomExtents: () => set((s) => ({ zoomExtentsRequest: s.zoomExtentsRequest + 1 })),
  homeRequest: 0,
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1 })),
  sunEnabled: true,
  setSunEnabled: (sunEnabled) => set({ sunEnabled }),
  layers: DEFAULT_LAYERS,
  setLayer: (key, value) => set((s) => ({ layers: { ...s.layers, [key]: value } })),
  look: readLook(),
  setLook: (look) => {
    try {
      localStorage.setItem(LOOK_KEY, look);
    } catch {
      /* storage unavailable */
    }
    set({ look });
  },
}));
