/**
 * Renderer-neutral schedules (SPEC §8.6): surfaces, KPIs, typologies & mix, variant comparison.
 *
 * The model contains no translated text: every label is a {@link TextRef} (i18n key + params),
 * so the UI table, XLSX/CSV exports and the PDF dossier render the same structure in any language.
 * Subtotal and total rows carry the indices of the rows they aggregate (`sums`), so spreadsheet
 * renderers can write real SUM formulas instead of static values.
 */
import { sumAreas, ZERO_AREAS, type AreaFigures } from './areas.js';
import type { MassResult, SolidResult } from './analysis.js';
import { parking } from './mix.js';
import { analyzeProject, type ProjectAnalysis } from './project.js';
import type { Traffic } from './typologies.js';
import type { Project, Usage } from './types.js';

/** i18n reference: `key` is a namespaced i18next key (e.g. `common:usage.wohnen`). */
export interface TextRef {
  key: string;
  params?: Record<string, string | number>;
}

/** Number / value formats; decimals are fixed so that every renderer rounds identically. */
export type ScheduleFormat = 'text' | 'int' | 'dec1' | 'dec2' | 'bool';

export const FORMAT_DECIMALS: Record<ScheduleFormat, number> = {
  text: 0,
  int: 0,
  dec1: 1,
  dec2: 2,
  bool: 0,
};

export type ScheduleUnit = 'm' | 'm2' | 'm3' | 'count';

/** Cell value: literal string (names, R+n formulas), number, boolean, translated text or list. */
export type ScheduleCell = number | string | boolean | null | TextRef | TextRef[];

export interface ScheduleColumn {
  key: string;
  label: TextRef;
  unit?: ScheduleUnit;
  format: ScheduleFormat;
  /** Values of this column are added up in subtotal / total rows. */
  sum?: boolean;
  /** Suggested width in characters (spreadsheet renderers). */
  width?: number;
}

export type ScheduleRowKind = 'group' | 'row' | 'subtotal' | 'total';

export interface ScheduleRow {
  kind: ScheduleRowKind;
  /** Nesting depth for indentation (0 = outermost). */
  depth: number;
  cells: Record<string, ScheduleCell>;
  /** Per-row format overrides (KPI tables mix units in one column). */
  formats?: Record<string, ScheduleFormat>;
  /** Per-row unit overrides (shown in a unit column or appended by renderers). */
  units?: Record<string, ScheduleUnit>;
  /** Indices (into `rows`) of the rows a subtotal / total aggregates. */
  sums?: number[];
  massId?: string;
  variantId?: string;
  status?: Traffic | 'none';
}

export type ScheduleId = 'surfaces' | 'kpis' | 'typologies' | 'comparison';

export interface Schedule {
  id: ScheduleId;
  title: TextRef;
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
}

const tr = (key: string, params?: TextRef['params']): TextRef =>
  params ? { key: `tables:${key}`, params } : { key: `tables:${key}` };

