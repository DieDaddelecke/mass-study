import type { Vec2 } from '@kubatur/core';
import type { DItem, DrawingModel, Hatch, LineType, Pen } from './model.js';

/** Pen widths in mm at 1:500 (SPEC §11). */
export const DEFAULT_PEN_WIDTHS: Record<Pen, number> = {
  1: 0.13,
  2: 0.18,
  3: 0.25,
  4: 0.35,
  5: 0.5,
  6: 0.7,
};

/** Font family written into the SVG; the PDF step maps "Kubatur Sans" to the embedded OFL font. */
export const DRAWING_FONT =
  "'Kubatur Sans', Inter, 'Inter Variable', 'Helvetica Neue', Arial, sans-serif";

/** Standard scales (denominators) for automatic scale selection (SPEC §12). */
export const STANDARD_SCALES = [200, 250, 500, 1000, 2000] as const;

export interface SvgOptions {
  /** Scale denominator, e.g. 500 for 1:500 (10 m = 20 mm). */
  scale: number;
  /** Pen widths in mm at 1:500 (overrides). */
  penWidthsMm?: Partial<Record<Pen, number>>;
  /** "Thin lines" mode: all pens 0.1 mm. */
  thinLines?: boolean;
  /** Paper margin around the content in mm (default 8). */
  marginMm?: number;
  /** Background fill; null = transparent (default white). */
  background?: string | null;
  /** 'paper' (default) = black on white. 'dark' inverts ink and background for screen use. */
  theme?: 'paper' | 'dark';
}

/** Pen width in mm for a scale: the 1:500 value scaled by √(500/scale), clamped to ±40 %. */
export function penWidthMm(pen: Pen, scale: number, opts: Partial<SvgOptions> = {}): number {
  if (opts.thinLines) return 0.1;
  const base = opts.penWidthsMm?.[pen] ?? DEFAULT_PEN_WIDTHS[pen];
  const f = Math.min(1.4, Math.max(0.7, Math.sqrt(500 / scale)));
  return base * f;
}

