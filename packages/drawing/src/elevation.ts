import type { Project, StoreySolid, Vec2 } from '@kubatur/core';
import {
  COLORS,
  DEFAULT_TEXTS,
  bboxIntersects,
  contextPrisms,
  line,
  massPrisms,
  roofPrisms,
  schemeColors,
  siteBox,
  visibleContext,
  type CommonOptions,
  type SectionLine,
} from './common.js';
import { union } from '@kubatur/core';
import {
  hiddenLine,
  mergeCollinear,
  painterOrder,
  type Prism,
  type Projection,
  type VisibleSegment,
} from './hidden.js';
import { formatLevel, geometryBounds, type DItem, type DrawingModel } from './model.js';

export type ElevationDir = 'N' | 'E' | 'S' | 'W';

export interface ElevationOptions extends CommonOptions {
  /** Horizontal storey lines on the façades (default true). */
  storeyLines?: boolean;
  /** Level kotes on the right (default true). */
  kotes?: boolean;
}

export interface SectionOptions extends ElevationOptions {
  /** Section letter for texts (default line.id). */
  label?: string;
}

/** Façade N = seen from the north (viewer looks south). */
const LOOK: Record<ElevationDir, Vec2> = { N: [0, -1], S: [0, 1], E: [-1, 0], W: [1, 0] };

/** Horizontal look direction → projection (screen x to the viewer's right, y = height). */
export function horizontalProjection(look: Vec2): Projection {
  const l = Math.hypot(look[0], look[1]) || 1;
  const L: Vec2 = [look[0] / l, look[1] / l];
  return { right: [L[1], -L[0], 0], up: [0, 0, 1], v: [-L[0], -L[1], 0] };
}

const dotv = (P: Projection, p: Vec2) => P.v[0] * p[0] + P.v[1] * p[1];

function emitHlr(
  items: DItem[],
  prisms: Prism[],
  P: Projection,
  opts: ElevationOptions,
  massWall: string,
  massRoof: string,
): VisibleSegment[] {
  const res = hiddenLine(prisms, P, { storeyLines: opts.storeyLines ?? true });
  for (const f of painterOrder(res.faces, P)) {
    const ctx = f.prism.group === 'context';
    items.push({
      kind: 'fill',
      rings: f.rings,
      fill: ctx
        ? f.kind === 'roof'
          ? COLORS.neighbourRoof
          : COLORS.neighbourWall
        : f.kind === 'roof'
          ? massRoof
          : massWall,
    });
  }
  const style = (s: VisibleSegment) => `${s.prism?.group}|${s.cls === 'storey' ? 's' : 'e'}`;
  const merged = mergeCollinear(res.segments, style);
  // context first, then mass storeys, then mass edges
  const rank = (s: VisibleSegment) =>
    s.prism?.group === 'context' ? 0 : s.cls === 'storey' ? 1 : 2;
  merged.sort((a, b) => rank(a) - rank(b));
  for (const s of merged) {
    if (s.prism?.group === 'context') items.push(line([s.a, s.b], 2, 'solid', COLORS.grey));
    else if (s.cls === 'storey') items.push(line([s.a, s.b], 1, 'solid', '#555555'));
    else items.push(line([s.a, s.b], 3));
  }
  return merged;
}

