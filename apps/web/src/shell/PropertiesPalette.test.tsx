import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '../i18n';
import { palaiseauDemo } from '../demo/palaiseau';
import { activeVariant, undo, useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { PropertiesPalette } from './PropertiesPalette';

describe('properties palette', () => {
  afterEach(cleanup);

  it('commits a numeric edit on Enter as exactly one undo step', () => {
    useProjectStore.getState().load(palaiseauDemo());
    const mass = activeVariant(useProjectStore.getState().project!).masses[0]!;
    useUiStore.getState().setSelection([mass.id]);
    render(<PropertiesPalette />);

    const input = screen.getByLabelText('Étages') as HTMLInputElement;
    expect(input.value).toBe('4');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.change(input, { target: { value: '7' } });
    // nothing committed while typing
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    const p = () => activeVariant(useProjectStore.getState().project!).masses[0]!;
    expect(p().storeys.upper.count).toBe(7);
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(1);
    undo();
    expect(p().storeys.upper.count).toBe(4);
  });

  it('accepts French decimal commas', () => {
    useProjectStore.getState().load(palaiseauDemo());
    const mass = activeVariant(useProjectStore.getState().project!).masses[0]!;
    useUiStore.getState().setSelection([mass.id]);
    render(<PropertiesPalette />);
    const input = screen.getByLabelText('Hauteur RDC') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '4,25' } });
    fireEvent.blur(input);
    expect(
      activeVariant(useProjectStore.getState().project!).masses[0]!.storeys.ground.height,
    ).toBe(4.25);
  });
});
