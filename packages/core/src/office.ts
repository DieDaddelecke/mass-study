/**
 * Office storeys (plateau de bureaux, Büro): central cores (stair + lift) with a sanitary block,
 * and the plateau on the façade grid (trame 1.35 m) as
 *
 * - open space: one plateau around the cores, meeting rooms beside the cores,
 * - cellulaire: central corridor, cellular offices of n grid modules on both façades,
 * - mixte: cellular offices on the north façade, corridor, open space on the south.
 *
 * The ground floor gets an entrance hall (hall d'accueil) in front of the first core.
 * Workstations follow the usable area (m² per desk). Pure and deterministic; world coordinates.
 */
import { intersection, normalizePolygon, polygonArea, union } from './geometry.js';
import {
  boxOf,
  coreCentres,
  rectPoly,
  simplify,
  solidBars,
  type Bar,
  type LayoutArea,
  type Rect,
  type StoreyLayout,
} from './layout.js';
import {
  OFFICE_USABLE,
  resolveOfficeRules,
  type LayoutSpace,
  type OfficeSummary,
} from './spaces.js';
import { requiredCores } from './typologies.js';
import type { Mass, OfficeRules, Polygon, Settings, StoreySolid } from './types.js';

/** Bars at least this deep get a central core with plateau on both sides, m. */
const CENTRAL_MIN_DEPTH = 10;
/** Workstations above which a storey needs a second stair core (two escape routes). */
const SECOND_STAIR_DESKS = 100;
const WALL = 0.1;

type Iv = [number, number];

/** Free intervals of [0, L] outside the occupied ones. */
function freeIntervals(L: number, occupied: readonly Iv[]): Iv[] {
  const occ = [...occupied].sort((a, b) => a[0] - b[0]);
  const out: Iv[] = [];
  let x = 0;
  for (const [a, b] of occ) {
    if (a - x > 0.3) out.push([x, Math.min(a, L)]);
    x = Math.max(x, b);
  }
  if (L - x > 0.3) out.push([x, L]);
  return out;
}

/** Cells of `width` (grid modules) in an interval; the rest widens the last cell. */
function cells(iv: Iv, width: number): Iv[] {
  const len = iv[1] - iv[0];
  if (len < 2) return [];
  const n = Math.max(1, Math.floor(len / width + 1e-6));
  const out: Iv[] = [];
  for (let i = 0; i < n; i++)
    out.push([iv[0] + i * width, i === n - 1 ? iv[1] : iv[0] + (i + 1) * width]);
  return out;
}

/**
 * Cores per bar: the total split by bar length (largest remainder); short bars without a core
 * are served by the cores of their neighbours.
 */
