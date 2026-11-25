import { create } from 'zustand';

export type DialogId =
  | 'projectInfo'
  | 'settings'
  | 'constraints'
  | 'warnings'
  | 'ifcExport'
  | 'dossier'
  | 'render'
  | 'autoStudy';
export type LeftTab = 'project' | 'layers' | 'views';

function wideScreen(): boolean {
  return typeof window === 'undefined' || window.innerWidth >= 1200;
}

/** Shell-local UI state (dialogs, panels, toasts). Not part of the document. */
export interface ShellState {
  dialog: DialogId | null;
  /** Visible error message (already translated), shown as a toast. */
  error: string | null;
  /** Short info message (e.g. "Enregistré"), shown as a toast. */
  info: string | null;
  busy: boolean;
  /** Command palette (Ctrl+K). */
  paletteOpen: boolean;
  leftOpen: boolean;
  leftTab: LeftTab;
  inspectorOpen: boolean;
  setDialog: (d: DialogId | null) => void;
  setError: (e: string | null) => void;
  setInfo: (i: string | null) => void;
  setBusy: (b: boolean) => void;
  setPaletteOpen: (o: boolean) => void;
  setLeftOpen: (o: boolean) => void;
  setLeftTab: (t: LeftTab) => void;
  setInspectorOpen: (o: boolean) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  dialog: null,
  error: null,
  info: null,
  busy: false,
  paletteOpen: false,
  // Panels start collapsed on small screens so the 3D view stays usable.
  leftOpen: wideScreen(),
  leftTab: 'project',
  inspectorOpen: wideScreen(),
  setDialog: (dialog) => set({ dialog }),
  setError: (error) => set({ error }),
  setInfo: (info) => set({ info }),
  setBusy: (busy) => set({ busy }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
}));
