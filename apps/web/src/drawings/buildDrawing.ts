import type { Project, VariantResult } from '@kubatur/core';
import {
  axonometry,
  defaultSections,
  drawingInput,
  elevation,
  section,
  sitePlan,
  type ColorScheme,
  type DrawingModel,
  type DrawingTexts,
} from '@kubatur/drawing';
import type { ViewId } from '../store/tools';

export type DrawingViewId = Exclude<ViewId, '3d' | 'areas'>;

export interface DrawingSettings {
  scheme: ColorScheme;
  neighbours: boolean;
  /** Show section lines A/B in the site plan. */
  sectionLines: boolean;
  texts?: Partial<DrawingTexts>;
}

/** Build the drawing model of a 2D view (pure; memoised by the caller). */
export function buildDrawing(
  view: DrawingViewId,
  project: Project,
  result: VariantResult,
  s: DrawingSettings,
): DrawingModel {
  const input = drawingInput(result);
  const common = {
    scheme: s.scheme,
    neighbours: s.neighbours,
    masses: input.masses,
    levels: input.levels,
    ...(s.texts ? { texts: s.texts } : {}),
  };
  const sections = defaultSections(project, input.solids);
  switch (view) {
    case 'site':
      return sitePlan(project, input.solids, {
        ...common,
        ...(s.sectionLines ? { sections } : {}),
      });
    case 'elevN':
    case 'elevE':
    case 'elevS':
    case 'elevW':
      return elevation(project, input.solids, view.slice(4) as 'N' | 'E' | 'S' | 'W', common);
    case 'sectionA':
    case 'sectionB':
      return section(project, input.solids, sections[view === 'sectionA' ? 0 : 1]!, 60, common);
    case 'axoSW':
      return axonometry(project, input.solids, 'SW', 'iso', common);
    case 'axoNE':
      return axonometry(project, input.solids, 'NE', 'iso', common);
  }
}
