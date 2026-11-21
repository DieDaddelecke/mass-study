import {
  difference,
  intersection,
  pointInPolygon,
  polygonArea,
  rect,
  ringCentroid,
  union,
  type LayoutArea,
  type LayoutRoom,
  type RoomKind,
  type MassLayout,
  type Polygon,
  type Project,
  type StoreyLayout,
  type StoreySolid,
  type UnitType,
  type Vec2,
} from '@kubatur/core';
import polylabel from 'polylabel';
import { COLORS, line, type CommonOptions } from './common.js';
import type { DItem, DrawingModel } from './model.js';

/** Fill colours per unit type, in the order of the unit mix (T1 … T5, 1-Zi … 5-Zi). */
export const UNIT_COLORS = [
  '#f7dca6',
  '#f5b994',
  '#b7dcc0',
  '#a9cdea',
  '#cbb9e8',
  '#f2b6c8',
  '#d7dca0',
  '#c5c5c5',
] as const;

export const FLOOR_PLAN_COLORS = {
  core: '#3f4146',
  coreLine: '#c9c9c9',
  circulation: '#ececea',
  open: '#f4f1ea',
  wall: '#2a2a2a',
  /** Façade pieces of the dwellings (subtle). */
  facade: '#5b8fc7',
  /** Dwellings below the minimum façade length. */
  facadeFail: '#d0342c',
};

/** Hex colour mixed towards black (k > 0) or white (k < 0). */
export function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(k >= 0 ? c * (1 - k) : c + (255 - c) * -k),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Fill of a room inside a dwelling of colour `unit`: séjour a little darker. */
export function roomColor(unit: string, kind: RoomKind): string {
  return kind === 'sejour' ? shade(unit, 0.12) : unit;
}

/** Fill of the rest of a dwelling (entrance, kitchen, bathroom) when its rooms are drawn. */
export const serviceColor = (unit: string): string => shade(unit, -0.5);

/** Short room labels (French plan convention). */
export const ROOM_LABELS: Record<RoomKind, string> = {
  sejour: 'séj.',
  chambrePmr: 'PMR',
  chambre: 'ch.',
};

/** Colour of a unit type (by its position in the mix). */
export function unitColor(typeId: string, mix: readonly UnitType[]): string {
  const i = mix.findIndex((t) => t.id === typeId);
  return UNIT_COLORS[(i < 0 ? UNIT_COLORS.length - 1 : i) % UNIT_COLORS.length]!;
}

export interface FloorPlanOptions extends CommonOptions {
  /** Unit labels (type + area), default true. */
  labels?: boolean;
  /** Faint site boundary, default true. */
  site?: boolean;
  /** Unit mix for colours (default: project settings). */
  unitMix?: readonly UnitType[];
  /** Tooltip text of the façade check, default French ("façade 9,40 m (min 9,10 m)"). */
  facadeText?: (facade: number, required: number) => string;
  /** Main rooms (séjour, chambre PMR, chambres) as rectangles, default true. */
  rooms?: boolean;
  /** Short room labels inside the rectangles, default true. */
  roomLabels?: boolean;
  /** Room names for tooltips and labels (default: French short labels). */
  roomText?: (kind: RoomKind) => string;
}

const fmtM = (v: number) => `${v.toFixed(2).replace('.', ',')} m`;
const defaultFacadeText = (f: number, r: number) => `façade ${fmtM(f)} (min ${fmtM(r)})`;

const rings = (p: Polygon): Vec2[][] => [p.outer, ...(p.holes ?? [])];

/** Distance of the façade band from the outline, m. */
const FACADE_INSET = 0.3;

/** Segment shifted by `d` towards the inside of `poly` (unchanged if neither side is inside). */
function insetSegment([a, b]: [Vec2, Vec2], poly: Polygon, d: number): Vec2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return [a, b];
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  // shorten the ends a little so bands of neighbouring units stay apart
  const t = Math.min(d, len / 4);
  for (const s of [1, -1]) {
    if (!pointInPolygon([mid[0] + s * nx * d, mid[1] + s * ny * d], poly)) continue;
    return [
      [a[0] + s * nx * d + ux * t, a[1] + s * ny * d + uy * t],
      [b[0] + s * nx * d - ux * t, b[1] + s * ny * d - uy * t],
    ];
  }
  return [a, b];
}

