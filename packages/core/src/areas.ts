import { polygonArea, polygonPerimeter } from './geometry.js';
import type { AccessType, Settings, StoreySolid } from './types.js';

/** Areas according to DIN 277 (approximation for feasibility studies). */
export interface AreaFigures {
  bgf: number;
  kgf: number;
  nrf: number;
  nuf: number;
  vf: number;
  tf: number;
  bri: number;
  /** Approximate living area (residential NUF × factor). */
  livingArea: number;
  /** Exterior wall area share of the footprint (perimeter × wall thickness). */
  exteriorWalls: number;
}

export const ZERO_AREAS: AreaFigures = Object.freeze({
  bgf: 0,
  kgf: 0,
  nrf: 0,
  nuf: 0,
  vf: 0,
  tf: 0,
  bri: 0,
  livingArea: 0,
  exteriorWalls: 0,
});

export function solidAreas(
  solid: StoreySolid,
  access: AccessType,
  settings: Pick<Settings, 'areas'>,
  parapet = 0,
): AreaFigures {
  const a = settings.areas;
  const bgf = polygonArea(solid.footprint);
  const exteriorWalls = Math.min(bgf, polygonPerimeter(solid.footprint) * a.exteriorWallThickness);
  const kgf = Math.min(bgf, exteriorWalls + bgf * a.interiorConstructionShare);
  const nrf = bgf - kgf;
  let vf: number;
  let tf: number;
  if (solid.usage === 'technik') {
    vf = 0;
    tf = nrf;
  } else if (solid.usage === 'parken') {
    vf = 0;
    tf = nrf * a.technicalShare;
  } else {
    vf = nrf * circulationShare(a.circulationShare, access);
    tf = nrf * a.technicalShare;
  }
  const nuf = nrf - vf - tf;
  const height = solid.z1 - solid.z0 + (solid.top ? parapet : 0);
  return {
    bgf,
    kgf,
    nrf,
    nuf,
    vf,
    tf,
    bri: bgf * height,
    livingArea: solid.usage === 'wohnen' ? nuf * a.livingAreaFactor : 0,
    exteriorWalls,
  };
}

export function sumAreas(list: readonly AreaFigures[]): AreaFigures {
  const out = { ...ZERO_AREAS };
  for (const f of list) {
    out.bgf += f.bgf;
    out.kgf += f.kgf;
    out.nrf += f.nrf;
    out.nuf += f.nuf;
    out.vf += f.vf;
    out.tf += f.tf;
    out.bri += f.bri;
    out.livingArea += f.livingArea;
    out.exteriorWalls += f.exteriorWalls;
  }
  return out;
}

/** VF share of an access type (files from before the Vierspänner take the Dreispänner share). */
export function circulationShare(
  shares: Settings['areas']['circulationShare'],
  access: AccessType,
): number {
  return access === 'vierspaenner' ? (shares.vierspaenner ?? shares.dreispaenner) : shares[access];
}

/** Depth range of a residential access type ([13, 15] m for a Vierspänner if not set). */
export function residentialDepthRange(
  ranges: Settings['depthRanges']['wohnen'],
  access: Exclude<AccessType, 'buero' | 'reihenhaus'>,
): [number, number] {
  return access === 'vierspaenner' ? (ranges.vierspaenner ?? [13, 15]) : ranges[access];
}
