/**
 * Central data model of Kubatur. All coordinates are local and metric:
 * x = east, y = north, z = up, origin = centroid of the site.
 */

export type Vec2 = [number, number];

/** Outer ring counter-clockwise, holes clockwise. Rings are open (last point ≠ first). */
export interface Polygon {
  outer: Vec2[];
  holes?: Vec2[][];
}

export type RuleProfileId = 'FR' | 'DE';
export type StoreyNotation = 'fr' | 'de' | 'roman';

export type Usage = 'wohnen' | 'buero' | 'gewerbe' | 'gemeinbedarf' | 'parken' | 'technik';
export const USAGES: readonly Usage[] = [
  'wohnen',
  'buero',
  'gewerbe',
  'gemeinbedarf',
  'parken',
  'technik',
];

export type AccessType =
  | 'zweispaenner'
  | 'dreispaenner'
  | 'laubengang'
  | 'mittelflur'
  | 'punkthaus'
  | 'reihenhaus'
  | 'buero';

// ---------------------------------------------------------------------------
// Typologies (Bauformen)
// ---------------------------------------------------------------------------

export interface SolitaerTypology {
  kind: 'solitaer';
  length: number;
  depth: number;
}

export interface ZeileTypology {
  kind: 'zeile';
  length: number;
  depth: number;
  sections: number;
  /** Offset of every second section perpendicular to the length axis (staggering), m. */
  sectionOffset: number;
}

export interface ReiheTypology {
  kind: 'reihe';
  count: number;
  unitWidth: number;
  depth: number;
  /** Alternating offset perpendicular to the row axis, m. */
  alternatingOffset: number;
  /** Optional width of both end houses. */
  endUnitWidth?: number;
}

export type LineAlignment = 'center' | 'left' | 'right';

export interface FreeLineTypology {
  kind: 'freeLine';
  /** Polyline in local mass coordinates. */
  points: Vec2[];
  closed: boolean;
  depth: number;
  alignment: LineAlignment;
}

export interface FreePolygonTypology {
  kind: 'freePolygon';
  polygon: Polygon;
}

export type Typology =
  SolitaerTypology | ZeileTypology | ReiheTypology | FreeLineTypology | FreePolygonTypology;

export type TypologyKind = Typology['kind'];

// ---------------------------------------------------------------------------
// Storeys
// ---------------------------------------------------------------------------

export type SetbackDistance = number | { front: number; back: number; left: number; right: number };

export interface StoreyStack {
  basement: { count: number; height: number };
  ground: { height: number };
  upper: { count: number; height: number };
  /** index: storey index (-n … m, 0 = ground floor). */
  heightOverrides?: { index: number; height: number }[];
  /** The top `storeys` upper storeys are set back (Staffelgeschoss / attique). */
  setback?: { storeys: number; distance: SetbackDistance };
  /** Parapet / roof upstand above the top slab, m. */
  parapet: number;
  slabThickness: number;
}

export interface Mass {
  id: string;
  name: string;
  typology: Typology;
  position: Vec2;
  /** Rotation in radians, counter-clockwise. */
  rotation: number;
  storeys: StoreyStack;
  /** Per section (Zeile / Reihe) overrides. */
  segmentOverrides?: Record<number, Partial<StoreyStack>>;
  /** Default usage of above-ground storeys (basement defaults to parking). */
  usage?: Usage;
  usageByStorey?: Record<number, Usage>;
  access?: AccessType | 'auto';
  /** Outdoor spaces of the dwellings (balcons, loggias, terrasses); default: settings. */
  outdoor?: OutdoorConfig;
}

export type OutdoorKind = 'none' | 'balcon' | 'loggia';
/** Façade orientation (outward normal). */
export type FacadeSide = 'N' | 'E' | 'S' | 'W';

export interface OutdoorSideConfig {
  kind: OutdoorKind;
  /** Depth, m (raised to the minimum of the kind). */
  depth: number;
}

/** Outdoor spaces of a building: for all façades, optionally per side. */
export interface OutdoorConfig extends OutdoorSideConfig {
  /** Ground-floor dwellings get a terrace (outside the footprint) instead. */
  groundTerrace: boolean;
  /** Per-side overrides (orientation of the façade). */
  sides?: Partial<Record<FacadeSide, OutdoorSideConfig>>;
}

