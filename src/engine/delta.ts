import type { EntityAabb, EntityFingerprint } from '@ifc-lite/diff';
import type { Axes, GeometryDelta } from './types';

/** Below these a difference is float noise from re-tessellation: 1 mm and 1 litre. */
const LENGTH_TOLERANCE = 0.001;
const VOLUME_TOLERANCE = 0.001;

/** Boxes arrive in the renderer's Y-up frame: IFC X = x, IFC Y = -z, IFC Z = y. */
const toIfcPoint = (x: number, y: number, z: number): Axes => [x, z === 0 ? 0 : -z, y];
const toIfcSize = (x: number, y: number, z: number): Axes => [x, z, y];

function centre({ min, max }: EntityAabb): Axes {
  return toIfcPoint((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
}

function size({ min, max }: EntityAabb): Axes {
  return toIfcSize(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

const differs = (a: Axes, b: Axes) => a.some((value, i) => Math.abs(value - b[i]) >= LENGTH_TOLERANCE);

/** What a hash cannot say: where the element went, and how its size changed. */
export function describeChangeGeometry(base: EntityFingerprint<number>, head: EntityFingerprint<number>): GeometryDelta {
  const delta: GeometryDelta = {};
  if (base.aabb && head.aabb) {
    const [before, after] = [centre(base.aabb), centre(head.aabb)];
    if (differs(before, after)) {
      delta.moved = { before, after, distance: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) };
    }
    const [oldSize, newSize] = [size(base.aabb), size(head.aabb)];
    if (differs(oldSize, newSize)) delta.resized = { before: oldSize, after: newSize };
  }
  const sameVolume = base.volume !== undefined && head.volume !== undefined && Math.abs(base.volume - head.volume) < VOLUME_TOLERANCE;
  if ((base.volume !== undefined || head.volume !== undefined) && !sameVolume) delta.volume = { before: base.volume, after: head.volume };
  return delta;
}
