/**
 * Typed subset of the Tapir add-on command schemas (Tapir 2.0.0,
 * github.com/ENZYME-APD/tapir-archicad-automation, docs/archicad-addon/command_definitions.js).
 * Only the fields the Kubatur transfer uses are modelled. Everything here was checked against
 * the schemas and against a live Archicad 28 + Tapir 2.0.0 (see docs/ARCHICAD.md).
 */

export interface Coordinate2D {
  x: number;
  y: number;
}
export interface Coordinate3D extends Coordinate2D {
  z: number;
}
export interface GuidRef {
  guid: string;
}
export interface ElementRef {
  elementId: GuidRef;
}
export interface Hole2D {
  polygonOutline: Coordinate2D[];
}
export interface ErrorItem {
  error: { code: number; message: string };
}
export type ElementIdOrError = ElementRef | ErrorItem;

export function isError(x: unknown): x is ErrorItem {
  return typeof x === 'object' && x !== null && 'error' in x;
}

/** One story as GetStories reports it. */
export interface TapirStory {
  index: number;
  floorId?: number;
  name: string;
  level: number;
  height?: number;
  dispOnSections?: boolean;
}
export interface GetStoriesResult {
  firstStory: number;
  lastStory: number;
  actStory: number;
  stories: TapirStory[];
}

export interface AttributeHeader {
  attributeId: GuidRef;
  index: number;
  name: string;
}

export interface TapirLibrary {
  name: string;
  type: string;
  available: boolean;
}

/** CreateZones item (manual geometry). */
export interface ZoneData {
  floorIndex: number;
  name: string;
  numberStr: string;
  id?: string;
  categoryAttributeId?: GuidRef;
  height?: number;
  bottomOffset?: number;
  allowOverlap?: boolean;
  geometry: { polygonCoordinates: Coordinate2D[]; holes?: Hole2D[] };
}

/** CreateSlabs item. `level` is the absolute Z of the slab's reference plane. */
export interface SlabData {
  floorIndex: number;
  level: number;
  thickness: number;
  structureType: 'Basic';
  referencePlaneLocation: 'Top';
  polygonCoordinates: Coordinate2D[];
  holes?: Hole2D[];
  layerIndex?: number;
  id?: string;
}

export interface MorphPolygon {
  vertexIds: number[];
  holes?: { vertexIds: number[] }[];
}
export interface MorphBody {
  bodyType: 'Solid';
  vertices: Coordinate3D[];
  polygons: MorphPolygon[];
}
/** CreateMorphs item; vertices are local to basePoint. */
export interface MorphData {
  basePoint: Coordinate3D;
  floorIndex: number;
  body: MorphBody;
  layerIndex?: number;
  id?: string;
}

export interface UserDataPair {
  key: string;
  value: string;
}

/** CreateWalls item. With floorIndex, zCoordinate is the bottom offset from that story. */
export interface WallData {
  begCoordinate: Coordinate2D;
  endCoordinate: Coordinate2D;
  floorIndex: number;
  zCoordinate: number;
  height: number;
  thickness: number;
  referenceLineLocation: 'Center';
  structureType: 'Basic';
  layerIndex?: number;
  id?: string;
}

/** CreateRoofs item: a single-plane roof (pivotLine + angle). The plane rises left of the pivot line. */
export interface RoofData {
  level: number;
  floorIndex: number;
  thickness: number;
  structureType: 'Basic';
  polygonCoordinates: Coordinate2D[];
  holes?: Hole2D[];
  pivotLine: { begCoordinate: Coordinate2D; endCoordinate: Coordinate2D };
  angle: number;
}

/**
 * CreateStairs item (Tapir 2.0.0): a U-shaped stair from a baseline with Flight / Landing /
 * Flight edges. Tapir 2.0.0 has no layerIndex here: the Stair tool default layer is switched.
 */
export interface StairData {
  baseLinePoints: Coordinate2D[];
  baselinePosition: 'Left' | 'Right' | 'Center';
  zCoordinate: number;
  floorIndex: number;
  totalHeight: number;
  flightWidth: number;
  stepNum: number;
  riserHeight: number;
  treadDepth: number;
  baseLineEdges: { segmentType: 'Flight' | 'Landing' }[];
  baseLineVertices: { turnType: 'None' | 'Landing' }[];
  id?: string;
}
