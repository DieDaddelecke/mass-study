import {
  siteBoundaries,
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
  type LayoutSpace,
  type SpaceKind,
  type LayoutUnit,
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
  type BoundaryKind,
} from '@kubatur/core';
import polylabel from 'polylabel';
import { COLORS, line, type CommonOptions } from './common.js';
import { RESIDENCE_COLORS, SPACE_COLORS, SPACE_LABELS, spaceLabelMinArea } from './spaces.js';
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
  /** Site boundary towards a neighbouring parcel (limite séparative). */
  party: '#d9480f',
  /** Façades without windows towards a neighbouring parcel (mur aveugle). */
  blind: '#d9480f',
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

/** Wet rooms and shaft (light blue-grey) and the passage of a dwelling. */
export const WET_COLOR = '#d6e2ea';
export const SHAFT_COLOR = '#8a9aa6';

/**
 * Fill of a room inside a dwelling of colour `unit`: séjour a little darker, kitchen in
 * between, wet rooms blue-grey, the shaft dark, the passage like the rest of the dwelling.
 */
export function roomColor(unit: string, kind: RoomKind): string {
  switch (kind) {
    case 'sejour':
      return shade(unit, 0.12);
    case 'cuisine':
      return shade(unit, 0.06);
    case 'sdb':
    case 'sde':
    case 'wc':
      return WET_COLOR;
    case 'gaine':
      return SHAFT_COLOR;
    case 'degagement':
      return serviceColor(unit);
    default:
      return unit;
  }
}

/** Fill of the rest of a dwelling (entrance, kitchen, bathroom) when its rooms are drawn. */
export const serviceColor = (unit: string): string => shade(unit, -0.5);

/** Short room labels (French plan convention). */
export const ROOM_LABELS: Record<RoomKind, string> = {
  sejour: 'séj.',
  cuisine: 'cuis.',
  chambrePmr: 'PMR',
  chambre: 'ch.',
  sdb: 'sdb',
  sde: 'sde',
  wc: 'wc',
  gaine: 'g.',
  degagement: 'dgt',
};

/** Rooms drawn without a label (too small or self-evident). */
const UNLABELLED: readonly RoomKind[] = ['gaine', 'degagement'];

/** Short outdoor space labels (French plan convention). */
export const OUTDOOR_LABELS: Record<OutdoorType, string> = {
  balcon: 'bal.',
  loggia: 'log.',
  terrasse: 'terr.',
};

/** Colour of a unit type (by its position in the mix). */
export function unitColor(typeId: string, mix: readonly UnitType[]): string {
  const own = RESIDENCE_COLORS[typeId];
  if (own) return own;
  const i = mix.findIndex((t) => t.id === typeId);
  return UNIT_COLORS[(i < 0 ? UNIT_COLORS.length - 1 : i) % UNIT_COLORS.length]!;
}

export interface FloorPlanOptions extends CommonOptions {
  /** Unit labels (type + area), default true. */
  labels?: boolean;
  /** Faint site boundary, default true (neighbour boundaries in orange). */
  site?: boolean;
  /** Text of the boundary labels (default French: "Limite séparative", street names). */
  boundaryText?: (kind: BoundaryKind, name?: string) => string | undefined;
  /** Unit mix for colours (default: project settings). */
  unitMix?: readonly UnitType[];
  /** Tooltip text of the façade check, default French ("façade 9,40 m (min 9,10 m)"). */
  facadeText?: (facade: number, required: number) => string;
  /** Main rooms (séjour, chambre PMR, chambres) as rectangles, default true. */
  rooms?: boolean;
  /** Names of residence / office spaces (default French short labels). */
  spaceText?: (k: SpaceKind) => string;
  /** Word after the workstation count ("postes"). */
  desksText?: string;
  /** Short room labels inside the rectangles, default true. */
  roomLabels?: boolean;
  /** Outdoor spaces (balcons, loggias, terrasses), default true. */
  outdoor?: boolean;
  /** Outdoor space names (default: French short labels). */
  outdoorText?: (kind: OutdoorType) => string;
  /** Room names for tooltips and labels (default: French short labels). */
  roomText?: (kind: RoomKind) => string;
  /** Duplex texts: mark after the type and the level names (default: French). */
  duplexText?: { duplex: string; jour: string; nuit: string };
}

