import type { Change } from '../engine/types';

export type Rgba = [number, number, number, number];

/**
 * The renderer's colour overrides only paint opaque draws, and its transparent draws use the mesh's
 * own colour. So every mesh is loaded already tinted (see tintMeshes), the renderer's ghost mode fades
 * what is unchanged, and changed elements are solid overrides on top. Same colours as the interface.
 */
export const COLOURS = {
  added: [0.384, 0.941, 0.878, 1] as Rgba,
  /** Shape or position changed. */
  modified: [1, 0.753, 0.302, 1] as Rgba,
  /** Only information changed, so it reads paler than a shape change. */
  dataOnly: [1, 0.906, 0.69, 1] as Rgba,
  deleted: [1, 0.361, 0.576, 1] as Rgba,
  ghost: [0.56, 0.71, 0.91, 1] as Rgba,
  /** The old copy of a moved element: amber, drawn see-through by its own colour. */
  oldPosition: [1, 0.753, 0.302, 1] as Rgba,
};

/** See-through level of an old copy while the new one is drawn solid. */
const OLD_POSITION_ALPHA = 0.3;

/** Overlay shows both versions at once. Old and New show one version, in the same colours. */
export type VersionView = 'overlay' | 'old' | 'new';

export interface Overlay {
  colours: Map<number, Rgba>;
  hidden: Set<number>;
  /** Stay solid while everything else fades to the X-ray ghost. */
  solid: Set<number>;
  /** Explicit see-through levels, which win over the ghost. */
  alpha: Map<number, number>;
}

export interface OverlayInput {
  changes: Change[];
  shown: ReadonlySet<string>;
  view: VersionView;
  /** Base-only meshes live in the head scene under `expressId + baseOffset`. */
  baseOffset: number;
}

/**
 * Colour and visibility for the head scene. It holds the whole new version, plus the old copies of
 * deleted and reshaped elements, which is enough to show either version without loading both whole.
 */
export function buildHeadOverlay({ changes, shown, view, baseOffset }: OverlayInput): Overlay {
  const overlay: Overlay = { colours: new Map(), hidden: new Set(), solid: new Set(), alpha: new Map() };
  const { colours, hidden, solid, alpha } = overlay;
  const paint = (id: number, colour: Rgba) => {
    colours.set(id, colour);
    solid.add(id);
  };

  for (const change of changes) {
    const head = change.head?.meshed ? change.head.expressId : undefined;
    const old = change.base?.meshed ? change.base.expressId + baseOffset : undefined;

    if (!shown.has(change.id)) {
      // Filtered out: it fades into the ghost, as if unchanged.
      if (old !== undefined) hidden.add(old);
      if (head !== undefined && change.kind === 'added' && view === 'old') hidden.add(head);
      continue;
    }
    if (change.kind === 'added') {
      if (head === undefined) continue;
      if (view === 'old') hidden.add(head);
      else paint(head, COLOURS.added);
    } else if (change.kind === 'deleted') {
      if (old === undefined) continue;
      if (view === 'new') hidden.add(old);
      else paint(old, COLOURS.deleted);
    } else if (change.geometry) {
      if (head !== undefined) {
        if (view === 'old') hidden.add(head);
        else paint(head, COLOURS.modified);
      }
      if (old !== undefined) {
        if (view === 'new') hidden.add(old);
        else if (view === 'old') paint(old, COLOURS.modified);
        else alpha.set(old, OLD_POSITION_ALPHA);
      }
    } else if (head !== undefined) {
      paint(head, COLOURS.dataOnly);
    }
  }
  return overlay;
}

/** The old side of the wipe view: the whole old version, under its own express ids. */
export function buildBaseOverlay(changes: Change[], shown: ReadonlySet<string>): Overlay {
  const overlay: Overlay = { colours: new Map(), hidden: new Set(), solid: new Set(), alpha: new Map() };
  for (const change of changes) {
    const id = change.base?.meshed ? change.base.expressId : undefined;
    if (id === undefined) continue;
    if (!shown.has(change.id)) {
      if (change.kind === 'deleted') overlay.hidden.add(id);
      continue;
    }
    overlay.colours.set(id, change.kind === 'deleted' ? COLOURS.deleted : change.geometry ? COLOURS.modified : COLOURS.dataOnly);
    overlay.solid.add(id);
  }
  return overlay;
}

/** Load everything in one colour, so the X-ray reads as one material whatever the authoring tool chose. */
export function tintMeshes<T extends { color: Rgba | number[] }>(meshes: T[], colour: Rgba = COLOURS.ghost): T[] {
  for (const mesh of meshes) mesh.color = colour;
  return meshes;
}
