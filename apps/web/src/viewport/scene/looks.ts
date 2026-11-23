import type { ScenePalette, ThemeName } from '../../theme/palette';
import { palette } from '../../theme/palette';
import type { VisualStyle } from '../../store/tools';

/** Styles drawn with lit faces: sun shadows and ambient occlusion apply to them. */
export const LIT_STYLES: ReadonlySet<VisualStyle> = new Set([
  'realistic',
  'consistentColors',
  'granulometry',
]);

/**
 * Scene "looks" (ambiances): colour palette, lighting, soft shadows and ambient occlusion of the
 * 3D view. Independent of the visual style (realistic, granulometry, …), which decides *what* is
 * drawn; the look decides how the model is lit and coloured.
 */
export type SceneLook = 'maquette' | 'bois' | 'diagramme';

export const SCENE_LOOKS: readonly SceneLook[] = ['maquette', 'bois', 'diagramme'];

export interface LookSpec {
  pal: ScenePalette;
  /** Background gradient: top of the screen → horizon. Also the fog colour (horizon). */
  sky: readonly [string, string];
  hemi: { sky: string; ground: string; intensity: number };
  ambient: number;
  sun: {
    color: string;
    intensity: number;
    /** Direction towards the sun as (east, north, up); normalised by the caller. */
    dir: readonly [number, number, number];
    /** PCF blur radius in shadow-map texels (soft shadow edge). */
    softness: number;
    /** 0 … 1, how dark shadows get. */
    shadowIntensity: number;
  };
  /** Screen-space ambient occlusion (contact shadows in corners); null = off. */
  ao: { intensity: number; radius: number; color: string } | null;
  /** Outline width of the project masses in pixels. */
  edgeWidth: number;
  /**
   * Opacity of the site fill. With ambient occlusion the scene is blended in linear space, where
   * transparent overlays look stronger, hence lower values there (dark backgrounds even more so).
   */
  siteFill: number;
  /**
   * Physical model materials (procedural textures): project masses in solid wood, neighbouring
   * buildings in cast plaster. Applies to the realistic style.
   */
  model?: boolean;
  /** Colour of the storey lines on the masses (default: the context edge colour). */
  storeyLine?: string;
}

/** South-south-east sun: shadows fall to the north-west, visible from the default SW view. */
const SUN_SSE: readonly [number, number, number] = [0.5, -1, 0.95];
/** Low east-south-east sun: long graphic shadows. */
const SUN_LOW: readonly [number, number, number] = [0.9, -0.5, 0.65];
/** Studio lamp from the south-south-east, fairly low: long soft shadows across the base. */
const SUN_STUDIO: readonly [number, number, number] = [0.45, -0.9, 0.6];

const base = (theme: ThemeName) => palette[theme];

