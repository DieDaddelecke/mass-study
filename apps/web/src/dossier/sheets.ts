/**
 * Sheet composer (SPEC §12): lays out the standard set as one SVG per page, in mm user units
 * (viewBox = paper size), so the same string is used for the on-screen preview and for the PDF.
 */
import {
  massLayouts,
  type MassLayout,
  type ProjectAnalysis,
  type Project,
  type Schedule,
  type ScheduleColumn,
  type ScheduleRow,
} from '@kubatur/core';
import {
  chooseScale,
  distinctStoreyGroups,
  drawingInput,
  floorPlan,
  FLOOR_PLAN_COLORS,
  measureDrawing,
  renderSvg,
  unitColor,
} from '@kubatur/drawing';
import { cellText, columnHeader, text } from '../tables/format';
import {
  buildPlanViews,
  esc,
  type ColourScheme,
  type PlanView,
  type PlanViewId,
  type PlanViewOptions,
  type PlanViewRequest,
} from './views';

export type PaperFormat = 'A3' | 'A2' | 'A1';
export const PAPER: Record<PaperFormat, [number, number]> = {
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
};

export type SheetKind =
  'cover' | 'site' | 'elevations' | 'sections' | 'floorPlans' | 'axo' | 'tables';
export const SHEET_KINDS: SheetKind[] = [
  'cover',
  'site',
  'elevations',
  'sections',
  'floorPlans',
  'axo',
  'tables',
];
export type ScaleChoice = number | 'auto';

export interface TitleBlockFields {
  office: string;
  client: string;
  index: string;
  date: string;
}

export interface DossierOptions {
  format: PaperFormat;
  sheets: Record<SheetKind, boolean>;
  /** Elevations: all four on one sheet or two per sheet. */
  elevationsPerSheet: 4 | 2;
  scales: Record<'site' | 'elevations' | 'sections' | 'axo', ScaleChoice>;
  scheme: ColourScheme;
  titleBlock: TitleBlockFields;
}

export const DEFAULT_OPTIONS: DossierOptions = {
  format: 'A3',
  sheets: {
    cover: true,
    site: true,
    elevations: true,
    sections: true,
    // only produces sheets when the variant has dwellings (residential storeys)
    floorPlans: true,
    axo: true,
    tables: true,
  },
  elevationsPerSheet: 4,
  scales: { site: 'auto', elevations: 'auto', sections: 'auto', axo: 'auto' },
  scheme: 'concours',
  titleBlock: { office: '', client: '', index: 'A', date: '' },
};

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface DossierInput {
  project: Project;
  analysis: ProjectAnalysis;
  variantName: string;
  schedules: Schedule[];
  /** Translator bound to the dossier language (`dossier:` keys are passed without namespace). */
  t: Translate;
  /** Logo as data URL (PNG/JPEG). */
  logo?: string;
  /** Raster cover image (data URL) and its pixel size; otherwise a vector axonometry is used. */
  coverImage?: { href: string; width: number; height: number };
  /** Number formatting for the KPI box. */
  formatNumber: (v: number, digits: number) => string;
  /** View generator – the seam to @kubatur/drawing (defaults to the placeholder). */
  views?: (p: Project, a: ProjectAnalysis, o: PlanViewOptions) => PlanView[];
}

export interface Sheet {
  /** MS-001 … */
  number: string;
  /** Sheet content (already translated). */
  title: string;
  widthMm: number;
  heightMm: number;
  svg: string;
  /** Scale shown in the title block (e.g. "1:500", "—", "1:500 / 1:1000"). */
  scaleLabel: string;
}

// ---------------------------------------------------------------------------
// Constants (mm)
// ---------------------------------------------------------------------------

export const MARGIN = { left: 20, top: 10, right: 10, bottom: 10 };
export const TITLE_BLOCK = { width: 180, height: 60 };
// The PDF maps 'Inter' to the embedded TTF; the fallbacks only matter for the on-screen preview.
const FONT = "Inter, 'Inter Variable', Arial, sans-serif";
const CAPTION_H = 15;
const GAP = 6;
const ROW_H = 5;
const TABLE_FS = 2.6;

