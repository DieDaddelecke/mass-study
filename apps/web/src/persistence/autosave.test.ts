import { createProject, parseProject } from '@kubatur/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../store/projectStore';
import {
  AUTOSAVE_DELAY,
  deleteRecent,
  listRecent,
  loadRecent,
  memoryStore,
  projectKey,
  saveRecent,
  startAutosave,
} from './autosave';
import { projectFileName, readProjectFile } from './file';

const mk = (name: string) => createProject({ name, lonLat: [2.2, 48.7] });

describe('autosave persistence', () => {
  it('stores serialized projects and keeps an index sorted by date', async () => {
    const kv = memoryStore();
    const a = mk('A');
    const b = mk('B');
    await saveRecent(a, kv, new Date('2026-01-01T10:00:00Z'));
    await saveRecent(b, kv, new Date('2026-01-02T10:00:00Z'));
    expect((await listRecent(kv)).map((e) => e.name)).toEqual(['B', 'A']);
    expect(typeof kv.data.get(projectKey(a.id))).toBe('string');

    await saveRecent({ ...a, name: 'A2' }, kv, new Date('2026-01-03T10:00:00Z'));
    const list = await listRecent(kv);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: a.id, name: 'A2' });
    expect((await loadRecent(a.id, kv)).name).toBe('A2');

    await deleteRecent(b.id, kv);
    expect((await listRecent(kv)).map((e) => e.id)).toEqual([a.id]);
    await expect(loadRecent(b.id, kv)).rejects.toThrow();
  });

  describe('debounced autosave', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('saves once, 1 s after the last change', async () => {
      const kv = memoryStore();
      const stop = startAutosave(kv);
      useProjectStore.getState().load(mk('P'));
      useProjectStore.getState().update((p) => void (p.name = 'P1'));
      useProjectStore.getState().update((p) => void (p.name = 'P2'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 10);
      expect(kv.data.size).toBe(0);
      await vi.advanceTimersByTimeAsync(20);
      const list = await listRecent(kv);
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe('P2');
      stop();
    });
  });

  it('reads project files and rejects invalid ones', async () => {
    const p = mk('Fichier');
    const ok = await readProjectFile(new Blob([JSON.stringify(p)]));
    expect(ok.id).toBe(p.id);
    await expect(readProjectFile(new Blob(['{"foo":1}']))).rejects.toThrow();
    await expect(readProjectFile(new Blob(['not json']))).rejects.toThrow();
    expect(parseProject(JSON.stringify(p)).name).toBe('Fichier');
    expect(projectFileName('Palaiseau / A')).toBe('Palaiseau _ A.massing.json');
  });
});
