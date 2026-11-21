import { describe, expect, it } from 'vitest';
import { defaultSettings, largestRemainder, parking, unitMix, workplaces } from '../src/index.js';

describe('largest remainder', () => {
  it('distributes exactly the total', () => {
    expect(largestRemainder(10, [0.1, 0.3, 0.35, 0.2, 0.05])).toEqual([1, 3, 4, 2, 0]);
    expect(largestRemainder(7, [1, 1, 1])).toEqual([3, 2, 2]);
    expect(largestRemainder(0, [1, 2])).toEqual([0, 0]);
    expect(largestRemainder(5, [0, 0])).toEqual([0, 0]);
  });

  it('sums stay consistent for many totals', () => {
    for (let n = 0; n < 200; n += 7) {
      expect(largestRemainder(n, [0.1, 0.3, 0.35, 0.2, 0.05]).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});

describe('unit mix', () => {
  const mix = defaultSettings('FR').unitMix;
  it('computes dwellings from living area', () => {
    // average target = 0.1·30 + 0.3·45 + 0.35·65 + 0.2·82 + 0.05·100 = 60.65 m²
    const r = unitMix(2000, mix);
    expect(r.total).toBe(Math.floor(2000 / 60.65));
    expect(r.byType.reduce((s, t) => s + t.count, 0)).toBe(r.total);
    expect(r.residualArea).toBeCloseTo(2000 - r.byType.reduce((s, t) => s + t.area, 0), 6);
  });

  it('handles empty input', () => {
    expect(unitMix(0, mix).total).toBe(0);
    expect(unitMix(100, []).total).toBe(0);
  });
});

describe('workplaces and parking', () => {
  const s = defaultSettings('DE');
  it('workplaces from office NUF', () => {
    expect(workplaces(1200, s)).toBe(100);
  });
  it('parking demand and garage capacity', () => {
    const p = parking({ dwellings: 20, officeNuf: 400, retailNuf: 70, garageBgf: 1000 }, s);
    expect(p.demand).toBe(20 + 10 + 2);
    expect(p.capacity).toBe(36);
  });
});
