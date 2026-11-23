/**
 * Residence storeys (résidence étudiante / résidence seniors, Wohnheim): many small repetitive
 * studios along a corridor, with
 *
 * - PMR studios next to the stair cores (share and minimum per storey),
 * - larger corner / end units at the building ends (T1bis / duo, T2 for seniors),
 * - two mirrored studios sharing one shaft on their party wall, opening to the corridor,
 * - common rooms (accueil, laverie, salle commune) on the lowest residence storey.
 *
 * Every studio is: entrance band behind the corridor (entrée + salle d'eau at the party wall),
 * then the main room on the façade with a kitchenette along the party wall. All rooms are
 * simple rectangles. Pure and deterministic; world coordinates.
 */
import { difference, intersection, normalizePolygon, polygonArea, union } from './geometry.js';
import {
  boxOf,
  coreCentres,
  layoutDimensions,
  rectPoly,
  simplify,
  solidBars,
  type Bar,
  type LayoutArea,
  type LayoutTypeCount,
  type LayoutUnit,
  type Rect,
  type StoreyLayout,
} from './layout.js';
import type { LayoutRoom } from './rooms.js';
import { resolveResidenceRules, type LayoutSpace, type ResidenceSummary } from './spaces.js';
import { shareCores } from './office.js';
import { requiredCores } from './typologies.js';
import { facadeOf, polygonEdges } from './unitRules.js';
import type { Mass, Polygon, ResidenceRules, Settings, StoreySolid, Vec2 } from './types.js';

export type ResidenceUnitKind = 'studio' | 'pmr' | 'corner';

export const RESIDENCE_TYPE_IDS: Record<ResidenceUnitKind, string> = {
  studio: 'rs-studio',
  pmr: 'rs-pmr',
  corner: 'rs-corner',
};

export function residenceTypeLabel(kind: ResidenceUnitKind, rules: ResidenceRules): string {
  if (kind === 'studio') return 'Studio';
  if (kind === 'pmr') return 'Studio PMR';
  return rules.variant === 'senior' ? 'T2' : 'Duo';
}

/** Beds of a unit: one per studio, two in a duo (student), one in a senior T2. */
export const residenceBeds = (kind: ResidenceUnitKind, rules: ResidenceRules): number =>
  kind === 'corner' && rules.variant === 'etudiant' ? 2 : 1;

/** Minimum façade of the main room(s): studio room 2.50, corner séjour 3.60 + chambre 2.50. */
const facadeNeed = (kind: ResidenceUnitKind): number => (kind === 'corner' ? 6.2 : 2.5);

/** Minimum depth of a studio row (entrance band + room), m. */
const MIN_ROW = 4.5;
const WALL = 0.1;

export interface ResidenceOptions {
  /** Units of the whole building: the common rooms go on this storey, sized for them. */
  totalUnits?: number;
}

interface Row {
  /** b-range of the row; façade at `fb`, corridor at `cb`. */
  b0: number;
  b1: number;
  facadeAtB0: boolean;
  cores: boolean;
}

interface Slot {
  a0: number;
  a1: number;
  kind: ResidenceUnitKind | 'common';
  /** Side of the party wall with the salle d'eau: -1 at a0, +1 at a1. */
  wet: -1 | 1;
}