export function isTextRef(v: ScheduleCell): v is TextRef {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Effective format of a cell (row override first). */
export function cellFormat(col: ScheduleColumn, row: ScheduleRow): ScheduleFormat {
  return row.formats?.[col.key] ?? col.format;
}

/** Round to the column format so that displayed values and sums agree. */
export function roundTo(v: number, format: ScheduleFormat): number {
  const f = 10 ** FORMAT_DECIMALS[format];
  return Math.round(v * f) / f;
}

type Analyses = Map<string, ProjectAnalysis>;

function analysesFor(project: Project, variantIds: readonly string[], given?: Analyses): Analyses {
  const out: Analyses = new Map();
  for (const id of variantIds) out.set(id, given?.get(id) ?? analyzeProject(project, id));
  return out;
}

export interface ScheduleOptions {
  /** Variants to include (default: the active one; the comparison uses all variants). */
  variantIds?: string[];
  /** Precomputed analyses by variant id (e.g. the live analysis of the UI). */
  analyses?: Analyses;
}

// ---------------------------------------------------------------------------
// 1. Surfaces: Variante › Baukörper › Geschoss
// ---------------------------------------------------------------------------

const AREA_KEYS = ['bgf', 'kgf', 'nrf', 'nuf', 'vf', 'tf'] as const;

function surfaceColumns(): ScheduleColumn[] {
  const area = (k: string): ScheduleColumn => ({
    key: k,
    label: tr(`col.${k}`),
    unit: 'm2',
    format: 'dec2',
    sum: true,
    width: 11,
  });
  return [
    { key: 'name', label: tr('col.name'), format: 'text', width: 26 },
    { key: 'usage', label: tr('col.usage'), format: 'text', width: 14 },
    { key: 'height', label: tr('col.storeyHeight'), unit: 'm', format: 'dec2', width: 9 },
    { key: 'level', label: tr('col.level'), unit: 'm', format: 'dec2', width: 9 },
    { key: 'fullStorey', label: tr('col.fullStorey'), format: 'bool', width: 8 },
    ...AREA_KEYS.map(area),
    { key: 'bri', label: tr('col.bri'), unit: 'm3', format: 'dec2', sum: true, width: 12 },
  ];
}

interface StoreyLine {
  storeyIndex: number;
  label: string;
  usage: Usage;
  height: number;
  level: number;
  fullStorey: boolean;
  areas: AreaFigures;
  aboveGround: boolean;
}

/** Merge the sections of one storey (Zeile / Reihe) into one line. */
function storeyLines(m: MassResult): StoreyLine[] {
  const by = new Map<number, SolidResult[]>();
  for (const s of m.solids) {
    const list = by.get(s.solid.storeyIndex) ?? [];
    list.push(s);
    by.set(s.solid.storeyIndex, list);
  }
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([storeyIndex, list]) => {
      const first = list[0]!;
      return {
        storeyIndex,
        label: first.solid.label,
        usage: first.solid.usage,
        height: Math.max(...list.map((s) => s.solid.z1 - s.solid.z0)),
        level: Math.min(...list.map((s) => s.solid.z0)),
        fullStorey: list.some((s) => s.fullStorey),
        areas: sumAreas(list.map((s) => s.areas)),
        aboveGround: first.solid.aboveGround,
      };
    });
}

function areaCells(a: AreaFigures): Record<string, ScheduleCell> {
  const c: Record<string, ScheduleCell> = {};
  for (const k of AREA_KEYS) c[k] = a[k];
  c.bri = a.bri;
  return c;
}

export function surfacesSchedule(project: Project, opts: ScheduleOptions = {}): Schedule {
  const ids = opts.variantIds ?? [project.activeVariantId];
  const analyses = analysesFor(project, ids, opts.analyses);
  const rows: ScheduleRow[] = [];
  const push = (r: ScheduleRow) => rows.push(r) - 1;

  for (const id of ids) {
    const variant = project.variants.find((v) => v.id === id);
    const a = analyses.get(id);
    if (!variant || !a) continue;
    push({ kind: 'group', depth: 0, variantId: id, cells: { name: variant.name } });
    const massAbove: number[] = [];
    const massBelow: number[] = [];
    const massTotals: number[] = [];
    for (const m of a.result.masses) {
      const base = { variantId: id, massId: m.mass.id };
      push({ kind: 'group', depth: 1, ...base, cells: { name: m.mass.name, usage: m.formula } });
      const lines = storeyLines(m);
      const hasBelow = lines.some((l) => !l.aboveGround);
      const sectionRows = (above: boolean) =>
        lines
          .filter((l) => l.aboveGround === above)
          .map((l) =>
            push({
              kind: 'row',
              depth: 2,
              ...base,
              cells: {
                name: l.label,
                usage: { key: `common:usage.${l.usage}` },
                height: l.height,
                level: l.level,
                fullStorey: l.fullStorey,
                ...areaCells(l.areas),
              },
            }),
          );
      const aboveRows = sectionRows(true);
      if (hasBelow) {
        const aboveSub = push({
          kind: 'subtotal',
          depth: 2,
          ...base,
          sums: aboveRows,
          cells: { name: tr('row.aboveGround'), ...areaCells(m.areasAbove) },
        });
        const belowRows = sectionRows(false);
        const belowSub = push({
          kind: 'subtotal',
          depth: 2,
          ...base,
          sums: belowRows,
          cells: { name: tr('row.belowGround'), ...areaCells(m.areasBelow) },
        });
        massAbove.push(aboveSub);
        massBelow.push(belowSub);
        massTotals.push(
          push({
            kind: 'subtotal',
            depth: 1,
            ...base,
            sums: [aboveSub, belowSub],
            cells: { name: tr('row.massTotal', { name: m.mass.name }), ...areaCells(m.areas) },
          }),
        );
      } else {
        const sub = push({
          kind: 'subtotal',
          depth: 1,
          ...base,
          sums: aboveRows,
          cells: { name: tr('row.massTotal', { name: m.mass.name }), ...areaCells(m.areas) },
        });
        massAbove.push(sub);
        massTotals.push(sub);
      }
    }
    const r = a.result;
    if (massBelow.length) {
      push({
        kind: 'total',
        depth: 0,
        variantId: id,
        sums: massAbove,
        cells: { name: tr('row.totalAboveGround'), ...areaCells(r.areasAbove) },
      });
      push({
        kind: 'total',
        depth: 0,
        variantId: id,
        sums: massBelow,
        cells: { name: tr('row.totalBelowGround'), ...areaCells(r.areasBelow) },
      });
    }
    push({
      kind: 'total',
      depth: 0,
      variantId: id,
      sums: massTotals,
      cells: {
        name: tr('row.variantTotal', { name: variant.name }),
        ...areaCells(r.masses.length ? r.areas : ZERO_AREAS),
      },
    });
  }
  return { id: 'surfaces', title: tr('tab.surfaces'), columns: surfaceColumns(), rows };
}

