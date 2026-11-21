import { solidAreas, sumAreas, type AreaFigures } from './areas.js';
import { polygonArea, union, polygonsArea } from './geometry.js';
import { typologySegments } from './generators.js';
import {
  parking,
  unitMix,
  unitsPerCoreRange,
  workplaces,
  type ParkingResult,
  type UnitMixResult,
} from './mix.js';
import {
  massToSolids,
  mergeStack,
  projectLevels,
  storeyFormula,
  type ProjectLevel,
} from './storeys.js';
import {
  lightWarning,
  massDepth,
  requiredCores,
  resolveAccess,
  suitability,
  type TypologySuitability,
} from './typologies.js';
import type { AccessType, Mass, Polygon, Settings, StoreySolid, Usage } from './types.js';

export interface SolidResult {
  solid: StoreySolid;
  areas: AreaFigures;
  /** DE Vollgeschoss according to the configured rule. */
  fullStorey: boolean;
}

export interface MassResult {
  mass: Mass;
  access: AccessType;
  depth: number;
  cores: number;
  suitability: TypologySuitability[];
  lightWarning: boolean;
  solids: SolidResult[];
  areas: AreaFigures;
  areasAbove: AreaFigures;
  areasBelow: AreaFigures;
  /** Top of parapet above ±0,00 (max over sections). */
  totalHeight: number;
  /** Top of the top slab without parapet (≈ hauteur à l'égout for flat roofs). */
  eavesHeight: number;
  /** Finished floor level of the highest storey (DE: "Höhe nach MBO"). */
  topFloorLevel: number;
  fullStoreys: number;
  aboveGroundStoreys: number;
  formula: string;
  dwellings: UnitMixResult;
  workplaces: number;
  /** Dwellings per storey and core outside the expected range of the access type. */
  mixHint?: { expected: [number, number]; actual: number };
}

export interface VariantResult {
  masses: MassResult[];
  solids: SolidResult[];
  areas: AreaFigures;
  areasAbove: AreaFigures;
  areasBelow: AreaFigures;
  /** Union of all above-ground footprints (overlap-free). */
  footprintUnion: Polygon[];
  footprintArea: number;
  levels: ProjectLevel[];
  dwellings: number;
  livingArea: number;
  workplaces: number;
  parking: ParkingResult;
  usageNuf: Record<Usage, number>;
}

const key = (s: StoreySolid) => `${s.segment ?? -1}|${s.storeyIndex}`;

/** DE full-storey rule (Vollgeschoss), evaluated per section. */
function fullStoreyFlags(
  solids: readonly StoreySolid[],
  slab: number,
  settings: Settings,
): boolean[] {
  const areaBy = new Map<string, number>();
  for (const s of solids) areaBy.set(key(s), (areaBy.get(key(s)) ?? 0) + polygonArea(s.footprint));
  const r = settings.fullStorey;
  return solids.map((s) => {
    if (!s.aboveGround) return false;
    if (s.z1 <= r.minHeightAboveGround) return false;
    if (s.z1 - s.z0 - slab < r.minClearHeight - 1e-9) return false;
    if (s.storeyIndex === 0) return true;
    const below = areaBy.get(`${s.segment ?? -1}|${s.storeyIndex - 1}`) ?? 0;
    const own = areaBy.get(key(s)) ?? 0;
    return below > 0 ? own / below > r.minAreaRatio + 1e-9 : true;
  });
}

