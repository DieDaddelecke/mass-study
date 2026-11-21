import type { TemplateId, Typology, TypologyKind, Usage } from '@kubatur/core';

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
  | { kind: 'align' }
  /** Draw the site boundary in the model (used when no cadastre is available). */
  | { kind: 'drawSite' }
  /** Draw a context building footprint. */
  | { kind: 'drawContext'; height: number };

export type ToolKind = ToolState['kind'];

export type VisualStyle = 'wireframe' | 'hiddenLine' | 'shaded' | 'consistentColors' | 'realistic';

/** Views. Only `3d` is implemented in phase 3; 2D views arrive with the drawing engine (P6). */
export type ViewId =
  | '3d'
  | 'axoSW'
  | 'axoNE'
  | 'site'
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
}