const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

function txt(
  x: number,
  y: number,
  s: string,
  size: number,
  o: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; fill?: string } = {},
): string {
  return `<text x="${f2(x)}" y="${f2(y)}" font-family="${FONT}" font-size="${size}"${
    o.bold ? ' font-weight="bold"' : ''
  }${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''} fill="${o.fill ?? '#000'}">${esc(s)}</text>`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  o: { fill?: string; stroke?: string; pen?: number } = {},
) {
  return `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${o.fill ?? 'none'}" stroke="${
    o.stroke ?? 'none'
  }" stroke-width="${o.pen ?? 0.25}"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, pen = 0.18, stroke = '#000') {
  return `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${stroke}" stroke-width="${pen}"/>`;
}

/** Approximate advance width of Inter (≈ 0.56 em average) – used for truncation only. */
export function textWidth(s: string, size: number): number {
  return s.length * size * 0.56;
}

function fit(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s;
  const n = Math.max(1, Math.floor(maxW / (size * 0.56)) - 1);
  return s.slice(0, n) + '…';
}

/** Break a label into at most two lines that fit `maxW` (the second one truncated if needed). */
export function wrap2(s: string, size: number, maxW: number): string[] {
  if (textWidth(s, size) <= maxW) return [s];
  const words = s.split(' ');
  let first = '';
  for (let i = 0; i < words.length; i++) {
    const cand = first ? `${first} ${words[i]}` : words[i]!;
    if (first && textWidth(cand, size) > maxW)
      return [fit(first, size, maxW), fit(words.slice(i).join(' '), size, maxW)];
    first = cand;
  }
  return [fit(first, size, maxW)];
}

let placed = 0;

/** Inline a view SVG (viewBox in mm) at (x, y) with its paper size. */
export function placeSvg(svg: string, x: number, y: number, w: number, h: number): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return '';
  // Prefix ids so that several drawings (clip paths, hatches) can share one page.
  const pre = `v${++placed}-`;
  const inner = svg
    .slice(open.index + open[0].length, svg.lastIndexOf('</svg>'))
    .replace(/\bid="([^"]+)"/g, `id="${pre}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${pre}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${pre}$1"`);
  const vb = /viewBox="([^"]+)"/
    .exec(open[0])?.[1]
    ?.split(/[\s,]+/)
    .map(Number) ?? [0, 0, w, h];
  const [vx = 0, vy = 0, vw = w, vh = h] = vb;
  const sx = w / vw;
  const sy = h / vh;
  const scale = Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3 ? '' : ` scale(${sx} ${sy})`;
  const shift = vx || vy ? ` translate(${-vx} ${-vy})` : '';
  // The drawing sets its font on the root <svg>, which is dropped here; without a font on the
  // group its texts fall back to Times in the PDF. Use the sheet font (mapped to embedded Inter).
  return `<g transform="translate(${f2(x)} ${f2(y)})${scale}${shift}" font-family="${FONT}">${inner}</g>`;
}

/** Scale bar length (m) giving ~25–50 mm on paper. */
export function scaleBarLength(scale: number): number {
  const k = 1000 / scale;
  const opts = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  return [...opts].reverse().find((l) => l * k <= 50) ?? 5;
}

function scaleBar(x: number, y: number, scale: number): string {
  const len = scaleBarLength(scale);
  const k = 1000 / scale;
  const n = 5;
  const seg = (len * k) / n;
  const out: string[] = [];
  for (let i = 0; i < n; i++)
    out.push(
      rect(x + i * seg, y, seg, 1.2, {
        fill: i % 2 ? '#ffffff' : '#000000',
        stroke: '#000',
        pen: 0.13,
      }),
    );
  out.push(txt(x, y + 4, '0', 2, { anchor: 'middle' }));
  out.push(txt(x + len * k, y + 4, `${len} m`, 2, { anchor: 'middle' }));
  return out.join('');
}

