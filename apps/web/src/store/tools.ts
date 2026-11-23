import type { PlantingKind, TemplateId, Typology, TypologyKind, Usage } from '@kubatur/core';

/**
 * Active tool (Revit-like). The ribbon / shortcuts set it, the options bar edits its parameters,
 * the 3D viewport executes it. Esc always returns to `select`.
 */
export type ToolState =
  | { kind: 'select' }
  /** Place a new mass. `typology` holds the parameters shown in the options bar. */
  | {
      kind: 'place';
      typologyKind: TypologyKind;
      typology: Typology;
      usage: Usage;
      template?: TemplateId;
    }
  | { kind: 'move' }
  | { kind: 'rotate' }
  | { kind: 'copy' }
  | { kind: 'mirror' }
  | { kind: 'array'; count: number }
  /** Align a façade (or the whole volume) on a reference edge. */
  | { kind: 'align'; mode?: 'facade' | 'volume' }
  /** Draw a vegetation zone. */
  | { kind: 'drawGreen'; plantingKind: PlantingKind }
  /** Draw the site boundary in the model (used when no cadastre is available). */
  | { kind: 'drawSite' }
  /** Draw a context building footprint. */
  | { kind: 'drawContext'; height: number };

export type ToolKind = ToolState['kind'];

/** Visual styles of the 3D view (filaire, lignes cachées and ombré were dropped in favour of these). */
export type VisualStyle = 'realistic' | 'consistentColors' | 'granulometry';

export const STYLES: readonly VisualStyle[] = ['realistic', 'consistentColors', 'granulometry'];

/**
 * Views. `3d` and `plan` are the editable working views (same scene and tools; `plan` looks
 * straight down in parallel projection with a storey selector); the others are dossier previews.
 */
export type ViewId =
  | '3d'
  | 'plan'
  | 'axoSW'
  | 'axoNE'
  | 'site'
  | 'floorPlan'
  | 'elevN'
  | 'elevE'
  | 'elevS'
  | 'elevW'
  | 'sectionA'
  | 'sectionB'
  | 'areas';

export interface SnapSettings {
  enabled: boolean;
  endpoints: boolean;
  midpoints: boolean;
  edges: boolean;
  angle: boolean;
  /** Angle step for angular snapping, degrees. */
  angleStep: number;
  grid: boolean;
  /** Grid size, m. */
  gridSize: number;
  /** Magnetic snapping of whole volumes and façades (hold Alt to suspend). */
  magnet: boolean;
}