/** Office minimums of outdoor spaces. */
export interface OutdoorRules {
  /** Minimum area, m² (4). */
  minArea: number;
  /** Minimum depth of a loggia, m (1.80). */
  loggiaMinDepth: number;
  /** Minimum depth of a balcony, m (1.40). */
  balconMinDepth: number;
  /** Depth of ground-floor terraces, m (3.00). */
  terraceDepth: number;
}

/** Central derived structure. 3D, areas, drawings, IFC and Archicad are generated from it. */
export interface StoreySolid {
  massId: string;
  segment?: number;
  /** -n … m, 0 = ground floor */
  storeyIndex: number;
  label: string;
  /** World (project-local) coordinates. */
  footprint: Polygon;
  /** Finished floor level of this storey and of the one above. */
  z0: number;
  z1: number;
  usage: Usage;
  aboveGround: boolean;
  /** True for set-back storeys (Staffelgeschoss / attique). */
  setback: boolean;
  /** True for the topmost storey of its mass / section (parapet sits on top). */
  top: boolean;
}

// ---------------------------------------------------------------------------
// Site, context, project
// ---------------------------------------------------------------------------

export interface Parcel {
  id: string;
  source: 'cadastre' | 'drawn' | 'import';
  ref?: string;
  polygon: Polygon;
}

export interface Site {
  parcels: Parcel[];
  boundary: Polygon;
  buildable?: Polygon[];
  buildingLines?: Vec2[][];
}

export interface ContextBuilding {
  id: string;
  footprint: Polygon;
  /** Top of the building above ground (m). */
  height: number;
  /** Bottom of the volume above ground (m), e.g. OSM min_height for building parts. */
  baseHeight?: number;
  levels?: number;
  source: 'osm' | 'ign' | 'import' | 'manual';
  heightEstimated: boolean;
  hidden?: boolean;
  /** Existing building on the site that is to be demolished. */
  demolished?: boolean;
}

export type ContextRoadKind =
  | 'motorway'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service'
  | 'track'
  | 'cycleway'
  | 'footway'
  | 'path'
  | 'rail'
  | 'tram';

export interface ContextRoad {
  id: string;
  /** Centre line in local coordinates. */
  centerline: Vec2[];
  /** Carriageway width, m. */
  width: number;
  widthEstimated: boolean;
  kind: ContextRoadKind;
  name?: string;
  /** -1 below ground, 0 at grade, 1 bridge. */
  level: -1 | 0 | 1;
  source: 'osm' | 'ign' | 'import' | 'manual';
}

export type ContextGreenKind =
  'wood' | 'park' | 'grass' | 'garden' | 'pitch' | 'scrub' | 'hedge' | 'other';

export interface ContextGreen {
  id: string;
  footprint: Polygon;
  kind: ContextGreenKind;
  source: 'osm' | 'ign' | 'import' | 'manual';
}

export interface ContextTree {
  id: string;
  position: Vec2;
  height: number;
  /** Crown diameter, m. */
  crown: number;
  heightEstimated: boolean;
  leafType?: 'broadleaved' | 'needleleaved';
  source: 'osm' | 'ign' | 'import' | 'manual';
}

export interface ContextWater {
  id: string;
  footprint: Polygon;
  source: 'osm' | 'ign' | 'import' | 'manual';
}

/** Neighbouring cadastral parcel (context only; the site parcels live in Site.parcels). */
export interface ContextParcel {
  id: string;
  ref?: string;
  label?: string;
  polygon: Polygon;
}

/** Surroundings beyond buildings: streets, vegetation, water, neighbouring parcels. */
export interface Surroundings {
  roads: ContextRoad[];
  green: ContextGreen[];
  trees: ContextTree[];
  water: ContextWater[];
  parcels: ContextParcel[];
}

export interface Variant {
  id: string;
  name: string;
  masses: Mass[];
}

export interface Constraints {
  // DE
  grz?: number;
  gfz?: number;
  bmz?: number;
  maxFullStoreys?: number;
  // shared
  maxHeight?: number;
  /** Abstandsflächen factor (DE, e.g. 0.4 H). */
  setbackFactor?: number;
  // FR
  /** Coefficient d'emprise au sol (CES), 0…1. */
  empriseMax?: number;
  /** Hauteur maximale, m (measured as configured in the profile). */
  hauteurMax?: number;
  /** Prospect: minimum distance to boundaries as a fraction of height (H/x → 1/x). */
  prospectRatio?: number;
  prospectMin?: number;
  buildable?: Polygon[];
  buildingLines?: Vec2[][];
}

