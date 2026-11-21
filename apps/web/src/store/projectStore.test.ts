import { createMass, createProject } from '@kubatur/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { actions, activeVariant, redo, undo, useProjectStore } from './projectStore';

describe('project store', () => {
  beforeEach(() => {
    useProjectStore.getState().load(createProject({ name: 'T', lonLat: [2.2, 48.7] }));
  });

  it('adds, updates and deletes masses with undo/redo', () => {
    const m = createMass('zeile');
    actions.addMass(m);
    actions.updateMass(m.id, (d) => {
      d.storeys.upper.count = 6;
    });
    const p = () => useProjectStore.getState().project!;
    expect(activeVariant(p()).masses[0]!.storeys.upper.count).toBe(6);
    undo();
    expect(activeVariant(p()).masses[0]!.storeys.upper.count).toBe(4);
    undo();
    expect(activeVariant(p()).masses).toHaveLength(0);
    redo();
    expect(activeVariant(p()).masses).toHaveLength(1);
    actions.deleteMasses([m.id]);
    expect(activeVariant(p()).masses).toHaveLength(0);
  });

  it('keeps at least 100 undo steps and clears history on load', () => {
    const m = createMass('solitaer');
    actions.addMass(m);
    for (let i = 0; i < 120; i++) actions.updateMass(m.id, (d) => void (d.rotation = i));
    expect(useProjectStore.temporal.getState().pastStates.length).toBeGreaterThanOrEqual(100);
    useProjectStore.getState().load(createProject({ name: 'U', lonLat: [2.2, 48.7] }));
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(0);
  });
});
