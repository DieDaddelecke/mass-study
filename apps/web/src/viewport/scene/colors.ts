import type { Usage } from '@kubatur/core';

/** Usage colours for the "consistent colours" style (SPEC §10). */
export const USAGE_COLORS: Record<Usage, string> = {
  wohnen: '#f2d35b',
  buero: '#5b9bd9',
  gewerbe: '#e0605a',
  gemeinbedarf: '#9b72cf',
  parken: '#a9a9a9',
  technik: '#5e5e5e',
};

export function usageColor(u: Usage): string {
  return USAGE_COLORS[u] ?? '#cccccc';
}

export const COLORS = {
  selection: '#2F8BE6',
  massWarm: '#e7e1d6',
  massHidden: '#ffffff',
  massEdge: '#000000',
  storeyLine: '#555555',
  context: '#e2e2e2',
  contextEstimated: '#d8d4cc',
  contextEdge: '#8a8a8a',
  demolished: '#b5b5b5',
  ground: '#efefef',
  siteLine: '#c0392b',
  siteFill: '#f6e3c8',
} as const;
