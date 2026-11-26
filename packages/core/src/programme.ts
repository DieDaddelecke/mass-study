import type { Mass, ProgrammeConfig, Settings, UnitType } from './types.js';
import { unitRooms } from './unitRules.js';

/**
 * Housing programme (« programme de logements »): the target unit mix of a building, as
 * percentages or dwelling counts, types may be grouped (« T1/T2 »). The storeys of the building
 * are then planned so that the building as a whole approaches it: storeys of the same massing
 * may get different plans (Soheyl 26.11.2026).
 */

/** Programme of a mass: its own, else the project's; undefined when off or empty. */
export function resolveProgramme(
  mass: Pick<Mass, 'programme'> | undefined,
  settings: Pick<Settings, 'programme'>,
): ProgrammeConfig | undefined {
  const cfg = mass?.programme ?? settings.programme;
  if (!cfg?.enabled) return undefined;
  const total = cfg.entries.reduce((s, e) => s + Math.max(0, e.value), 0);
  return total > 0 && cfg.entries.some((e) => e.typeIds.length) ? cfg : undefined;
}

/** Programme with one entry per type of the mix, from the mix shares (in percent). */
export function defaultProgramme(mix: readonly UnitType[]): ProgrammeConfig {
  return {
    enabled: true,
    mode: 'percent',
    entries: mix.map((t) => ({ typeIds: [t.id], value: Math.round(t.share * 1000) / 10 })),
  };
}

export interface ProgrammeShare {
  typeIds: string[];
  label: string;
  /** Target share 0…1. */
  share: number;
  /** Target dwellings (mode « count »). */
  count?: number;
}

/** Entries of the programme with normalised shares (types not in the mix dropped). */
export function programmeShares(cfg: ProgrammeConfig, mix: readonly UnitType[]): ProgrammeShare[] {
  const entries = cfg.entries
    .map((e) => ({ ...e, typeIds: e.typeIds.filter((id) => mix.some((t) => t.id === id)) }))
    .filter((e) => e.typeIds.length);
  const total = entries.reduce((s, e) => s + Math.max(0, e.value), 0) || 1;
  return entries.map((e) => ({
    typeIds: e.typeIds,
    label: e.typeIds.map((id) => mix.find((t) => t.id === id)!.label).join('/'),
    share: Math.max(0, e.value) / total,
    ...(cfg.mode === 'count' ? { count: Math.max(0, e.value) } : {}),
  }));
}

/**
 * The unit mix with the shares of the programme: a group's share is split over its types by
 * their shares in the mix (evenly when those are all 0); types outside the programme get 0.
 */
export function programmeMix(cfg: ProgrammeConfig, mix: readonly UnitType[]): UnitType[] {
  const share = new Map<string, number>();
  for (const e of programmeShares(cfg, mix)) {
    const types = e.typeIds.map((id) => mix.find((t) => t.id === id)!);
    const base = types.reduce((s, t) => s + Math.max(0, t.share), 0);
    for (const t of types)
      share.set(
        t.id,
        (share.get(t.id) ?? 0) +
          e.share * (base > 0 ? Math.max(0, t.share) / base : 1 / types.length),
      );
  }
  return mix.map((t) => ({ ...t, share: share.get(t.id) ?? 0 }));
}

/** Settings whose unit mix follows the programme of the mass (unchanged without one). */
export function programmeSettings(mass: Pick<Mass, 'programme'>, settings: Settings): Settings {
  const cfg = resolveProgramme(mass, settings);
  return cfg ? { ...settings, unitMix: programmeMix(cfg, settings.unitMix) } : settings;
}

export interface ProgrammeEntryResult extends ProgrammeShare {
  /** Dwellings of the entry's types. */
  achieved: number;
  /** Their share of all dwellings 0…1. */
  achievedShare: number;
  /** Target dwellings for the dwellings actually laid out (share × total). */
  target: number;
}

export interface ProgrammeResult {
  entries: ProgrammeEntryResult[];
  /** Dwellings counted (all types). */
  total: number;
  /** Dwellings of types outside the programme. */
  other: number;
  /** Dwellings that would have to change type to meet the programme exactly. */
  deviation: number;
}

/** Target vs achieved for dwelling counts by type id. */
export function programmeResult(
  cfg: ProgrammeConfig,
  mix: readonly UnitType[],
  counts: ReadonlyMap<string, number>,
): ProgrammeResult {
  const shares = programmeShares(cfg, mix);
  let total = 0;
  for (const c of counts.values()) total += c;
  const entries = shares.map((e) => {
    const achieved = e.typeIds.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
    return {
      ...e,
      achieved,
      achievedShare: total > 0 ? achieved / total : 0,
      target: e.share * total,
    };
  });
  const inside = entries.reduce((s, e) => s + e.achieved, 0);
  return {
    entries,
    total,
    other: total - inside,
    deviation: programmeDeviation(shares, counts, total),
  };
}

/**
 * Dwellings off the programme: half the sum of |achieved − share × total| over the entries
 * (dwellings of other types count fully).
 */
export function programmeDeviation(
  shares: readonly Pick<ProgrammeShare, 'typeIds' | 'share'>[],
  counts: ReadonlyMap<string, number>,
  total?: number,
): number {
  let n = total ?? 0;
  if (total === undefined) for (const c of counts.values()) n += c;
  let dev = 0;
  let inside = 0;
  for (const e of shares) {
    const a = e.typeIds.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
    inside += a;
    dev += Math.abs(a - e.share * n);
  }
  return 0.5 * (dev + (n - inside));
}

/**
 * Margin above a type's areaMax before a dwelling counts as clearly too large (Soheyl
 * 26.11.2026): its own value, else T1/T2 10 %, T3/T4 15 %, T5 and larger 17 %.
 */
export function unitAreaTolerance(t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'areaTolerance'>) {
  if (t.areaTolerance !== undefined && Number.isFinite(t.areaTolerance))
    return Math.max(0, t.areaTolerance);
  const rooms = unitRooms(t);
  return rooms <= 2 ? 0.1 : rooms <= 4 ? 0.15 : 0.17;
}

/** Margin below a type's areaMin before a dwelling counts as clearly too small. */
export const AREA_TOLERANCE_BELOW = 0.1;

/** Whether a dwelling area is clearly off the type's range (beyond the margins). */
export function clearlyOffRange(
  t: Pick<UnitType, 'id' | 'label' | 'rooms' | 'areaTolerance' | 'areaMin' | 'areaMax'>,
  area: number,
): boolean {
  return (
    area > t.areaMax * (1 + unitAreaTolerance(t)) + 1e-6 ||
    area < t.areaMin * (1 - AREA_TOLERANCE_BELOW) - 1e-6
  );
}
