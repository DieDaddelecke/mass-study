import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { palette, type ScenePalette, type ThemeName } from './palette';

export type ThemePreference = ThemeName | 'system';

const KEY = 'kubatur.theme';

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

/** Light / dark / system preference (persisted per browser). The shell applies it as data-theme. */
export const useThemeStore = create<ThemeState>()((set) => ({
  preference: typeof window === 'undefined' ? 'system' : readPreference(),
  setPreference: (preference) => {
    try {
      localStorage.setItem(KEY, preference);
    } catch {
      /* storage unavailable */
    }
    set({ preference });
  },
}));

function systemDark(): boolean {
  return (
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

/** The effective theme, following the OS setting when the preference is "system". */
export function useResolvedTheme(): ThemeName {
  const preference = useThemeStore((s) => s.preference);
  const [dark, setDark] = useState(systemDark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return preference === 'system' ? (dark ? 'dark' : 'light') : preference;
}

/** Scene colours for the effective theme (3D view, map). */
export function useScenePalette(): ScenePalette {
  return palette[useResolvedTheme()];
}
