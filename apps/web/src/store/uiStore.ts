import { create } from 'zustand';
import type { SnapSettings, ToolState, ViewId, VisualStyle } from './tools';

export interface UiState {
  selection: string[];
  hover: string | null;
  tool: ToolState;
  activeView: ViewId;
  openViews: ViewId[];
  visualStyle: VisualStyle;
  projection: 'perspective' | 'orthographic';
  snap: SnapSettings;
  /** Status bar hint (already translated). */
  hint: string;
  /** Cursor position in model coordinates (m). */
  cursor: [number, number] | null;
  newProjectOpen: boolean;
  /** Context radius (m) used when loading surroundings. */
  contextRadius: number;

  setSelection: (ids: string[]) => void;
  setHover: (id: string | null) => void;
  setTool: (t: ToolState) => void;
  openView: (v: ViewId) => void;
  closeView: (v: ViewId) => void;
  setVisualStyle: (s: VisualStyle) => void;
  setProjection: (p: UiState['projection']) => void;
  setSnap: (s: Partial<SnapSettings>) => void;
  setHint: (h: string) => void;
  setCursor: (c: [number, number] | null) => void;
  setNewProjectOpen: (o: boolean) => void;
  setContextRadius: (r: number) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  selection: [],
  hover: null,
  tool: { kind: 'select' },
  activeView: '3d',
  openViews: ['3d'],
  visualStyle: 'shaded',
  projection: 'perspective',
  snap: {
    enabled: true,
    endpoints: true,
    midpoints: true,
    edges: true,
    angle: true,
    angleStep: 15,
    grid: true,
    gridSize: 0.5,
  },
  hint: '',
  cursor: null,
  newProjectOpen: false,
  contextRadius: 150,

  setSelection: (ids) => set({ selection: ids }),
  setHover: (id) => set({ hover: id }),
  setTool: (tool) => set({ tool }),
  openView: (v) =>
    set((s) => ({
      activeView: v,
      openViews: s.openViews.includes(v) ? s.openViews : [...s.openViews, v],
    })),
  closeView: (v) =>
    set((s) => {
      const openViews = s.openViews.filter((x) => x !== v);
      return { openViews, activeView: s.activeView === v ? (openViews[0] ?? '3d') : s.activeView };
    }),
  setVisualStyle: (visualStyle) => set({ visualStyle }),
  setProjection: (projection) => set({ projection }),
  setSnap: (s) => set((st) => ({ snap: { ...st.snap, ...s } })),
  setHint: (hint) => set({ hint }),
  setCursor: (cursor) => set({ cursor }),
  setNewProjectOpen: (newProjectOpen) => set({ newProjectOpen }),
  setContextRadius: (contextRadius) => set({ contextRadius }),
}));