// ---------------------------------------------------------------------------
// 2. KPIs (actual | target | status), following the rule profile
// ---------------------------------------------------------------------------

interface KpiLine {
  key: string;
  unit?: ScheduleUnit;
  format: ScheduleFormat;
  value: (a: ProjectAnalysis) => number | string;
  /** Key of the matching constraint row (targets and traffic light). */
  constraint?: string;
  group: 'site' | 'density' | 'height' | 'program';
}

function kpiLines(profile: Project['settings']['profile']): KpiLine[] {
  const common: KpiLine[] = [
    { key: 'bgf', unit: 'm2', format: 'dec2', group: 'program', value: (a) => a.result.areas.bgf },
    { key: 'nuf', unit: 'm2', format: 'dec2', group: 'program', value: (a) => a.result.areas.nuf },
    {
      key: 'dwellings',
      unit: 'count',
      format: 'int',
      group: 'program',
      value: (a) => a.result.dwellings,
    },
    {
      key: 'livingArea',
      unit: 'm2',
      format: 'dec2',
      group: 'program',
      value: (a) => a.result.livingArea,
    },
    {
      key: 'workplaces',
      unit: 'count',
      format: 'int',
      group: 'program',
      value: (a) => a.result.workplaces,
    },
    {
      key: 'parkingDemand',
      unit: 'count',
      format: 'int',
      group: 'program',
      value: (a) => a.result.parking.demand,
    },
    {
      key: 'parkingCapacity',
      unit: 'count',
      format: 'int',
      group: 'program',
      value: (a) => a.result.parking.capacity,
    },
  ];
  if (profile === 'FR') {
    return [
      { key: 'siteArea', unit: 'm2', format: 'dec2', group: 'site', value: (a) => a.fr.siteArea },
      { key: 'emprise', unit: 'm2', format: 'dec2', group: 'site', value: (a) => a.fr.emprise },
      { key: 'ces', format: 'dec2', group: 'site', constraint: 'ces', value: (a) => a.fr.ces },
      {
        key: 'surfaceDePlancher',
        unit: 'm2',
        format: 'dec2',
        group: 'density',
        constraint: 'surfaceDePlancher',
        value: (a) => a.fr.surfaceDePlancher,
      },
      { key: 'densite', format: 'dec2', group: 'density', value: (a) => a.fr.densite },
      { key: 'formula', format: 'text', group: 'height', value: (a) => a.fr.formula },
      {
        key: 'niveaux',
        unit: 'count',
        format: 'int',
        group: 'height',
        constraint: 'niveaux',
        value: (a) => a.fr.niveaux,
      },
      {
        key: 'hauteurEgout',
        unit: 'm',
        format: 'dec2',
        group: 'height',
        constraint: 'hauteur',
        value: (a) => a.fr.hauteurEgout,
      },
      {
        key: 'hauteurAcrotere',
        unit: 'm',
        format: 'dec2',
        group: 'height',
        value: (a) => a.fr.hauteurAcrotere,
      },
      ...common,
    ];
  }
  return [
    { key: 'siteArea', unit: 'm2', format: 'dec2', group: 'site', value: (a) => a.de.siteArea },
    { key: 'gr', unit: 'm2', format: 'dec2', group: 'site', value: (a) => a.de.gr },
    { key: 'grz', format: 'dec2', group: 'site', constraint: 'grz', value: (a) => a.de.grz },
    { key: 'gf', unit: 'm2', format: 'dec2', group: 'density', value: (a) => a.de.gf },
    { key: 'gfz', format: 'dec2', group: 'density', constraint: 'gfz', value: (a) => a.de.gfz },
    { key: 'baumasse', unit: 'm3', format: 'dec2', group: 'density', value: (a) => a.de.baumasse },
    { key: 'bmz', format: 'dec2', group: 'density', constraint: 'bmz', value: (a) => a.de.bmz },
    {
      key: 'maxFullStoreys',
      unit: 'count',
      format: 'int',
      group: 'height',
      constraint: 'maxFullStoreys',
      value: (a) => a.de.maxFullStoreys,
    },
    {
      key: 'totalHeight',
      unit: 'm',
      format: 'dec2',
      group: 'height',
      constraint: 'totalHeight',
      value: (a) => a.de.totalHeight,
    },
    { key: 'mboHeight', unit: 'm', format: 'dec2', group: 'height', value: (a) => a.de.mboHeight },
    { key: 'buildingClass', format: 'int', group: 'height', value: (a) => a.de.buildingClass },
    ...common,
  ];
}