const DASH: Record<LineType, number[] | null> = {
  solid: null,
  dashed: [2, 1],
  dashdot: [6, 1, 0.6, 1],
  hidden: [1, 0.8],
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Nice scale bar length (m) for ~40 mm on paper. */
export function scaleBarLength(scale: number): number {
  const target = (40 * scale) / 1000;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  let best = nice[0]!;
  for (const n of nice) if (n <= target * 1.15) best = n;
  return best;
}

/** Approximate extent (mm, y down, relative to the anchor) of a text or symbol. */
function itemExtent(it: DItem, scale: number): Box | null {
  if (it.kind === 'text') {
    const w = it.text.length * it.sizeMm * 0.58;
    const x0 = it.anchor === 'start' ? 0 : it.anchor === 'middle' ? -w / 2 : -w;
    const y0 = it.baseline === 'top' ? 0 : it.baseline === 'middle' ? -it.sizeMm / 2 : -it.sizeMm;
    const ox = it.offsetMm?.[0] ?? 0;
    const oy = -(it.offsetMm?.[1] ?? 0);
    return { x0: x0 + ox, y0: y0 + oy, x1: x0 + w + ox, y1: y0 + it.sizeMm + oy };
  }
  if (it.kind === 'symbol') {
    switch (it.type) {
      case 'north':
        return { x0: -6, y0: -12, x1: 6, y1: 6 };
      case 'scaleBar':
        return { x0: -1, y0: -5, x1: (scaleBarLength(scale) * 1000) / scale + 6, y1: 2 };
      case 'level': {
        const w = 4 + Math.max((it.label ?? '').length * 1.2, (it.sublabel ?? '').length * 0.95);
        return it.side === 'left'
          ? { x0: -w, y0: -4, x1: 2, y1: 3 }
          : { x0: -2, y0: -4, x1: w, y1: 3 };
      }
      case 'sectionHead':
        return { x0: -8, y0: -8, x1: 8, y1: 8 };
    }
  }
  return null;
}

class Layout {
  k: number;
  ox = 0;
  oy = 0;
  constructor(
    private model: DrawingModel,
    public scale: number,
  ) {
    this.k = 1000 / scale;
  }
  /** model → paper mm with origin at model (minX, maxY). */
  raw(p: Vec2): Vec2 {
    const b = this.model.bounds;
    return [(p[0] - b.minX) * this.k, (b.maxY - p[1]) * this.k];
  }
  pt(p: Vec2): Vec2 {
    const r = this.raw(p);
    return [r[0] + this.ox, r[1] + this.oy];
  }
  contentBox(): Box {
    const b = this.model.bounds;
    const box: Box = {
      x0: 0,
      y0: 0,
      x1: (b.maxX - b.minX) * this.k,
      y1: (b.maxY - b.minY) * this.k,
    };
    for (const it of this.model.items) {
      const e = itemExtent(it, this.scale);
      if (!e || (it.kind !== 'text' && it.kind !== 'symbol')) continue;
      const a = this.raw(it.at);
      box.x0 = Math.min(box.x0, a[0] + e.x0);
      box.y0 = Math.min(box.y0, a[1] + e.y0);
      box.x1 = Math.max(box.x1, a[0] + e.x1);
      box.y1 = Math.max(box.y1, a[1] + e.y1);
    }
    return box;
  }
}

/** Paper size (mm) of the drawing at a scale, including margins. */
export function measureDrawing(
  model: DrawingModel,
  scale: number,
  marginMm = 8,
): { widthMm: number; heightMm: number } {
  const b = new Layout(model, scale).contentBox();
  return { widthMm: b.x1 - b.x0 + 2 * marginMm, heightMm: b.y1 - b.y0 + 2 * marginMm };
}

/**
 * Largest standard scale (smallest denominator) at which the drawing fits into the paper box.
 * Returns the smallest scale in the list (largest denominator) if nothing fits.
 */
export function chooseScale(
  model: DrawingModel,
  boxWidthMm: number,
  boxHeightMm: number,
  scales: readonly number[] = STANDARD_SCALES,
  marginMm = 8,
): number {
  const sorted = [...scales].sort((a, b) => a - b);
  for (const s of sorted) {
    const m = measureDrawing(model, s, marginMm);
    if (m.widthMm <= boxWidthMm && m.heightMm <= boxHeightMm) return s;
  }
  return sorted[sorted.length - 1]!;
}

/** Render a drawing model to an SVG string with real millimetre dimensions. */
export function renderSvg(model: DrawingModel, opts: SvgOptions): string {
  const L = new Layout(model, opts.scale);
  const margin = opts.marginMm ?? 8;
  const cb = L.contentBox();
  L.ox = margin - cb.x0;
  L.oy = margin - cb.y0;
  const W = cb.x1 - cb.x0 + 2 * margin;
  const H = cb.y1 - cb.y0 + 2 * margin;
  const dark = opts.theme === 'dark';
  const ink = (c: string | undefined) => {
    const col = c ?? '#111111';
    if (!dark) return col;
    if (col === '#111111' || col === '#000000') return '#f2f2f2';
    return col;
  };
  const pw = (pen: Pen) => f2(penWidthMm(pen, opts.scale, opts));
  const dash = (t: LineType) => {
    const d = DASH[t];
    return d ? ` stroke-dasharray="${d.join(' ')}"` : '';
  };
  const path = (rings: Vec2[][], close: boolean) =>
    rings
      .filter((r) => r.length >= 2)
      .map((r) => 'M' + r.map((p) => L.pt(p).map(f2).join(' ')).join('L') + (close ? 'Z' : ''))
      .join('');

  const defs: string[] = [];
  const hatchIds = new Map<string, string>();
  const hatchId = (h: Hatch) => {
    const key = JSON.stringify(h);
    let id = hatchIds.get(key);
    if (!id) {
      id = `h${hatchIds.size + 1}`;
      hatchIds.set(key, id);
      const s = f2(h.spacingMm);
      defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}" patternTransform="rotate(${f2(-h.angle)})"><line x1="0" y1="0" x2="${s}" y2="0" stroke="${ink(h.color)}" stroke-width="${pw(h.pen)}"/></pattern>`,
      );
    }
    return id;
  };

  const body: string[] = [];
  for (const it of model.items) {
    switch (it.kind) {
      case 'fill': {
        const d = path(it.rings, true);
        if (!d) break;
        const stroke =
          it.pen !== undefined
            ? ` stroke="${ink(it.stroke)}" stroke-width="${pw(it.pen)}" stroke-linejoin="round"${dash(it.type ?? 'solid')}`
            : // hairline in the fill colour hides anti-aliasing seams between adjacent faces
              ` stroke="${it.fill}" stroke-width="0.06" stroke-linejoin="round"`;
        body.push(`<path d="${d}" fill="${it.fill}" fill-rule="evenodd"${stroke}/>`);
        if (it.hatch)
          body.push(`<path d="${d}" fill="url(#${hatchId(it.hatch)})" fill-rule="evenodd"/>`);
        break;
      }
      case 'line': {
        const d = path([it.pts], !!it.closed);
        if (!d) break;
        body.push(
          `<path d="${d}" fill="none" stroke="${ink(it.color)}" stroke-width="${pw(it.pen)}" stroke-linecap="${it.type === 'solid' ? 'round' : 'butt'}" stroke-linejoin="round"${dash(it.type)}/>`,
        );
        break;
      }
      case 'text': {
        const p = L.pt(it.at);
        const x = p[0] + (it.offsetMm?.[0] ?? 0);
        const y = p[1] - (it.offsetMm?.[1] ?? 0);
        const dy =
          it.baseline === 'top'
            ? it.sizeMm * 0.78
            : it.baseline === 'middle'
              ? it.sizeMm * 0.36
              : 0;
        const rot = it.rotation
          ? ` transform="rotate(${f2((-it.rotation * 180) / Math.PI)} ${f2(x)} ${f2(y)})"`
          : '';
        body.push(
          `<text x="${f2(x)}" y="${f2(y + dy)}" font-size="${f2(it.sizeMm)}" text-anchor="${it.anchor}" fill="${ink(it.color)}"${it.weight === 'bold' ? ' font-weight="600"' : ''}${rot}>${esc(it.text)}</text>`,
        );
        break;
      }
      case 'dim': {
        const a = L.pt(it.a);
        const b = L.pt(it.b);
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        // left of a→b in model space = (dy, -dx) on paper (y down) … use paper normal
        const nx = dy / l;
        const ny = -dx / l;
        const o = it.offsetMm;
        const a2: Vec2 = [a[0] + nx * o, a[1] + ny * o];
        const b2: Vec2 = [b[0] + nx * o, b[1] + ny * o];
        const w = pw(1);
        body.push(
          `<path d="M${f2(a[0])} ${f2(a[1])}L${f2(a2[0])} ${f2(a2[1])}M${f2(b[0])} ${f2(b[1])}L${f2(b2[0])} ${f2(b2[1])}M${f2(a2[0])} ${f2(a2[1])}L${f2(b2[0])} ${f2(b2[1])}" fill="none" stroke="${ink(undefined)}" stroke-width="${w}"/>`,
        );
        for (const q of [a2, b2])
          body.push(
            `<path d="M${f2(q[0] - 0.8)} ${f2(q[1] + 0.8)}L${f2(q[0] + 0.8)} ${f2(q[1] - 0.8)}" stroke="${ink(undefined)}" stroke-width="${pw(3)}"/>`,
          );
        const mx = (a2[0] + b2[0]) / 2 + nx * 1;
        const my = (a2[1] + b2[1]) / 2 + ny * 1;
        let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        body.push(
          `<text x="${f2(mx)}" y="${f2(my)}" font-size="1.8" text-anchor="middle" fill="${ink(undefined)}" transform="rotate(${f2(ang)} ${f2(mx)} ${f2(my)})">${esc(it.text)}</text>`,
        );
        break;
      }
      case 'symbol':
        body.push(symbol(it, L.pt(it.at), opts.scale, ink, pw));
        break;
    }
  }
  const bg =
    opts.background === null
      ? ''
      : `<rect x="0" y="0" width="${f2(W)}" height="${f2(H)}" fill="${opts.background ?? (dark ? '#16171c' : '#ffffff')}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}mm" height="${f2(H)}mm" viewBox="0 0 ${f2(W)} ${f2(H)}" font-family="${DRAWING_FONT.replace(/"/g, '&quot;')}" data-scale="${opts.scale}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    bg +
    body.join('') +
    `</svg>`
  );
}

function symbol(
  it: Extract<DItem, { kind: 'symbol' }>,
  p: Vec2,
  scale: number,
  ink: (c?: string) => string,
  pw: (pen: Pen) => string,
): string {
  const tr = (rot = 0) =>
    `translate(${f2(p[0])} ${f2(p[1])})${rot ? ` rotate(${f2((-rot * 180) / Math.PI)})` : ''}`;
  const k = ink(undefined);
  switch (it.type) {
    case 'north':
      return (
        `<g transform="${tr(it.rotation)}"><circle r="5" fill="none" stroke="${k}" stroke-width="${pw(2)}"/>` +
        `<path d="M0 -6L2.2 4L0 2.2Z" fill="${k}"/><path d="M0 -6L-2.2 4L0 2.2Z" fill="none" stroke="${k}" stroke-width="${pw(1)}" stroke-linejoin="round"/>` +
        `<text x="0" y="-7.6" font-size="3" text-anchor="middle" font-weight="600" fill="${k}">N</text></g>`
      );
    case 'scaleBar': {
      const m = scaleBarLength(scale);
      const len = (m * 1000) / scale;
      const n = m % 5 === 0 && m / 5 >= 1 ? 5 : 4;
      const w = len / n;
      let s = `<g transform="${tr()}">`;
      for (let i = 0; i < n; i++)
        s += `<rect x="${f2(i * w)}" y="-1.4" width="${f2(w)}" height="1.4" fill="${i % 2 ? '#ffffff' : k}" stroke="${k}" stroke-width="${pw(1)}"/>`;
      s += `<text x="0" y="-2.4" font-size="1.8" text-anchor="middle" fill="${k}">0</text>`;
      s += `<text x="${f2(len)}" y="-2.4" font-size="1.8" text-anchor="middle" fill="${k}">${m}</text>`;
      s += `<text x="${f2(len + 2)}" y="0" font-size="1.8" fill="${k}">m</text>`;
      return s + `</g>`;
    }
    case 'level': {
      const left = it.side === 'left';
      const tx = left ? -2.6 : 2.6;
      const anchor = left ? 'end' : 'start';
      let s = `<g transform="${tr()}"><path d="M0 0L-1.4 -2.2L1.4 -2.2Z" fill="none" stroke="${k}" stroke-width="${pw(2)}" stroke-linejoin="round"/><path d="M0 0L-1.4 -2.2L0 -2.2Z" fill="${k}"/>`;
      s += `<text x="${tx}" y="-0.6" font-size="2" text-anchor="${anchor}" fill="${k}">${esc(it.label ?? '')}</text>`;
      if (it.sublabel)
        s += `<text x="${tx}" y="2.1" font-size="1.5" text-anchor="${anchor}" fill="#6f6f6f">${esc(it.sublabel)}</text>`;
      return s + `</g>`;
    }
    case 'sectionHead':
      return (
        `<g transform="${tr(it.rotation)}"><path d="M2.6 -2.2L7 0L2.6 2.2Z" fill="${k}"/>` +
        `<circle r="3.2" fill="#ffffff" stroke="${k}" stroke-width="${pw(3)}"/></g>` +
        `<text x="${f2(p[0])}" y="${f2(p[1] + 1.1)}" font-size="3" text-anchor="middle" font-weight="600" fill="${k}">${esc(it.label ?? '')}</text>`
      );
  }
}
