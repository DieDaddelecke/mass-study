import type { RuleProfileId, Settings, StoreyStack, UnitType, Usage } from './types.js';

/** Office default unit mix (France: T1 … T5). Shares sum to 1. */
export const DEFAULT_UNIT_MIX_FR: UnitType[] = [
  { id: 't1', label: 'T1', share: 0.1, areaMin: 25, areaTarget: 30, areaMax: 35 },
  { id: 't2', label: 'T2', share: 0.3, areaMin: 40, areaTarget: 45, areaMax: 50 },
  { id: 't3', label: 'T3', share: 0.35, areaMin: 58, areaTarget: 65, areaMax: 70 },
  { id: 't4', label: 'T4', share: 0.2, areaMin: 75, areaTarget: 82, areaMax: 90 },
  { id: 't5', label: 'T5', share: 0.05, areaMin: 90, areaTarget: 100, areaMax: 115 },
];

export const DEFAULT_UNIT_MIX_DE: UnitType[] = [
  { id: '1zi', label: '1-Zi', share: 0.1, areaMin: 28, areaTarget: 35, areaMax: 40 },
  { id: '2zi', label: '2-Zi', share: 0.3, areaMin: 45, areaTarget: 55, areaMax: 62 },
  { id: '3zi', label: '3-Zi', share: 0.35, areaMin: 65, areaTarget: 75, areaMax: 85 },
  { id: '4zi', label: '4-Zi', share: 0.2, areaMin: 85, areaTarget: 95, areaMax: 105 },
  { id: '5zi', label: '5-Zi', share: 0.05, areaMin: 105, areaTarget: 115, areaMax: 130 },
];

export function defaultSettings(profile: RuleProfileId = 'FR'): Settings {
  return {
    profile,
    notation: profile === 'FR' ? 'fr' : 'de',
    language: profile === 'FR' ? 'fr' : 'de',
    areas: {
      exteriorWallThickness: 0.4,
      interiorConstructionShare: 0.05,
      technicalShare: 0.02,
      livingAreaFactor: 1,
      circulationShare: {
        zweispaenner: 0.08,
        dreispaenner: 0.09,
        laubengang: 0.1,
        punkthaus: 0.1,
        mittelflur: 0.15,
        buero: 0.15,
        reihenhaus: 0.05,
      },
    },
    depthRanges: {
      wohnen: {
        laubengang: [8, 12],
        zweispaenner: [10, 13],
        dreispaenner: [12, 15],
        mittelflur: [15, 20],
        punkthaus: [18, 30],
      },
      buero: { zellenbuero: [12, 14], kombibuero: [14, 16], openSpace: [16, 22] },
      punkthausMinSide: 18,
      lightWarningDepth: 18,
    },
    cores: {
      maxEscapeDistance: 35,
      sectionLength: { zweispaenner: 22, dreispaenner: 28 },
      coreWidth: 5.5,
      coreDepth: 6,
      galleryWidth: 1.6,
      corridorWidth: 1.8,
      landingDepth: 1.5,
    },
    unitMix: profile === 'FR' ? DEFAULT_UNIT_MIX_FR : DEFAULT_UNIT_MIX_DE,
    workplaceArea: 12,
    parking: {
      perDwelling: 1,
      officeAreaPerSpace: 40,
      retailAreaPerSpace: 35,
      garageAreaPerSpace: 25,
      garageEfficiency: 0.9,
    },
    fullStorey: { minHeightAboveGround: 1.4, minClearHeight: 2.3, minAreaRatio: 2 / 3 },
    surfaceDePlancher: { deductParking: true, deductTechnical: true, residentialAbatement: 0.1 },
    levelTolerance: 0.05,
  };
}

export function defaultStoreys(usage: Usage = 'wohnen'): StoreyStack {
  const upper = usage === 'buero' ? 3.5 : 3.0;
  return {
    basement: { count: 0, height: 3.0 },
    ground: { height: usage === 'gewerbe' ? 4.0 : 3.5 },
    upper: { count: 4, height: upper },
    parapet: 0.5,
    slabThickness: 0.3,
  };
}
