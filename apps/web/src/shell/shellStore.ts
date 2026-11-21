import { create } from 'zustand';

export type DialogId = 'projectInfo' | 'settings' | 'constraints' | 'warnings';
export type RibbonTab =
  'file' | 'site' | 'volume' | 'modify' | 'view' | 'analysis' | 'output' | 'archicad' | 'context';

/** Shell-local UI state (dialogs, ribbon tab, error banner). Not part of the document. */
export interface ShellState {
  dialog: DialogId | null;
  tab: RibbonTab;
  /** Visible error message (already translated). */
  error: string | null;
  /** Short info message (e.g. "Enregistré"). */
  info: string | null;
  busy: boolean;
  setDialog: (d: DialogId | null) => void;
  setTab: (t: RibbonTab) => void;
  setError: (e: string | null) => void;
  setInfo: (i: string | null) => void;
  setBusy: (b: boolean) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  dialog: null,
  tab: 'volume',
  error: null,
  info: null,
  busy: false,
  setDialog: (dialog) => set({ dialog }),
  setTab: (tab) => set({ tab }),
  setError: (error) => set({ error }),
  setInfo: (info) => set({ info }),
  setBusy: (busy) => set({ busy }),
}));