/** Split a free interval of a row into units (end units at gables, PMR next to cores). */
function fillInterval(
  a0: number,
  a1: number,
  atGable0: boolean,
  atGable1: boolean,
  nextToCore0: boolean,
  nextToCore1: boolean,
  r: ResidenceRules,
  pmrLeft: { n: number },
): Slot[] {
  const len = a1 - a0;
  if (len < 1.5) return [];
  const head: Slot[] = [];
  const tail: Slot[] = [];
  let x0 = a0;
  let x1 = a1;
  const room = () => x1 - x0;
  if (atGable0 && room() >= r.cornerWidth + r.studioWidth) {
    head.push({ a0: x0, a1: x0 + r.cornerWidth, kind: 'corner', wet: 1 });
    x0 += r.cornerWidth;
  }
  if (atGable1 && room() >= r.cornerWidth + r.studioWidth) {
    tail.unshift({ a0: x1 - r.cornerWidth, a1: x1, kind: 'corner', wet: -1 });
    x1 -= r.cornerWidth;
  }
  if (pmrLeft.n > 0 && nextToCore0 && room() >= r.pmrWidth + r.studioWidth) {
    head.push({ a0: x0, a1: x0 + r.pmrWidth, kind: 'pmr', wet: 1 });
    x0 += r.pmrWidth;
    pmrLeft.n--;
  }
  if (pmrLeft.n > 0 && nextToCore1 && room() >= r.pmrWidth + r.studioWidth) {
    tail.unshift({ a0: x1 - r.pmrWidth, a1: x1, kind: 'pmr', wet: -1 });
    x1 -= r.pmrWidth;
    pmrLeft.n--;
  }
  const mid: Slot[] = [];
  // the count whose width is closest to the studio width (none narrower than 80 % of it)
  const fl = Math.floor(room() / r.studioWidth + 1e-6);
  const n =
    [fl, fl + 1]
      .filter((k) => k > 0 && room() / k >= 0.8 * r.studioWidth - 1e-6)
      .sort(
        (x, y) => Math.abs(room() / x - r.studioWidth) - Math.abs(room() / y - r.studioWidth),
      )[0] ?? 0;
  if (n <= 0) {
    // too short for a studio: widen the neighbour
    if (head.length) head[head.length - 1]!.a1 = x1;
    else if (tail.length) tail[0]!.a0 = x0;
    else if (room() >= 2.5) mid.push({ a0: x0, a1: x1, kind: 'studio', wet: 1 });
  } else {
    // repetitive studios; the rest of the interval widens or narrows them evenly
    const w = room() / n;
    for (let i = 0; i < n; i++)
      mid.push({
        a0: x0 + i * w,
        a1: i === n - 1 ? x1 : x0 + (i + 1) * w,
        kind: 'studio',
        // mirrored pairs: wet rooms at the shared party wall
        wet: i % 2 === 0 ? 1 : -1,
      });
  }
  return [...head, ...mid, ...tail];
}

/** Interior spaces and main rooms of one unit (frame rectangles). */
function unitParts(
  s: Slot,
  row: Row,
  r: ResidenceRules,
): {
  rooms: { kind: LayoutRoom['kind']; rect: Rect }[];
  spaces: { kind: LayoutSpace['kind']; rect: Rect; overlay?: boolean }[];
} {
  const depth = row.b1 - row.b0;
  // b measured from the corridor side
  const fromCorr = (t0: number, t1: number): [number, number] =>
    row.facadeAtB0 ? [row.b1 - t1, row.b1 - t0] : [row.b0 + t0, row.b0 + t1];
  const wet = Math.min(r.wetDepth, Math.max(1.6, depth - 2.6));
  const w = s.a1 - s.a0;
  const sdeW = Math.min(s.kind === 'studio' ? r.sdeWidth : Math.max(r.sdeWidth, 2.2), w - 0.9);
  // salle d'eau at the wet party wall, entrée beside it
  const [sa0, sa1] = s.wet > 0 ? [s.a1 - sdeW, s.a1] : [s.a0, s.a0 + sdeW];
  const [ea0, ea1] = s.wet > 0 ? [s.a0, s.a1 - sdeW - WALL] : [s.a0 + sdeW + WALL, s.a1];
  const [wb0, wb1] = fromCorr(0, wet);
  const [rb0, rb1] = fromCorr(wet + WALL, depth);
  const spaces: { kind: LayoutSpace['kind']; rect: Rect; overlay?: boolean }[] = [
    { kind: 'sde', rect: [sa0, wb0, sa1, wb1] },
    { kind: 'entree', rect: [ea0, wb0, ea1, wb1] },
  ];
  // kitchenette along the party wall of the salle d'eau (same shaft), inside the main room
  const kl = Math.min(r.kitchenetteLength, rb1 - rb0 - 1);
  const [kb0, kb1] = fromCorr(wet + WALL, wet + WALL + kl);
  const rooms: { kind: LayoutRoom['kind']; rect: Rect }[] = [];
  if (s.kind === 'corner') {
    // séjour at the gable (with the kitchen), chambre at the party wall side
    const chW = Math.max(2.5, Math.min(3.2, w - 3.6 - WALL));
    const gableAtA0 = s.wet > 0;
    const [ca0, ca1] = gableAtA0 ? [s.a1 - chW, s.a1] : [s.a0, s.a0 + chW];
    const [ja0, ja1] = gableAtA0 ? [s.a0, s.a1 - chW - WALL] : [s.a0 + chW + WALL, s.a1];
    rooms.push({ kind: 'sejour', rect: [ja0, rb0, ja1, rb1] });
    rooms.push({
      kind: r.variant === 'senior' ? 'chambrePmr' : 'chambre',
      rect: [ca0, rb0, ca1, rb1],
    });
    const [ka0, ka1] = gableAtA0 ? [ja1 - 0.65, ja1] : [ja0, ja0 + 0.65];
    spaces.push({ kind: 'kitchenette', rect: [ka0, kb0, ka1, kb1], overlay: true });
  } else {
    rooms.push({ kind: 'sejour', rect: [s.a0, rb0, s.a1, rb1] });
    const [ka0, ka1] = s.wet > 0 ? [s.a1 - 0.65, s.a1] : [s.a0, s.a0 + 0.65];
    spaces.push({ kind: 'kitchenette', rect: [ka0, kb0, ka1, kb1], overlay: true });
  }
  return { rooms, spaces };
}

