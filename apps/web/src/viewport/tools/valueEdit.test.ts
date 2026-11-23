import { createMass, createProject } from '@kubatur/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { actions, activeVariant, undo, useProjectStore } from '../../store/projectStore';
import { markCommitted, useValueEdit, valueEditKey } from './valueEdit';

const count = () =>
  activeVariant(useProjectStore.getState().project!).masses[0]!.storeys.upper.count;

describe('measurements box', () => {
  let id = '';
  beforeEach(() => {
    useProjectStore.getState().load(createProject({ name: 'T', lonLat: [2.2, 48.7] }));
    const m = createMass('zeile');
    id = m.id;
    actions.addMass(m);
    useValueEdit.getState().set(null);
  });

  const setCount = (n: number) =>
    actions.updateMass(id, (d) => {
      d.storeys.upper.count = n;
    });

  it('ignores keys without an edit', () => {
    expect(valueEditKey('5')).toBe(false);
  });

  it('corrects the last drag as a single undo step', () => {
    useValueEdit.getState().set({
      label: 'Étages',
      unit: '',
      value: 4,
      decimals: 0,
      at: [0, 0, 0],
      apply: setCount,
    });
    setCount(6); // the drag
    markCommitted();
    expect(valueEditKey('9')).toBe(true);
    expect(useValueEdit.getState().typed).toBe('9');
    expect(valueEditKey('Enter')).toBe(true);
    expect(count()).toBe(9);
    undo();
    expect(count()).toBe(4);
  });

  it('during a drag, Enter ends the drag and applies the value', () => {
    let aborted = false;
    useValueEdit.getState().set({
      label: 'Étages',
      unit: '',
      value: 4,
      decimals: 0,
      at: [0, 0, 0],
      apply: setCount,
      abortDrag: () => {
        aborted = true;
      },
    });
    valueEditKey('7');
    valueEditKey('Enter');
    expect(aborted).toBe(true);
    expect(count()).toBe(7);
    expect(useValueEdit.getState().edit?.abortDrag).toBeUndefined();
  });

  it('Backspace and Escape edit the typed text', () => {
    useValueEdit.getState().set({
      label: 'L',
      unit: 'm',
      value: 1,
      decimals: 2,
      at: [0, 0, 0],
      apply: () => {},
    });
    valueEditKey('1');
    valueEditKey(',');
    valueEditKey('5');
    valueEditKey('Backspace');
    expect(useValueEdit.getState().typed).toBe('1,');
    expect(valueEditKey('Escape')).toBe(true);
    expect(useValueEdit.getState().typed).toBe('');
    expect(valueEditKey('Escape')).toBe(false);
  });
});