export interface UnitType {
  id: string;
  label: string;
  /** Target share 0…1 */
  share: number;
  areaMin: number;
  areaTarget: number;
  areaMax: number;
  /** Number of main rooms (T3 = 3: living + 2 bedrooms); default: digit in id / label. */
  rooms?: number;
}

/** Office rules for dwellings: minimum façade lengths per room, m. */
export interface UnitRules {
  /** Living room (séjour), m (3.60). */
  livingMinFacade: number;
  /** PMR bedroom of every dwelling with a bedroom, m (2.80). */
  pmrBedroomMinFacade: number;
  /** Every further bedroom, m (2.50). */
  bedroomMinFacade: number;
  /** Partition between rooms along the façade, m (0.10). */
  interiorWall: number;
  /** Whether the gallery side of a Laubengang dwelling counts as façade. */
  galleryCountsAsFacade: boolean;
}

export interface Settings {
  profile: RuleProfileId;
  notation: StoreyNotation;
  language: 'fr' | 'de' | 'en';
  areas: {
    exteriorWallThickness: number;
    /** Share of BGF taken by interior walls / structure. */
    interiorConstructionShare: number;
    technicalShare: number;
    livingAreaFactor: number;
    /** VF share of NRF per access type. */
    circulationShare: Record<AccessType, number>;
  };
  depthRanges: {
    wohnen: Record<Exclude<AccessType, 'buero' | 'reihenhaus'>, [number, number]>;
    buero: {
      zellenbuero: [number, number];
      kombibuero: [number, number];
      openSpace: [number, number];
    };
    /** Minimum footprint side for a Punkthaus (solitaire) */
    punkthausMinSide: number;
    lightWarningDepth: number;
  };
  cores: {
    /** Maximum distance to a protected stair (MBO § 35 / CCH), m. */
    maxEscapeDistance: number;
    /** Typical section length served by one core per access type, m. */
    sectionLength: Partial<Record<AccessType, number>>;
    /** Schematic core size (stair + lift) along the building axis, m (default 5.5). */
    coreWidth?: number;
    /** Schematic core size across the building depth, m (default 6). */
    coreDepth?: number;
    /** Width of the access gallery (coursive / Laubengang), m (default 1.6). */
    galleryWidth?: number;
    /** Width of the central corridor (couloir central / Mittelflur), m (default 1.8). */
    corridorWidth?: number;
    /** Depth of the landing in front of the core (palier), m (default 1.5). */
    landingDepth?: number;
  };
  unitMix: UnitType[];
  /** Office façade rules for dwellings (defaults when missing). */
  unitRules?: UnitRules;
  /** Outdoor spaces: minimums and the default configuration of new buildings. */
  outdoorRules?: OutdoorRules;
  outdoor?: OutdoorConfig;
  workplaceArea: number;
  parking: {
    perDwelling: number;
    officeAreaPerSpace: number;
    retailAreaPerSpace: number;
    garageAreaPerSpace: number;
    garageEfficiency: number;
  };
  /** DE full-storey rule (Vollgeschoss, configurable per Land). */
  fullStorey: {
    minHeightAboveGround: number;
    minClearHeight: number;
    minAreaRatio: number;
  };
  /** FR surface de plancher approximation. */
  surfaceDePlancher: {
    deductParking: boolean;
    deductTechnical: boolean;
    /** Abattement of 10 % on residential area (Code de l'urbanisme R.111-22, 8°). */
    residentialAbatement: number;
  };
  levelTolerance: number;
}

export interface ProjectInfo {
  address?: string;
  client?: string;
  author?: string;
  office?: string;
  date: string;
  revision: string;
  phase: string;
  logo?: string;
}

export interface GeoReference {
  crs: string;
  originCrs: Vec2;
  originLonLat: [number, number];
  groundElevation?: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  info: ProjectInfo;
  geo: GeoReference;
  site: Site;
  context: ContextBuilding[];
  /** Optional (added after schema v1 shipped; absent = not loaded yet). */
  surroundings?: Surroundings;
  variants: Variant[];
  activeVariantId: string;
  /** View and sheet definitions are owned by the drawing package (added in a later phase). */
  views: unknown[];
  sheets: unknown[];
  settings: Settings;
  constraints: Constraints;
}
