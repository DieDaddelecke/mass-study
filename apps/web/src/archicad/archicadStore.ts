import type { Project, Usage } from '@kubatur/core';
import { create } from 'zustand';
import { activeVariant } from '../store/projectStore';
import {
  BridgeClient,
  BridgeError,
  DEFAULT_BRIDGE_URL,
  type ArchicadInstance,
} from './bridgeClient';
import {
  buildPlan,
  DEFAULT_OPTIONS,
  type PlanOptions,
  type StorySetting,
  type TransferPlan,
  type ZoneLabels,
} from './plan';
import {
  applyStories,
  executePlan,
  readSnapshot,
  removeOwnElements,
  type ArchicadSnapshot,
  type TransferReport,
} from './transfer';

export type BridgeStatus = 'idle' | 'checking' | 'offline' | 'unpaired' | 'ready';

const TOKEN_KEY = 'kubatur.archicad.token';
const URL_KEY = 'kubatur.archicad.bridgeUrl';

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

interface ArchicadState {
  open: boolean;
  bridgeUrl: string;
  token: string;
  status: BridgeStatus;
  bridgeVersion?: string;
  instances: ArchicadInstance[];
  port?: number;
  snapshot?: ArchicadSnapshot;
  options: PlanOptions;
  mode: 'create' | 'replace';
  busy: boolean;
  progress?: { step: string; done: number; total: number };
  report?: TransferReport;
  removed?: number;
  /** Stories were adjusted in this session (shown as a confirmation). */
  storiesAdjusted?: boolean;
  error?: string;

  openDialog: () => void;
  close: () => void;
  setToken: (t: string) => void;
  setBridgeUrl: (u: string) => void;
  setOptions: (o: Partial<PlanOptions>) => void;
  setMode: (m: 'create' | 'replace') => void;
  connect: () => Promise<void>;
  selectInstance: (port: number, projectId: string) => Promise<void>;
  transfer: (project: Project, plan: TransferPlan) => Promise<void>;
  remove: (project: Project) => Promise<void>;
  /** Replaces the Archicad stories (test projects only; the bridge enforces it). */
  adjustStories: (project: Project, stories: StorySetting[]) => Promise<void>;
}

function client(s: Pick<ArchicadState, 'bridgeUrl' | 'token'>) {
  return new BridgeClient(s.bridgeUrl, s.token.trim());
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useArchicadStore = create<ArchicadState>((set, get) => ({
  open: false,
  bridgeUrl: load(URL_KEY, DEFAULT_BRIDGE_URL),
  token: load(TOKEN_KEY, ''),
  status: 'idle',
  instances: [],
  options: { ...DEFAULT_OPTIONS },
  mode: 'create',
  busy: false,

  openDialog: () => {
    set({ open: true, report: undefined, removed: undefined, error: undefined });
    if (get().status !== 'ready') void get().connect();
  },
  close: () => set({ open: false }),
  setToken: (token) => {
    store(TOKEN_KEY, token.trim());
    set({ token });
  },
  setBridgeUrl: (bridgeUrl) => {
    store(URL_KEY, bridgeUrl.trim());
    set({ bridgeUrl });
  },
  setOptions: (o) => set((s) => ({ options: { ...s.options, ...o } })),
  setMode: (mode) => set({ mode }),

  connect: async () => {
    set({ status: 'checking', error: undefined });
    const c = client(get());
    try {
      const h = await c.health();
      if (!h.authorized) {
        set({ status: 'unpaired', bridgeVersion: h.version, instances: [] });
        return;
      }
      const instances = await c.instances();
      const port = instances.some((i) => i.port === get().port) ? get().port : undefined;
      set({
        status: 'ready',
        bridgeVersion: h.version,
        instances,
        port,
        snapshot: port ? get().snapshot : undefined,
      });
    } catch (e) {
      set({
        status: e instanceof BridgeError && e.kind === 'unauthorized' ? 'unpaired' : 'offline',
        instances: [],
        error: e instanceof BridgeError && e.kind === 'unreachable' ? undefined : message(e),
      });
    }
  },

  selectInstance: async (port, projectId) => {
    set({
      port,
      snapshot: undefined,
      busy: true,
      error: undefined,
      report: undefined,
      removed: undefined,
      storiesAdjusted: undefined,
    });
    try {
      const snapshot = await readSnapshot(client(get()), port, projectId);
      set({ snapshot, mode: snapshot.ownElements > 0 ? 'replace' : 'create' });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  transfer: async (project, plan) => {
    const { port, mode } = get();
    if (port === undefined) return;
    set({
      busy: true,
      error: undefined,
      report: undefined,
      removed: undefined,
      progress: undefined,
    });
    try {
      const report = await executePlan(client(get()), port, plan, {
        projectId: project.id,
        mode,
        ...(get().snapshot?.zoneStamp ? { zoneStamp: get().snapshot!.zoneStamp! } : {}),
        onProgress: (step, done, total) => set({ progress: { step, done, total } }),
      });
      set({ report });
      const snapshot = await readSnapshot(client(get()), port, project.id);
      set({ snapshot, mode: snapshot.ownElements > 0 ? 'replace' : 'create' });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false, progress: undefined });
    }
  },

  remove: async (project) => {
    const { port } = get();
    if (port === undefined) return;
    set({ busy: true, error: undefined, report: undefined });
    try {
      const removed = await removeOwnElements(client(get()), port, project.id);
      const snapshot = await readSnapshot(client(get()), port, project.id);
      set({ removed, snapshot, mode: 'create' });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },

  adjustStories: async (project, stories) => {
    const { port } = get();
    if (port === undefined) return;
    set({ busy: true, error: undefined, report: undefined, storiesAdjusted: undefined });
    try {
      await applyStories(client(get()), port, stories);
      const snapshot = await readSnapshot(client(get()), port, project.id);
      set({ snapshot, storiesAdjusted: true });
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ busy: false });
    }
  },
}));

export function planFor(
  project: Project,
  snapshot: ArchicadSnapshot,
  options: PlanOptions,
  usageLabel: (u: Usage) => string,
  zoneLabels?: ZoneLabels,
): TransferPlan {
  return buildPlan({
    ...(zoneLabels ? { zoneLabels } : {}),
    project,
    masses: activeVariant(project).masses,
    stories: snapshot.stories,
    libraries: snapshot.libraries,
    isTeamwork: snapshot.isTeamwork,
    options,
    usageLabel,
  });
}
