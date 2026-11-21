import { createProject, rect, surfacesSchedule } from '@kubatur/core';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { scheduleToCsv, scheduleToTsv } from './csv';
import { colLetter, scheduleSheet, sumFormula } from './xlsx';

function project() {
  const p = createProject({
    name: 'Test',
    localBoundary: rect(-25, -20, 25, 20),
    lonLat: [2.2, 48.7],
    profile: 'FR',
  });
  p.variants[0]!.masses.push({
    id: 'm1',
    name: 'Bât. A',
    typology: { kind: 'zeile', length: 40, depth: 12, sections: 1, sectionOffset: 0 },
    position: [-20, 0],
    rotation: 0,
    storeys: {
      basement: { count: 0, height: 3 },
      ground: { height: 3.5 },
      upper: { count: 4, height: 3 },
      parapet: 0,
      slabThickness: 0.3,
    },
    usage: 'wohnen',
    access: 'auto',
  });
  return p;
}

describe('xlsx helpers', () => {
  it('column letters and SUM ranges', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(25)).toBe('Z');
    expect(colLetter(26)).toBe('AA');
    expect(sumFormula('F', [3, 4, 5, 9])).toBe('SUM(F3:F5,F9)');
  });

  it('writes formulas for totals and a frozen header', () => {
    const sheet = scheduleSheet(surfacesSchedule(project()));
    expect(sheet.stickyRowsCount).toBe(1);
    const last = sheet.data.at(-1)!;
    const bgfCol = 5;
    expect(last[bgfCol]).toMatchObject({ type: 'Formula', value: 'SUM(F9)' });
    const subtotal = sheet.data.at(-2)!;
    expect(subtotal[bgfCol]).toMatchObject({ type: 'Formula', value: 'SUM(F4:F8)' });
  });
});

describe('csv / tsv', () => {
  it('uses ; and decimal comma in French', async () => {
    await i18n.changeLanguage('fr');
    const csv = scheduleToCsv(surfacesSchedule(project()));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Surface brute (m²)');
    expect(lines.at(-1)).toContain(';2400,00;');
    expect(scheduleToTsv(surfacesSchedule(project()), 'en')).toContain('\t2400.00\t');
  });
});