function labelPoint(p: Polygon): Vec2 {
  try {
    const r = polylabel(rings(p), 0.2);
    if (Number.isFinite(r[0]) && Number.isFinite(r[1])) return [r[0]!, r[1]!];
  } catch {
    /* fall through */
  }
  return ringCentroid(p.outer);
}

/** Label point of a dwelling: in the part not covered by its rooms when that is large enough. */
function unitLabelPoint(p: Polygon, rooms: readonly LayoutRoom[]): Vec2 {
  if (rooms.length) {
    const rest = difference(
      [p],
      rooms.map((r) => r.polygon),
    ).sort((a, b) => polygonArea(b) - polygonArea(a))[0];
    if (rest && polygonArea(rest) > 6) return labelPoint(rest);
  }
  return labelPoint(p);
}

const fmtArea = (a: number) => `${Math.round(a)} m²`;

/** Stair (two flights) and lift hint inside a rectangular core. */
function coreSymbol(core: LayoutArea): DItem[] {
  const r = core.polygon.outer;
  if (r.length !== 4) return [];
  const [p0, p1, , p3] = r as [Vec2, Vec2, Vec2, Vec2];
  let e1: Vec2 = [p1[0] - p0[0], p1[1] - p0[1]];
  let e2: Vec2 = [p3[0] - p0[0], p3[1] - p0[1]];
  if (Math.hypot(...e2) > Math.hypot(...e1)) [e1, e2] = [e2, e1];
  const l1 = Math.hypot(...e1);
  const l2 = Math.hypot(...e2);
  if (l1 < 2 || l2 < 2) return [];
  const at = (s: number, t: number): Vec2 => [
    p0[0] + e1[0] * s + e2[0] * t,
    p0[1] + e1[1] * s + e2[1] * t,
  ];
  const out: DItem[] = [];
  const c = FLOOR_PLAN_COLORS.coreLine;
  // stair: 64 % of the long side, two flights with a centre line
  const s0 = 0.08;
  const s1 = 0.64;
  const steps = Math.max(4, Math.round(((s1 - s0) * l1) / 0.55));
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    out.push(line([at(s, 0.1), at(s, 0.9)], 1, 'solid', c));
  }
  out.push(line([at(s0, 0.5), at(s1, 0.5)], 1, 'solid', c));
  // arrow up the first flight
  out.push(line([at(s0 + 0.02, 0.3), at(s1 - 0.04, 0.3)], 1, 'solid', c));
  // lift: square with a cross
  const ls = Math.min(2.2 / l1, 0.28);
  const lt = Math.min(2.2 / l2, 0.45);
  const lift: Vec2[] = [
    at(0.68, 0.1),
    at(0.68 + ls, 0.1),
    at(0.68 + ls, 0.1 + lt),
    at(0.68, 0.1 + lt),
  ];
  out.push(line(lift, 1, 'solid', c, true));
  out.push(line([lift[0]!, lift[2]!], 1, 'solid', c));
  out.push(line([lift[1]!, lift[3]!], 1, 'solid', c));
  return out;
}

/**
 * Schematic floor plan (plan d'étage schématique) of one storey level: dwellings coloured per
 * type, cores, circulation, footprint outline, faint neighbours and site boundary.
 * `storeyIndex` selects the storey (−n … m); `layouts` come from `massLayouts()`.
 */
