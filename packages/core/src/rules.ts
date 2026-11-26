import type { VariantResult } from './analysis.js';
import type { Constraints, Settings } from './types.js';
import type { Traffic } from './typologies.js';
import type { GreenKpis } from './green.js';

// ---------------------------------------------------------------------------
// DE profile (BauNVO / MBO, simplified)
// ---------------------------------------------------------------------------

export interface KpisDE {
  siteArea: number;
  gr: number;
  grz: number;
  gf: number;
  gfz: number;
  gfzAllAbove: number;
  baumasse: number;
  bmz: number;
  maxFullStoreys: number;
  totalHeight: number;
  /** Höhe nach MBO § 2 Abs. 3 (finished floor of the highest storey; flat terrain). */
  mboHeight: number;
  buildingClass: 1 | 2 | 3 | 4 | 5;
  highRise: boolean;
  elevatorRequired: boolean;
  dwellings: number;
}

export function kpisDE(r: VariantResult, siteArea: number, settings: Settings): KpisDE {
  const gf = r.solids.filter((s) => s.fullStorey).reduce((a, s) => a + s.areas.bgf, 0);
  const baumasse = r.areasAbove.bri + r.masses.reduce((a, m) => a + m.roofVolume, 0);
  const mboHeight = Math.max(0, ...r.masses.map((m) => m.topFloorLevel));
  const totalHeight = Math.max(0, ...r.masses.map((m) => m.totalHeight));
  // Largest Nutzungseinheit: residential → largest dwelling of the mix, else NUF per storey and core.
  let maxUnit = 0;
  for (const m of r.masses) {
    const res = m.solids.some((s) => s.solid.usage === 'wohnen' && s.solid.aboveGround);
    if (res)
      maxUnit = Math.max(
        maxUnit,
        ...settings.unitMix.map((u) => u.areaMax),
        m.mass.typology.kind === 'reihe' ? m.areas.livingArea / Math.max(1, m.dwellings.total) : 0,
      );
    for (const s of m.solids) {
      if (s.solid.aboveGround && s.solid.usage !== 'wohnen')
        maxUnit = Math.max(maxUnit, s.areas.nuf / Math.max(1, m.cores));
    }
  }
  let buildingClass: KpisDE['buildingClass'];
  if (mboHeight <= 7) {
    buildingClass =
      r.dwellings <= 2 && r.areasAbove.bgf <= 400 ? (r.masses.length <= 1 ? 1 : 2) : 3;
  } else if (mboHeight <= 13 && maxUnit <= 400) buildingClass = 4;
  else buildingClass = 5;
  return {
    siteArea,
    gr: r.footprintArea,
    grz: siteArea > 0 ? r.footprintArea / siteArea : 0,
    gf,
    gfz: siteArea > 0 ? gf / siteArea : 0,
    gfzAllAbove: siteArea > 0 ? r.areasAbove.bgf / siteArea : 0,
    baumasse,
    bmz: siteArea > 0 ? baumasse / siteArea : 0,
    maxFullStoreys: Math.max(0, ...r.masses.map((m) => m.fullStoreys)),
    totalHeight,
    mboHeight,
    buildingClass,
    highRise: mboHeight > 22,
    elevatorRequired: mboHeight > 13,
    dwellings: r.dwellings,
  };
}

// ---------------------------------------------------------------------------
// FR profile (Code de l'urbanisme, simplified)
// ---------------------------------------------------------------------------

export interface KpisFR {
  siteArea: number;
  /** Emprise au sol (projection of above-ground volumes, without overhangs). */
  emprise: number;
  ces: number;
  /** Surface de plancher, approximation of R.111-22. */
  surfaceDePlancher: number;
  /** Coefficient (SDP / terrain), informative since the COS was abolished (loi ALUR). */
  densite: number;
  /** Hauteur à l'égout / sommet de façade (flat roof: top slab). */
  hauteurEgout: number;
  /** Hauteur à l'acrotère (incl. parapet) or au faîtage (ridge), whichever is higher. */
  hauteurAcrotere: number;
  /** Hauteur au faîtage of pitched roofs (0 when all roofs are flat). */
  hauteurFaitage: number;
  /** Maximum number of above-ground levels (R+n → n+1). */
  niveaux: number;
  formula: string;
  logements: number;
  surfaceHabitable: number;
}

/** Steps of the surface de plancher approximation (R.111-22), the numbers {@link kpisFR} uses. */
export interface SdpBreakdown {
  /** Surface brute of all storeys (incl. basements). */
  gross: number;
  /** Parking storeys left out (BGF), when `deductParking`. */
  parking: number;
  /** Exterior wall thickness (perimeter × wall thickness) of the remaining storeys. */
  exteriorWalls: number;
  /** Technical rooms (TF) of the remaining storeys, when `deductTechnical`. */
  technical: number;
  /** After the deductions, before the abatement. */
  beforeAbatement: number;
  /** Residential part of `beforeAbatement`. */
  residential: number;
  /** Abatement on the residential part (residential × residentialAbatement). */
  abatement: number;
  /** Surface de plancher (not clamped). */
  sdp: number;
}

