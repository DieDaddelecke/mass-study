import type { Project } from '@kubatur/core';
import { create } from 'zustand';
import { undo, useProjectStore } from '../../store/projectStore';
import { parseTyped } from './math';

/**
 * Typed value of the current (or last) direct edit — SketchUp's "measurements box".
 * While a façade, the storeys, the rotation or the whole volume is dragged, typing a number and
 * Enter sets the exact value. After the drag, typing still corrects the last edit (replacing it in
 * the undo history) until another interaction starts.
 */
export interface ValueEdit {
  /** Translated label, e.g. "Épaisseur". */
  label: string;
  unit: string;
  /** Current value (shown while nothing is typed). */
  value: number;
  decimals: number;
  at: [number, number, number];
  /** Applies an exact value, starting from the state before the drag. */
  apply: (v: number) => void;
  /** Called on Enter during a drag (ends the drag without committing the pointer value). */
  abortDrag?: () => void;
  /** Project state right after the committed drag (undo target for a correction). */
  committed?: Project | null;
}

interface ValueEditState {
  edit: ValueEdit | null;
  typed: string;
  set: (e: ValueEdit | null) => void;
  patch: (p: Partial<ValueEdit>) => void;
  setTyped: (t: string) => void;
}

export const useValueEdit = create<ValueEditState>()((set) => ({
  edit: null,
  typed: '',
  set: (edit) => set({ edit, typed: '' }),
  patch: (p) => set((s) => (s.edit ? { edit: { ...s.edit, ...p } } : s)),
  setTyped: (typed) => set({ typed }),
}));

/** Typed value of the active edit, or null. */
export function typedValue(): number | null {
  const s = useValueEdit.getState();
  return s.typed ? parseTyped(s.typed) : null;
}

/** Mark the current edit as committed (the next typed value replaces it). */
export function markCommitted() {
  useValueEdit.getState().patch({ committed: useProjectStore.getState().project });
}

/**
 * Apply a typed value to the current edit: during a drag the drag ends and the value is applied;
 * after a drag, the drag is undone first so that the correction is a single undo step.
 */
export function applyTyped(v: number): boolean {
  const st = useValueEdit.getState();
  const e = st.edit;
  if (!e) return false;
  if (e.abortDrag) e.abortDrag();
  else if (e.committed && useProjectStore.getState().project === e.committed) undo();
  e.apply(v);
  st.set({ ...e, value: v, abortDrag: undefined, committed: useProjectStore.getState().project });
  return true;
}

/**
 * Keyboard handling of the measurements box: digits, separator, minus, Backspace, Enter, Esc.
 * Returns true when the key was consumed.
 */
export function valueEditKey(key: string): boolean {
  const st = useValueEdit.getState();
  if (!st.edit) return false;
  if (/^[0-9.,]$/.test(key) || (key === '-' && !st.typed)) {
    st.setTyped(st.typed + key);
    return true;
  }
  if (key === 'Backspace' && st.typed) {
    st.setTyped(st.typed.slice(0, -1));
    return true;
  }
  if (key === 'Enter' && st.typed) {
    const v = parseTyped(st.typed);
    if (v === null) {
      st.setTyped('');
      return true;
    }
    return applyTyped(v);
  }
  if (key === 'Escape' && st.typed) {
    st.setTyped('');
    return true;
  }
  return false;
}
