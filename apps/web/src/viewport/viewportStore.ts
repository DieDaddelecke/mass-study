import { create } from 'zustand';

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
}));
