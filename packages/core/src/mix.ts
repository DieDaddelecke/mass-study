import type { AccessType, Settings, UnitType } from './types.js';

/** Distribute `total` items over `shares` (any positive weights) with the largest-remainder method. */
export function largestRemainder(total: number, shares: readonly number[]): number[] {
  const sum = shares.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0 || sum <= 0) return shares.map(() => 0);
  const exact = shares.map((s) => (Math.max(0, s) / sum) * total);
  const floors = exact.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

export interface UnitMixResult {
  total: number;
  byType: { id: string; label: string; count: number; area: number }[];
  /** Living area not allocated to units (may be negative if the rounded mix overshoots). */
  residualArea: number;
}

export function unitMix(livingArea: number, mix: readonly UnitType[]): UnitMixResult {
  const shareSum = mix.reduce((s, u) => s + u.share, 0);
  const avg = shareSum > 0 ? mix.reduce((s, u) => s + (u.share / shareSum) * u.areaTarget, 0) : 0;
  const total = avg > 0 ? Math.floor(livingArea / avg + 1e-9) : 0;
  const counts = largestRemainder(
    total,
    mix.map((u) => u.share),
  );
  const byType = mix.map((u, i) => ({
    id: u.id,
    label: u.label,
    count: counts[i]!,
    area: counts[i]! * u.areaTarget,
  }));
  const allocated = byType.reduce((s, t) => s + t.area, 0);
  return { total, byType, residualArea: livingArea - allocated };
}

/** Expected dwellings per storey and core for an access type, or undefined if not applicable. */
export function unitsPerCoreRange(access: AccessType): [number, number] | undefined {
  switch (access) {
    case 'zweispaenner':
      return [2, 2];
    case 'dreispaenner':
      return [3, 3];
    case 'punkthaus':
      return [4, 6];
    default:
      return undefined;
  }
}

export function workplaces(officeNuf: number, settings: Pick<Settings, 'workplaceArea'>): number {
  return settings.workplaceArea > 0 ? Math.floor(officeNuf / settings.workplaceArea) : 0;
}

export interface ParkingResult {
  demand: number;
  capacity: number;
}

export function parking(
  input: { dwellings: number; officeNuf: number; retailNuf: number; garageBgf: number },
  settings: Pick<Settings, 'parking'>,
): ParkingResult {
  const p = settings.parking;
  const demand =
    input.dwellings * p.perDwelling +
    (p.officeAreaPerSpace > 0 ? input.officeNuf / p.officeAreaPerSpace : 0) +
    (p.retailAreaPerSpace > 0 ? input.retailNuf / p.retailAreaPerSpace : 0);
  const capacity =
    p.garageAreaPerSpace > 0
      ? Math.floor((input.garageBgf * p.garageEfficiency) / p.garageAreaPerSpace)
      : 0;
  return { demand: Math.ceil(demand - 1e-9), capacity };
}
