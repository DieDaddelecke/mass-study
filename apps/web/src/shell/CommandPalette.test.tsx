import * as Tooltip from '@radix-ui/react-tooltip';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../i18n';
import { palaiseauDemo } from '../demo/palaiseau';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useThemeStore } from '../theme/themeStore';
import { CommandPalette } from './CommandPalette';
import { filterCommands, fuzzyScore, getCommands } from './commandList';
import { openProject } from './commands';
import { useShellStore } from './shellStore';
import { useShortcuts } from './shortcuts';
import { ThemeToggle } from './TopBar';

function Harness() {
  useShortcuts();
  return <CommandPalette />;
}

describe('command palette', () => {
  beforeEach(() => {
    openProject(palaiseauDemo());
    useShellStore.getState().setPaletteOpen(false);
  });
  afterEach(cleanup);

  it('opens with Ctrl+K and closes with Escape', async () => {
    render(<Harness />);
    expect(screen.queryByRole('combobox')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    const input = await screen.findByRole('combobox');
    expect(useShellStore.getState().paletteOpen).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('filters commands and runs the highlighted one with Enter', async () => {
    useShellStore.getState().setPaletteOpen(true);
    render(<Harness />);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'deplacer' } });
    const opts = screen.getAllByRole('option');
    expect(opts[0]!.textContent).toContain('Déplacer');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useUiStore.getState().tool.kind).toBe('move');
    expect(useShellStore.getState().paletteOpen).toBe(false);
  });

  it('lists disabled commands but does not run them', () => {
    const cmds = getCommands();
    const ifc = cmds.find((c) => c.id === 'output.ifc')!;
    expect(ifc.enabled).toBe(false);
    expect(ifc.reason).toBe('en préparation');
    // every two-letter shortcut is reachable from the palette
    for (const code of ['MV', 'RO', 'CO', 'MM', 'AR', 'AL', 'DE', 'ZF'])
      expect(cmds.some((c) => c.shortcut === code)).toBe(true);
    expect(filterCommands(cmds, 'ZF')[0]!.id).toBe('view.zoomExtents');
  });

  it('scores fuzzy matches ignoring accents', () => {
    expect(fuzzyScore('rot', 'Rotation')).toBeGreaterThan(0);
    expect(fuzzyScore('elmt', 'Élément')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Rotation')).toBe(0);
  });

  it('places a typology from the palette', () => {
    getCommands()
      .find((c) => c.id === 'place.zeile')!
      .run();
    const tool = useUiStore.getState().tool;
    expect(tool.kind === 'place' && tool.typologyKind).toBe('zeile');
    expect(useProjectStore.getState().project).not.toBeNull();
  });
});

describe('theme toggle', () => {
  afterEach(cleanup);
  it('cycles light → dark → system', () => {
    useThemeStore.getState().setPreference('light');
    render(
      <Tooltip.Provider>
        <ThemeToggle />
      </Tooltip.Provider>,
    );
    const btn = screen.getByRole('button', { name: /Thème/ });
    fireEvent.click(btn);
    expect(useThemeStore.getState().preference).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Thème/ }));
    expect(useThemeStore.getState().preference).toBe('system');
    fireEvent.click(screen.getByRole('button', { name: /Thème/ }));
    expect(useThemeStore.getState().preference).toBe('light');
  });
});
