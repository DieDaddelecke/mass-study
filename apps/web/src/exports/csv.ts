import type { Schedule } from '@kubatur/core';
import i18n from '../i18n';
import { scheduleMatrix, text } from '../tables/format';
import { downloadBlob, safeFileName } from './download';

const BOM = '﻿';

function quote(v: string, sep: string): string {
  return /["\r\n]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV text: `;`-separated, decimal comma for fr/de (Excel FR/DE opens it directly). */
export function scheduleToCsv(s: Schedule, lng = i18n.language): string {
  return scheduleMatrix(s, 'csv', lng)
    .map((r) => r.map((v) => quote(v, ';')).join(';'))
    .join('\r\n');
}

/** TSV text for the clipboard (pastes into Excel / Numbers / LibreOffice cell by cell). */
export function scheduleToTsv(s: Schedule, lng = i18n.language): string {
  return scheduleMatrix(s, 'csv', lng)
    .map((r) => r.map((v) => v.replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/** Download one schedule as UTF-8 CSV with BOM. */
export function exportCsv(s: Schedule, projectName: string): void {
  const blob = new Blob([BOM + scheduleToCsv(s) + '\r\n'], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `${safeFileName(projectName)} – ${safeFileName(text(s.title))}.csv`);
}

export async function copyTsv(s: Schedule): Promise<void> {
  await navigator.clipboard.writeText(scheduleToTsv(s));
}