function northArrow(cx: number, cy: number): string {
  return (
    `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="5" fill="none" stroke="#000" stroke-width="0.25"/>` +
    `<path d="M${f2(cx)} ${f2(cy - 5)}L${f2(cx + 2.2)} ${f2(cy + 3.5)}L${f2(cx)} ${f2(cy + 2)}Z" fill="#000"/>` +
    `<path d="M${f2(cx)} ${f2(cy - 5)}L${f2(cx - 2.2)} ${f2(cy + 3.5)}L${f2(cx)} ${f2(cy + 2)}Z" fill="#fff" stroke="#000" stroke-width="0.18"/>` +
    txt(cx, cy - 6.5, 'N', 3, { anchor: 'middle', bold: true })
  );
}

/** View + caption (number bubble, title, scale, scale bar). */
function placeView(
  v: PlanView,
  num: number,
  x: number,
  y: number,
  cellW: number,
  t: Translate,
): string {
  const vx = x + (cellW - v.widthMm) / 2;
  const out = [placeSvg(v.svg, vx, y, v.widthMm, v.heightMm)];
  const cy = y + v.heightMm + 7;
  out.push(
    `<circle cx="${f2(vx + 3.5)}" cy="${f2(cy)}" r="3.5" fill="none" stroke="#000" stroke-width="0.35"/>`,
  );
  out.push(txt(vx + 3.5, cy + 1.1, String(num), 3, { anchor: 'middle', bold: true }));
  out.push(txt(vx + 9, cy - 0.3, t(v.titleKey), 3.5, { bold: true }));
  out.push(line(vx + 9, cy + 1.2, vx + Math.max(40, v.widthMm * 0.45), cy + 1.2, 0.25));
  out.push(txt(vx + 9, cy + 4.6, `${t('scale')} 1:${v.scale}`, 2.4));
  if (!v.hasScaleBar)
    out.push(
      scaleBar(vx + v.widthMm - (scaleBarLength(v.scale) * 1000) / v.scale, cy - 1.5, v.scale),
    );
  if (v.north) out.push(northArrow(vx + v.widthMm - 8, y + 10));
  return out.join('');
}

interface Frame {
  W: number;
  H: number;
  /** Content area above the title block. */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
}

function frame(format: PaperFormat): Frame {
  const [W, H] = PAPER[format];
  const cx = MARGIN.left + 6;
  const cy = MARGIN.top + 6;
  return {
    W,
    H,
    cx,
    cy,
    cw: W - MARGIN.right - 6 - cx,
    ch: H - MARGIN.bottom - TITLE_BLOCK.height - 6 - cy,
  };
}

export interface TitleBlockData {
  office: string;
  client: string;
  index: string;
  date: string;
  project: string;
  address: string;
  content: string;
  number: string;
  scale: string;
  format: string;
  /** "3 / 12" */
  sheetOf: string;
  logo?: string;
}