/** Layout of one residence storey (all sections of the mass on this storey). */
export function residenceStoreyLayout(
  mass: Mass,
  solids: readonly StoreySolid[],
  settings: Settings,
  opts: ResidenceOptions = {},
): StoreyLayout {
  const first = solids[0]!;
  const r = resolveResidenceRules(mass, settings);
  const dim = layoutDimensions(settings);
  const outlines =
    mass.typology.kind === 'zeile' && solids.length > 1
      ? union(solids.map((s) => s.footprint))
      : solids.map((s) => normalizePolygon(s.footprint));
  const outline = union(outlines);
  const facadeSegs = polygonEdges(outline);
  const bars: Bar[] = outlines.flatMap((p) => solidBars(mass, p));
  const clip = (region: Polygon[], p: Polygon): Polygon[] =>
    intersection(region, [p]).filter((q) => polygonArea(q) > 1e-3);

  const cores: LayoutArea[] = [];
  const circulation: LayoutArea[] = [];
  const units: LayoutUnit[] = [];
  const spaces: LayoutSpace[] = [];
  const storeyArea = bars.reduce((a, b) => a + b.region.reduce((s, q) => s + polygonArea(q), 0), 0);
  // PMR quota of the storey (estimate of the studio count)
  const estUnits = Math.max(1, Math.round(storeyArea / (r.studioWidth * 6.5 * 1.25)));
  const pmrLeft = { n: Math.max(r.pmrMinPerStorey, Math.ceil(r.pmrShare * estUnits - 1e-9)) };
  let commonLeft =
    opts.totalUnits !== undefined ? Math.max(r.commonMin, r.commonPerUnit * opts.totalUnits) : 0;

  const nCoresTotal = Math.max(1, requiredCores(mass, 'mittelflur', settings));
  const coresPerBar = shareCores(nCoresTotal, bars);
  for (const bar of bars) {
    const { frame, region } = bar;
    const L = bar.length;
    const D = bar.depth;
    const cw = r.corridorWidth;
    // double-loaded corridor when two rows fit, else a corridor on the north side
    const rows: Row[] = [];
    let corridor: Rect;
    if (D >= 2 * MIN_ROW + cw) {
      const c0 = (D - cw) / 2;
      corridor = [0, c0, L, c0 + cw];
      rows.push({ b0: 0, b1: c0, facadeAtB0: true, cores: true });
      rows.push({ b0: c0 + cw, b1: D, facadeAtB0: false, cores: false });
    } else {
      corridor = [0, 0, L, Math.min(cw, D)];
      rows.push({ b0: Math.min(cw, D), b1: D, facadeAtB0: false, cores: true });
    }
    // cores of this bar: by length share of the escape / section rule (short wings: none)
    const n = coresPerBar[bars.indexOf(bar)]!;
    const centres = coreCentres(L, n);
    const coreRow = rows.find((x) => x.cores)!;
    const cwc = Math.min(dim.coreWidth, L / 2);
    const coreIv: [number, number][] = centres.map((c) => [c - cwc / 2, c + cwc / 2]);
    for (const [a0, a1] of coreIv)
      for (const p of clip(region, rectPoly(frame, [a0, coreRow.b0, a1, coreRow.b1])))
        cores.push({
          kind: 'core',
          polygon: p,
          area: polygonArea(p),
          index: cores.length,
          box: boxOf(frame, p),
        });
    // corridor (without the parts in front of nothing: it runs over the full bar)
    for (const p of clip(region, rectPoly(frame, corridor)))
      circulation.push({ kind: 'corridor', polygon: p, area: polygonArea(p) });

    for (const row of rows) {
      // occupied intervals of the row: cores, and the common rooms opposite the first core
      const occupied: [number, number][] = row.cores ? [...coreIv] : [];
      const commons: Slot[] = [];
      if (commonLeft > 1 && centres.length) {
        const target = row.cores && rows.length > 1 ? undefined : centres[0]!;
        if (target !== undefined) {
          const depth = row.b1 - row.b0;
          let w = Math.min(commonLeft / depth, L - 2 * r.studioWidth);
          if (!row.cores) {
            let s0 = Math.max(0, target - w / 2);
            const s1 = Math.min(L, s0 + w);
            s0 = Math.max(0, s1 - w);
            commons.push({ a0: s0, a1: s1, kind: 'common', wet: 1 });
            occupied.push([s0, s1]);
          } else {
            // single row: next to the core
            const a0 = coreIv[0]![1];
            w = Math.min(w, L - a0);
            commons.push({ a0, a1: a0 + w, kind: 'common', wet: 1 });
            occupied.push([a0, a0 + w]);
          }
          commonLeft = 0;
        }
      }
      occupied.sort((x, y) => x[0] - y[0]);
      const free: { a0: number; a1: number; core0: boolean; core1: boolean }[] = [];
      let x = 0;
      let prevCore = false;
      for (const [o0, o1] of occupied) {
        const isCore = coreIv.some(([c0, c1]) => c0 === o0 && c1 === o1) && row.cores;
        if (o0 - x > 1e-6) free.push({ a0: x, a1: o0, core0: prevCore, core1: isCore });
        x = Math.max(x, o1);
        prevCore = isCore;
      }
      if (L - x > 1e-6) free.push({ a0: x, a1: L, core0: prevCore, core1: false });
      const slots: Slot[] = [];
      for (const f of free)
        slots.push(
          ...fillInterval(f.a0, f.a1, f.a0 < 1e-6, f.a1 > L - 1e-6, f.core0, f.core1, r, pmrLeft),
        );

      // common rooms: accueil, laverie, salle commune
      for (const c of commons) {
        const w = c.a1 - c.a0;
        const acc = Math.min(4, w * 0.3);
        const lav = Math.min(4, w * 0.25);
        const parts: [LayoutSpace['kind'], number, number][] = [
          ['accueil', c.a0, c.a0 + acc],
          ['laverie', c.a0 + acc + WALL, c.a0 + acc + WALL + lav],
          ['salleCommune', c.a0 + acc + lav + 2 * WALL, c.a1],
        ];
        for (const [kind, p0, p1] of parts)
          if (p1 - p0 > 0.5)
            for (const p of clip(region, rectPoly(frame, [p0, row.b0, p1, row.b1])))
              spaces.push({ kind, polygon: simplify(p), area: polygonArea(p) });
      }

      // units
      for (const s of slots) {
        if (s.kind === 'common') continue;
        const polys = clip(region, rectPoly(frame, [s.a0, row.b0, s.a1, row.b1])).sort(
          (p, q) => polygonArea(q) - polygonArea(p),
        );
        const polygon = polys[0];
        if (!polygon || polygonArea(polygon) < 8) continue;
        const kind = s.kind;
        const parts = unitParts(s, row, r);
        const own = (rc: Rect) => clip([polygon], rectPoly(frame, rc));
        const rooms: LayoutRoom[] = [];
        for (const pr of parts.rooms)
          for (const p of own(pr.rect)) {
            const f = facadeOf(p, facadeSegs);
            const need = pr.kind === 'sejour' ? (kind === 'corner' ? 3.6 : 2.5) : 2.5;
            rooms.push({
              kind: pr.kind,
              polygon: simplify(p),
              area: polygonArea(p),
              facade: f.length,
              facadeRequired: need,
              facadeOk: f.length >= need - 1e-6,
              areaRequired: 0,
              areaOk: true,
            } as LayoutRoom);
          }
        const inner: LayoutSpace[] = [];
        for (const sp of parts.spaces)
          for (const p of own(sp.rect))
            inner.push({
              kind: sp.kind,
              polygon: simplify(p),
              area: polygonArea(p),
              ...(sp.overlay ? { overlay: true } : {}),
            });
        const poly = simplify(polygon);
        const facade = facadeOf(poly, facadeSegs);
        const need = facadeNeed(kind);
        units.push({
          polygon: poly,
          typeId: RESIDENCE_TYPE_IDS[kind],
          label: residenceTypeLabel(kind, r),
          area: polygonArea(poly),
          coreIndex: -1,
          outOfRange: false,
          facade: facade.length,
          facadeRequired: need,
          facadeOk: facade.length >= need - 1e-6,
          facadeSegments: facade.segments,
          rooms,
          spaces: inner,
        });
      }

      // shared shafts: on the party wall of two studios with their wet rooms against it
      const [sw, sd] = r.shaft;
      const [cb0, cb1] = row.facadeAtB0 ? [row.b1 - sd, row.b1] : [row.b0, row.b0 + sd];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i]!;
        if (s.kind === 'common') continue;
        const next = slots[i + 1];
        let rc: Rect | undefined;
        if (
          s.wet > 0 &&
          next &&
          next.kind !== 'common' &&
          next.wet < 0 &&
          Math.abs(next.a0 - s.a1) < 1e-6
        ) {
          rc = [s.a1 - sw / 2, cb0, s.a1 + sw / 2, cb1];
          i++;
        } else {
          // a unit without a mirrored neighbour has its own shaft (60 × 60)
          const own = Math.min(sw, sd);
          rc = s.wet > 0 ? [s.a1 - own, cb0, s.a1, cb1] : [s.a0, cb0, s.a0 + own, cb1];
        }
        for (const p of clip(region, rectPoly(frame, rc)))
          spaces.push({ kind: 'gaine', polygon: simplify(p), area: polygonArea(p) });
      }
    }
  }
  // salles d'eau without the shafts (no overlaps between zones)
  const shafts = spaces.filter((s) => s.kind === 'gaine').map((s) => s.polygon);
  if (shafts.length)
    for (const u of units)
      for (const sp of u.spaces ?? []) {
        if (sp.kind !== 'sde') continue;
        const rest = difference([sp.polygon], shafts).sort(
          (a, b) => polygonArea(b) - polygonArea(a),
        )[0];
        if (rest) {
          sp.polygon = rest;
          sp.area = polygonArea(rest);
        }
      }
  for (const u of units) u.coreIndex = nearestCore(cores, u.polygon);

  const byTypeMap = new Map<string, LayoutTypeCount>();
  for (const u of units) {
    const c = byTypeMap.get(u.typeId) ?? { typeId: u.typeId, label: u.label, count: 0, area: 0 };
    c.count++;
    c.area += u.area;
    byTypeMap.set(u.typeId, c);
  }
  const order = Object.values(RESIDENCE_TYPE_IDS);
  const byType = [...byTypeMap.values()].sort(
    (a, b) => order.indexOf(a.typeId) - order.indexOf(b.typeId),
  );
  const sum = (xs: readonly { area: number }[]) => xs.reduce((s, x) => s + x.area, 0);
  const footprints = solids.map((s) => normalizePolygon(s.footprint));
  const kindOf = (u: LayoutUnit): ResidenceUnitKind =>
    (Object.keys(RESIDENCE_TYPE_IDS) as ResidenceUnitKind[]).find(
      (k) => RESIDENCE_TYPE_IDS[k] === u.typeId,
    ) ?? 'studio';
  const commonArea = sum(
    spaces.filter((s) => ['accueil', 'laverie', 'salleCommune'].includes(s.kind)),
  );
  const residence: ResidenceSummary = {
    variant: r.variant,
    units: units.length,
    beds: units.reduce((s, u) => s + residenceBeds(kindOf(u), r), 0),
    pmr: units.filter((u) => u.typeId === RESIDENCE_TYPE_IDS.pmr || r.variant === 'senior').length,
    commonArea,
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const out: StoreyLayout = {
    massId: mass.id,
    storeyIndex: first.storeyIndex,
    label: first.label,
    usage: first.usage,
    access: 'mittelflur',
    setback: first.setback,
    z0: first.z0,
    z1: Math.max(...solids.map((x) => x.z1)),
    footprints,
    cores,
    circulation,
    open: [],
    units,
    summary: {
      units: units.length,
      byType,
      unitArea: sum(units),
      coreArea: sum(cores),
      circulationArea: sum(circulation),
      openArea: commonArea,
      footprintArea: sum(footprints.map((p) => ({ area: polygonArea(p) }))),
      facadeViolations: units.filter((u) => !u.facadeOk).length,
    },
    signature: [
      'wohnheim',
      r.variant,
      ...footprints.map((p) => p.outer.map(([x, y]) => `${r1(x)},${r1(y)}`).join(';')),
      ...units.map((u) => `${u.typeId}:${r1(u.area)}`),
      `c${r1(commonArea)}`,
    ].join('|'),
    spaces,
    residence,
  };
  if (cores.length && units.length)
    out.unitsPerCore = Math.round((units.length / cores.length) * 10) / 10;
  return out;
}

const centroid = (p: Polygon): Vec2 => {
  let x = 0;
  let y = 0;
  for (const q of p.outer) {
    x += q[0];
    y += q[1];
  }
  return [x / p.outer.length, y / p.outer.length];
};

function nearestCore(cores: readonly LayoutArea[], p: Polygon): number {
  if (!cores.length) return -1;
  const c = centroid(p);
  let best = 0;
  let bd = Infinity;
  cores.forEach((k, i) => {
    const q = centroid(k.polygon);
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}