export function floorPlan(
  project: Project,
  solids: readonly StoreySolid[],
  storeyIndex: number,
  layouts: readonly MassLayout[],
  opts: FloorPlanOptions = {},
): DrawingModel {
  const mix = opts.unitMix ?? project.settings.unitMix;
  const storeys: StoreyLayout[] = layouts.flatMap((m) =>
    m.storeys.filter((s) => s.storeyIndex === storeyIndex),
  );
  const items: DItem[] = [];
  const fill = (p: Polygon, color: string): DItem => ({
    kind: 'fill',
    rings: rings(p),
    fill: color,
  });

  // extent: all above-ground footprints (so every storey of a project has the same frame)
  const above = solids.filter((s) => s.aboveGround);
  const all = union(above.map((s) => s.footprint));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of all.length ? all : [project.site.boundary])
    for (const [x, y] of p.outer) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const m = opts.contextMargin ?? 5;
  const ext = { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m };
  const clip = [rect(ext.minX, ext.minY, ext.maxX, ext.maxY)];

  // context: faint
  if (opts.neighbours !== false)
    for (const c of project.context) {
      if (c.hidden || c.demolished) continue;
      for (const p of intersection([c.footprint], clip)) {
        items.push(fill(p, '#f3f3f3'));
        for (const r of rings(p)) items.push(line(r, 1, 'solid', '#bdbdbd', true));
      }
    }
  if (opts.site !== false && project.site.boundary.outer.length) {
    // clipped boundary without the edges that lie on the frame of the drawing
    const onFrame = (a: Vec2, b: Vec2) =>
      ([0, 1] as const).some(
        (k) =>
          (Math.abs(a[k] - (k ? ext.minY : ext.minX)) < 1e-6 &&
            Math.abs(b[k] - (k ? ext.minY : ext.minX)) < 1e-6) ||
          (Math.abs(a[k] - (k ? ext.maxY : ext.maxX)) < 1e-6 &&
            Math.abs(b[k] - (k ? ext.maxY : ext.maxX)) < 1e-6),
      );
    for (const p of intersection([project.site.boundary], clip))
      for (const r of rings(p))
        r.forEach((a, i) => {
          const b = r[(i + 1) % r.length]!;
          if (!onFrame(a, b)) items.push(line([a, b], 2, 'dashdot', COLORS.lightGrey));
        });
  }

  // footprint of the whole building (other storeys) as a thin dashed outline
  const here = union(storeys.flatMap((s) => s.footprints));
  for (const p of all)
    for (const r of rings(p)) items.push(line(r, 1, 'dashed', COLORS.lightGrey, true));

  const labels: DItem[] = [];
  const roomName = opts.roomText ?? ((k: RoomKind) => ROOM_LABELS[k]);
  for (const st of storeys) {
    for (const o of st.open) items.push(fill(o.polygon, FLOOR_PLAN_COLORS.open));
    for (const c of st.circulation) items.push(fill(c.polygon, FLOOR_PLAN_COLORS.circulation));
    for (const u of st.units)
      items.push({
        ...fill(
          u.polygon,
          opts.rooms !== false && u.rooms?.length
            ? serviceColor(unitColor(u.typeId, mix))
            : unitColor(u.typeId, mix),
        ),
        title: `${u.label} · ${fmtArea(u.area)}${u.outOfRange ? ' *' : ''} · ${(
          opts.facadeText ?? defaultFacadeText
        )(u.facade, u.facadeRequired)}${u.facadeOk ? '' : ' !'}`,
        ...(u.facadeOk
          ? {}
          : {
              hatch: { angle: 45, spacingMm: 1.2, pen: 1, color: FLOOR_PLAN_COLORS.facadeFail },
            }),
      } as DItem);
    if (opts.rooms !== false)
      for (const u of st.units) {
        const base = unitColor(u.typeId, mix);
        for (const r of u.rooms ?? []) {
          items.push({
            kind: 'fill',
            rings: rings(r.polygon),
            fill: roomColor(base, r.kind),
            pen: 1,
            stroke: r.facadeOk ? '#55534e' : FLOOR_PLAN_COLORS.facadeFail,
            title: `${u.label} · ${roomName(r.kind)} · ${fmtArea(r.area)} · ${(
              opts.facadeText ?? defaultFacadeText
            )(r.facade, r.facadeRequired)}${r.facadeOk ? '' : ' !'}`,
          });
          if (opts.roomLabels !== false && opts.labels !== false && r.area >= 7)
            labels.push({
              kind: 'text',
              at: labelPoint(r.polygon),
              text: roomName(r.kind),
              sizeMm: 1.3,
              anchor: 'middle',
              baseline: 'middle',
              color: r.facadeOk ? '#4a4843' : FLOOR_PLAN_COLORS.facadeFail,
            });
        }
      }
    for (const k of st.cores) {
      items.push(fill(k.polygon, FLOOR_PLAN_COLORS.core));
      items.push(...coreSymbol(k));
    }
    // walls between units / around cores and circulation (thin)
    for (const u of st.units)
      for (const r of rings(u.polygon))
        items.push(line(r, 3, 'solid', FLOOR_PLAN_COLORS.wall, true));
    for (const k of st.cores)
      for (const r of rings(k.polygon))
        items.push(line(r, 3, 'solid', FLOOR_PLAN_COLORS.wall, true));
    for (const o of st.open)
      for (const r of rings(o.polygon)) items.push(line(r, 1, 'solid', COLORS.grey, true));
    if (opts.labels !== false)
      for (const u of st.units) {
        const at = unitLabelPoint(u.polygon, opts.rooms === false ? [] : (u.rooms ?? []));
        const big = polygonArea(u.polygon) > 12;
        labels.push({
          kind: 'text',
          at,
          text: `${u.label}${u.outOfRange ? '*' : ''}${u.facadeOk ? '' : ' !'}`,
          sizeMm: big ? 2.6 : 1.8,
          anchor: 'middle',
          baseline: 'bottom',
          weight: 'bold',
          color: u.facadeOk ? COLORS.ink : FLOOR_PLAN_COLORS.facadeFail,
          offsetMm: [0, 0.2],
        });
        labels.push({
          kind: 'text',
          at,
          text: fmtArea(u.area),
          sizeMm: big ? 1.9 : 1.4,
          anchor: 'middle',
          baseline: 'top',
          color: '#3a3a3a',
          offsetMm: [0, -0.5],
        });
      }
  }
  // footprint outline of this storey (pen 5)
  for (const p of here) for (const r of rings(p)) items.push(line(r, 5, 'solid', COLORS.ink, true));
  // façade pieces of each dwelling: a band just inside the outline (so the black wall line
  // does not hide it), failing dwellings in red
  for (const st of storeys)
    for (const u of st.units) {
      for (const seg of u.facadeSegments ?? [])
        items.push(
          line(insetSegment(seg, u.polygon, FACADE_INSET), 4, 'solid', FLOOR_PLAN_COLORS.facade),
        );
      if (!u.facadeOk)
        for (const r of rings(u.polygon))
          items.push(line(r, 4, 'solid', FLOOR_PLAN_COLORS.facadeFail, true));
    }
  items.push(...labels);

  items.push({ kind: 'symbol', type: 'north', at: [ext.maxX - 3, ext.maxY - 5] });
  items.push({ kind: 'symbol', type: 'scaleBar', at: [ext.minX + 2, ext.minY + 2] });
  return { kind: 'floorPlan', items, bounds: { ...ext }, warnings: [] };
}