export function analyzeMass(mass: Mass, settings: Settings): MassResult {
  const access = resolveAccess(mass, settings);
  const solids = massToSolids(mass, settings);
  const segs = typologySegments(mass.typology);
  const stackOf = (segment?: number) =>
    mergeStack(mass.storeys, segment !== undefined ? mass.segmentOverrides?.[segment] : undefined);

  const flags = fullStoreyFlags(solids, mass.storeys.slabThickness, settings);
  const results: SolidResult[] = solids.map((solid, i) => ({
    solid,
    areas: solidAreas(solid, access, settings, stackOf(solid.segment).parapet),
    fullStorey: flags[i]!,
  }));

  let totalHeight = 0;
  let eavesHeight = 0;
  let topFloorLevel = 0;
  let fullStoreys = 0;
  let aboveGroundStoreys = 0;
  const sectionIds = segs.map((s) => s.segment);
  for (const seg of sectionIds) {
    const own = results.filter((r) => r.solid.segment === seg && r.solid.aboveGround);
    if (!own.length) continue;
    const top = Math.max(...own.map((r) => r.solid.z1));
    totalHeight = Math.max(totalHeight, top + stackOf(seg).parapet);
    eavesHeight = Math.max(eavesHeight, top);
    topFloorLevel = Math.max(topFloorLevel, ...own.map((r) => r.solid.z0));
    fullStoreys = Math.max(
      fullStoreys,
      new Set(own.filter((r) => r.fullStorey).map((r) => r.solid.storeyIndex)).size,
    );
    aboveGroundStoreys = Math.max(
      aboveGroundStoreys,
      new Set(own.map((r) => r.solid.storeyIndex)).size,
    );
  }

  const areas = sumAreas(results.map((r) => r.areas));
  const areasAbove = sumAreas(results.filter((r) => r.solid.aboveGround).map((r) => r.areas));
  const areasBelow = sumAreas(results.filter((r) => !r.solid.aboveGround).map((r) => r.areas));
  const cores = requiredCores(mass, access, settings);

  let dwellings: UnitMixResult;
  if (mass.typology.kind === 'reihe' && areas.livingArea > 0) {
    const n = segs.length;
    dwellings = {
      total: n,
      byType: [{ id: 'reihenhaus', label: 'Reihenhaus', count: n, area: areas.livingArea }],
      residualArea: 0,
    };
  } else {
    dwellings = unitMix(areas.livingArea, settings.unitMix);
  }

  let mixHint: MassResult['mixHint'];
  const expected = unitsPerCoreRange(access);
  const resStoreys = new Set(
    results.filter((r) => r.solid.usage === 'wohnen').map((r) => r.solid.storeyIndex),
  ).size;
  if (expected && resStoreys > 0 && cores > 0 && dwellings.total > 0) {
    const actual = Math.round((dwellings.total / resStoreys / cores) * 10) / 10;
    if (actual < expected[0] - 0.5 || actual > expected[1] + 0.5) mixHint = { expected, actual };
  }

  const officeNuf = results
    .filter((r) => r.solid.usage === 'buero')
    .reduce((s, r) => s + r.areas.nuf, 0);
  const usage = mass.usage ?? 'wohnen';

  const out: MassResult = {
    mass,
    access,
    depth: massDepth(mass.typology),
    cores,
    suitability: suitability(mass.typology, usage, settings),
    lightWarning: lightWarning(mass.typology, usage, settings),
    solids: results,
    areas,
    areasAbove,
    areasBelow,
    totalHeight,
    eavesHeight,
    topFloorLevel,
    fullStoreys,
    aboveGroundStoreys,
    formula: storeyFormula(mass.storeys, settings.notation),
    dwellings,
    workplaces: workplaces(officeNuf, settings),
  };
  if (mixHint) out.mixHint = mixHint;
  return out;
}

export function analyzeMasses(masses: readonly Mass[], settings: Settings): VariantResult {
  const massResults = masses.map((m) => analyzeMass(m, settings));
  const solids = massResults.flatMap((m) => m.solids);
  const footprintUnion = union(
    solids.filter((s) => s.solid.aboveGround).map((s) => s.solid.footprint),
  );
  const usageNuf: Record<Usage, number> = {
    wohnen: 0,
    buero: 0,
    gewerbe: 0,
    gemeinbedarf: 0,
    parken: 0,
    technik: 0,
  };
  for (const s of solids) usageNuf[s.solid.usage] += s.areas.nuf;
  const garageBgf = solids
    .filter((s) => s.solid.usage === 'parken')
    .reduce((a, s) => a + s.areas.bgf, 0);
  const dwellings = massResults.reduce((a, m) => a + m.dwellings.total, 0);
  return {
    masses: massResults,
    solids,
    areas: sumAreas(massResults.map((m) => m.areas)),
    areasAbove: sumAreas(massResults.map((m) => m.areasAbove)),
    areasBelow: sumAreas(massResults.map((m) => m.areasBelow)),
    footprintUnion,
    footprintArea: polygonsArea(footprintUnion),
    levels: projectLevels(
      solids.map((s) => s.solid),
      settings,
    ),
    dwellings,
    livingArea: massResults.reduce((a, m) => a + m.areas.livingArea, 0),
    workplaces: massResults.reduce((a, m) => a + m.workplaces, 0),
    parking: parking(
      { dwellings, officeNuf: usageNuf.buero, retailNuf: usageNuf.gewerbe, garageBgf },
      settings,
    ),
    usageNuf,
  };
}
