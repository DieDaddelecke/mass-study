import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { api } from '../api/client';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { NewProjectDialog } from './NewProjectDialog';
import type { SiteMapProps } from './SiteMap';
import { completionResponse, contextResponse, parcelsResponse0518 } from './testFixtures';

// MapLibre needs WebGL: replace the map with a button that "clicks" at a fixed location.
vi.mock('./SiteMap', () => ({
  SiteMap: (p: SiteMapProps) => (
    <div data-testid="site-map">
      <button onClick={() => p.onClick([2.198, 48.7129])}>map-click</button>
      <span data-testid="map-parcels">{p.parcels.filter((x) => x.selected).length}</span>
    </div>
  ),
}));

describe('NewProjectDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useUiStore.getState().setNewProjectOpen(true);
    useProjectStore.getState().load(null);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows autocomplete results and enables "Créer le projet" once a parcel is selected', async () => {
    const complete = vi.spyOn(api, 'complete').mockResolvedValue(completionResponse);
    vi.spyOn(api, 'parcelsAt').mockResolvedValue(parcelsResponse0518);
    vi.spyOn(api, 'context').mockResolvedValue(contextResponse);
    render(<NewProjectDialog />);

    expect(screen.getByRole('dialog', { name: 'Nouveau projet' })).toBeTruthy();
    const create = screen.getByRole('button', { name: 'Créer le projet' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '27 bd thom' } });
    fireEvent.change(input, { target: { value: '27 bd thomas gob' } });
    expect(complete).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(complete).toHaveBeenCalledTimes(1); // debounced
    expect(complete.mock.calls[0]![0]).toBe('27 bd thomas gob');
    const option = await screen.findByText('27 Boulevard Thomas Gobert, 91120 Palaiseau');
    fireEvent.mouseDown(option);
    expect((input as HTMLInputElement).value).toBe('27 Boulevard Thomas Gobert, 91120 Palaiseau');
    expect(create.disabled).toBe(true); // address alone is not a site

    await act(async () => {
      fireEvent.click(screen.getByText('map-click'));
    });
    expect(await screen.findByText('Palaiseau 0H 0518')).toBeTruthy();
    expect(screen.getAllByText(/3\s341 m²/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('map-parcels').textContent).toBe('1');
    expect(create.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(create);
    });
    await vi.waitFor(() => expect(useProjectStore.getState().project).not.toBeNull());
    const p = useProjectStore.getState().project!;
    expect(p.name).toBe('27 Boulevard Thomas Gobert, 91120 Palaiseau');
    expect(p.info.address).toBe('27 Boulevard Thomas Gobert, 91120 Palaiseau');
    expect(p.context.some((b) => b.demolished)).toBe(true);
    expect(useUiStore.getState().newProjectOpen).toBe(false);
  });

  it('switches to drawing when the location has no cadastre', async () => {
    vi.spyOn(api, 'parcelsAt').mockResolvedValue({ parcels: [], covered: false });
    render(<NewProjectDialog />);
    await act(async () => {
      fireEvent.click(screen.getByText('map-click'));
    });
    expect(await screen.findByText(/Aucun cadastre disponible/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Dessiner' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
