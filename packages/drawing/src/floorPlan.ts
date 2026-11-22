import {
  coreStair,
  difference,
  resolveStairRules,
  intersection,
  pointInPolygon,
  polygonArea,
  rect,
  ringCentroid,
  union,
  type LayoutArea,
  type LayoutRoom,
  type OutdoorType,
  type RoomKind,
  type MassLayout,
  type Polygon,
  type Project,
  type StairRules,
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
  /** Outdoor spaces (balcons, loggias, terrasses). */
  outdoor: '#f4f3ef',
  outdoorLine: '#6b6862',
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

/** Short outdoor space labels (French plan convention). */
export const OUTDOOR_LABELS: Record<OutdoorType, string> = {
  balcon: 'bal.',
  loggia: 'log.',
  terrasse: 'terr.',
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
  /** Outdoor spaces (balcons, loggias, terrasses), default true. */
  outdoor?: boolean;
  /** Outdoor space names (default: French short labels). */
  outdoorText?: (kind: OutdoorType) => string;
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
export function unitLabelPoint(p: Polygon, rooms: readonly LayoutRoom[]): Vec2 {
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

/**
 * Stair and lift of a core, as modelled in 3D and transferred to Archicad (`coreStair`): treads,
 * flight outlines, the intermediate landing, the walking line with its arrow and the lift
 * shaft with a cross. Falls back to nothing when the core has no oriented box.
 */
function coreSymbol(core: LayoutArea, st: StoreyLayout, rules: StairRules): DItem[] {
  const s = coreStair(
    core,
    st.z0,
    st.z1 > st.z0 + 0.5 ? st.z1 : st.z0 + 3,
    rules,
    st.circulation.map((c) => c.polygon),
  );
  if (!s) return [];
  const c = FLOOR_PLAN_COLORS.coreLine;
  const out: DItem[] = [];
  for (const f of s.flights) {
    for (const r of rings(f.polygon)) out.push(line(r, 1, 'solid', c, true));
    for (const t of f.treads.slice(0, -1)) {
      // riser line at the far end of each tread (in the rising direction)
      const [a, b] = treadEdge(t.polygon, f.dir);
      out.push(line([a, b], 1, 'solid', c));
    }
  }
  for (const l of s.landings)
    for (const r of rings(l.polygon)) out.push(line(r, 1, 'solid', c, true));
  // walking line: up flight 1, across the landing, up flight 2, arrow at the top
  const [f1, f2] = s.flights;
  if (f1 && f2) {
    const mid = (f: typeof f1, k: number): Vec2 => [
      f.origin[0] + f.side[0] * (f.width / 2) + f.dir[0] * k,
      f.origin[1] + f.side[1] * (f.width / 2) + f.dir[1] * k,
    ];
    const len = (f: typeof f1) => (f.risers - 1) * f.going;
    const a0 = mid(f1, 0.15);
    const a1 = mid(f1, len(f1) + f1.width / 2);
    const b0 = mid(f2, -f2.width / 2);
    const b1 = mid(f2, len(f2) - 0.1);
    out.push(line([a0, a1, b0, b1], 1, 'solid', c));
    const h = 0.25;
    const back: Vec2 = [b1[0] - f2.dir[0] * h, b1[1] - f2.dir[1] * h];
    out.push(
      line(
        [
          [back[0] + f2.side[0] * h * 0.6, back[1] + f2.side[1] * h * 0.6],
          b1,
          [back[0] - f2.side[0] * h * 0.6, back[1] - f2.side[1] * h * 0.6],
        ],
        1,
        'solid',
        c,
      ),
    );
  }
  if (s.lift) {
    const r = s.lift.outer;
    out.push(line(r, 1, 'solid', c, true));
    if (r.length === 4) {
      out.push(line([r[0]!, r[2]!], 1, 'solid', c));
      out.push(line([r[1]!, r[3]!], 1, 'solid', c));
    }
  }
  return out;
}

/** Edge of a tread rectangle that lies furthest along `dir`. */
function treadEdge(p: Polygon, dir: Vec2): [Vec2, Vec2] {
  const r = p.outer;
  let best: [Vec2, Vec2] = [r[0]!, r[1]!];
  let bestK = -Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    const k = ((a[0] + b[0]) / 2) * dir[0] + ((a[1] + b[1]) / 2) * dir[1];
    if (k > bestK + 1e-9) {
      bestK = k;
      best = [a, b];
    }
  }
  return best;
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
  const stairRules = resolveStairRules(project.settings);
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
      items.push(...coreSymbol(k, st, stairRules));
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
  // outdoor spaces: balconies and terraces outside the outline, loggias cut into the dwelling
  if (opts.outdoor !== false)
    for (const st of storeys)
      for (const u of st.units) {
        const o = u.outdoor;
        if (!o) continue;
        const name = (opts.outdoorText ?? ((k: OutdoorType) => OUTDOOR_LABELS[k]))(o.kind);
        items.push({
          kind: 'fill',
          rings: rings(o.polygon),
          fill: FLOOR_PLAN_COLORS.outdoor,
          pen: 2,
          stroke: o.ok ? FLOOR_PLAN_COLORS.outdoorLine : FLOOR_PLAN_COLORS.facadeFail,
          title: `${u.label} · ${name} · ${fmtArea(o.area)} · ${fmtM(o.depth)}${o.ok ? '' : ' !'}`,
          hatch: { angle: 45, spacingMm: 1.6, pen: 1, color: '#c9c5bb' },
        });
        if (opts.labels !== false && opts.roomLabels !== false && o.area >= 3)
          labels.push({
            kind: 'text',
            at: labelPoint(o.polygon),
            text: name,
            sizeMm: 1.3,
            anchor: 'middle',
            baseline: 'middle',
            color: o.ok ? '#4a4843' : FLOOR_PLAN_COLORS.facadeFail,
          });
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
