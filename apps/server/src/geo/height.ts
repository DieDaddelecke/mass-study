export const LEVEL_HEIGHT_M = 3.0;
export const DEFAULT_HEIGHT_M = 9;

/** Parses OSM-style lengths like "20", "20 m", "20.5m", "12,5". Feet etc. → undefined. */
export function parseMeters(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)?\s*$/i.exec(v);
  if (!m?.[1]) return undefined;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function parseCount(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Height rule: explicit height → levels × 3.0 m → 9 m (estimated). */
export function resolveHeight(
  explicit: number | undefined,
  levels: number | undefined,
): { height: number; heightEstimated: boolean } {
  if (explicit !== undefined && explicit > 0) return { height: explicit, heightEstimated: false };
  if (levels !== undefined && levels > 0)
    return { height: levels * LEVEL_HEIGHT_M, heightEstimated: false };
  return { height: DEFAULT_HEIGHT_M, heightEstimated: true };
}
