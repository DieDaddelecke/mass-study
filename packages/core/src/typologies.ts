import { unitsPerCoreRange } from './mix.js';
import { typologySegments } from './generators.js';
import type { AccessType, Mass, Settings, Typology, Usage } from './types.js';

export type Traffic = 'ok' | 'warning' | 'error';

export interface TypologySuitability {
  type: AccessType | 'zellenbuero' | 'kombibuero' | 'openSpace' | 'atrium';
  status: Traffic;
  range?: [number, number];
}

/** Representative building depth of a mass (minimum over its sections). */
export function massDepth(t: Typology): number {
  const segs = typologySegments(t);
  if (t.kind === 'zeile') return t.depth;
  return segs.length ? Math.min(...segs.map((s) => s.depth)) : 0;
}

/** Length of the main axis of a mass (used for escape routes / cores). */
export function massLength(t: Typology): number {
  switch (t.kind) {
    case 'solitaer':
      return Math.max(t.length, t.depth);
    case 'zeile':
      return t.length;
    default:
      return typologySegments(t).reduce(
        (s, seg) => (t.kind === 'reihe' ? s + seg.length : Math.max(s, seg.length)),
        0,
      );
  }
}

function inRange(d: number, [a, b]: [number, number]): Traffic {
  if (d >= a && d <= b) return 'ok';
  if (d >= a - 1 && d <= b + 1) return 'warning';
  return 'error';
}

/** Suitability list (traffic lights) of residential / office typologies for a given depth. */
export function suitability(t: Typology, usage: Usage, settings: Settings): TypologySuitability[] {
  const depth = massDepth(t);
  const r = settings.depthRanges;
  if (usage === 'wohnen') {
    if (t.kind === 'reihe') return [{ type: 'reihenhaus', status: 'ok' }];
    const list: TypologySuitability[] = (
      ['laubengang', 'zweispaenner', 'dreispaenner', 'mittelflur'] as const
    ).map((type) => ({ type, range: r.wohnen[type], status: inRange(depth, r.wohnen[type]) }));
    const isPoint = t.kind === 'solitaer' && Math.min(t.length, t.depth) >= r.punkthausMinSide;
    list.push({ type: 'punkthaus', range: r.wohnen.punkthaus, status: isPoint ? 'ok' : 'error' });
    return list;
  }
  if (usage === 'buero') {
    return (['zellenbuero', 'kombibuero', 'openSpace'] as const).map((type) => ({
      type,
      range: r.buero[type],
      status: inRange(depth, r.buero[type]),
    }));
  }
  return [];
}

/** True if the depth exceeds the daylight warning threshold (unless point block / atrium). */
export function lightWarning(t: Typology, usage: Usage, settings: Settings): boolean {
  if (usage !== 'wohnen') return false;
  if (t.kind === 'solitaer' && Math.min(t.length, t.depth) >= settings.depthRanges.punkthausMinSide)
    return false;
  return massDepth(t) > settings.depthRanges.lightWarningDepth;
}

/** Resolve the access type: explicit, or the best match for depth and typology. */
export function resolveAccess(mass: Mass, settings: Settings): AccessType {
  const n = mass.unitsPerCore;
  const usage = mass.usage ?? 'wohnen';
  const spaenner = n === 2 ? 'zweispaenner' : n === 3 ? 'dreispaenner' : undefined;
  // dwellings per landing given: 2 / 3 make the spänner type (also over the other spänner)
  if (
    spaenner &&
    usage === 'wohnen' &&
    mass.typology.kind !== 'reihe' &&
    (!mass.access ||
      mass.access === 'auto' ||
      mass.access === 'zweispaenner' ||
      mass.access === 'dreispaenner')
  )
    return spaenner;
  if (mass.access && mass.access !== 'auto') return mass.access;
  if (usage === 'wohnheim') return 'mittelflur';
  if (usage !== 'wohnen') return 'buero';
  const t = mass.typology;
  if (t.kind === 'reihe') return 'reihenhaus';
  if (t.kind === 'solitaer' && Math.min(t.length, t.depth) >= settings.depthRanges.punkthausMinSide)
    return 'punkthaus';
  const depth = massDepth(t);
  // 4 or more per landing: no spänner (they serve 2 or 3)
  const types =
    n && n >= 4
      ? (['laubengang', 'mittelflur'] as const)
      : (['zweispaenner', 'dreispaenner', 'laubengang', 'mittelflur'] as const);
  const candidates = types.map((type) => {
    const [a, b] = settings.depthRanges.wohnen[type];
    const mid = (a + b) / 2;
    const outside = depth < a ? a - depth : depth > b ? depth - b : 0;
    return { type, score: outside * 10 + Math.abs(depth - mid) };
  });
  candidates.sort((x, y) => x.score - y.score);
  return candidates[0]!.type;
}

/**
 * Minimum number of stair cores: escape distance (every point ≤ maxEscapeDistance from a stair,
 * evenly spaced along the main axis) and typical section length of the access type.
 * Terraced houses have their own stairs (0 shared cores).
 */
export function requiredCores(mass: Mass, access: AccessType, settings: Settings): number {
  if (access === 'reihenhaus') return 0;
  const length = massLength(mass.typology);
  const byEscape = Math.max(1, Math.ceil(length / (2 * settings.cores.maxEscapeDistance)));
  // with the dwellings per core given, those set the cores (not the typical section length)
  if (access === 'punkthaus' || (mass.unitsPerCore && mass.unitsPerCore >= 4)) return byEscape;
  const section = settings.cores.sectionLength[access];
  const byAccess = section ? Math.max(1, Math.ceil(length / section - 1e-9)) : 1;
  return Math.max(byEscape, byAccess);
}

/**
 * Dwellings per core and storey expected for this mass: the user's number (`unitsPerCore`) for
 * gallery, corridor and point block, else the access type's range (settings).
 */
export function massUnitsPerCoreRange(
  mass: Mass,
  access: AccessType,
  range: [number, number],
): [number, number] | undefined {
  const n = mass.unitsPerCore;
  if (n && n >= 1 && (access === 'laubengang' || access === 'mittelflur' || access === 'punkthaus'))
    return [n, n];
  return unitsPerCoreRange(access, range);
}
