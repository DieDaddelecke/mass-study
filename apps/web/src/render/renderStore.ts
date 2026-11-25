import { create } from 'zustand';
import type { RenderProviderId } from '../api/contract';
import type { FacadeMaterial, RenderStyle } from './prompt';

/**
 * AI rendering: settings (this browser only, never in the project file) and the session's
 * captures/results. API keys stay in localStorage of this computer and go only to our own server,
 * which forwards them to the provider.
 */

const STORAGE_KEY = 'kubatur.render';

export interface RenderSettings {
  provider: RenderProviderId;
  keys: Partial<Record<RenderProviderId, string>>;
  models: Partial<Record<RenderProviderId, string>>;
  rememberKeys: boolean;
  style: RenderStyle;
  material: FacadeMaterial;
  animate: boolean;
  /** 0–1 */
  fidelity: number;
  /** The user confirmed that each rendering is billed by the provider. */
  paidOk: boolean;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  provider: 'gemini',
  keys: {},
  models: {},
  rememberKeys: true,
  style: 'photo',
  material: 'auto',
  animate: true,
  fidelity: 0.75,
  paidOk: false,
};

function load(): RenderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_RENDER_SETTINGS, ...(JSON.parse(raw) as Partial<RenderSettings>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_RENDER_SETTINGS;
}

function save(s: RenderSettings) {
  try {
    const stored = s.rememberKeys ? s : { ...s, keys: {} };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* ignore */
  }
}

export interface Capture {
  image: string;
  width: number;
  height: number;
}

export interface RenderResult {
  id: string;
  image: string;
  provider: RenderProviderId;
  model: string;
  prompt: string;
  at: string;
}

interface RenderState {
  settings: RenderSettings;
  capture: Capture | null;
  results: RenderResult[];
  update: (p: Partial<RenderSettings>) => void;
  setCapture: (c: Capture | null) => void;
  addResult: (r: RenderResult) => void;
}

export const useRenderStore = create<RenderState>()((set, get) => ({
  settings: load(),
  capture: null,
  results: [],
  update: (p) => {
    const settings = { ...get().settings, ...p };
    save(settings);
    set({ settings });
  },
  setCapture: (capture) => set({ capture }),
  // newest first, the session keeps the last 12
  addResult: (r) => set({ results: [r, ...get().results].slice(0, 12) }),
}));