function levelsAndGround(
  items: DItem[],
  project: Project,
  opts: ElevationOptions,
  massX: [number, number],
  allX: [number, number],
  topZ: number,
  minZ: number,
  ridge = false,
) {
  // ground line
  items.push(
    line(
      [
        [allX[0] - 6, 0],
        [allX[1] + 6, 0],
      ],
      6,
    ),
  );
  if (opts.kotes === false || !Number.isFinite(massX[0])) return;
  const xk = allX[1] + 4;
  const zs: { z: number; sub?: string }[] = [];
  const ngf = project.geo.groundElevation;
  const datum =
    opts.texts?.datum ?? (project.settings.profile === 'DE' ? 'NHN' : DEFAULT_TEXTS.datum);
  for (const lv of opts.levels ?? []) {
    if (lv.elevation < minZ - 0.01) continue;
    const sub =
      Math.abs(lv.elevation) < 0.005 && ngf !== undefined
        ? `= ${ngf.toFixed(2).replace('.', ',')} ${datum}`
        : lv.name;
    zs.push({ z: lv.elevation, sub });
  }
  if (!zs.some((l) => Math.abs(l.z) < 0.005)) zs.push({ z: 0 });
  if (topZ > 0)
    zs.push({
      z: topZ,
      sub: ridge
        ? (opts.texts?.ridge ?? DEFAULT_TEXTS.ridge)
        : (opts.texts?.parapet ?? DEFAULT_TEXTS.parapet),
    });
  zs.sort((a, b) => a.z - b.z);
  for (const lv of zs) {
    items.push(
      line(
        [
          [allX[1] + 1, lv.z],
          [xk, lv.z],
        ],
        1,
        'dashed',
        '#555555',
      ),
    );
    const sym: DItem = { kind: 'symbol', type: 'level', at: [xk, lv.z], label: formatLevel(lv.z) };
    if (lv.sub) sym.sublabel = lv.sub;
    items.push(sym);
  }
}

/** Elevation of the masses (+ grey neighbours) seen from the given side (SPEC §11.3). */
export function elevation(
  project: Project,
  solids: readonly StoreySolid[],
  dir: ElevationDir,
  opts: ElevationOptions = {},
): DrawingModel {
  const P = horizontalProjection(LOOK[dir]);
  const sc = schemeColors(opts.scheme);
  const masses = [...massPrisms(solids, opts.masses), ...roofPrisms(opts.roofs)];
  const box = siteBox(project, solids);
  const m = opts.contextMargin ?? 25;
  const region = { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
  // the front-most depth of the site: neighbours entirely in front of it are left out
  const sitePts = project.site.boundary.outer.length
    ? project.site.boundary.outer
    : masses.flatMap((p) => p.outer);
  const frontDepth = Math.max(...sitePts.map((p) => dotv(P, p)));
  const ctx =
    opts.neighbours === false
      ? []
      : contextPrisms(
          visibleContext(project).filter(
            (c) =>
              bboxIntersects(c.footprint, region) &&
              Math.min(...c.footprint.outer.map((p) => dotv(P, p))) < frontDepth,
          ),
        );
  const items: DItem[] = [];
  emitHlr(items, [...ctx, ...masses], P, opts, sc.wall, sc.roof);
  const u = (p: Vec2) => P.right[0] * p[0] + P.right[1] * p[1];
  const massU = masses.flatMap((p) => p.outer.map(u));
  const allU = [...massU, ...ctx.flatMap((p) => p.outer.map(u)), ...sitePts.map(u)];
  // site boundary markers
  if (project.site.boundary.outer.length) {
    const su = project.site.boundary.outer.map(u);
    for (const x of [Math.min(...su), Math.max(...su)])
      items.push(
        line(
          [
            [x, -1.5],
            [x, 2.5],
          ],
          4,
          'dashdot',
        ),
      );
  }
  const top = Math.max(0, ...masses.map((p) => p.z1));
  levelsAndGround(
    items,
    project,
    opts,
    [Math.min(...massU), Math.max(...massU)],
    [Math.min(...allU), Math.max(...allU)],
    top,
    0,
    isRidge(masses, top),
  );
  return { kind: 'elevation', items, bounds: geometryBounds(items), warnings: [] };
}

/** Is the top kote the ridge of a pitched roof? */
function isRidge(masses: Prism[], top: number): boolean {
  const roof = Math.max(-Infinity, ...masses.filter((p) => p.top).map((p) => p.z1));
  const flat = Math.max(-Infinity, ...masses.filter((p) => !p.top).map((p) => p.z1));
  return Number.isFinite(roof) && roof >= flat - 1e-6 && Math.abs(roof - top) < 1e-3;
}

/** Parameters along a→b (unbounded line) where the line is inside the polygon rings. */
export function lineIntervals(rings: Vec2[][], a: Vec2, b: Vec2): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const ts: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const p = ring[j]!;
      const q = ring[i]!;
      // signed distances to the line
      const sp = (p[0] - a[0]) * -uy + (p[1] - a[1]) * ux;
      const sq = (q[0] - a[0]) * -uy + (q[1] - a[1]) * ux;
      if (sp > 0 === sq > 0) continue;
      const t = sp / (sp - sq);
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      ts.push((x - a[0]) * ux + (y - a[1]) * uy);
    }
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    if (ts[i + 1]! - ts[i]! > 1e-6) out.push([ts[i]!, ts[i + 1]!]);
  }
  return out;
}

