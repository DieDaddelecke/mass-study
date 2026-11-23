/**
 * Spaces of the non-dwelling uses (Wohnheim / Büro): interior rooms of residence studios,
 * shared shafts, common rooms, and the rooms of office plateaus. Kept apart from the dwelling
 * rooms (rooms.ts), so the housing generator and these uses evolve independently.
 */
import type { StoreyLayout } from './layout.js';
import type { Polygon, ResidenceRules, OfficeRules, Mass, Settings } from './types.js';

export type SpaceKind =
  // residence studios
  | 'sde'
  | 'entree'
  | 'kitchenette'
  | 'gaine'
  // residence ground floor
  | 'accueil'
  | 'laverie'
  | 'salleCommune'
  // offices
  | 'openSpace'
  | 'bureau'
  | 'reunion'
  | 'sanitaires'
  | 'hall';

export const SPACE_KINDS: readonly SpaceKind[] = [
  'sde',
  'entree',
  'kitchenette',
  'gaine',
  'accueil',
  'laverie',
  'salleCommune',
  'openSpace',
  'bureau',
  'reunion',
  'sanitaires',
  'hall',
];

/** Office spaces counted as usable area (surface utile). */
export const OFFICE_USABLE: readonly SpaceKind[] = ['openSpace', 'bureau', 'reunion'];
/** Common rooms of a residence. */
export const RESIDENCE_COMMON: readonly SpaceKind[] = ['accueil', 'laverie', 'salleCommune'];

export interface LayoutSpace {
  kind: SpaceKind;
  polygon: Polygon;
  area: number;
  /** Workstations (offices). */
  desks?: number;
  /**
   * Drawn on top of another space (e.g. the kitchenette inside the studio room): not a zone of
   * its own and not counted in the areas.
   */
  overlay?: boolean;
}

/** Summary of a residence storey. */
export interface ResidenceSummary {
  variant: ResidenceRules['variant'];
  /** Units (studios, PMR studios, corner units) and beds. */
  units: number;
  beds: number;
  pmr: number;
  /** Common rooms (ground floor), m². */
  commonArea: number;
}

/** Summary of an office storey. */
export interface OfficeSummary {
  layout: OfficeRules['layout'];
  /** Usable area (surface utile: open space, offices, meeting rooms), m². */
  usable: number;
  desks: number;
  meetingRooms: number;
  /** Lifts needed for the storey area (areaPerLift). */
  lifts: number;
  /** Largest distance of the plateau from a façade, m. */
  facadeDistance: number;
  /** False when the plateau is deeper than maxFacadeDistance (daylight). */
  depthOk: boolean;
}

export const RESIDENCE_DEFAULTS: Record<ResidenceRules['variant'], ResidenceRules> = {
  etudiant: {
    variant: 'etudiant',
    studioWidth: 3.0,
    pmrWidth: 3.75,
    pmrShare: 0.05,
    pmrMinPerStorey: 1,
    cornerWidth: 6.25,
    corridorWidth: 1.5,
    wetDepth: 2.2,
    sdeWidth: 1.7,
    shaft: [0.8, 0.6],
    kitchenetteLength: 1.8,
    commonPerUnit: 1,
    commonMin: 60,
  },
  senior: {
    variant: 'senior',
    studioWidth: 5.0,
    pmrWidth: 5.0,
    pmrShare: 1,
    pmrMinPerStorey: 1,
    cornerWidth: 7.5,
    corridorWidth: 1.6,
    wetDepth: 2.4,
    sdeWidth: 2.4,
    shaft: [0.8, 0.6],
    kitchenetteLength: 2.4,
    commonPerUnit: 1.5,
    commonMin: 80,
  },
};

export const DEFAULT_OFFICE_RULES: OfficeRules = {
  layout: 'openSpace',
  grid: 1.35,
  maxFacadeDistance: 7.5,
  areaPerDeskOpen: 11,
  areaPerDeskCell: 14,
  cellModules: 2,
  desksPerMeeting: 15,
  meetingModules: 3,
  corridorWidth: 1.6,
  coreWidth: 6.0,
  coreDepth: 6.0,
  sanitaryWidth: 4.05,
  areaPerLift: 1000,
  lobbyModules: 6,
};

/** Residence rules of a mass: its own, else the project, on the defaults of the variant. */
export function resolveResidenceRules(
  mass: Pick<Mass, 'residence'> | undefined,
  settings: Pick<Settings, 'residenceRules'>,
): ResidenceRules {
  const variant = mass?.residence?.variant ?? settings.residenceRules?.variant ?? 'etudiant';
  const base = RESIDENCE_DEFAULTS[variant];
  // project values apply only to the variant they were set for
  const project =
    (settings.residenceRules?.variant ?? 'etudiant') === variant
      ? (settings.residenceRules ?? {})
      : {};
  return { ...base, ...project, ...(mass?.residence ?? {}), variant };
}

export function resolveOfficeRules(
  mass: Pick<Mass, 'office'> | undefined,
  settings: Pick<Settings, 'officeRules'>,
): OfficeRules {
  return { ...DEFAULT_OFFICE_RULES, ...(settings.officeRules ?? {}), ...(mass?.office ?? {}) };
}

/** Totals of the residence and office storeys of a set of mass layouts (KPIs, legends). */
export interface UsesTotals {
  residence?: {
    units: number;
    beds: number;
    pmr: number;
    commonArea: number;
    unitArea: number;
    byType: { typeId: string; label: string; count: number; area: number }[];
  };
  office?: {
    usable: number;
    desks: number;
    meetingRooms: number;
    /** Footprint area of the office storeys (gross), m². */
    floorArea: number;
    /** Storeys deeper than the daylight distance. */
    deepStoreys: number;
  };
}

export function usesTotals(
  storeys: readonly Pick<StoreyLayout, 'residence' | 'office' | 'summary' | 'units'>[],
): UsesTotals {
  const out: UsesTotals = {};
  for (const st of storeys) {
    if (st.residence) {
      const r = (out.residence ??= {
        units: 0,
        beds: 0,
        pmr: 0,
        commonArea: 0,
        unitArea: 0,
        byType: [],
      });
      r.units += st.residence.units;
      r.beds += st.residence.beds;
      r.pmr += st.residence.pmr;
      r.commonArea += st.residence.commonArea;
      r.unitArea += st.summary.unitArea;
      for (const b of st.summary.byType) {
        const t = r.byType.find((x) => x.typeId === b.typeId);
        if (t) {
          t.count += b.count;
          t.area += b.area;
        } else r.byType.push({ typeId: b.typeId, label: b.label, count: b.count, area: b.area });
      }
    }
    if (st.office) {
      const o = (out.office ??= {
        usable: 0,
        desks: 0,
        meetingRooms: 0,
        floorArea: 0,
        deepStoreys: 0,
      });
      o.usable += st.office.usable;
      o.desks += st.office.desks;
      o.meetingRooms += st.office.meetingRooms;
      o.floorArea += st.summary.footprintArea;
      if (!st.office.depthOk) o.deepStoreys++;
    }
  }
  return out;
}
