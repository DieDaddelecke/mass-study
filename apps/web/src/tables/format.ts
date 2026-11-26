import {
  cellFormat,
  FORMAT_DECIMALS,
  isTextRef,
  type Schedule,
  type ScheduleCell,
  type ScheduleColumn,
  type ScheduleRow,
  type TextRef,
} from '@kubatur/core';
import i18n, { formatNumber, numberLocale } from '../i18n';

/** Translate an i18n reference of the schedule model. */
export function text(ref: TextRef): string {
  if (!ref.params) return i18n.t(ref.key);
  // numbers in the parameters (calculation steps) follow the locale: "0,40", "1 234,5"
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(ref.params))
    params[k] =
      typeof v === 'number'
        ? new Intl.NumberFormat(numberLocale(), { maximumFractionDigits: 2 }).format(v)
        : v;
  return i18n.t(ref.key, params);
}

/** Column header incl. unit, e.g. "SDP (m²)". */
export function columnHeader(col: ScheduleColumn): string {
  const label = text(col.label);
  return col.unit && col.unit !== 'count'
    ? `${label} (${i18n.t(`tables:unit.${col.unit}`)})`
    : label;
}

export type TextMode = 'ui' | 'csv';

/**
 * Cell as text. `ui` uses the locale's grouping (e.g. "2 400,00"), `csv` only the decimal
 * separator of the language (comma for fr/de, point for en) so spreadsheets parse the numbers.
 */
export function cellText(
  col: ScheduleColumn,
  row: ScheduleRow,
  mode: TextMode = 'ui',
  lng = i18n.language,
): string {
  const v: ScheduleCell | undefined = row.cells[col.key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return i18n.t(v ? 'tables:bool.yes' : 'tables:bool.no');
  if (Array.isArray(v)) return v.map(text).join(', ');
  if (isTextRef(v)) return text(v);
  const digits = FORMAT_DECIMALS[cellFormat(col, row)];
  if (mode === 'ui') return formatNumber(v, digits, lng);
  const s = v.toFixed(digits);
  return lng === 'en' ? s : s.replace('.', ',');
}

/** Plain-text matrix (header + rows) of a schedule. */
export function scheduleMatrix(s: Schedule, mode: TextMode, lng = i18n.language): string[][] {
  return [
    s.columns.map(columnHeader),
    ...s.rows.map((r) => s.columns.map((c) => cellText(c, r, mode, lng))),
  ];
}

export { numberLocale };
