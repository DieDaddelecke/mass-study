import {
  difference,
  intersection,
  offsetPolyline,
  polygonArea,
  rect,
  ringCentroid,
  union,
  zoneTrees,
  type PlantingZone,
  type Polygon,
  type Project,
  type StoreySolid,
  type Vec2,
} from '@kubatur/core';
import polylabel from 'polylabel';
import {
  COLORS,
  line,
  schemeColors,
  siteBox,
  type CommonOptions,
  type SectionLine,
} from './common.js';
import { formatLevel, roman, type DItem, type DrawingModel } from './model.js';

export interface SitePlanOptions extends CommonOptions {
  /** Section lines drawn with section heads. */
  sections?: SectionLine[];
  /** Show roads, green, water, trees and neighbouring parcels (default true). */
  surroundings?: boolean;
  /** Vegetation zones (default: the active variant's plantings). */
  plantings?: PlantingZone[];
}

/** Tree symbol: crown circle + centre cross. */
function treeItems(x: number, y: number, r: number): DItem[] {
  const n = 16;
  const ring: Vec2[] = [];
  for (let i = 0; i < n; i++)
    ring.push([x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI)]);
  return [
    { kind: 'fill', rings: [ring], fill: 'rgba(127,158,108,0.18)', pen: 1, stroke: COLORS.tree },
    line(
      [
        [x - 0.4, y],
        [x + 0.4, y],
      ],
      1,
      'solid',
      COLORS.tree,
    ),
    line(
      [
        [x, y - 0.4],
        [x, y + 0.4],
      ],
      1,
      'solid',
      COLORS.tree,
    ),
  ];
}

const rings = (p: Polygon): Vec2[][] => [p.outer, ...(p.holes ?? [])];

function labelPoint(p: Polygon): Vec2 {
  try {
    const r = polylabel(rings(p), 0.5);
    if (Number.isFinite(r[0]) && Number.isFinite(r[1])) return [r[0]!, r[1]!];
  } catch {
    /* fall through */
  }
  return ringCentroid(p.outer);
}

/** Short parcel label: French IDU "91477000H0518" → "H 0518". */
export function parcelLabel(ref: string | undefined): string {
  if (!ref) return '';
  const m = /^\d{5}\d{3}([0-9A-Z]{2})(\d{4})$/.exec(ref);
  if (m) return `${m[1]!.replace(/^0/, '')} ${m[2]}`;
  return ref;
}

