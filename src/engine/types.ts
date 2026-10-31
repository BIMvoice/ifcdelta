export type ChangeKind = 'added' | 'modified' | 'deleted';

/** One side of a change: where the element lives in that version's file. */
export interface ElementRef {
  expressId: number;
  globalId: string;
  ifcType: string;
  name: string;
  storey?: string;
  meshed: boolean;
}

export type Axes = [x: number, y: number, z: number];

export interface GeometryDelta {
  /** Bounding box centre in metres, IFC axes. Only set if it moved. */
  moved?: { before: Axes; after: Axes; distance: number };
  /** Bounding box size in metres, IFC axes. Only set if it changed. */
  resized?: { before: Axes; after: Axes };
  /** Enclosed volume in m³, when the geometry kernel could prove one. */
  volume?: { before?: number; after?: number };
}

export interface PropertyChange {
  group: string;
  name: string;
  before: string | null;
  after: string | null;
  /** Geometry rows describe shape and position; data rows describe information. */
  scope: 'geometry' | 'data';
}

export interface Change {
  /** Stable row id, also the diff key. */
  id: string;
  kind: ChangeKind;
  geometry: boolean;
  data: boolean;
  /** The element moved to another storey or space. */
  container: boolean;
  base?: ElementRef;
  head?: ElementRef;
  ifcType: string;
  name: string;
  storey?: string;
  /** Set when GlobalIds differ and the element was paired by content instead. */
  matchedBy?: 'moved' | 'reshaped' | 'respecified';
  geometryDelta?: GeometryDelta;
  /** Filled by the property pass; added and deleted elements stay empty until inspected. */
  properties: PropertyChange[];
}

export interface ComparisonSummary {
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
  /** Identical elements whose GlobalId changed, for example after a re-export. */
  reidentified: number;
  /** Content the engine could not pair confidently, reported as added plus deleted. */
  ambiguousGroups: number;
  /** One version has geometry hashes and the other does not, so geometry could not be compared. */
  geometryCompared: boolean;
}
