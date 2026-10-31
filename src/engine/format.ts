import type { Axes, Change, ChangeKind, GeometryDelta, PropertyChange } from './types';

/** Round for display and drop float noise: 3.6000000000000001 reads as 3.6. */
export function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(digits)));
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A length in metres, in whichever of mm or m reads best. */
export function formatLength(metres: number): string {
  const abs = Math.abs(metres);
  if (abs < 1) return `${formatNumber(metres * 1000, 1)} mm`;
  return `${formatNumber(metres, 3)} m`;
}

const AXIS = ['X', 'Y', 'Z'] as const;
const NOISE = 0.001;

const metres = (value: number) => `${formatNumber(value, 3)} m`;

/** One-line, plain description of a geometry change, for lists. */
export function describeGeometry(delta: GeometryDelta | undefined): string {
  if (!delta) return 'Shape changed';
  const bits: string[] = [];
  if (delta.moved) bits.push(`Moved ${formatLength(delta.moved.distance)}`);
  if (delta.resized) bits.push('Resized');
  return bits.length ? bits.join(', ') : 'Shape changed, same extents';
}

/** The geometry delta as table rows, so geometry and data read the same way. */
export function geometryRows(delta: GeometryDelta | undefined): PropertyChange[] {
  const rows: PropertyChange[] = [];
  const add = (name: string, before: string | null, after: string | null) =>
    rows.push({ group: 'Geometry', name, before, after, scope: 'geometry' });
  const axes = (label: string, values: { before: Axes; after: Axes } | undefined) => {
    if (!values) return;
    AXIS.forEach((axis, i) => {
      if (Math.abs(values.before[i] - values.after[i]) >= NOISE) add(`${label} ${axis}`, metres(values.before[i]), metres(values.after[i]));
    });
  };
  axes('Position', delta?.moved);
  axes('Size', delta?.resized);
  const volume = delta?.volume;
  if (volume && (volume.before !== undefined || volume.after !== undefined) && volume.before !== volume.after) {
    add(
      'Volume',
      volume.before === undefined ? null : `${formatNumber(volume.before, 3)} m³`,
      volume.after === undefined ? null : `${formatNumber(volume.after, 3)} m³`,
    );
  }
  if (rows.length === 0) add('Shape', null, 'Changed, same extents');
  return rows;
}

export const KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What happened to an element, in a few words. */
export function changeSummary(change: Change): string {
  if (change.kind !== 'modified') return KIND_LABEL[change.kind];
  const parts: string[] = [];
  if (change.geometry) parts.push(describeGeometry(change.geometryDelta));
  const dataRows = change.properties.filter((p) => p.scope === 'data').length;
  if (change.data) parts.push(dataRows ? plural(dataRows, 'property', 'properties') : 'Data changed');
  return parts.join(' · ');
}
