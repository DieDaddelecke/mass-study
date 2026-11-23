import type { LayoutSpace, SpaceKind } from '@kubatur/core';

/** Colours of the residence unit types (Wohnheim). */
export const RESIDENCE_COLORS: Record<string, string> = {
  'rs-studio': '#f3cf8e',
  'rs-pmr': '#9fd0c2',
  'rs-corner': '#e9a3a0',
};

/** Fill colours of the spaces of residences and offices. */
export const SPACE_COLORS: Record<SpaceKind, string> = {
  sde: '#d9e7f1',
  entree: '#f2efe8',
  kitchenette: '#ffffff',
  gaine: '#8d8f95',
  accueil: '#c9b8e3',
  laverie: '#b9d3e6',
  salleCommune: '#d6c3ea',
  openSpace: '#bcd5ee',
  bureau: '#a6c7e8',
  reunion: '#f0c987',
  sanitaires: '#d9e7f1',
  hall: '#d8cfee',
};

/** Short labels (French plan convention). */
export const SPACE_LABELS: Record<SpaceKind, string> = {
  sde: 'SDE',
  entree: 'entr.',
  kitchenette: 'kitch.',
  gaine: 'g.',
  accueil: 'Accueil',
  laverie: 'Laverie',
  salleCommune: 'Salle commune',
  openSpace: 'Open space',
  bureau: 'Bur.',
  reunion: 'Réunion',
  sanitaires: 'Sanit.',
  hall: "Hall d'accueil",
};

/** Smallest area for a label of a space, m². */
export const spaceLabelMinArea = (s: Pick<LayoutSpace, 'kind'>): number =>
  s.kind === 'sde' ? 3 : s.kind === 'gaine' || s.kind === 'kitchenette' ? Infinity : 6;