const LOOKS: Record<SceneLook, Record<ThemeName, LookSpec>> = {
  /** White study model: everything in paper white, soft daylight, contact shadows. */
  maquette: {
    light: {
      pal: {
        ...base('light'),
        sky: '#f3f2ef',
        ground: '#e8e5de',
        contextBuilding: '#f6f5f2',
        contextEdge: '#a9a398',
        mass: '#ffffff',
        massEdge: '#2e3340',
        road: '#e3e0da',
        footway: '#e9e7e2',
        green: '#e0e6d6',
        wood: '#d5dec9',
        tree: '#c8d4bc',
        water: '#d6e0e8',
        parcel: '#aaa49a',
      },
      sky: ['#d9e1ea', '#f3f2ef'],
      hemi: { sky: '#ffffff', ground: '#d4cdc0', intensity: 1.4 },
      ambient: 0.3,
      sun: {
        color: '#fff6ea',
        intensity: 2.4,
        dir: SUN_SSE,
        softness: 7,
        shadowIntensity: 0.55,
      },
      ao: { intensity: 2.6, radius: 4, color: '#2a2722' },
      edgeWidth: 1.4,
      siteFill: 0.045,
    },
    dark: {
      pal: {
        ...base('dark'),
        sky: '#1a1e26',
        ground: '#1c2028',
        contextBuilding: '#30353f',
        contextEdge: '#4b5262',
        mass: '#eceef3',
        massEdge: '#0b0d12',
        road: '#252a33',
        footway: '#22262e',
        green: '#24302a',
        wood: '#26362c',
        tree: '#4d6b55',
        water: '#1f3040',
        parcel: '#5e6677',
      },
      sky: ['#0b0d12', '#1a1e26'],
      hemi: { sky: '#c9d4ea', ground: '#20242c', intensity: 1.0 },
      ambient: 0.2,
      sun: {
        color: '#fff1dc',
        intensity: 2.2,
        dir: SUN_SSE,
        softness: 7,
        shadowIntensity: 0.7,
      },
      ao: { intensity: 2.2, radius: 4, color: '#000000' },
      edgeWidth: 1.4,
      siteFill: 0.02,
    },
  },
  /**
   * Physical wood model: solid wood blocks with visible grain for the project, cast plaster
   * neighbours, on a plain studio background with soft lamp light and long soft shadows.
   */
  bois: {
    light: {
      pal: {
        ...base('light'),
        sky: '#ebe9e5',
        ground: '#e7e5e1',
        contextBuilding: '#f3f1ec',
        contextEdge: '#c9c4bb',
        mass: '#7d5a40',
        massEdge: '#b08d70',
        road: '#dfdcd6',
        footway: '#e3e1dc',
        green: '#dcddd2',
        wood: '#d3d6c6',
        tree: '#b48e57',
        water: '#d5dadb',
        parcel: '#bdb7ad',
      },
      sky: ['#dedcd8', '#ebe9e5'],
      hemi: { sky: '#ffffff', ground: '#d9d4cc', intensity: 1.25 },
      ambient: 0.32,
      sun: {
        color: '#fff4e6',
        intensity: 2.7,
        dir: SUN_STUDIO,
        softness: 10,
        shadowIntensity: 0.5,
      },
      ao: { intensity: 2.4, radius: 4, color: '#2c2520' },
      edgeWidth: 1,
      siteFill: 0.035,
      model: true,
      storeyLine: '#5e4332',
    },
    dark: {
      pal: {
        ...base('dark'),
        sky: '#2c2d2b',
        ground: '#30312f',
        contextBuilding: '#d9d6d0',
        contextEdge: '#55554f',
        mass: '#7d5a40',
        massEdge: '#a07f64',
        road: '#363734',
        footway: '#333431',
        green: '#33372f',
        wood: '#363b31',
        tree: '#a07c4b',
        water: '#2f3638',
        parcel: '#6a6861',
      },
      sky: ['#202120', '#2c2d2b'],
      hemi: { sky: '#f2eee8', ground: '#30312f', intensity: 1.0 },
      ambient: 0.22,
      sun: {
        color: '#fff1de',
        intensity: 2.6,
        dir: SUN_STUDIO,
        softness: 10,
        shadowIntensity: 0.65,
      },
      ao: { intensity: 2.2, radius: 4, color: '#000000' },
      edgeWidth: 1,
      siteFill: 0.02,
      model: true,
      storeyLine: '#5e4332',
    },
  },
  /** Graphic axonometry: coloured project against a quiet, light grey context, long shadows. */
  diagramme: {
    light: {
      pal: {
        ...base('light'),
        sky: '#fbfbfd',
        ground: '#fafafb',
        contextBuilding: '#eef0f3',
        contextEdge: '#d3d7de',
        mass: '#f6b48f',
        massEdge: '#5a2e1a',
        road: '#eceef2',
        footway: '#f3f4f7',
        green: '#dcefdc',
        wood: '#c8e5c9',
        tree: '#a3d3ab',
        water: '#d3e5f8',
        parcel: '#c3c8d2',
      },
      sky: ['#e6ebf7', '#fbfbfd'],
      hemi: { sky: '#ffffff', ground: '#e6e2dc', intensity: 1.9 },
      ambient: 0.35,
      sun: {
        color: '#ffffff',
        intensity: 2.2,
        dir: SUN_LOW,
        softness: 2.5,
        shadowIntensity: 0.35,
      },
      ao: { intensity: 1.6, radius: 3, color: '#1d2233' },
      edgeWidth: 1.2,
      siteFill: 0.045,
    },
    dark: {
      pal: {
        ...base('dark'),
        sky: '#161a2a',
        ground: '#141826',
        contextBuilding: '#232a3e',
        contextEdge: '#323a54',
        mass: '#ff9f70',
        massEdge: '#24120a',
        road: '#1c2133',
        footway: '#191d2d',
        green: '#1b3328',
        wood: '#1f3a2c',
        tree: '#3f7a57',
        water: '#1b3252',
        parcel: '#4a5370',
      },
      sky: ['#0b0e1a', '#161a2a'],
      hemi: { sky: '#d9def5', ground: '#141826', intensity: 1.1 },
      ambient: 0.25,
      sun: {
        color: '#ffffff',
        intensity: 2.0,
        dir: SUN_LOW,
        softness: 2.5,
        shadowIntensity: 0.55,
      },
      ao: { intensity: 1.6, radius: 3, color: '#000000' },
      edgeWidth: 1.2,
      siteFill: 0.02,
    },
  },
};

export function lookSpec(look: SceneLook, theme: ThemeName): LookSpec {
  return (LOOKS[look] ?? LOOKS.maquette)[theme];
}
