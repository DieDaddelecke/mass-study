/**
 * Plan views for the dossier – the seam between the sheet composer and `@kubatur/drawing`.
 *
 * The composer (`sheets.ts`) only knows {@link PlanView}: an SVG string whose root carries
 * `width="<w>mm" height="<h>mm" viewBox` in mm (1 unit = 1 mm on paper, pen widths in mm), plus
 * scale and paper size. {@link buildPlanViews} builds the drawing models with the drawing package
 * (same calls as the 2D views in `drawings/buildDrawing.ts`), chooses the scale and renders them.
 */
import type { Project, ProjectAnalysis } from '@kubatur/core';
import {
  axonometry,
  chooseScale,
  defaultSections,
  drawingInput,
  elevation,
  measureDrawing,
  renderSvg,
  section,
  sitePlan,
  STANDARD_SCALES,
  type DrawingModel,
  type DrawingTexts,
} from '@kubatur/drawing';

export { STANDARD_SCALES };

export type PlanViewId =
  'site' | 'elevN' | 'elevE' | 'elevS' | 'elevW' | 'sectionA' | 'sectionB' | 'axoSW' | 'axoNE';

/** Dossier colour scheme: Concours (black) / Permis (red). */
export type ColourScheme = 'concours' | 'permis';

/** One drawn view, ready to be placed on a sheet. */
export interface PlanView {
  id: PlanViewId;
  /** i18n key (namespace `dossier`) of the view title. */
  titleKey: string;
  /** Scale denominator (500 → 1:500). */
  scale: number;
  /** Size on paper in mm. */
  widthMm: number;
  heightMm: number;
  /** SVG with width/height/viewBox in mm. */
  svg: string;
  /** The composer adds a north arrow next to the view. */
  north?: boolean;
  /** The drawing already contains a scale bar (the caption then omits its own). */
  hasScaleBar?: boolean;
}

export interface PlanViewRequest {
  id: PlanViewId;
  boxWidthMm: number;
  boxHeightMm: number;
  /** Fixed denominator or 'auto' (largest standard scale that fits). */
  scale: number | 'auto';
  /** Views with the same group share one scale (the smallest auto scale of the group). */
  group?: string;
}

export interface PlanViewOptions {
  requests: PlanViewRequest[];
  scheme: ColourScheme;
  texts?: Partial<DrawingTexts>;
}

export const VIEW_TITLE: Record<PlanViewId, string> = {
  site: 'view.site',
  elevN: 'view.elevN',
  elevE: 'view.elevE',
  elevS: 'view.elevS',
  elevW: 'view.elevW',
  sectionA: 'view.sectionA',
  sectionB: 'view.sectionB',
  axoSW: 'view.axoSW',
  axoNE: 'view.axoNE',
};

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function model(
  id: PlanViewId,
  project: Project,
  analysis: ProjectAnalysis,
  opts: PlanViewOptions,
): DrawingModel {
  const input = drawingInput(analysis.result);
  const common = {
    scheme: opts.scheme === 'permis' ? ('permit' as const) : ('competition' as const),
    // Neighbours widen elevations/sections to the whole context area (→ 1:2000 on A3); site plan only.
    neighbours: id === 'site',
    masses: input.masses,
    levels: input.levels,
    ...(opts.texts ? { texts: opts.texts } : {}),
  };
  const sections = defaultSections(project, input.solids);
  switch (id) {
    case 'site':
      return sitePlan(project, input.solids, { ...common, sections });
    case 'elevN':
    case 'elevE':
    case 'elevS':
    case 'elevW':
      return elevation(project, input.solids, id.slice(4) as 'N' | 'E' | 'S' | 'W', common);
    case 'sectionA':
    case 'sectionB':
      return section(project, input.solids, sections[id === 'sectionA' ? 0 : 1]!, 60, common);
    case 'axoSW':
      return axonometry(project, input.solids, 'SW', 'iso', common);
    case 'axoNE':
      return axonometry(project, input.solids, 'NE', 'iso', common);
  }
}

const hasSymbol = (m: DrawingModel, type: string) =>
  m.items.some((i) => i.kind === 'symbol' && i.type === type);

/** Build and render the requested views with @kubatur/drawing. */
export function buildPlanViews(
  project: Project,
  analysis: ProjectAnalysis,
  opts: PlanViewOptions,
): PlanView[] {
  const models = opts.requests.map((r) => model(r.id, project, analysis, opts));
  const scales = opts.requests.map((r, i) =>
    r.scale === 'auto' ? chooseScale(models[i]!, r.boxWidthMm, r.boxHeightMm) : r.scale,
  );
  const groupScale = new Map<string, number>();
  opts.requests.forEach((r, i) => {
    if (r.group && r.scale === 'auto')
      groupScale.set(r.group, Math.max(groupScale.get(r.group) ?? 0, scales[i]!));
  });
  return opts.requests.map((r, i) => {
    const m = models[i]!;
    const scale =
      (r.group && r.scale === 'auto' ? groupScale.get(r.group) : undefined) ?? scales[i]!;
    const size = measureDrawing(m, scale);
    return {
      id: r.id,
      titleKey: VIEW_TITLE[r.id],
      scale,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      svg: renderSvg(m, { scale, background: null, theme: 'paper' }),
      north: r.id === 'site' && !hasSymbol(m, 'north'),
      hasScaleBar: hasSymbol(m, 'scaleBar'),
    };
  });
}