export function shareCores(total: number, bars: readonly { length: number }[]): number[] {
  const sum = bars.reduce((s, b) => s + b.length, 0) || 1;
  const raw = bars.map((b) => (total * b.length) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

interface Item {
  kind: LayoutSpace['kind'] | 'core' | 'corridor';
  rect: Rect;
}

/** Layout of one office storey (all sections of the mass on this storey). */
export function officeStoreyLayout(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
): StoreyLayout {
  const first = solids[0]!;
  const O: OfficeRules = resolveOfficeRules(mass, settings);
  const g = O.grid;
  const outlines =
    mass.typology.kind === 'zeile' && solids.length > 1
      ? union(solids.map((s) => s.footprint))
      : solids.map((s) => normalizePolygon(s.footprint));
  const bars: Bar[] = outlines.flatMap((p) => solidBars(mass, p));
  const clip = (region: Polygon[], p: Polygon): Polygon[] =>
    intersection(region, [p]).filter((q) => polygonArea(q) > 1e-3);
  const storeyArea = bars.reduce((a, b) => a + b.region.reduce((s, q) => s + polygonArea(q), 0), 0);
  const estDesks = (0.7 * storeyArea) / O.areaPerDeskOpen;
  const nCores = Math.max(
    requiredCores(mass, 'buero', settings),
    estDesks > SECOND_STAIR_DESKS && storeyArea > 600 ? 2 : 1,
  );
  const coresPerBar = shareCores(nCores, bars);
  let meetingsLeft = Math.ceil(estDesks / O.desksPerMeeting);
  const ground = first.storeyIndex === 0;
  let lobbyLeft = ground;

  const cores: LayoutArea[] = [];
  const circulation: LayoutArea[] = [];
  const spaces: LayoutSpace[] = [];
  let facadeDistance = 0;

  for (const bar of bars) {
    const { frame, region } = bar;
    const L = bar.length;
    const D = bar.depth;
    const central = D >= CENTRAL_MIN_DEPTH;
    const n = coresPerBar[bars.indexOf(bar)]!;
    const gw = Math.min(O.coreWidth + O.sanitaryWidth, L * 0.6);
    const coreW = (gw * O.coreWidth) / (O.coreWidth + O.sanitaryWidth);
    const centres = coreCentres(L, n);
    const groups: Iv[] = centres.map((c) => [c - gw / 2, c + gw / 2]);
    const items: Item[] = [];
    const openRects: Rect[] = [];
    const cw = O.corridorWidth;
    const cellW = O.cellModules * g;
    const meetW = O.meetingModules * g;
    const coreGroup = (b0: number, b1: number) => {
      for (const [a0, a1] of groups) {
        items.push({ kind: 'core', rect: [a0, b0, a0 + coreW, b1] });
        items.push({ kind: 'sanitaires', rect: [a0 + coreW + WALL, b0, a1, b1] });
      }
    };
    const lobbyAt = (b0: number, b1: number): Iv | undefined => {
      if (!lobbyLeft || !centres.length || b1 - b0 < 2) return undefined;
      lobbyLeft = false;
      const hw = Math.min(O.lobbyModules * g, L * 0.4);
      const c = centres[0]!;
      const iv: Iv = [Math.max(0, c - hw / 2), Math.min(L, c + hw / 2)];
      items.push({ kind: 'hall', rect: [iv[0], b0, iv[1], b1] });
      return iv;
    };
    /** Cellular offices (and meeting rooms next to the cores) in a row. */
    const cellRow = (b0: number, b1: number, occupied: Iv[], meetings: boolean) => {
      for (const iv of freeIntervals(L, occupied)) {
        let [x0, x1] = iv;
        const touchesCore0 = groups.some(([, a1]) => Math.abs(a1 - x0) < 1e-6);
        const touchesCore1 = groups.some(([a0]) => Math.abs(a0 - x1) < 1e-6);
        if (meetings && meetingsLeft > 0 && touchesCore0 && x1 - x0 >= meetW + cellW) {
          items.push({ kind: 'reunion', rect: [x0, b0, x0 + meetW, b1] });
          x0 += meetW + WALL;
          meetingsLeft--;
        }
        if (meetings && meetingsLeft > 0 && touchesCore1 && x1 - x0 >= meetW + cellW) {
          items.push({ kind: 'reunion', rect: [x1 - meetW, b0, x1, b1] });
          x1 -= meetW + WALL;
          meetingsLeft--;
        }
        for (const [c0, c1] of cells([x0, x1], cellW))
          items.push({
            kind: 'bureau',
            rect: [c0 + (c0 > x0 ? WALL / 2 : 0), b0, c1 - (c1 < x1 ? WALL / 2 : 0), b1],
          });
      }
    };

    if (O.layout === 'openSpace') {
      const cd = central ? Math.min(O.coreDepth, D - 6) : Math.min(O.coreDepth, D * 0.6);
      const cz0 = central ? (D - cd) / 2 : 0;
      const cz1 = cz0 + cd;
      coreGroup(cz0, cz1);
      // meeting rooms beside the cores, in the core band
      const occupiedCore: Iv[] = [...groups];
      for (const [a0, a1] of groups) {
        for (const side of [1, -1] as const) {
          if (meetingsLeft <= 0) break;
          const iv: Iv = side > 0 ? [a1 + WALL, a1 + WALL + meetW] : [a0 - WALL - meetW, a0 - WALL];
          if (iv[0] < 0 || iv[1] > L) continue;
          items.push({ kind: 'reunion', rect: [iv[0], cz0, iv[1], cz1] });
          occupiedCore.push([iv[0] - WALL, iv[1] + WALL]);
          meetingsLeft--;
        }
      }
      for (const [a0, a1] of freeIntervals(L, occupiedCore)) openRects.push([a0, cz0, a1, cz1]);
      if (cz0 > 0.5) openRects.push([0, 0, L, cz0]);
      if (D - cz1 > 0.5) {
        const hall = lobbyAt(cz1, D);
        if (hall) {
          for (const [a0, a1] of freeIntervals(L, [[hall[0] - WALL, hall[1] + WALL]]))
            openRects.push([a0, cz1, a1, D]);
        } else openRects.push([0, cz1, L, D]);
      }
      facadeDistance = Math.max(facadeDistance, central ? D / 2 : D);
    } else if (O.layout === 'cellulaire' || !central) {
      // corridor in the middle (or on the north side of a narrow bar), offices on the façades
      const c0 = central ? (D - cw) / 2 : 0;
      const c1 = c0 + cw;
      const cd = central ? Math.min(O.coreDepth, D - 5) : Math.min(O.coreDepth, D);
      const cz0 = central ? (D - cd) / 2 : 0;
      coreGroup(cz0, cz0 + cd);
      for (const [a0, a1] of freeIntervals(L, groups))
        items.push({ kind: 'corridor', rect: [a0, c0, a1, c1] });
      if (central) cellRow(0, c0, groups, true);
      // ground floor of a central core: the hall behind the first core
      const hall = central ? undefined : lobbyAt(c1, D);
      cellRow(c1, D, hall ? [...groups, [hall[0] - WALL, hall[1] + WALL]] : groups, !central);
      // offices in front of / behind the cores where the core is shallower than the plateau
      groups.forEach(([a0, a1], gi) => {
        if (!central) return;
        const split = (b0: number, b1: number) => {
          for (const [x0, x1] of cells([a0, a1], cellW))
            items.push({ kind: 'bureau', rect: [x0 + WALL / 2, b0, x1 - WALL / 2, b1] });
        };
        if (cz0 > 2.4) split(0, cz0);
        if (D - (cz0 + cd) > 2.4) {
          if (gi === 0 && lobbyLeft) {
            lobbyLeft = false;
            items.push({ kind: 'hall', rect: [a0, cz0 + cd, a1, D] });
          } else split(cz0 + cd, D);
        }
      });
      facadeDistance = Math.max(facadeDistance, central ? c0 : D - cw);
    } else {
      // mixte: offices on the north façade, corridor, open space to the south façade
      const rowD = Math.min(5.4, (D - cw) / 2);
      const c0 = rowD;
      const c1 = c0 + cw;
      const cd = Math.min(O.coreDepth, D - c1 - 3);
      coreGroup(c1, c1 + cd);
      items.push({ kind: 'corridor', rect: [0, c0, L, c1] });
      cellRow(0, c0, groups, false);
      // meeting rooms on the north façade opposite the cores
      for (const [a0, a1] of groups)
        for (const [m0, m1] of cells([a0, a1], meetW)) {
          items.push({
            kind: meetingsLeft > 0 ? 'reunion' : 'bureau',
            rect: [m0 + WALL / 2, 0, m1 - WALL / 2, c0],
          });
          meetingsLeft--;
        }
      // open space: beside the cores in the core band, and the full width behind them
      for (const [a0, a1] of freeIntervals(L, groups)) openRects.push([a0, c1, a1, c1 + cd]);
      if (D - (c1 + cd) > 0.5) {
        const hall = lobbyAt(c1 + cd, D);
        if (hall)
          for (const [a0, a1] of freeIntervals(L, [[hall[0] - WALL, hall[1] + WALL]]))
            openRects.push([a0, c1 + cd, a1, D]);
        else openRects.push([0, c1 + cd, L, D]);
      }
      facadeDistance = Math.max(facadeDistance, rowD, D - c1);
    }

    // to world, clipped to the bar
    for (const it of items) {
      const polys = clip(region, rectPoly(frame, it.rect));
      for (const p of polys) {
        const polygon = simplify(p);
        const area = polygonArea(polygon);
        if (it.kind === 'core')
          cores.push({ kind: 'core', polygon, area, index: cores.length, box: boxOf(frame, p) });
        else if (it.kind === 'corridor') circulation.push({ kind: 'corridor', polygon, area });
        else spaces.push({ kind: it.kind, polygon, area });
      }
    }
    if (openRects.length) {
      const merged = union(openRects.map((rc) => rectPoly(frame, rc)));
      for (const p of intersection(region, merged))
        if (polygonArea(p) > 1)
          spaces.push({ kind: 'openSpace', polygon: simplify(p), area: polygonArea(p) });
    }
  }

  // corridors without the cores (the core holds the landing)
  // workstations
  for (const s of spaces) {
    if (s.kind === 'openSpace') s.desks = Math.floor(s.area / O.areaPerDeskOpen);
    else if (s.kind === 'bureau') s.desks = Math.max(1, Math.floor(s.area / O.areaPerDeskCell));
  }
  const sum = (xs: readonly { area: number }[]) => xs.reduce((s, x) => s + x.area, 0);
  const footprints = solids.map((s) => normalizePolygon(s.footprint));
  const footprintArea = footprints.reduce((s, p) => s + polygonArea(p), 0);
  const office: OfficeSummary = {
    layout: O.layout,
    usable: sum(spaces.filter((s) => OFFICE_USABLE.includes(s.kind))),
    desks: spaces.reduce((s, x) => s + (x.desks ?? 0), 0),
    meetingRooms: spaces.filter((s) => s.kind === 'reunion').length,
    lifts: Math.max(1, Math.ceil(footprintArea / O.areaPerLift)),
    facadeDistance,
    depthOk: facadeDistance <= O.maxFacadeDistance + 1e-6,
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    massId: mass.id,
    storeyIndex: first.storeyIndex,
    label: first.label,
    usage: first.usage,
    access: 'buero',
    setback: first.setback,
    z0: first.z0,
    z1: Math.max(...solids.map((x) => x.z1)),
    footprints,
    cores,
    circulation,
    open: [],
    units: [],
    summary: {
      units: 0,
      byType: [],
      unitArea: 0,
      coreArea: sum(cores),
      circulationArea: sum(circulation),
      openArea: sum(spaces),
      footprintArea,
      facadeViolations: 0,
    },
    signature: [
      'buero',
      O.layout,
      ...footprints.map((p) => p.outer.map(([x, y]) => `${r1(x)},${r1(y)}`).join(';')),
      ...spaces.map((s) => `${s.kind}:${r1(s.area)}`),
    ].join('|'),
    spaces,
    office,
  };
}