/**
 * Groups of identical storeys (same layout signature on every mass), bottom to top.
 * Used to draw one plan per distinct storey ("R+1 à R+3").
 */
export function distinctStoreyGroups(
  layouts: readonly MassLayout[],
  filter: (s: StoreyLayout) => boolean = () => true,
): { storeys: number[]; labels: string[] }[] {
  const idx = [
    ...new Set(layouts.flatMap((m) => m.storeys.filter(filter).map((s) => s.storeyIndex))),
  ].sort((a, b) => a - b);
  const sig = (i: number) =>
    layouts
      .map(
        (m) => m.storeys.find((s) => s.storeyIndex === i)?.signature.replace(/^[^|]*\|/, '') ?? '-',
      )
      .join('#');
  const groups: { storeys: number[]; labels: string[]; sig: string }[] = [];
  for (const i of idx) {
    const s = sig(i);
    const g = groups[groups.length - 1];
    const label =
      layouts.flatMap((m) => m.storeys.filter((x) => x.storeyIndex === i)).map((x) => x.label)[0] ??
      String(i);
    if (g && g.sig === s && g.storeys[g.storeys.length - 1] === i - 1) {
      g.storeys.push(i);
      g.labels.push(label);
    } else groups.push({ storeys: [i], labels: [label], sig: s });
  }
  return groups.map(({ storeys, labels }) => ({ storeys, labels }));
}

/** Default storey of the floor plan view: the first storey of the largest group of identical
 *  residential storeys (the typical upper floor), else the first above-ground storey. */
export function typicalStorey(layouts: readonly MassLayout[]): number {
  const groups = distinctStoreyGroups(layouts, (s) => s.units.length > 0);
  if (groups.length) {
    const best = [...groups].sort(
      (a, b) => b.storeys.length - a.storeys.length || a.storeys[0]! - b.storeys[0]!,
    )[0]!;
    return best.storeys[0]!;
  }
  const all = layouts.flatMap((m) => m.storeys.map((s) => s.storeyIndex));
  return all.length ? Math.min(...all) : 0;
}