export function sdpBreakdown(r: Pick<VariantResult, 'solids'>, settings: Settings): SdpBreakdown {
  const sdpSettings = settings.surfaceDePlancher;
  let gross = 0;
  let parkingArea = 0;
  let exteriorWalls = 0;
  let technical = 0;
  let before = 0;
  let residential = 0;
  for (const s of r.solids) {
    gross += s.areas.bgf;
    if (sdpSettings.deductParking && s.solid.usage === 'parken') {
      parkingArea += s.areas.bgf;
      continue;
    }
    let a = s.areas.bgf - s.areas.exteriorWalls;
    exteriorWalls += s.areas.exteriorWalls;
    if (sdpSettings.deductTechnical) {
      a -= s.areas.tf;
      technical += s.areas.tf;
    }
    before += a;
    if (s.solid.usage === 'wohnen') residential += a;
  }
  const abatement = residential * sdpSettings.residentialAbatement;
  return {
    gross,
    parking: parkingArea,
    exteriorWalls,
    technical,
    beforeAbatement: before,
    residential,
    abatement,
    sdp: before - abatement,
  };
}

export function kpisFR(r: VariantResult, siteArea: number, settings: Settings): KpisFR {
  const sdp = sdpBreakdown(r, settings).sdp;
  const highest = r.masses.reduce<VariantResult['masses'][number] | undefined>(
    (best, m) => (!best || m.aboveGroundStoreys > best.aboveGroundStoreys ? m : best),
    undefined,
  );
  return {
    siteArea,
    emprise: r.footprintArea,
    ces: siteArea > 0 ? r.footprintArea / siteArea : 0,
    surfaceDePlancher: Math.max(0, sdp),
    densite: siteArea > 0 ? sdp / siteArea : 0,
    hauteurEgout: Math.max(0, ...r.masses.map((m) => m.eavesHeight)),
    hauteurAcrotere: Math.max(0, ...r.masses.map((m) => m.totalHeight)),
    hauteurFaitage: Math.max(0, ...r.masses.map((m) => m.ridgeHeight)),
    niveaux: Math.max(0, ...r.masses.map((m) => m.aboveGroundStoreys)),
    formula: highest?.formula ?? '',
    logements: r.dwellings,
    surfaceHabitable: r.livingArea,
  };
}

// ---------------------------------------------------------------------------
// Targets vs. actual (traffic lights)
// ---------------------------------------------------------------------------

export interface ConstraintRow {
  key: string;
  actual: number;
  target?: number;
  /** The target is a minimum (espaces verts, pleine terre), not a maximum. */
  min?: true;
  status: Traffic | 'none';
}

/** ≤ 95 % of the limit: ok; ≤ 100 %: warning (at the limit); above: error. */
export function judge(actual: number, max?: number): Traffic | 'none' {
  if (max === undefined || !Number.isFinite(max)) return 'none';
  if (actual > max + 1e-9) return 'error';
  if (actual > max * 0.95) return 'warning';
  return 'ok';
}

/** Minimum: ≥ 105 % of the minimum: ok; ≥ 100 %: warning (at the limit); below: error. */
export function judgeMin(actual: number, min?: number): Traffic | 'none' {
  if (min === undefined || !Number.isFinite(min)) return 'none';
  if (actual < min - 1e-9) return 'error';
  if (actual < min * 1.05) return 'warning';
  return 'ok';
}

export function constraintRows(
  profile: Settings['profile'],
  c: Constraints,
  de: KpisDE,
  fr: KpisFR,
  green?: GreenKpis,
): ConstraintRow[] {
  const row = (key: string, actual: number, target?: number): ConstraintRow => {
    const r: ConstraintRow = { key, actual, status: judge(actual, target) };
    if (target !== undefined) r.target = target;
    return r;
  };
  const minRow = (key: string, actual: number, target?: number): ConstraintRow => {
    const r: ConstraintRow = { key, actual, min: true, status: judgeMin(actual, target) };
    if (target !== undefined) r.target = target;
    return r;
  };
  if (profile === 'FR') {
    const rows = [
      row('ces', fr.ces, c.empriseMax),
      row('hauteur', fr.hauteurEgout, c.hauteurMax ?? c.maxHeight),
      row('surfaceDePlancher', fr.surfaceDePlancher),
      row('niveaux', fr.niveaux, c.niveauxMax),
    ];
    if (green) {
      rows.push(minRow('espacesVerts', green.espacesVertsRatio, c.espacesVertsMin));
      rows.push(minRow('pleineTerre', green.pleineTerreRatio, c.pleineTerreMin));
    }
    return rows;
  }
  return [
    row('grz', de.grz, c.grz),
    row('gfz', de.gfz, c.gfz),
    row('bmz', de.bmz, c.bmz),
    row('maxFullStoreys', de.maxFullStoreys, c.maxFullStoreys),
    row('totalHeight', de.totalHeight, c.maxHeight),
  ];
}
