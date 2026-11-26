import type { AccessType, BikeParkingRules, Settings, UnitType } from './types.js';

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

/**
 * Expected dwellings per storey and core for an access type, or undefined if not applicable.
 * Zweispänner / Dreispänner serve 2 / 3; gallery, corridor and point blocks the office range
 * (`range`, default 3–8, settings: unitRules.unitsPerCoreMin/Max).
 */
export function unitsPerCoreRange(
  access: AccessType,
  range: [number, number] = [3, 8],
): [number, number] | undefined {
  switch (access) {
    case 'zweispaenner':
      return [2, 2];
    case 'dreispaenner':
      return [3, 3];
    case 'vierspaenner':
      return [4, 4];
    case 'punkthaus':
      // point block: 4 to 7 dwellings around the central core (within the office range)
      return [Math.max(4, range[0]), Math.max(Math.max(4, range[0]), Math.min(7, range[1]))];
    case 'laubengang':
    case 'mittelflur':
      return range;
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

/** Every step of the car parking calculation (same numbers as {@link parking}). */
export interface ParkingBreakdown extends ParkingResult {
  dwellings: number;
  /** Spaces for the dwellings (dwellings × spaces per dwelling, not rounded). */
  dwellingSpaces: number;
  officeNuf: number;
  officeSpaces: number;
  retailNuf: number;
  retailSpaces: number;
  /** Sum before rounding up. */
  demandExact: number;
  garageBgf: number;
  /** Garage area usable for spaces and aisles (BGF × efficiency). */
  garageUsable: number;
  /** Garage BGF the demand needs (demand × area per space / efficiency). */
  garageBgfRequired: number;
}

export function parkingBreakdown(
  input: { dwellings: number; officeNuf: number; retailNuf: number; garageBgf: number },
  settings: Pick<Settings, 'parking'>,
): ParkingBreakdown {
  const p = settings.parking;
  const dwellingSpaces = input.dwellings * p.perDwelling;
  const officeSpaces = p.officeAreaPerSpace > 0 ? input.officeNuf / p.officeAreaPerSpace : 0;
  const retailSpaces = p.retailAreaPerSpace > 0 ? input.retailNuf / p.retailAreaPerSpace : 0;
  const demandExact = dwellingSpaces + officeSpaces + retailSpaces;
  const demand = Math.ceil(demandExact - 1e-9);
  const garageUsable = input.garageBgf * p.garageEfficiency;
  const capacity = p.garageAreaPerSpace > 0 ? Math.floor(garageUsable / p.garageAreaPerSpace) : 0;
  return {
    dwellings: input.dwellings,
    dwellingSpaces,
    officeNuf: input.officeNuf,
    officeSpaces,
    retailNuf: input.retailNuf,
    retailSpaces,
    demandExact,
    demand,
    garageBgf: input.garageBgf,
    garageUsable,
    capacity,
    garageBgfRequired:
      p.garageEfficiency > 0 ? (demand * p.garageAreaPerSpace) / p.garageEfficiency : 0,
  };
}

export function parking(
  input: { dwellings: number; officeNuf: number; retailNuf: number; garageBgf: number },
  settings: Pick<Settings, 'parking'>,
): ParkingResult {
  const b = parkingBreakdown(input, settings);
  return { demand: b.demand, capacity: b.capacity };
}

/** Bicycle parking defaults (arrêté du 30 juin 2022; the PLU may ask for more). */
export const DEFAULT_BIKE_PARKING: BikeParkingRules = Object.freeze({
  perSmallDwelling: 1,
  perLargeDwelling: 2,
  largeFromRooms: 3,
  areaPerSpace: 1.5,
  officeShareOfWorkplaces: 0.15,
});

export function resolveBikeParking(settings: Pick<Settings, 'bikeParking'>): BikeParkingRules {
  return { ...DEFAULT_BIKE_PARKING, ...settings.bikeParking };
}

export interface BikeParkingResult {
  rules: BikeParkingRules;
  /** Dwellings with fewer than `largeFromRooms` pièces principales. */
  smallDwellings: number;
  largeDwellings: number;
  smallSpaces: number;
  largeSpaces: number;
  workplaces: number;
  officeSpaces: number;
  /** Total spaces (rounded up). */
  spaces: number;
  /** Floor area of the bicycle room(s), m². */
  area: number;
}

/**
 * Bicycle spaces and their area: dwellings by number of pièces principales (`rooms` of the
 * unit type; dwellings of an unknown type count as large) and office workplaces.
 */
export function bikeParking(
  input: {
    dwellingsByType: readonly { id: string; count: number }[];
    workplaces: number;
  },
  settings: Pick<Settings, 'bikeParking' | 'unitMix'>,
): BikeParkingResult {
  const rules = resolveBikeParking(settings);
  let small = 0;
  let large = 0;
  for (const t of input.dwellingsByType) {
    const rooms = settings.unitMix.find((u) => u.id === t.id)?.rooms;
    if (rooms !== undefined && rooms < rules.largeFromRooms) small += t.count;
    else large += t.count;
  }
  const smallSpaces = small * rules.perSmallDwelling;
  const largeSpaces = large * rules.perLargeDwelling;
  const officeSpaces = input.workplaces * rules.officeShareOfWorkplaces;
  const spaces = Math.ceil(smallSpaces + largeSpaces + officeSpaces - 1e-9);
  return {
    rules,
    smallDwellings: small,
    largeDwellings: large,
    smallSpaces,
    largeSpaces,
    workplaces: input.workplaces,
    officeSpaces,
    spaces,
    area: spaces * rules.areaPerSpace,
  };
}
