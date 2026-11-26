import { create } from 'zustand';
import type { RenderProviderId } from '../api/contract';
import type { FacadeMaterial, RenderStyle } from './prompt';

/**
 * AI rendering: settings (this browser only, never in the project file) and the session's
 * captures/results. API keys stay in localStorage of this computer and go only to our own server,
 * which forwards them to the provider.
 */

const STORAGE_KEY = 'kubatur.render';
/**
 * Version of the stored defaults. v2: free mode is the default again (fidelity 0.6); settings
 * saved before keep key, provider and model but get the new fidelity.
 */
const SETTINGS_VERSION = 2;

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
  /** Send the line drawing as a second image (Gemini, OpenRouter). */
  useGuide: boolean;
  /** Fixed seed for series from the same view; empty = random. */
  seed: string;
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  provider: 'openrouter',
  keys: {},
  models: {},
  rememberKeys: true,
  style: 'photo',
  material: 'auto',
  animate: true,
  fidelity: 0.6,
  paidOk: false,
  useGuide: true,
  seed: '',
};

function load(): RenderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<RenderSettings> & { v?: number };
      // older defaults: drop the remembered fidelity so the new default applies
      if ((stored.v ?? 1) < SETTINGS_VERSION) delete stored.fidelity;
      delete stored.v;
      return { ...DEFAULT_RENDER_SETTINGS, ...stored };
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_RENDER_SETTINGS;
}

function save(s: RenderSettings) {
  try {
    const stored = s.rememberKeys ? s : { ...s, keys: {} };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, v: SETTINGS_VERSION }));
  } catch {
    /* ignore */
  }
}

export interface Capture {
  image: string;
  width: number;
  height: number;
  /** Aspect ratio sent to the provider, e.g. "16:9" (the capture is cropped to it). */
  ratio?: string;
  /** Line drawing of the view (black on white), sent as a second image to keep the geometry. */
  guide?: string;
  /** The same lines in red on transparent, laid over a result to check the drift. */
  overlay?: string;
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
