import type { Vec2 } from '@kubatur/core';

/** Pen numbers per SPEC §11 (1 = finest … 6 = boundary / ground line). */
export type Pen = 1 | 2 | 3 | 4 | 5 | 6;
export type LineType = 'solid' | 'dashed' | 'dashdot' | 'hidden';

/** Colour scheme of the masses: competition (black/dark grey) or building permit (red). */
export type ColorScheme = 'competition' | 'permit';

export interface DLine {
  kind: 'line';
  pts: Vec2[];
  pen: Pen;
  type: LineType;
  closed?: boolean;
  /** CSS colour, default black. */
  color?: string;
}

export interface Hatch {
  /** Angle in degrees, counter-clockwise from the x axis. */
  angle: number;
  /** Spacing on paper in mm. */
  spacingMm: number;
  pen: Pen;
  color?: string;
}

export interface DFill {
  kind: 'fill';
  /** Outer ring(s) and holes; even-odd fill rule. */
  rings: Vec2[][];
  fill: string;
  hatch?: Hatch;
  /** Optional outline. */
  pen?: Pen;
  stroke?: string;
  type?: LineType;
}

export interface DText {
  kind: 'text';
  at: Vec2;
  text: string;
  /** Height on paper in mm. */
  sizeMm: number;
  anchor: 'start' | 'middle' | 'end';
  baseline?: 'bottom' | 'middle' | 'top';
  /** Radians, counter-clockwise. */
  rotation?: number;
  color?: string;
  weight?: 'normal' | 'bold';
  /** Offset on paper (mm, x right / y up) applied after scaling. */
  offsetMm?: Vec2;
}

export interface DDimension {
  kind: 'dim';
  a: Vec2;
  b: Vec2;
  /** Offset of the dimension line from a–b on paper (mm), positive = left of a→b. */
  offsetMm: number;
  text: string;
}

export type SymbolType = 'north' | 'scaleBar' | 'level' | 'sectionHead';

export interface DSymbol {
  kind: 'symbol';
  type: SymbolType;
  at: Vec2;
  /** north: rotation of north (rad, 0 = up); sectionHead: viewing direction (rad). */
  rotation?: number;
  /** level: kote text (e.g. "±0,00"); sectionHead: letter. */
  label?: string;
  /** level: secondary text (e.g. level name); */
  sublabel?: string;
  /** level: put the text on the left of the marker. */
  side?: 'left' | 'right';
}

export type DItem = DLine | DFill | DText | DDimension | DSymbol;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type DrawingKind = 'site' | 'elevation' | 'section' | 'axonometry';

/**
 * Neutral 2D drawing (SPEC §11). Model coordinates are metres (plan: x east / y north; elevation
 * and section: x along the view / y = height; axonometry: projected metres). Items are in draw
 * order (first = bottom).
 */
export interface DrawingModel {
  kind: DrawingKind;
  items: DItem[];
  /** Extent of the geometry in model metres (symbols and texts excluded). */
  bounds: Bounds;
  /** Warnings (e.g. overlapping masses). */
  warnings: string[];
}

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBounds(b: Bounds, p: Vec2): void {
  if (p[0] < b.minX) b.minX = p[0];
  if (p[1] < b.minY) b.minY = p[1];
  if (p[0] > b.maxX) b.maxX = p[0];
  if (p[1] > b.maxY) b.maxY = p[1];
}

/** Bounds of all line, fill and dimension geometry. */
export function geometryBounds(items: readonly DItem[]): Bounds {
  const b = emptyBounds();
  for (const it of items) {
    if (it.kind === 'line') it.pts.forEach((p) => extendBounds(b, p));
    else if (it.kind === 'fill') it.rings.forEach((r) => r.forEach((p) => extendBounds(b, p)));
    else if (it.kind === 'dim') {
      extendBounds(b, it.a);
      extendBounds(b, it.b);
    } else extendBounds(b, it.at);
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return b;
}

/** Roman numerals for storey counts (I … MMMCMXCIX). */
export function roman(n: number): string {
  if (n <= 0) return '';
  const t: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let s = '';
  for (const [v, r] of t) {
    while (n >= v) {
      s += r;
      n -= v;
    }
  }
  return s;
}

/** Level text: ±0,00 / +3,50 / −2,80 (decimal comma, two decimals). */
export function formatLevel(z: number): string {
  const r = Math.round(z * 100) / 100;
  if (Math.abs(r) < 0.005) return '±0,00';
  const s = Math.abs(r).toFixed(2).replace('.', ',');
  return (r > 0 ? '+' : '−') + s;
}