const BOUNDARY_LABELS: Partial<Record<BoundaryKind, string>> = {
  neighbour: 'Limite séparative',
  road: 'Voie',
  path: 'Chemin',
  public: 'Espace public',
};
const defaultBoundaryText = (k: BoundaryKind, name?: string) =>
  k === 'road' || k === 'path' ? (name ?? BOUNDARY_LABELS[k]) : BOUNDARY_LABELS[k];

/** Segment clipped to an axis-aligned box (Liang–Barsky), undefined when outside. */
function clipSegment(
  [a, b]: [Vec2, Vec2],
  e: { minX: number; minY: number; maxX: number; maxY: number },
): [Vec2, Vec2] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const ps = [-dx, dx, -dy, dy];
  const qs = [a[0] - e.minX, e.maxX - a[0], a[1] - e.minY, e.maxY - a[1]];
  for (let i = 0; i < 4; i++) {
    const p = ps[i]!;
    const q = qs[i]!;
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return undefined;
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
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

/** Segment moved by `d` to the side away from the polygons. */
function outsetSegment([a, b]: [Vec2, Vec2], polys: readonly Polygon[], d: number): Vec2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-9) return [a, b];
  let nx = -(b[1] - a[1]) / len;
  let ny = (b[0] - a[0]) / len;
  const mid: Vec2 = [(a[0] + b[0]) / 2 + nx * 0.05, (a[1] + b[1]) / 2 + ny * 0.05];
  if (polys.some((p) => pointInPolygon(mid, p))) {
    nx = -nx;
    ny = -ny;
  }
  return [
    [a[0] + nx * d, a[1] + ny * d],
    [b[0] + nx * d, b[1] + ny * d],
  ];
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
export function unitLabelPoint(p: Polygon, rooms: readonly Pick<LayoutRoom, 'polygon'>[]): Vec2 {
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

/** Default French texts of duplex dwellings. */
export const DUPLEX_LABELS: { duplex: string; jour: string; nuit: string } = {
  duplex: 'duplex',
  jour: 'niv. jour',
  nuit: 'niv. nuit',
};

/** Unit label: type, duplex mark, out-of-range and façade marks. */
export function unitTitle(
  u: Pick<LayoutUnit, 'label' | 'outOfRange' | 'facadeOk' | 'duplex'>,
  duplexText: string = DUPLEX_LABELS.duplex,
): string {
  return `${u.label}${u.duplex ? ` ${duplexText}` : ''}${u.outOfRange ? '*' : ''}${u.facadeOk ? '' : ' !'}`;
}

/** Areas to keep the unit label clear of: rooms and the duplex stair. */
export const labelObstacles = (u: Pick<LayoutUnit, 'rooms' | 'duplex'>): { polygon: Polygon }[] => [
  ...(u.rooms ?? []).filter((r) => r.kind !== 'degagement'),
  ...(u.duplex?.stair ? [{ polygon: u.duplex.stair }] : []),
];

/**
 * Internal stair of a duplex: a straight flight with treads across its length and an arrow
 * pointing up (drawn on both levels; on the upper level the arrow starts at the landing).
 */
export function duplexStairSymbol(stair: Polygon, upper: boolean): DItem[] {
  const r = stair.outer;
  if (r.length !== 4) return [line(r, 1, 'solid', '#55534e', true)];
  const [p0, p1, , p3] = r as [Vec2, Vec2, Vec2, Vec2];
  const o = p0;
  let e1: Vec2 = [p1[0] - p0[0], p1[1] - p0[1]];
  let e2: Vec2 = [p3[0] - p0[0], p3[1] - p0[1]];
  if (Math.hypot(...e2) > Math.hypot(...e1)) [e1, e2] = [e2, e1];
  const at = (a: number, b: number): Vec2 => [
    o[0] + e1[0] * a + e2[0] * b,
    o[1] + e1[1] * a + e2[1] * b,
  ];
  const out: DItem[] = [
    { kind: 'fill', rings: [r], fill: '#ffffff', pen: 1, stroke: '#55534e', title: 'escalier' },
  ];
  const steps = Math.max(4, Math.round(Math.hypot(...e1) / 0.26));
  for (let i = 1; i < steps; i++)
    out.push(line([at(i / steps, 0), at(i / steps, 1)], 1, 'solid', '#8a877f'));
  // walking line with arrow (up), from the bottom step on the lower level
  const a0 = upper ? 0.55 : 0.06;
  const a1 = 0.94;
  out.push(line([at(a0, 0.5), at(a1, 0.5)], 1, 'solid', '#55534e'));
  out.push(line([at(a1 - 0.1, 0.25), at(a1, 0.5), at(a1 - 0.1, 0.75)], 1, 'solid', '#55534e'));
  if (upper) out.push(line([at(0.5, 0), at(0.5, 1)], 2, 'dashed', '#55534e'));
  return out;
}

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
  const siteLabels: DItem[] = [];
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
    // neighbour boundaries (limites séparatives) in orange, labelled; streets labelled
    const text = opts.boundaryText ?? defaultBoundaryText;
    for (const s of siteBoundaries(project.site, project.surroundings, project.context)) {
      const pieces = clipSegment([s.a, s.b], ext);
      if (!pieces) continue;
      const [a, b] = pieces;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (s.kind === 'neighbour') items.push(line([a, b], 3, 'dashdot', FLOOR_PLAN_COLORS.party));
      const label = opts.labels === false || len < 8 ? undefined : text(s.kind, s.name);
      if (!label) continue;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      // outside the site, just beyond the boundary line
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      const out = pointInPolygon([mid[0] + nx * 0.1, mid[1] + ny * 0.1], project.site.boundary)
        ? -1
        : 1;
      siteLabels.push({
        kind: 'text',
        at: [mid[0] + out * nx * 1.2, mid[1] + out * ny * 1.2],
        text: label,
        sizeMm: 1.5,
        anchor: 'middle',
        baseline: 'middle',
        rotation: ang,
        color: s.kind === 'neighbour' ? FLOOR_PLAN_COLORS.party : '#7a7a7a',
      });
    }
  }

  // footprint of the whole building (other storeys) as a thin dashed outline
  const here = union(storeys.flatMap((s) => s.footprints));
  for (const p of all)
    for (const r of rings(p)) items.push(line(r, 1, 'dashed', COLORS.lightGrey, true));

  const labels: DItem[] = [];
  const roomName = opts.roomText ?? ((k: RoomKind) => ROOM_LABELS[k]);
  const dpx = opts.duplexText ?? DUPLEX_LABELS;
  for (const st of storeys) {
    for (const o of st.open) items.push(fill(o.polygon, FLOOR_PLAN_COLORS.open));
    for (const c of st.circulation)
      if (c.kind === 'lift') {
        // lift shaft opposite the stair: core fill with the shaft cross
        items.push(fill(c.polygon, FLOOR_PLAN_COLORS.core));
        const r = c.polygon.outer;
        items.push(line(r, 1, 'solid', FLOOR_PLAN_COLORS.coreLine, true));
        if (r.length === 4) {
          items.push(line([r[0]!, r[2]!], 1, 'solid', FLOOR_PLAN_COLORS.coreLine));
          items.push(line([r[1]!, r[3]!], 1, 'solid', FLOOR_PLAN_COLORS.coreLine));
        }
      } else items.push(fill(c.polygon, FLOOR_PLAN_COLORS.circulation));
    // spaces of residences / offices (common rooms, shafts, plateau)
    const spaceName = opts.spaceText ?? ((k: SpaceKind) => SPACE_LABELS[k]);
    const spaceItems = (sp: LayoutSpace, owner?: string) => {
      if (sp.overlay) {
        for (const r of rings(sp.polygon)) items.push(line(r, 1, 'solid', '#6f6c66', true));
        return;
      }
      items.push({
        kind: 'fill',
        rings: rings(sp.polygon),
        fill: SPACE_COLORS[sp.kind],
        pen: sp.kind === 'gaine' ? 2 : 1,
        stroke: '#55534e',
        title: `${owner ? `${owner} · ` : ''}${spaceName(sp.kind)} · ${fmtArea(sp.area)}${sp.desks ? ` · ${sp.desks} ${opts.desksText ?? 'postes'}` : ''}`,
      });
      if (
        !owner &&
        opts.labels !== false &&
        opts.roomLabels !== false &&
        sp.area >= spaceLabelMinArea(sp)
      ) {
        const big = sp.area >= 40;
        labels.push({
          kind: 'text',
          at: labelPoint(sp.polygon),
          text: spaceName(sp.kind),
          sizeMm: big ? 2 : 1.3,
          anchor: 'middle',
          baseline: big ? 'bottom' : 'middle',
          weight: big ? 'bold' : 'normal',
          color: '#3d3b37',
        });
        if (big)
          labels.push({
            kind: 'text',
            at: labelPoint(sp.polygon),
            text: `${fmtArea(sp.area)}${sp.desks ? ` · ${sp.desks} ${opts.desksText ?? 'postes'}` : ''}`,
            sizeMm: 1.5,
            anchor: 'middle',
            baseline: 'top',
            color: '#3d3b37',
            offsetMm: [0, -0.5],
          });
      }
    };
    for (const sp of st.spaces ?? []) if (sp.kind !== 'gaine') spaceItems(sp);
    for (const u of st.units)
      items.push({
        ...fill(
          u.polygon,
          opts.rooms !== false && u.rooms?.length
            ? serviceColor(unitColor(u.typeId, mix))
            : unitColor(u.typeId, mix),
        ),
        title: `${u.label}${u.duplex ? ` ${dpx.duplex} · ${dpx[u.duplex.level]} · ${fmtArea(u.duplex.totalArea)}` : ''} · ${fmtArea(u.area)}${u.outOfRange ? ' *' : ''} · ${(
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
            stroke: r.facadeOk && !r.onGallery ? '#55534e' : FLOOR_PLAN_COLORS.facadeFail,
            title: `${u.label} · ${roomName(r.kind)} · ${fmtArea(r.area)}${
              r.areaRequired > 0 ? ` (min ${fmtArea(r.areaRequired)})${r.areaOk ? '' : ' !'}` : ''
            }${
              r.facadeRequired > 0
                ? ` · ${(opts.facadeText ?? defaultFacadeText)(r.facade, r.facadeRequired)}${r.facadeOk ? '' : ' !'}`
                : ''
            }${r.onGallery ? ' · coursive !' : ''}`,
            ...(r.onGallery
              ? {
                  hatch: { angle: 45, spacingMm: 1.6, pen: 1, color: FLOOR_PLAN_COLORS.facadeFail },
                }
              : {}),
          });
          const small = r.area < 7;
          if (
            opts.roomLabels !== false &&
            opts.labels !== false &&
            !UNLABELLED.includes(r.kind) &&
            r.area >= 1.8
          )
            labels.push({
              kind: 'text',
              at: labelPoint(r.polygon),
              text: roomName(r.kind),
              sizeMm: small ? 1.0 : 1.3,
              anchor: 'middle',
              baseline: 'middle',
              color: r.facadeOk ? '#4a4843' : FLOOR_PLAN_COLORS.facadeFail,
            });
        }
      }
    if (opts.rooms !== false)
      for (const u of st.units) for (const sp of u.spaces ?? []) spaceItems(sp, u.label);
    for (const sp of st.spaces ?? []) if (sp.kind === 'gaine') spaceItems(sp);
    for (const u of st.units)
      if (u.duplex?.stair)
        items.push(...duplexStairSymbol(u.duplex.stair, u.duplex.part === 'upper'));
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
    for (const sp of st.spaces ?? [])
      if (sp.kind !== 'gaine')
        for (const r of rings(sp.polygon))
          items.push(line(r, 2, 'solid', FLOOR_PLAN_COLORS.wall, true));
    if (opts.labels !== false)
      for (const u of st.units) {
        const at = unitLabelPoint(
          u.polygon,
          opts.rooms === false
            ? u.duplex?.stair
              ? [{ polygon: u.duplex.stair }]
              : []
            : labelObstacles(u),
        );
        const big = polygonArea(u.polygon) > 12;
        labels.push({
          kind: 'text',
          at,
          text: unitTitle(u, dpx.duplex),
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
          text: u.duplex ? `${fmtArea(u.area)} · ${dpx[u.duplex.level]}` : fmtArea(u.area),
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
  // façades without windows towards a neighbour (mur aveugle): an orange band outside the wall
  for (const st of storeys)
    for (const seg of st.blindFacades ?? [])
      items.push(
        line(outsetSegment(seg, st.footprints, 0.35), 6, 'solid', FLOOR_PLAN_COLORS.blind),
      );
  items.push(...siteLabels);
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
  const groups = distinctStoreyGroups(layouts, (s) => s.units.length > 0 || !!s.office);
  if (groups.length) {
    const best = [...groups].sort(
      (a, b) => b.storeys.length - a.storeys.length || a.storeys[0]! - b.storeys[0]!,
    )[0]!;
    return best.storeys[0]!;
  }
  const all = layouts.flatMap((m) => m.storeys.map((s) => s.storeyIndex));
  return all.length ? Math.min(...all) : 0;
}
