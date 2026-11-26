import { describe, expect, it } from 'vitest';
import { palaiseauDemo } from '../demo/palaiseau';
import { closestRatio, cropRect, edgeMagnitude, outputSize } from './capture';
import { buildPrompt, cityOf, describeProject } from './prompt';

const base = {
  style: 'photo',
  material: 'auto',
  animate: true,
  look: 'maquette',
  fidelity: 0.9,
} as const;
const free = { ...base, fidelity: 0.6 };

describe('render prompt, free mode (default)', () => {
  it('keeps only the viewpoint and leaves freedom', () => {
    const p = palaiseauDemo();
    const d = describeProject(p);
    const text = buildPrompt(p, free);
    expect(text).toContain('keep the camera viewpoint');
    expect(text).toContain('do not pull the camera back');
    expect(text).toContain('may be interpreted freely');
    expect(text).toContain(`R+${d.maxUpper}`);
    expect(text).toContain('pedestrians');
    expect(text).not.toContain('Edit this image');
    expect(text).not.toContain('line drawing');
    expect(buildPrompt(p, { ...free, fidelity: undefined })).toBe(text);
  });
});

describe('render prompt, strict mode', () => {
  it('is an edit instruction that locks the camera and the framing', () => {
    const p = palaiseauDemo();
    expect(describeProject(p).city).toBe('Palaiseau');
    const text = buildPrompt(p, base);
    expect(text.startsWith('Edit this image.')).toBe(true);
    expect(text).toContain('same camera position');
    expect(text).toContain('Do not zoom out');
    expect(text).toContain('cut off by the image border stay cut off');
    expect(text).toContain('Palaiseau, France');
    expect(text).toContain('white massing model');
    expect(text).toContain('balconies');
    // no storey count: a cropped view would make the model add floors
    expect(text).not.toMatch(/R\+\d/);
  });

  it('mentions the line drawing only when it is sent', () => {
    const p = palaiseauDemo();
    expect(buildPrompt(p, { ...base, guide: true })).toContain('second image is a line drawing');
    expect(buildPrompt(p, base)).not.toContain('line drawing');
  });

  it('follows style, material, look and fidelity', () => {
    const p = palaiseauDemo();
    const text = buildPrompt(p, { ...base, style: 'dusk', material: 'brique', look: 'bois' });
    expect(text).toContain('blue hour');
    expect(text).toContain('brick');
    expect(text).toContain('wooden massing model');
    expect(buildPrompt(p, { ...base, animate: false })).not.toContain('pedestrians');
    expect(buildPrompt(p, { ...base, fidelity: 1 })).not.toContain('pedestrians');
    expect(buildPrompt(p, { ...base, fidelity: 0.9 })).toContain('Do not add new objects');
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

describe('render capture', () => {
  it('crops to the closest ratio the models return', () => {
    expect(closestRatio(1536 / 800)[0]).toBe('16:9');
    const r = cropRect(1536, 800);
    expect(r.h).toBe(800);
    expect(r.w).toBe(1422);
    expect(r.x).toBe(57);
    expect(cropRect(1000, 1000)).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });
  it('scales to at most 1536 px', () => {
    expect(outputSize(3000, 1500)).toEqual({ w: 1536, h: 768 });
    expect(outputSize(1000, 600)).toEqual({ w: 1000, h: 600 });
  });
  it('finds edges between flat faces', () => {
    const w = 8;
    const h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        data.set(x < 4 ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    const m = edgeMagnitude(data, w, h);
    expect(m[3 * w + 3]).toBe(255);
    expect(m[3 * w + 1]).toBe(0);
    expect(m[3 * w + 6]).toBe(0);
  });
});
