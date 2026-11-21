import {
  cellFormat,
  FORMAT_DECIMALS,
  type Schedule,
  type ScheduleFormat,
  type ScheduleRow,
} from '@kubatur/core';
import type { Cell, CellObject, Row, Sheet } from 'write-excel-file/browser';
import { cellText, columnHeader, text } from '../tables/format';
import { downloadBlob, safeFileName } from './download';

/** Excel number format codes are locale-neutral; Excel shows them with the user's separators. */
const NUM_FMT: Record<ScheduleFormat, string | undefined> = {
  text: undefined,
  bool: undefined,
  int: '#,##0',
  dec1: '#,##0.0',
  dec2: '#,##0.00',
};

const HEADER_BG = '#E8EAF6';
const GROUP_BG = '#F4F5FA';
const TOTAL_BG = '#E0E3F3';

/** A1 column letters (0 → A, 26 → AA). */
export function colLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** SUM formula (OOXML, without "=") over 1-based sheet rows; contiguous rows become ranges. */
export function sumFormula(col: string, sheetRows: number[]): string {
  const sorted = [...sheetRows].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${col}${sorted[i]}` : `${col}${sorted[i]}:${col}${sorted[j]}`);
    i = j + 1;
  }
  return `SUM(${parts.join(',') || '0'})`;
}

/** Sheet name: ≤ 31 characters, without []:*?/\ and unique within the workbook. */
function sheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .slice(0, 31)
      .trim() || 'Sheet';
  let n = base;
  for (let i = 2; used.has(n); i++) n = `${base.slice(0, 28)} ${i}`;
  used.add(n);
  return n;
}

/** Row index in the model → 1-based sheet row (row 1 is the header). */
const sheetRow = (i: number) => i + 2;

function rowStyle(r: ScheduleRow): Pick<CellObject, 'fontWeight' | 'backgroundColor'> {
  if (r.kind === 'group') return { fontWeight: 'bold', backgroundColor: GROUP_BG };
  if (r.kind === 'total') return { fontWeight: 'bold', backgroundColor: TOTAL_BG };
  if (r.kind === 'subtotal') return { fontWeight: 'bold' };
  return {};
}

export function scheduleSheet(s: Schedule, used = new Set<string>()): Sheet<Blob> {
  const header: Row = s.columns.map((c, i) => ({
    value: columnHeader(c),
    type: String,
    fontWeight: 'bold',
    backgroundColor: HEADER_BG,
    align: i === 0 ? 'left' : 'right',
    alignVertical: 'center',
    wrap: true,
  }));
  const data: Row[] = s.rows.map((r) =>
    s.columns.map((c, ci): Cell => {
      const style = rowStyle(r);
      const v = r.cells[c.key];
      const fmt = cellFormat(c, r);
      if (ci === 0) {
        return { value: cellText(c, r), type: String, indent: r.depth, ...style };
      }
      if (r.sums && c.sum) {
        return {
          type: 'Formula',
          value: sumFormula(colLetter(ci), r.sums.map(sheetRow)),
          format: NUM_FMT[fmt] ?? '#,##0.00',
          ...style,
        };
      }
      if (typeof v === 'number') {
        const f = NUM_FMT[fmt];
        const value = f
          ? Math.round(v * 10 ** FORMAT_DECIMALS[fmt]) / 10 ** FORMAT_DECIMALS[fmt]
          : v;
        return f ? { value, type: Number, format: f, ...style } : { value, type: Number, ...style };
      }
      const t = cellText(c, r);
      return t ? { value: t, type: String, ...style } : { ...style };
    }),
  );
  return {
    sheet: sheetName(text(s.title), used),
    data: [header, ...data],
    columns: s.columns.map((c) => ({ width: c.width ?? 12 })),
    stickyRowsCount: 1,
  };
}

/** Build the workbook (one sheet per schedule). The library is loaded on demand. */
export async function schedulesToXlsx(schedules: Schedule[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const used = new Set<string>();
  return writeXlsxFile(
    schedules.map((s) => scheduleSheet(s, used)),
    { fontFamily: 'Calibri', fontSize: 11 },
  ).toBlob();
}

export async function exportXlsx(schedules: Schedule[], projectName: string): Promise<void> {
  const blob = await schedulesToXlsx(schedules);
  downloadBlob(blob, `${safeFileName(projectName)}.xlsx`);
}