function withUnit(r: ScheduleRow, col: string, unit?: ScheduleUnit): ScheduleRow {
  if (unit) r.units = { ...r.units, [col]: unit };
  return r;
}

export function kpiSchedule(project: Project, opts: ScheduleOptions = {}): Schedule {
  const id = opts.variantIds?.[0] ?? project.activeVariantId;
  const a = analysesFor(project, [id], opts.analyses).get(id)!;
  const columns: ScheduleColumn[] = [
    { key: 'name', label: tr('col.indicator'), format: 'text', width: 34 },
    { key: 'unit', label: tr('col.unit'), format: 'text', width: 8 },
    { key: 'actual', label: tr('col.actual'), format: 'dec2', width: 14 },
    { key: 'target', label: tr('col.target'), format: 'dec2', width: 14 },
    { key: 'status', label: tr('col.status'), format: 'text', width: 16 },
  ];
  const rows: ScheduleRow[] = [];
  let group = '';
  for (const l of kpiLines(project.settings.profile)) {
    if (l.group !== group) {
      group = l.group;
      rows.push({ kind: 'group', depth: 0, cells: { name: tr(`kpiGroup.${group}`) } });
    }
    const c = l.constraint ? a.constraints.find((x) => x.key === l.constraint) : undefined;
    const status = c?.status ?? 'none';
    const row: ScheduleRow = {
      kind: 'row',
      depth: 1,
      variantId: id,
      formats: { actual: l.format, target: l.format },
      status,
      cells: {
        name: tr(`kpi.${l.key}`),
        unit: l.unit ? tr(`unit.${l.unit}`) : null,
        actual: l.value(a),
        target: c?.target ?? null,
        status: c ? { key: `common:status.${status}` } : null,
      },
    };
    rows.push(withUnit(withUnit(row, 'actual', l.unit), 'target', l.unit));
  }
  return { id: 'kpis', title: tr('tab.kpis'), columns, rows };
}

// ---------------------------------------------------------------------------
// 3. Typologies and unit mix per mass
// ---------------------------------------------------------------------------