/** Title block (cartouche), bottom right, 180 × 60 mm. */
export function titleBlock(W: number, H: number, d: TitleBlockData, t: Translate): string {
  const { width: tw, height: th } = TITLE_BLOCK;
  const x = W - MARGIN.right - tw;
  const y = H - MARGIN.bottom - th;
  const out: string[] = [rect(x, y, tw, th, { fill: '#ffffff', stroke: '#000', pen: 0.5 })];
  const L = 52; // logo / office column
  out.push(line(x + L, y, x + L, y + th, 0.25));
  if (d.logo)
    out.push(
      `<image x="${f2(x + 4)}" y="${f2(y + 4)}" width="${L - 8}" height="30" preserveAspectRatio="xMidYMid meet" href="${d.logo}"/>`,
    );
  out.push(txt(x + 4, y + 42, fit(d.office || t('tb.officeEmpty'), 3, L - 8), 3, { bold: true }));
  out.push(txt(x + 4, y + 47, t('tb.phaseValue'), 2.2, { fill: '#444' }));
  out.push(txt(x + 4, y + 55, fit(t('tb.disclaimer'), 1.6, L - 6), 1.6, { fill: '#444' }));
  const cell = (
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    value: string,
    size = 2.8,
    bold = false,
  ) => {
    out.push(rect(cx, cy, w, h, { stroke: '#000', pen: 0.13 }));
    out.push(txt(cx + 1.5, cy + 2.6, label, 1.7, { fill: '#555' }));
    out.push(txt(cx + 1.5, cy + h - 2, fit(value, size, w - 3), size, { bold }));
  };
  const rx = x + L;
  const rw = tw - L;
  let cy = y;
  cell(rx, cy, rw, 12, t('tb.project'), d.project, 4, true);
  cy += 12;
  cell(rx, cy, rw, 9, t('tb.address'), d.address);
  cy += 9;
  cell(rx, cy, rw * 0.6, 9, t('tb.client'), d.client);
  cell(rx + rw * 0.6, cy, rw * 0.4, 9, t('tb.phase'), t('tb.phaseValue'));
  cy += 9;
  cell(rx, cy, rw, 9, t('tb.content'), d.content, 3, true);
  cy += 9;
  const q = rw / 4;
  cell(rx, cy, q, 21, t('tb.number'), d.number, 4, true);
  cell(rx + q, cy, q, 10.5, t('tb.scale'), d.scale);
  cell(rx + 2 * q, cy, q, 10.5, t('tb.format'), d.format);
  cell(rx + 3 * q, cy, q, 10.5, t('tb.index'), d.index, 3, true);
  cell(rx + q, cy + 10.5, 2 * q, 10.5, t('tb.date'), d.date);
  cell(rx + 3 * q, cy + 10.5, q, 10.5, t('tb.sheet'), d.sheetOf);
  return out.join('');
}

function page(f: Frame, body: string, tb: string): string {
  const { W, H } = f;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">` +
    rect(0, 0, W, H, { fill: '#ffffff' }) +
    rect(MARGIN.left, MARGIN.top, W - MARGIN.left - MARGIN.right, H - MARGIN.top - MARGIN.bottom, {
      stroke: '#000',
      pen: 0.5,
    }) +
    body +
    tb +
    '</svg>'
  );
}

/** Grid layout: cells of the content area. */
function grid(f: Frame, cols: number, rows: number) {
  const w = (f.cw - (cols - 1) * GAP) / cols;
  const h = (f.ch - (rows - 1) * GAP) / rows;
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ x: f.cx + c * (w + GAP), y: f.cy + r * (h + GAP), w, h });
  return cells;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const NUMERIC = new Set(['int', 'dec1', 'dec2']);

/** Split schedule rows into pages of at most `perPage` rows. */
export function paginateRows<T>(rows: readonly T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}

export function rowsPerPage(format: PaperFormat): number {
  const f = frame(format);
  // title (12 mm) + two-line header
  return Math.floor((f.ch - 12 - 2 * ROW_H) / ROW_H);
}

