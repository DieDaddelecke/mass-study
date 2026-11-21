/**
 * Shared colour palette for JS consumers (3D scene, map). CSS uses the same values as custom
 * properties in theme/tokens.css – keep both in sync.
 */
export const palette = {
  accent: '#6366f1',
  accent2: '#8b5cf6',
  ok: '#10b981',
  warning: '#f59e0b',
  error: '#f43f5e',
  light: {
    sky: '#eef1f7',
    ground: '#f4f5f7',
    contextBuilding: '#e4e7ec',
    contextEdge: '#9aa3b2',
    mass: '#ffffff',
    massEdge: '#1f2433',
    road: '#d5d9e0',
    footway: '#e6e8ec',
    green: '#d7ead3',
    wood: '#bfdcb8',
    tree: '#8fbf86',
    water: '#bcd7f0',
    parcel: '#8a93a6',
    site: '#e11d48',
  },
  dark: {
    sky: '#0f1117',
    ground: '#171a22',
    contextBuilding: '#2a2f3b',
    contextEdge: '#566074',
    mass: '#e8eaf2',
    massEdge: '#0b0d12',
    road: '#2b303c',
    footway: '#242833',
    green: '#1f3326',
    wood: '#24402c',
    tree: '#3f7a4a',
    water: '#1c3550',
    parcel: '#6b7487',
    site: '#fb7185',
  },
} as const;

export type ThemeName = 'light' | 'dark';
export type ScenePalette = Record<keyof (typeof palette)['light'], string>;