export function typologySchedule(project: Project, opts: ScheduleOptions = {}): Schedule {
  const id = opts.variantIds?.[0] ?? project.activeVariantId;
  const a = analysesFor(project, [id], opts.analyses).get(id)!;
  const mix = project.settings.unitMix;
  const int = (key: string, label: string, sum = true): ScheduleColumn => ({
    key,
    label: tr(label),
    unit: 'count',
    format: 'int',
    sum,
    width: 10,
  });
  const columns: ScheduleColumn[] = [
    { key: 'name', label: tr('col.mass'), format: 'text', width: 22 },
    { key: 'typology', label: tr('col.typology'), format: 'text', width: 18 },
    { key: 'depth', label: tr('col.depth'), unit: 'm', format: 'dec2', width: 10 },
    { key: 'suitable', label: tr('col.suitable'), format: 'text', width: 36 },
    { key: 'access', label: tr('col.access'), format: 'text', width: 22 },
    int('cores', 'col.cores'),
    int('dwellings', 'col.dwellings'),
    ...mix.map((u): ScheduleColumn => ({
      key: `mix:${u.id}`,
      label: tr('col.unitType', { name: u.label }),
      unit: 'count',
      format: 'int',
      sum: true,
      width: 8,
    })),
    {
      key: 'livingArea',
      label: tr('col.livingArea'),
      unit: 'm2',
      format: 'dec2',
      sum: true,
      width: 12,
    },
    int('workplaces', 'col.workplaces'),
    int('parkingDemand', 'col.parkingDemand'),
    int('parkingCapacity', 'col.parkingCapacity'),
  ];
  const rows: ScheduleRow[] = [];
  const settings = project.settings;
  for (const m of a.result.masses) {
    const nuf = (u: Usage) =>
      m.solids.filter((s) => s.solid.usage === u).reduce((s, x) => s + x.areas.nuf, 0);
    const garageBgf = m.solids
      .filter((s) => s.solid.usage === 'parken')
      .reduce((s, x) => s + x.areas.bgf, 0);
    const p = parking(
      {
        dwellings: m.dwellings.total,
        officeNuf: nuf('buero'),
        retailNuf: nuf('gewerbe'),
        garageBgf,
      },
      settings,
    );
    const cells: Record<string, ScheduleCell> = {
      name: m.mass.name,
      typology: { key: `common:typology.${m.mass.typology.kind}` },
      depth: m.depth,
      suitable: m.suitability
        .filter((s) => s.status === 'ok')
        .map((s) => ({ key: `tables:suit.${s.type}` })),
      access: { key: `common:access.${m.access}` },
      cores: m.cores,
      dwellings: m.dwellings.total,
      livingArea: m.areas.livingArea,
      workplaces: m.workplaces,
      parkingDemand: p.demand,
      parkingCapacity: p.capacity,
    };
    for (const u of mix)
      cells[`mix:${u.id}`] = m.dwellings.byType.find((b) => b.id === u.id)?.count ?? 0;
    rows.push({
      kind: 'row',
      depth: 0,
      variantId: id,
      massId: m.mass.id,
      status: m.lightWarning ? 'warning' : 'none',
      cells,
    });
  }
  const sumRows = rows.map((_, i) => i);
  const total: Record<string, ScheduleCell> = { name: tr('row.total') };
  for (const c of columns)
    if (c.sum) total[c.key] = rows.reduce((s, r) => s + (Number(r.cells[c.key]) || 0), 0);
  rows.push({ kind: 'total', depth: 0, variantId: id, sums: sumRows, cells: total });
  return { id: 'typologies', title: tr('tab.typologies'), columns, rows };
}

// ---------------------------------------------------------------------------
// 4. Variant comparison
// ---------------------------------------------------------------------------

export function comparisonSchedule(project: Project, opts: ScheduleOptions = {}): Schedule {
  const ids = opts.variantIds ?? project.variants.map((v) => v.id);
  const analyses = analysesFor(project, ids, opts.analyses);
  const columns: ScheduleColumn[] = [
    { key: 'name', label: tr('col.indicator'), format: 'text', width: 34 },
    { key: 'unit', label: tr('col.unit'), format: 'text', width: 8 },
    ...ids.map((id): ScheduleColumn => ({
      key: `v:${id}`,
      label: tr('col.variant', {
        name: project.variants.find((v) => v.id === id)?.name ?? id,
      }),
      format: 'dec2',
      width: 16,
    })),
  ];
  const rows: ScheduleRow[] = [];
  let group = '';
  for (const l of kpiLines(project.settings.profile)) {
    if (l.group !== group) {
      group = l.group;
      rows.push({ kind: 'group', depth: 0, cells: { name: tr(`kpiGroup.${group}`) } });
    }
    const cells: Record<string, ScheduleCell> = {
      name: tr(`kpi.${l.key}`),
      unit: l.unit ? tr(`unit.${l.unit}`) : null,
    };
    const formats: Record<string, ScheduleFormat> = {};
    const units: Record<string, ScheduleUnit> = {};
    for (const id of ids) {
      cells[`v:${id}`] = l.value(analyses.get(id)!);
      formats[`v:${id}`] = l.format;
      if (l.unit) units[`v:${id}`] = l.unit;
    }
    rows.push({ kind: 'row', depth: 1, formats, units, cells });
  }
  return { id: 'comparison', title: tr('tab.comparison'), columns, rows };
}

/** All four schedules (surfaces, KPIs, typologies for the active variant; comparison of all). */
export function allSchedules(project: Project, opts: ScheduleOptions = {}): Schedule[] {
  return [
    surfacesSchedule(project, opts),
    kpiSchedule(project, opts),
    typologySchedule(project, opts),
    comparisonSchedule(project, { ...(opts.analyses ? { analyses: opts.analyses } : {}) }),
  ];
}