function tableSvg(s: Schedule, rows: ScheduleRow[], f: Frame, title: string): string {
  const weights = s.columns.map((c) => c.width ?? 12);
  const total = weights.reduce((a, b) => a + b, 0);
  const tw = Math.min(f.cw, total * 2.8);
  const widths = weights.map((w) => (w / total) * tw);
  const out: string[] = [txt(f.cx, f.cy + 6, title, 5, { bold: true })];
  let y = f.cy + 12;
  const drawRow = (
    cells: string[],
    cols: ScheduleColumn[],
    o: { bold?: boolean; fill?: string; depth?: number; topLine?: boolean },
  ) => {
    if (o.fill) out.push(rect(f.cx, y, tw, ROW_H, { fill: o.fill }));
    if (o.topLine) out.push(line(f.cx, y, f.cx + tw, y, 0.35));
    let x = f.cx;
    cells.forEach((c, i) => {
      const w = widths[i]!;
      const numeric = NUMERIC.has(cols[i]!.format) && i > 0;
      const indent = i === 0 ? (o.depth ?? 0) * 3 : 0;
      const v = fit(c, TABLE_FS, w - 2 - indent);
      out.push(
        numeric
          ? txt(x + w - 1, y + ROW_H - 1.5, v, TABLE_FS, { anchor: 'end', bold: o.bold })
          : txt(x + 1 + indent, y + ROW_H - 1.5, v, TABLE_FS, { bold: o.bold }),
      );
      x += w;
    });
    out.push(line(f.cx, y + ROW_H, f.cx + tw, y + ROW_H, 0.1, '#999'));
    y += ROW_H;
  };
  // header: two lines, wrapped at word boundaries instead of truncated
  {
    const hh = 2 * ROW_H;
    out.push(rect(f.cx, y, tw, hh, { fill: '#e9e9e9' }));
    let x = f.cx;
    s.columns.forEach((c, i) => {
      const w = widths[i]!;
      const numeric = NUMERIC.has(c.format) && i > 0;
      const lines = wrap2(columnHeader(c), TABLE_FS, w - 2);
      const y0 = y + hh - 1.5 - (lines.length - 1) * (TABLE_FS + 0.6);
      lines.forEach((l, k) => {
        const ly = y0 + k * (TABLE_FS + 0.6);
        out.push(
          numeric
            ? txt(x + w - 1, ly, l, TABLE_FS, { anchor: 'end', bold: true })
            : txt(x + 1, ly, l, TABLE_FS, { bold: true }),
        );
      });
      x += w;
    });
    out.push(line(f.cx, y + hh, f.cx + tw, y + hh, 0.1, '#999'));
    y += hh;
  }
  for (const r of rows) {
    const cells = s.columns.map((c) => cellText(c, r));
    drawRow(cells, s.columns, {
      bold: r.kind !== 'row',
      fill: r.kind === 'group' ? '#f4f4f4' : undefined,
      depth: r.depth,
      topLine: r.kind === 'subtotal' || r.kind === 'total',
    });
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface Draft {
  /** i18n key of the sheet content, or `title` for already translated text. */
  titleKey?: string;
  title?: string;
  scaleLabel: string;
  body: string;
}

function viewSheet(
  input: DossierInput,
  opts: DossierOptions,
  f: Frame,
  ids: PlanViewId[],
  cols: number,
  rows: number,
  scale: ScaleChoice,
  group: string,
  counter: { n: number },
): { body: string; scaleLabel: string } {
  const cells = grid(f, cols, rows);
  const requests: PlanViewRequest[] = ids.map((id, i) => ({
    id,
    boxWidthMm: cells[i]!.w - 4,
    boxHeightMm: cells[i]!.h - CAPTION_H,
    scale,
    group,
  }));
  const views = (input.views ?? buildPlanViews)(input.project, input.analysis, {
    requests,
    scheme: opts.scheme,
  });
  const body = views
    .map((v, i) => placeView(v, ++counter.n, cells[i]!.x, cells[i]!.y, cells[i]!.w, input.t))
    .join('');
  const scales = [...new Set(views.map((v) => v.scale))];
  return { body, scaleLabel: scales.map((s) => `1:${s}`).join(' / ') };
}

const FP_SCALES = [200, 250, 500, 1000];
const FP_LEGEND_W = 72;

/** Legend of a schematic floor plan sheet (types with counts, access, keys). */
function floorPlanLegend(
  layouts: readonly MassLayout[],
  storey: number,
  input: DossierInput,
  x: number,
  y: number,
): string {
  const { t, project } = input;
  const mix = project.settings.unitMix;
  const out: string[] = [txt(x, y, t('fp.legend'), 3.2, { bold: true })];
  y += 6;
  const here = layouts.flatMap((m) =>
    m.storeys.filter((s) => s.storeyIndex === storey).map((s) => ({ m, s })),
  );
  for (const { m, s } of here) {
    const per =
      m.expectedUnitsPerCore && s.unitsPerCore !== undefined
        ? ` : ${t('fp.perCore', { n: input.formatNumber(s.unitsPerCore, 0) })}`
        : '';
    for (const l of wrap2(`${m.name} · ${t(`fp.access.${s.access}`)}${per}`, 2.4, FP_LEGEND_W)) {
      out.push(txt(x, y, l, 2.4));
      y += 3.6;
    }
  }
  y += 2;
  let total = 0;
  let area = 0;
  for (const type of mix) {
    let n = 0;
    let a = 0;
    let d = 0;
    for (const { s } of here)
      for (const b of s.summary.byType)
        if (b.typeId === type.id) {
          n += b.count;
          a += b.area;
          d += b.duplex ?? 0;
        }
    if (!n && !a) continue;
    total += n;
    area += a;
    out.push(
      rect(x, y - 2.6, 3.2, 3.2, { fill: unitColor(type.id, mix), stroke: '#000', pen: 0.1 }),
    );
    out.push(
      txt(x + 5, y, d ? `${type.label} (${d} ${t('fp.duplexShort.duplex')})` : type.label, 2.6),
    );
    out.push(txt(x + 40, y, String(n), 2.6, { anchor: 'end' }));
    out.push(txt(x + FP_LEGEND_W, y, `${input.formatNumber(a, 0)} m²`, 2.6, { anchor: 'end' }));
    y += 4.6;
  }
  out.push(line(x, y - 2.8, x + FP_LEGEND_W, y - 2.8, 0.18));
  out.push(txt(x + 5, y + 0.6, t('fp.total'), 2.6, { bold: true }));
  out.push(txt(x + 40, y + 0.6, String(total), 2.6, { anchor: 'end', bold: true }));
  out.push(
    txt(x + FP_LEGEND_W, y + 0.6, `${input.formatNumber(area, 0)} m²`, 2.6, {
      anchor: 'end',
      bold: true,
    }),
  );
  y += 7;
  for (const [fill, key] of [
    [FLOOR_PLAN_COLORS.core, 'fp.core'],
    [FLOOR_PLAN_COLORS.circulation, 'fp.circulation'],
  ] as const) {
    out.push(rect(x, y - 2.6, 3.2, 3.2, { fill, stroke: '#000', pen: 0.1 }));
    out.push(txt(x + 5, y, fit(t(key), 2.4, FP_LEGEND_W - 5), 2.4));
    y += 4.4;
  }
  const nuit = here.reduce(
    (k, { s }) => k + s.units.filter((u) => u.duplex?.level === 'nuit').length,
    0,
  );
  if (nuit) {
    for (const l of wrap2(t('fp.duplexNuit', { count: nuit }), 2, FP_LEGEND_W)) {
      out.push(txt(x, y + 1, l, 2, { fill: '#555' }));
      y += 3.2;
    }
    y += 1;
  }
  if (here.some(({ s }) => s.units.some((u) => u.outOfRange))) {
    out.push(txt(x, y + 1, fit(t('fp.outOfRange'), 2, FP_LEGEND_W), 2, { fill: '#555' }));
    y += 4;
  }
  for (const m of layouts)
    if (m.areaBasedDwellings > 0 && m.totals.units !== m.areaBasedDwellings)
      for (const l of wrap2(
        t('fp.differs', { layout: m.totals.units, area: m.areaBasedDwellings }),
        2,
        FP_LEGEND_W,
      )) {
        out.push(txt(x, y + 1, l, 2, { fill: '#555' }));
        y += 3;
      }
  return out.join('');
}

/** One sheet per distinct residential storey layout ("R+1 à R+3"), with legend. */
function floorPlanDrafts(input: DossierInput, f: Frame, counter: { n: number }): Draft[] {
  const { project, analysis, t } = input;
  const layouts = massLayouts(analysis.result, project.settings);
  const groups = distinctStoreyGroups(layouts, (s) => s.units.length > 0);
  const { solids } = drawingInput(analysis.result);
  const boxW = f.cw - FP_LEGEND_W - 12;
  const boxH = f.ch - CAPTION_H;
  return groups.map((g) => {
    const storey = g.storeys[0]!;
    const model = floorPlan(project, solids, storey, layouts, {
      neighbours: false,
      duplexText: {
        duplex: t('fp.duplexShort.duplex'),
        jour: t('fp.duplexShort.jour'),
        nuit: t('fp.duplexShort.nuit'),
      },
    });
    const scale = chooseScale(model, boxW, boxH, FP_SCALES);
    const size = measureDrawing(model, scale);
    const svg = renderSvg(model, { scale, background: null, theme: 'paper' });
    const range =
      g.labels.length > 1
        ? t('fp.range', { from: g.labels[0]!, to: g.labels[g.labels.length - 1]! })
        : g.labels[0]!;
    const vx = f.cx + (boxW - size.widthMm) / 2;
    const vy = f.cy + Math.max(0, (boxH - size.heightMm) / 2);
    const body: string[] = [placeSvg(svg, vx, vy, size.widthMm, size.heightMm)];
    const cy = vy + size.heightMm + 7;
    body.push(
      `<circle cx="${f2(vx + 3.5)}" cy="${f2(cy)}" r="3.5" fill="none" stroke="#000" stroke-width="0.35"/>`,
    );
    body.push(txt(vx + 3.5, cy + 1.1, String(++counter.n), 3, { anchor: 'middle', bold: true }));
    body.push(txt(vx + 9, cy - 0.3, `${t('view.floorPlan')} ${range}`, 3.5, { bold: true }));
    body.push(line(vx + 9, cy + 1.2, vx + Math.max(40, size.widthMm * 0.45), cy + 1.2, 0.25));
    body.push(txt(vx + 9, cy + 4.6, `${t('scale')} 1:${scale}`, 2.4));
    body.push(floorPlanLegend(layouts, storey, input, f.cx + f.cw - FP_LEGEND_W, f.cy + 6));
    return {
      title: `${t('sheet.floorPlans')} ${range}`,
      scaleLabel: `1:${scale}`,
      body: body.join(''),
    };
  });
}

function coverBody(input: DossierInput, opts: DossierOptions, f: Frame): string {
  const { t, project } = input;
  const out: string[] = [];
  const imgW = f.cw * 0.62;
  const imgH = f.ch + TITLE_BLOCK.height;
  if (input.coverImage) {
    const { width, height, href } = input.coverImage;
    const k = Math.min(imgW / width, imgH / height);
    const w = width * k;
    const h = height * k;
    out.push(
      `<image x="${f2(f.cx + (imgW - w) / 2)}" y="${f2(f.cy + (imgH - h) / 2)}" width="${f2(w)}" height="${f2(h)}" href="${href}"/>`,
    );
  } else {
    const views = (input.views ?? buildPlanViews)(input.project, input.analysis, {
      requests: [{ id: 'axoSW', boxWidthMm: imgW, boxHeightMm: imgH, scale: 'auto' }],
      scheme: opts.scheme,
    });
    const v = views[0]!;
    out.push(
      placeSvg(
        v.svg,
        f.cx + (imgW - v.widthMm) / 2,
        f.cy + (imgH - v.heightMm) / 2,
        v.widthMm,
        v.heightMm,
      ),
    );
  }
  const x = f.cx + imgW + 10;
  const w = f.cx + f.cw - x;
  let y = f.cy + 10;
  out.push(txt(x, y, t('cover.kicker'), 3, { fill: '#666' }));
  y += 12;
  out.push(txt(x, y, fit(project.name, 8, w), 8, { bold: true }));
  y += 8;
  out.push(txt(x, y, fit(project.info.address ?? '', 3.5, w), 3.5));
  y += 6;
  out.push(txt(x, y, `${t('cover.variant')} : ${input.variantName}`, 3.5));
  y += 6;
  if (opts.titleBlock.date) out.push(txt(x, y, opts.titleBlock.date, 3, { fill: '#666' }));
  y += 10;
  // KPI box
  const kpis = input.schedules.find((s) => s.id === 'kpis');
  const rows = (kpis?.rows ?? []).filter((r) => r.kind === 'row').slice(0, 12);
  out.push(txt(x, y, t('cover.kpis'), 3.2, { bold: true }));
  y += 3;
  const boxH = rows.length * 6.5 + 4;
  out.push(rect(x, y, w, boxH, { stroke: '#000', pen: 0.25 }));
  y += 2;
  for (const r of rows) {
    const nameCol = kpis!.columns[0]!;
    const valCol = kpis!.columns.find((c) => c.key === 'actual')!;
    const unitCol = kpis!.columns.find((c) => c.key === 'unit');
    const unit = unitCol ? cellText(unitCol, r) : '';
    out.push(txt(x + 3, y + 4.5, fit(cellText(nameCol, r), 2.8, w * 0.6), 2.8));
    out.push(
      txt(x + w - 3, y + 4.5, `${cellText(valCol, r)}${unit ? ` ${unit}` : ''}`, 2.8, {
        anchor: 'end',
        bold: true,
      }),
    );
    out.push(line(x + 3, y + 6.5, x + w - 3, y + 6.5, 0.1, '#bbb'));
    y += 6.5;
  }
  return out.join('');
}

/** Compose all pages of the dossier. */
export function composeDossier(input: DossierInput, opts: DossierOptions): Sheet[] {
  const f = frame(opts.format);
  const { t } = input;
  const drafts: Draft[] = [];
  const counter = { n: 0 };
  if (opts.sheets.cover)
    drafts.push({ titleKey: 'sheet.cover', scaleLabel: '—', body: coverBody(input, opts, f) });
  if (opts.sheets.site) {
    const r = viewSheet(input, opts, f, ['site'], 1, 1, opts.scales.site, 'site', counter);
    drafts.push({ titleKey: 'sheet.site', ...r });
  }
  if (opts.sheets.elevations) {
    const all: PlanViewId[] = ['elevS', 'elevE', 'elevN', 'elevW'];
    if (opts.elevationsPerSheet === 4) {
      const r = viewSheet(input, opts, f, all, 2, 2, opts.scales.elevations, 'elev', counter);
      drafts.push({ titleKey: 'sheet.elevations', ...r });
    } else
      for (const pair of [all.slice(0, 2), all.slice(2)]) {
        const r = viewSheet(input, opts, f, pair, 1, 2, opts.scales.elevations, 'elev', counter);
        drafts.push({ titleKey: 'sheet.elevations', ...r });
      }
  }
  if (opts.sheets.sections) {
    const r = viewSheet(
      input,
      opts,
      f,
      ['sectionA', 'sectionB'],
      1,
      2,
      opts.scales.sections,
      'sec',
      counter,
    );
    drafts.push({ titleKey: 'sheet.sections', ...r });
  }
  if (opts.sheets.floorPlans) drafts.push(...floorPlanDrafts(input, f, counter));
  if (opts.sheets.axo) {
    const r = viewSheet(input, opts, f, ['axoSW', 'axoNE'], 2, 1, opts.scales.axo, 'axo', counter);
    drafts.push({ titleKey: 'sheet.axo', ...r });
  }
  if (opts.sheets.tables) {
    const per = rowsPerPage(opts.format);
    for (const s of input.schedules.filter((x) => x.id !== 'comparison')) {
      const pages = paginateRows(s.rows, per);
      pages.forEach((rows, i) => {
        const title = text(s.title) + (i > 0 ? ` (${t('table.continued')})` : '');
        drafts.push({ title, scaleLabel: '—', body: tableSvg(s, rows, f, title) });
      });
    }
  }
  return drafts.map((d, i) => {
    const number = `MS-${String(i + 1).padStart(3, '0')}`;
    const title = d.title ?? t(d.titleKey ?? '');
    const tb = titleBlock(
      f.W,
      f.H,
      {
        ...opts.titleBlock,
        project: input.project.name,
        address: input.project.info.address ?? '',
        content: title,
        number,
        scale: d.scaleLabel,
        format: `${opts.format} ${f.W} × ${f.H}`,
        sheetOf: `${i + 1} / ${drafts.length}`,
        logo: input.logo,
      },
      t,
    );
    return {
      number,
      title,
      widthMm: f.W,
      heightMm: f.H,
      svg: page(f, d.body, tb),
      scaleLabel: d.scaleLabel,
    };
  });
}
