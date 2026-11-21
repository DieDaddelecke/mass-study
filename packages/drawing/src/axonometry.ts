import type { Project, StoreySolid, Vec2 } from '@kubatur/core';
import {
  COLORS,
  bboxIntersects,
  contextPrisms,
  line,
  massPrisms,
  schemeColors,
  siteBox,
  visibleContext,
  type CommonOptions,
} from './common.js';
import {
  hiddenLine,
  mergeCollinear,
  painterOrder,
  type ExtraEdge,
  type Projection,
  type Vec3,
  type VisibleSegment,
} from './hidden.js';
import { geometryBounds, type DItem, type DrawingModel } from './model.js';

export type AxoDir = 'SW' | 'SE' | 'NE' | 'NW';
/** iso = isometric (true orthographic, 35.26° elevation); planOblique = 45° plan axonometry. */
export type AxoKind = 'iso' | 'planOblique';

export interface AxonometryOptions extends CommonOptions {
  storeyLines?: boolean;
}

/** Horizontal direction from the building towards the viewer. */
const VIEWER: Record<AxoDir, Vec2> = { SW: [-1, -1], SE: [1, -1], NE: [1, 1], NW: [-1, 1] };

export function axoProjection(dir: AxoDir, kind: AxoKind): Projection {
  const h = VIEWER[dir];
  const hl = Math.hypot(h[0], h[1]);
  const hx = h[0] / hl;
  const hy = h[1] / hl;
  if (kind === 'iso') {
    const e = Math.atan(1 / Math.SQRT2); // 35.26°
    const v: Vec3 = [hx * Math.cos(e), hy * Math.cos(e), Math.sin(e)];
    const look: Vec3 = [-v[0], -v[1], -v[2]];
    const rl = Math.hypot(look[1], look[0]);
    const right: Vec3 = [look[1] / rl, -look[0] / rl, 0];
    // up = right × look
    const up: Vec3 = [
      right[1] * look[2] - right[2] * look[1],
      right[2] * look[0] - right[0] * look[2],
      right[0] * look[1] - right[1] * look[0],
    ];
    return { right, up, v };
  }
  // plan oblique: plan rotated so that the viewer direction points down the sheet, z vertical
  const theta = -Math.PI / 2 - Math.atan2(hy, hx);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const right: Vec3 = [c, -s, 0];
  const up: Vec3 = [s, c, 1];
  // kernel of [right; up]: d = (s, c, -1) → towards the viewer v = (-s, -c, 1)
  const n = Math.hypot(s, c, 1);
  return { right, up, v: [-s / n, -c / n, 1 / n] };
}

/** Vector axonometry with hidden edges removed, roofs light grey, neighbours grey (SPEC §11.5). */
export function axonometry(
  project: Project,
  solids: readonly StoreySolid[],
  dir: AxoDir,
  kind: AxoKind = 'iso',
  opts: AxonometryOptions = {},
): DrawingModel {
  const P = axoProjection(dir, kind);
  const sc = schemeColors(opts.scheme);
  const masses = massPrisms(solids, opts.masses);
  const box = siteBox(project, solids);
  const m = opts.contextMargin ?? 30;
  const region = { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
  const ctx =
    opts.neighbours === false
      ? []
      : contextPrisms(visibleContext(project).filter((c) => bboxIntersects(c.footprint, region)));
  const extra: ExtraEdge[] = [];
  const sb = project.site.boundary;
  for (const ring of sb.outer.length ? [sb.outer, ...(sb.holes ?? [])] : []) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      extra.push({ p: [a[0], a[1], 0], q: [b[0], b[1], 0], tag: 'site' });
    }
  }
  const prisms = [...ctx, ...masses];
  const res = hiddenLine(prisms, P, { storeyLines: opts.storeyLines ?? false, extraEdges: extra });
  const items: DItem[] = [];
  for (const f of painterOrder(res.faces, P)) {
    const c = f.prism.group === 'context';
    const fill =
      f.kind === 'roof' ? (c ? COLORS.neighbourRoof : sc.roof) : c ? COLORS.neighbourWall : sc.wall;
    items.push({ kind: 'fill', rings: f.rings, fill });
  }
  const key = (s: VisibleSegment) => `${s.tag ?? s.prism?.group}|${s.cls === 'storey' ? 's' : 'e'}`;
  const merged = mergeCollinear(res.segments, key);
  const rank = (s: VisibleSegment) =>
    s.tag === 'site' ? 0 : s.prism?.group === 'context' ? 1 : s.cls === 'storey' ? 2 : 3;
  merged.sort((a, b) => rank(a) - rank(b));
  for (const s of merged) {
    if (s.tag === 'site') items.push(line([s.a, s.b], 4, 'dashdot'));
    else if (s.prism?.group === 'context') items.push(line([s.a, s.b], 2, 'solid', COLORS.grey));
    else if (s.cls === 'storey') items.push(line([s.a, s.b], 1, 'solid', '#555555'));
    else items.push(line([s.a, s.b], 3));
  }
  return { kind: 'axonometry', items, bounds: geometryBounds(items), warnings: [] };
}