/**
 * Section along `line` (SPEC §11.4): the viewer looks to the left of a→b; cut parts as poché,
 * geometry up to `depth` metres behind the plane as hidden-line view. Screen x = distance from a.
 */
export function section(
  project: Project,
  solids: readonly StoreySolid[],
  sec: SectionLine,
  depth = 60,
  opts: SectionOptions = {},
): DrawingModel {
  const { a, b } = sec;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const look: Vec2 = [-u[1], u[0]];
  const base = horizontalProjection(look);
  // shift so that screen x = 0 at a
  const P: Projection = { ...base };
  const ua = base.right[0] * a[0] + base.right[1] * a[1];
  const sc = schemeColors(opts.scheme);
  // neighbours only up to `contextMargin` beyond the ends of the section line (like elevations)
  const L = opts.contextMargin ?? 25;
  const strip = [
    {
      outer: [
        [a[0] - u[0] * L, a[1] - u[1] * L],
        [b[0] + u[0] * L, b[1] + u[1] * L],
        [b[0] + u[0] * L + look[0] * depth, b[1] + u[1] * L + look[1] * depth],
        [a[0] - u[0] * L + look[0] * depth, a[1] - u[1] * L + look[1] * depth],
      ] as Vec2[],
    },
  ];
  const masses = [
    ...massPrisms(solids, opts.masses, (s) => s.aboveGround, strip),
    ...roofPrisms(opts.roofs, strip),
  ];
  const neighbours = opts.neighbours === false ? [] : visibleContext(project);
  const ctx = contextPrisms(neighbours, strip);
  const items: DItem[] = [];
  const shift = (p: Vec2): Vec2 => [p[0] - ua, p[1]];
  const beyond: DItem[] = [];
  emitHlr(beyond, [...ctx, ...masses], P, { ...opts, kotes: false }, sc.wall, sc.roof);
  for (const it of beyond) {
    if (it.kind === 'line') it.pts = it.pts.map(shift);
    if (it.kind === 'fill') it.rings = it.rings.map((r) => r.map(shift));
    items.push(it);
  }

  // poché of the cut
  const cutRects = (rings: Vec2[][], z0: number, z1: number): Vec2[][] =>
    lineIntervals(rings, a, b)
      .map(([s0, s1]): [number, number] => [Math.max(s0, -L), Math.min(s1, len + L)])
      .filter(([s0, s1]) => s1 - s0 > 1e-6)
      .map(([s0, s1]) => [
        [s0, z0],
        [s1, z0],
        [s1, z1],
        [s0, z1],
      ]);
  const ctxCut = neighbours.flatMap((c) =>
    cutRects(
      [c.footprint.outer, ...(c.footprint.holes ?? [])],
      Math.max(0, c.baseHeight ?? 0),
      c.height,
    ),
  );
  if (ctxCut.length) {
    const un = union(ctxCut.map((r) => ({ outer: r })));
    for (const p of un) {
      const rings = [p.outer, ...(p.holes ?? [])];
      items.push({ kind: 'fill', rings, fill: COLORS.neighbourCut, pen: 3, stroke: '#555555' });
    }
  }
  const slabLines: DItem[] = [];
  const massRects: Vec2[][] = [];
  for (const s of solids) {
    const z1 = s.z1 + (s.top ? (opts.masses?.find((m) => m.massId === s.massId)?.parapet ?? 0) : 0);
    const rects = cutRects([s.footprint.outer, ...(s.footprint.holes ?? [])], s.z0, z1);
    for (const r of rects) {
      massRects.push(r);
      // floor slab line (white) at the storey bottom
      slabLines.push(line([r[0]!, r[1]!], 1, 'solid', '#ffffff'));
    }
  }
  // pitched roofs: the cut between the top slab and the roof plane
  const ux = u[0];
  const uy = u[1];
  for (const r of opts.roofs ?? []) {
    const zAt = (t: number) =>
      r.plane[0] + r.plane[1] * (a[0] + ux * t) + r.plane[2] * (a[1] + uy * t);
    for (const [s0, s1] of lineIntervals([r.polygon.outer, ...(r.polygon.holes ?? [])], a, b)) {
      const t0 = Math.max(s0, -L);
      const t1 = Math.min(s1, len + L);
      if (t1 - t0 < 1e-6) continue;
      const pts: Vec2[] = [
        [t0, r.z0],
        [t1, r.z0],
        [t1, Math.max(r.z0, zAt(t1))],
        [t0, Math.max(r.z0, zAt(t0))],
      ];
      massRects.push(pts);
    }
  }
  if (massRects.length) {
    const un = union(massRects.map((r) => ({ outer: r })));
    for (const p of un)
      items.push({ kind: 'fill', rings: [p.outer, ...(p.holes ?? [])], fill: sc.poche });
    items.push(...slabLines);
    for (const p of un)
      for (const r of [p.outer, ...(p.holes ?? [])])
        items.push(line(r, 5, 'solid', sc.outline, true));
  }

  // extents
  const xs: number[] = [];
  for (const it of items) {
    if (it.kind === 'line') it.pts.forEach((p) => xs.push(p[0]));
    if (it.kind === 'fill') it.rings.forEach((r) => r.forEach((p) => xs.push(p[0])));
  }
  const massXs = massRects.flatMap((r) => r.map((p) => p[0]));
  for (const it of beyond)
    if (it.kind === 'line' && it.color === undefined) it.pts.forEach((p) => massXs.push(p[0]));
  const allX: [number, number] = xs.length ? [Math.min(...xs, 0), Math.max(...xs, len)] : [0, len];
  // underground: below-grade band
  const minZ = Math.min(0, ...solids.map((s) => s.z0));
  if (minZ < 0) {
    items.unshift({
      kind: 'fill',
      rings: [
        [
          [allX[0] - 6, minZ - 1],
          [allX[1] + 6, minZ - 1],
          [allX[1] + 6, 0],
          [allX[0] - 6, 0],
        ],
      ],
      fill: '#f3f1ec',
      hatch: { angle: 45, spacingMm: 1.6, pen: 1, color: '#c9c4b8' },
    });
  }
  // site boundary markers
  if (project.site.boundary.outer.length) {
    const sb = project.site.boundary;
    for (const [s0, s1] of lineIntervals([sb.outer, ...(sb.holes ?? [])], a, b))
      for (const x of [s0, s1])
        items.push(
          line(
            [
              [x, -1.5],
              [x, 2.5],
            ],
            4,
            'dashdot',
          ),
        );
  }
  const top = Math.max(
    0,
    ...massRects.flatMap((r) => r.map((p) => p[1])),
    ...masses.map((p) => p.z1),
  );
  levelsAndGround(
    items,
    project,
    opts,
    massXs.length ? [Math.min(...massXs), Math.max(...massXs)] : [NaN, NaN],
    allX,
    top,
    minZ,
    isRidge(masses, top) ||
      (opts.roofs ?? []).some((r) =>
        r.polygon.outer.some(
          (q) => Math.abs(r.plane[0] + r.plane[1] * q[0] + r.plane[2] * q[1] - top) < 1e-3,
        ),
      ),
  );
  return { kind: 'section', items, bounds: geometryBounds(items), warnings: [] };
}