/** Site plan (Lageplan / plan masse, SPEC §11.1). Model coordinates = project plan metres. */
export function sitePlan(
  project: Project,
  solids: readonly StoreySolid[],
  opts: SitePlanOptions = {},
): DrawingModel {
  const sc = schemeColors(opts.scheme);
  const box = siteBox(project, solids);
  const m = opts.contextMargin ?? 40;
  const ext = { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
  const clip = [rect(ext.minX, ext.minY, ext.maxX, ext.maxY)];
  const items: DItem[] = [];
  const fill = (p: Polygon, color: string, pen?: 1 | 2 | 3, stroke?: string): DItem => {
    const f: DItem = { kind: 'fill', rings: rings(p), fill: color };
    if (pen) f.pen = pen;
    if (stroke) f.stroke = stroke;
    return f;
  };

  const sur = opts.surroundings === false ? undefined : project.surroundings;
  if (sur) {
    for (const g of sur.green)
      for (const p of intersection([g.footprint], clip)) items.push(fill(p, COLORS.green));
    for (const w of sur.water)
      for (const p of intersection([w.footprint], clip))
        items.push(fill(p, COLORS.water, 1, COLORS.waterLine));
    const roadPolys: Polygon[] = [];
    for (const r of sur.roads) {
      if (r.level < 0 || r.kind === 'rail' || r.kind === 'tram') continue;
      const w = Math.max(
        r.width,
        r.kind === 'footway' || r.kind === 'path' || r.kind === 'cycleway' ? 1.5 : 3,
      );
      roadPolys.push(...offsetPolyline(r.centerline, false, w, 'center'));
    }
    if (roadPolys.length) {
      for (const p of intersection(union(roadPolys), clip))
        items.push(fill(p, COLORS.road, 1, COLORS.roadLine));
    }
    for (const r of sur.roads) {
      if (r.kind !== 'rail' && r.kind !== 'tram') continue;
      items.push(line(r.centerline, 2, 'dashed', COLORS.grey));
    }
    for (const p of sur.parcels) {
      const parts = intersection([p.polygon], clip);
      for (const q of parts)
        for (const r of rings(q)) items.push(line(r, 1, 'solid', '#b5b5b5', true));
    }
  }

  // neighbours
  const showN = opts.neighbours !== false;
  for (const c of project.context) {
    if (c.hidden) continue;
    const parts = intersection([c.footprint], clip);
    if (!parts.length) continue;
    if (c.demolished) {
      for (const p of parts)
        for (const r of rings(p)) items.push(line(r, 1, 'dashed', COLORS.grey, true));
      continue;
    }
    if (!showN) continue;
    for (const p of parts) items.push(fill(p, COLORS.neighbourFill, 2, '#7a7a7a'));
  }
  if (sur) {
    for (const t of sur.trees) {
      const [x, y] = t.position;
      if (x < ext.minX || x > ext.maxX || y < ext.minY || y > ext.maxY) continue;
      items.push(...treeItems(x, y, Math.max(1.5, t.crown / 2)));
    }
  }
  if (showN) {
    for (const c of project.context) {
      if (c.hidden || c.demolished) continue;
      const parts = intersection([c.footprint], clip);
      const big = parts.filter((p) => polygonArea(p) > 40);
      if (!big.length) continue;
      const n = c.levels ?? Math.max(1, Math.round(c.height / 3));
      items.push({
        kind: 'text',
        at: labelPoint(big[0]!),
        text: roman(n),
        sizeMm: 1.8,
        anchor: 'middle',
        baseline: 'middle',
        color: '#555555',
      });
    }
  }
  if (sur) {
    for (const p of sur.parcels) {
      const label = p.label ?? parcelLabel(p.ref);
      if (!label) continue;
      const parts = intersection([p.polygon], clip);
      const big = parts.find((q) => polygonArea(q) > 150);
      if (!big) continue;
      items.push({
        kind: 'text',
        at: labelPoint(big),
        text: label,
        sizeMm: 1.5,
        anchor: 'middle',
        baseline: 'middle',
        color: '#9a9a9a',
        offsetMm: [0, -3],
      });
    }
  }

  // vegetation zones of the variant (below the masses)
  const plantings =
    opts.plantings ??
    project.variants?.find((v) => v.id === project.activeVariantId)?.plantings ??
    [];
  for (const z of plantings) {
    if (z.polygon.outer.length < 3) continue;
    for (const p of intersection([z.polygon], clip)) {
      const f: DItem = {
        kind: 'fill',
        rings: rings(p),
        fill: z.kind === 'surDalle' ? '#f1f6ec' : COLORS.green,
        pen: 1,
        stroke: COLORS.greenLine,
      };
      if (z.kind === 'surDalle')
        f.hatch = { angle: 45, spacingMm: 1.6, pen: 1, color: COLORS.greenLine };
      items.push(f);
    }
  }
  for (const z of plantings) {
    const crown = z.treeHeight ? 0.6 * z.treeHeight : 5;
    for (const [x, y] of zoneTrees(z)) items.push(...treeItems(x, y, Math.max(1.5, crown / 2)));
  }

  // buildable area / building lines
  const buildable = project.constraints.buildable ?? project.site.buildable;
  for (const b of buildable ?? [])
    for (const r of rings(b)) items.push(line(r, 3, 'dashed', '#4a4a4a', true));
  for (const bl of project.site.buildingLines ?? []) items.push(line(bl, 4, 'dashed'));

  // masses: union of above-ground storeys per mass; storey outlines (setbacks) thin
  const byMass = new Map<string, StoreySolid[]>();
  for (const s of solids) {
    let arr = byMass.get(s.massId);
    if (!arr) byMass.set(s.massId, (arr = []));
    arr.push(s);
  }
  const labels: DItem[] = [];
  for (const [massId, ss] of byMass) {
    const above = ss.filter((s) => s.aboveGround);
    const below = ss.filter((s) => !s.aboveGround);
    const all = union(above.map((s) => s.footprint));
    if (below.length) {
      const under = difference(union(below.map((s) => s.footprint)), all);
      for (const p of under)
        for (const r of rings(p)) items.push(line(r, 2, 'hidden', '#333333', true));
    }
    for (const p of all) items.push(fill(p, sc.massFill));
    // set-back outlines: footprints of the higher storeys
    const levels = [...new Set(above.map((s) => s.z0))].sort((a, b) => a - b);
    for (const z of levels.slice(1)) {
      const at = union(above.filter((s) => s.z0 === z).map((s) => s.footprint));
      const below2 = union(
        above.filter((s) => s.z0 < z && s.z1 > z - 0.01).map((s) => s.footprint),
      );
      if (!at.length || !below2.length) continue;
      // only draw where the outline differs from the outline below
      const diff = difference(below2, at);
      if (!diff.length) continue;
      for (const p of at)
        for (const r of rings(p)) items.push(line(r, 1, 'solid', 'rgba(255,255,255,0.7)', true));
    }
    // ridge / hip lines of pitched roofs
    for (const rf of opts.roofs ?? []) {
      if (rf.massId !== massId) continue;
      const o = rf.polygon.outer;
      o.forEach((a, i) => {
        if (rf.seams[i])
          items.push(line([a, o[(i + 1) % o.length]!], 1, 'solid', 'rgba(255,255,255,0.7)'));
      });
    }
    for (const p of all)
      for (const r of rings(p)) items.push(line(r, 4, 'solid', sc.outline, true));
    const info = opts.masses?.find((mi) => mi.massId === massId);
    const biggest = [...all].sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    if (biggest) {
      const at = labelPoint(biggest);
      const formula = info?.formula ?? roman(new Set(above.map((s) => s.storeyIndex)).size);
      const top = info?.top ?? Math.max(0, ...above.map((s) => s.z1));
      labels.push({
        kind: 'text',
        at,
        text: formula,
        sizeMm: 2.4,
        anchor: 'middle',
        baseline: 'bottom',
        color: sc.massText,
        weight: 'bold',
        offsetMm: [0, 0.4],
      });
      labels.push({
        kind: 'text',
        at,
        text: formatLevel(top),
        sizeMm: 1.8,
        anchor: 'middle',
        baseline: 'top',
        color: sc.massText,
        offsetMm: [0, -0.6],
      });
    }
  }
  items.push(...labels);

  // site boundary + parcel numbers
  const sb = project.site.boundary;
  for (const r of sb.outer.length ? rings(sb) : [])
    items.push(line(r, 6, 'dashdot', COLORS.ink, true));
  for (const p of project.site.parcels) {
    const label = parcelLabel(p.ref);
    if (!label) continue;
    // place the number on the free part of the parcel (not on a mass)
    const free = difference(
      [p.polygon],
      union(solids.filter((s) => s.aboveGround).map((s) => s.footprint)),
    ).sort((x, y) => polygonArea(y) - polygonArea(x));
    const at = labelPoint(free[0] ?? p.polygon);
    items.push({
      kind: 'text',
      at,
      text: label,
      sizeMm: 2.2,
      anchor: 'middle',
      baseline: 'middle',
      color: COLORS.ink,
      weight: 'bold',
    });
  }

  // section lines
  for (const s of opts.sections ?? []) {
    items.push(line([s.a, s.b], 4, 'dashdot', COLORS.ink));
    const dir = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) + Math.PI / 2;
    items.push({ kind: 'symbol', type: 'sectionHead', at: s.a, rotation: dir, label: s.id });
    items.push({ kind: 'symbol', type: 'sectionHead', at: s.b, rotation: dir, label: s.id });
  }

  items.push({ kind: 'symbol', type: 'north', at: [ext.maxX - 6, ext.maxY - 8] });
  items.push({ kind: 'symbol', type: 'scaleBar', at: [ext.minX + 3, ext.minY + 3] });

  return { kind: 'site', items, bounds: { ...ext }, warnings: [] };
}
