import { describe, expect, it } from 'vitest';
import { palaiseauDemo } from '../demo/palaiseau';
import { cropRect, outputSize } from './capture';
import { buildPrompt, cityOf, describeProject } from './prompt';

const base = { style: 'photo', material: 'auto', animate: true, look: 'maquette' } as const;

describe('render prompt', () => {
  it('describes the demo project', () => {
    const p = palaiseauDemo();
    const d = describeProject(p);
    expect(d.count).toBeGreaterThan(0);
    expect(d.city).toBe('Palaiseau');
    const text = buildPrompt(p, base);
    expect(text).toContain('Palaiseau, France');
    expect(text).toContain(`R+${d.maxUpper}`);
    expect(text).toContain('white massing model');
    expect(text).toContain('Do not add or remove floors');
    expect(text).toContain('balconies');
  });

  it('follows style, material and look', () => {
    const p = palaiseauDemo();
    const text = buildPrompt(p, { ...base, style: 'dusk', material: 'brique', look: 'bois' });
    expect(text).toContain('blue hour');
    expect(text).toContain('brick');
    expect(text).toContain('wooden massing model');
    expect(buildPrompt(p, { ...base, animate: false })).not.toContain('pedestrians');
  });

  it('mentions a commercial ground floor', () => {
    const p = palaiseauDemo();
    const m = p.variants[0]!.masses[0]!;
    m.usage = 'wohnen';
    m.usageByStorey = { 0: 'gewerbe' };
    expect(buildPrompt(p, base)).toContain('shops and commercial space on the ground floor');
  });

  it('finds the city in an address', () => {
    expect(cityOf('27 Boulevard Thomas Gobert, 91120 Palaiseau')).toBe('Palaiseau');
    expect(cityOf('Rue X, Lyon')).toBe('Lyon');
    expect(cityOf(undefined)).toBeUndefined();
  });
});

describe('render capture size', () => {
  it('crops extreme aspect ratios to 2.5:1', () => {
    expect(cropRect(3000, 1000)).toEqual({ x: 250, y: 0, w: 2500, h: 1000 });
    expect(cropRect(1000, 800)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
  it('scales to at most 1536 px, multiples of 8', () => {
    expect(outputSize(3000, 1500)).toEqual({ w: 1536, h: 768 });
    expect(outputSize(1001, 601)).toEqual({ w: 1000, h: 600 });
  });
});
