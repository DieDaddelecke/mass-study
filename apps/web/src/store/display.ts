import type { SceneLook } from '../viewport/scene/looks';
import { useViewportStore } from '../viewport/viewportStore';
import type { VisualStyle } from './tools';
import { useUiStore } from './uiStore';

/**
 * Display modes of the 3D view: one menu ("Affichage") instead of a visual style and a scene look.
 * Each mode is a fixed pair of both; the colour-coded modes use the calm white model around them.
 */
export type DisplayMode = 'maquette' | 'bois' | 'diagramme' | 'usages' | 'granulometrie';

export const DISPLAY_MODES: readonly DisplayMode[] = [
  'maquette',
  'bois',
  'diagramme',
  'usages',
  'granulometrie',
];

const MODES: Record<DisplayMode, { style: VisualStyle; look: SceneLook }> = {
  maquette: { style: 'realistic', look: 'maquette' },
  bois: { style: 'realistic', look: 'bois' },
  diagramme: { style: 'realistic', look: 'diagramme' },
  usages: { style: 'consistentColors', look: 'maquette' },
  granulometrie: { style: 'granulometry', look: 'maquette' },
};

/** The display mode a style / look pair belongs to. */
export function displayModeOf(style: VisualStyle, look: SceneLook): DisplayMode {
  if (style === 'consistentColors') return 'usages';
  if (style === 'granulometry') return 'granulometrie';
  return look;
}

export function setDisplayMode(mode: DisplayMode) {
  const m = MODES[mode];
  useUiStore.getState().setVisualStyle(m.style);
  useViewportStore.getState().setLook(m.look);
}

export function useDisplayMode(): DisplayMode {
  const style = useUiStore((s) => s.visualStyle);
  const look = useViewportStore((s) => s.look);
  return displayModeOf(style, look);
}
