import { parseProject, serializeProject, type Project } from '@kubatur/core';
import { createStore, del, get, set } from 'idb-keyval';
import { useProjectStore } from '../store/projectStore';

/** Minimal key-value interface (IndexedDB in the app, a Map in tests). */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export interface RecentEntry {
  id: string;
  name: string;
  /** ISO timestamp of the last autosave. */
  savedAt: string;
}

export const INDEX_KEY = 'index';
export const projectKey = (id: string) => `project:${id}`;

let idb: KeyValueStore | null = null;
/** IndexedDB-backed store (lazily created, so tests and SSR never touch IndexedDB). */
export function idbStore(): KeyValueStore {
  if (!idb) {
    const store = createStore('kubatur', 'autosave');
    idb = {
      get: (k) => get(k, store),
      set: (k, v) => set(k, v, store),
      del: (k) => del(k, store),
    };
  }
  return idb;
}

export function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    del: async (k) => void data.delete(k),
  };
}

export async function listRecent(kv: KeyValueStore = idbStore()): Promise<RecentEntry[]> {
  const raw = await kv.get(INDEX_KEY);
  if (!Array.isArray(raw)) return [];
  return (raw as RecentEntry[])
    .filter((e) => typeof e?.id === 'string')
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function saveRecent(
  p: Project,
  kv: KeyValueStore = idbStore(),
  now: Date = new Date(),
): Promise<void> {
  await kv.set(projectKey(p.id), serializeProject(p));
  const list = (await listRecent(kv)).filter((e) => e.id !== p.id);
  list.unshift({ id: p.id, name: p.name, savedAt: now.toISOString() });
  await kv.set(INDEX_KEY, list);
}

export async function loadRecent(id: string, kv: KeyValueStore = idbStore()): Promise<Project> {
  const raw = await kv.get(projectKey(id));
  if (typeof raw !== 'string') throw new Error(`Autosave ${id} not found`);
  return parseProject(raw);
}

export async function deleteRecent(id: string, kv: KeyValueStore = idbStore()): Promise<void> {
  await kv.del(projectKey(id));
  await kv.set(
    INDEX_KEY,
    (await listRecent(kv)).filter((e) => e.id !== id),
  );
}

export const AUTOSAVE_DELAY = 1000;

/**
 * Debounced autosave: every `revision` change schedules a save of the current project after 1 s.
 * Returns an unsubscribe function.
 */
export function startAutosave(
  kv: KeyValueStore = idbStore(),
  onError: (e: unknown) => void = (e) => console.error('autosave failed', e),
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = useProjectStore.subscribe((s, prev) => {
    if (s.revision === prev.revision || !s.project) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const p = useProjectStore.getState().project;
      if (p) saveRecent(p, kv).catch(onError);
    }, AUTOSAVE_DELAY);
  });
  return () => {
    clearTimeout(timer);
    unsub();
  };
}
