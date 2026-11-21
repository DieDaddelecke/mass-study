import type { VariantResult } from './analysis.js';
import { massFootprints } from './generators.js';
import { outsideArea, overlapArea } from './geometry.js';
import type { ConstraintRow } from './rules.js';
import type { ContextBuilding, Polygon } from './types.js';

export type WarningCode =
  | 'massOverlap'
  | 'outsideSite'
  | 'outsideBuildable'
  | 'constraintExceeded'
  | 'depthOutOfRange'
  | 'lightDepth'
  | 'mixPlausibility'
  | 'estimatedContextHeights';

export interface ModelWarning {
  code: WarningCode;
  severity: 'warning' | 'error';
  massIds: string[];
  /** Additional values for the message (area, key, …). */
  data?: Record<string, number | string>;
}

const AREA_TOL = 0.01;

export function modelWarnings(
  result: VariantResult,
  site: { boundary: Polygon; buildable?: Polygon[] },
  context: readonly ContextBuilding[],
  rows: readonly ConstraintRow[],
): ModelWarning[] {
  const w: ModelWarning[] = [];
  const masses = result.masses;
  const footprints = masses.map((m) => massFootprints(m.mass));

  for (let i = 0; i < masses.length; i++) {
    for (let j = i + 1; j < masses.length; j++) {
      const a = overlapArea(footprints[i]!, footprints[j]!);
      if (a > AREA_TOL)
        w.push({
          code: 'massOverlap',
          severity: 'warning',
          massIds: [masses[i]!.mass.id, masses[j]!.mass.id],
          data: { area: a },
        });
    }
  }
  masses.forEach((m, i) => {
    const out = outsideArea(footprints[i]!, [site.boundary]);
    if (out > AREA_TOL)
      w.push({ code: 'outsideSite', severity: 'error', massIds: [m.mass.id], data: { area: out } });
    else if (site.buildable?.length) {
      const ob = outsideArea(footprints[i]!, site.buildable);
      if (ob > AREA_TOL)
        w.push({
          code: 'outsideBuildable',
          severity: 'warning',
          massIds: [m.mass.id],
          data: { area: ob },
        });
    }
    if (m.suitability.length && !m.suitability.some((s) => s.status === 'ok'))
      w.push({
        code: 'depthOutOfRange',
        severity: 'warning',
        massIds: [m.mass.id],
        data: { depth: m.depth },
      });
    if (m.lightWarning)
      w.push({
        code: 'lightDepth',
        severity: 'warning',
        massIds: [m.mass.id],
        data: { depth: m.depth },
      });
    if (m.mixHint)
      w.push({
        code: 'mixPlausibility',
        severity: 'warning',
        massIds: [m.mass.id],
        data: { actual: m.mixHint.actual, min: m.mixHint.expected[0], max: m.mixHint.expected[1] },
      });
  });
  for (const r of rows) {
    if (r.status === 'error')
      w.push({
        code: 'constraintExceeded',
        severity: 'error',
        massIds: [],
        data: { key: r.key, actual: r.actual, target: r.target ?? 0 },
      });
  }
  const estimated = context.filter((c) => c.heightEstimated && !c.hidden && !c.demolished).length;
  if (estimated)
    w.push({
      code: 'estimatedContextHeights',
      severity: 'warning',
      massIds: [],
      data: { count: estimated },
    });
  return w;
}
