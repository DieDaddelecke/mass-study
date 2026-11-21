import {
  normalizePolygon,
  offsetPolyline,
  orientedExtents,
  inscribedRadius,
  rect,
  transformPolygon,
  polygonArea,
} from './geometry.js';
import type { FreeLineTypology, Mass, Polygon, Typology, TypologyKind, Vec2 } from './types.js';

/**
 * Local mass coordinates:
 * - Solitär: centred on the insertion point, x = length, y = depth.
 * - Zeile / Reihe: the insertion point is the start of the axis; x runs along the length,
 *   the building is centred on the axis in y (depth).
 * - Freiform: points / polygon are given in local coordinates directly.
 */
export interface MassSegment {
  /** Section index for Zeile / Reihe, undefined for single-part typologies. */
  segment?: number;
  /** Footprint in local mass coordinates. */
  local: Polygon;
  /** Building depth used for typology suitability (m). */
  depth: number;
  /** Length along the main axis (m). */
  length: number;
}

export function typologySegments(t: Typology): MassSegment[] {
  switch (t.kind) {
    case 'solitaer': {
      const l = t.length / 2;
      const d = t.depth / 2;
      return [
        {
          local: rect(-l, -d, l, d),
          depth: Math.min(t.length, t.depth),
          length: Math.max(t.length, t.depth),
        },
      ];
    }
    case 'zeile': {
      const n = Math.max(1, Math.round(t.sections));
      const w = t.length / n;
      const d = t.depth / 2;
      return Array.from({ length: n }, (_, i) => {
        const dy = i % 2 === 1 ? t.sectionOffset : 0;
        return {
          segment: i,
          local: rect(i * w, -d + dy, (i + 1) * w, d + dy),
          depth: Math.min(t.depth, w),
          length: w,
        };
      });
    }
    case 'reihe': {
      const n = Math.max(1, Math.round(t.count));
      const widths = Array.from({ length: n }, (_, i) =>
        t.endUnitWidth !== undefined && (i === 0 || i === n - 1) ? t.endUnitWidth : t.unitWidth,
      );
      const d = t.depth / 2;
      let x = 0;
      return widths.map((w, i) => {
        const dy = i % 2 === 1 ? t.alternatingOffset : 0;
        const seg: MassSegment = {
          segment: i,
          local: rect(x, -d + dy, x + w, d + dy),
          depth: t.depth,
          length: w,
        };
        x += w;
        return seg;
      });
    }
    case 'freeLine': {
      const polys = offsetPolyline(t.points, t.closed, t.depth, t.alignment);
      return polys.map((local) => ({
        local,
        depth: t.depth,
        length: lineLength(t),
      }));
    }
    case 'freePolygon': {
      const local = normalizePolygon(t.polygon);
      const ext = orientedExtents(local.outer);
      // For a rectangle the shorter side, otherwise 2 × largest inscribed circle radius.
      const isRect =
        local.outer.length === 4 &&
        !local.holes?.length &&
        Math.abs(ext.length * ext.width - polygonArea(local)) < 1e-6;
      const depth = isRect ? ext.width : 2 * inscribedRadius(local);
      return [{ local, depth, length: ext.length }];
    }
  }
}

function lineLength(t: FreeLineTypology): number {
  let l = 0;
  const pts = t.points;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  if (t.closed && pts.length > 2) {
    const a = pts[pts.length - 1]!;
    const b = pts[0]!;
    l += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return l;
}

/** Footprint of a segment in project coordinates. */
export function toWorld(mass: Pick<Mass, 'position' | 'rotation'>, local: Polygon): Polygon {
  return transformPolygon(local, mass.position, mass.rotation);
}

export function massFootprints(mass: Mass): Polygon[] {
  return typologySegments(mass.typology).map((s) => toWorld(mass, s.local));
}

// ---------------------------------------------------------------------------
// Defaults and templates (ribbon gallery)
// ---------------------------------------------------------------------------

export function defaultTypology(kind: TypologyKind): Typology {
  switch (kind) {
    case 'solitaer':
      return { kind, length: 20, depth: 20 };
    case 'zeile':
      return { kind, length: 40, depth: 12, sections: 3, sectionOffset: 0 };
    case 'reihe':
      return { kind, count: 6, unitWidth: 6, depth: 10, alternatingOffset: 0 };
    case 'freeLine':
      return {
        kind,
        points: [
          [0, 0],
          [30, 0],
        ],
        closed: false,
        depth: 12,
        alignment: 'center',
      };
    case 'freePolygon':
      return { kind, polygon: rect(0, 0, 20, 15) };
  }
}

export type TemplateId = 'winkel' | 'uForm' | 'blockrand' | 'hofhaus';

const line = (points: Vec2[], closed: boolean, depth: number): FreeLineTypology => ({
  kind: 'freeLine',
  points,
  closed,
  depth,
  alignment: 'center',
});

export const TEMPLATES: Record<TemplateId, () => FreeLineTypology> = {
  winkel: () =>
    line(
      [
        [0, 0],
        [36, 0],
        [36, 30],
      ],
      false,
      12,
    ),
  uForm: () =>
    line(
      [
        [0, 30],
        [0, 0],
        [40, 0],
        [40, 30],
      ],
      false,
      12,
    ),
  blockrand: () =>
    line(
      [
        [0, 0],
        [60, 0],
        [60, 50],
        [0, 50],
      ],
      true,
      13,
    ),
  hofhaus: () =>
    line(
      [
        [0, 0],
        [24, 0],
        [24, 24],
        [0, 24],
      ],
      true,
      8,
    ),
};
