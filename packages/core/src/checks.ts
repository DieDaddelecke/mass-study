import type { VariantResult } from './analysis.js';
import { massFootprints } from './generators.js';
import type { BoundarySegment } from './boundaries.js';
import {
  outsideArea,
  overlapArea,
  pointInPolygon,
  pointRingDistance,
  pointSegmentDistance,
  polygonDistance,
} from './geometry.js';
import type { ConstraintRow } from './rules.js';
import type { Constraints, ContextBuilding, Polygon, Vec2 } from './types.js';

export type WarningCode =
  | 'massOverlap'
  | 'outsideSite'
  | 'outsideBuildable'
  | 'constraintExceeded'
  | 'constraintBelow'
  | 'depthOutOfRange'
  | 'lightDepth'
  | 'mixPlausibility'
  | 'estimatedContextHeights'
  | 'unitFacade'
  | 'prospect'
  | 'reculVoie'
  | 'buildingDistance';

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
        code: r.min ? 'constraintBelow' : 'constraintExceeded',
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

/**
 * Distance rules of the PLU (FR): set-back from streets, prospect towards neighbour boundaries
 * (L ≥ ratio × H, min.) and the distance between buildings on the same parcel. Only rules that
 * are set in the constraints are checked; H is the top slab height of each building.
 */
export function distanceWarnings(
  result: VariantResult,
  edges: readonly BoundarySegment[],
  c: Constraints,
): ModelWarning[] {
  const w: ModelWarning[] = [];
  const prospect = c.prospectRatio !== undefined || c.prospectMin !== undefined;
  const recul = c.reculVoie !== undefined;
  const between = c.distanceRatio !== undefined || c.distanceMin !== undefined;
  if (!prospect && !recul && !between && !c.edgeRecul) return w;
  const fps = result.masses.map((m) => massFootprints(m.mass));
  result.masses.forEach((m, i) => {
    const h = m.eavesHeight;
    let worstProspect: { actual: number; required: number } | undefined;
    let worstRecul: { actual: number; required: number } | undefined;
    for (const e of edges) {
      const street = e.kind === 'road' || e.kind === 'path' || e.kind === 'public';
      const override = c.edgeRecul?.[e.key];
      let required: number | undefined;
      if (street) required = override ?? c.reculVoie;
      else if (prospect || override !== undefined)
        required = Math.max(override ?? c.prospectMin ?? 0, (c.prospectRatio ?? 0) * h);
      if (required === undefined || required <= 0) continue;
      const actual = Math.min(...fps[i]!.map((fp) => segmentPolygonDistance(e.a, e.b, fp)));
      if (actual >= required - 0.05) continue;
      const slot = street ? worstRecul : worstProspect;
      if (!slot || required - actual > slot.required - slot.actual) {
        if (street) worstRecul = { actual, required };
        else worstProspect = { actual, required };
      }
    }
    if (worstProspect)
      w.push({ code: 'prospect', severity: 'warning', massIds: [m.mass.id], data: worstProspect });
    if (worstRecul)
      w.push({ code: 'reculVoie', severity: 'warning', massIds: [m.mass.id], data: worstRecul });
  });
  if (between) {
    for (let i = 0; i < result.masses.length; i++)
      for (let j = i + 1; j < result.masses.length; j++) {
        const a = result.masses[i]!;
        const b = result.masses[j]!;
        let actual = Infinity;
        for (const fa of fps[i]!)
          for (const fb of fps[j]!) actual = Math.min(actual, polygonDistance(fa, fb));
        // touching / overlapping buildings are one building (or a massOverlap warning)
        if (actual < 0.05) continue;
        const h = Math.max(a.eavesHeight, b.eavesHeight);
        const required = Math.max(c.distanceMin ?? 0, (c.distanceRatio ?? 0) * h);
        if (actual < required - 0.05)
          w.push({
            code: 'buildingDistance',
            severity: 'warning',
            massIds: [a.mass.id, b.mass.id],
            data: { actual, required },
          });
      }
  }
  return w;
}

function segmentPolygonDistance(a: Vec2, b: Vec2, p: Polygon): number {
  let d = Infinity;
  for (const ring of [p.outer, ...(p.holes ?? [])]) {
    for (const q of ring) d = Math.min(d, pointSegmentDistance(q, a, b));
    d = Math.min(d, pointRingDistance(a, ring), pointRingDistance(b, ring));
  }
  if (pointInPolygon(a, p) || pointInPolygon(b, p)) return 0;
  return d;
}
