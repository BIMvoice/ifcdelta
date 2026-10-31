import type { Change, ChangeKind, PropertyChange } from '../engine/types';

export interface Filters {
  kind: 'all' | ChangeKind;
  scope: 'all' | 'geometry' | 'data';
  ifcType: string | null;
  query: string;
}

export const NO_FILTERS: Filters = { kind: 'all', scope: 'all', ifcType: null, query: '' };

const inScope = (change: Change, scope: Filters['scope']) =>
  scope === 'all' || (scope === 'geometry' ? change.geometry : change.data);

function propertyMatches(property: PropertyChange, needle: string) {
  return `${property.group} ${property.name} ${property.before ?? ''} ${property.after ?? ''}`.toLowerCase().includes(needle);
}

function elementMatches(change: Change, needle: string) {
  const ids = `${change.base?.globalId ?? ''} ${change.head?.globalId ?? ''}`;
  return `${change.name} ${change.ifcType} ${change.storey ?? ''} ${ids}`.toLowerCase().includes(needle);
}

export function matches(change: Change, filters: Filters): boolean {
  if (filters.kind !== 'all' && change.kind !== filters.kind) return false;
  if (!inScope(change, filters.scope)) return false;
  if (filters.ifcType && change.ifcType !== filters.ifcType) return false;
  const needle = filters.query.trim().toLowerCase();
  if (!needle) return true;
  return elementMatches(change, needle) || change.properties.some((p) => propertyMatches(p, needle));
}

export interface TableRow {
  change: Change;
  /** The first row of an element carries its name, class and storey. */
  first: boolean;
  /** Null for an added or deleted element, which is one row as a whole. */
  property: PropertyChange | null;
}

/** The data view: one row per changed property, grouped under its element. */
export function tableRows(changes: Change[], filters: Filters): TableRow[] {
  const rows: TableRow[] = [];
  const needle = filters.query.trim().toLowerCase();
  for (const change of changes) {
    if (!matches(change, filters)) continue;
    if (change.kind !== 'modified') {
      rows.push({ change, first: true, property: null });
      continue;
    }
    const byElement = needle !== '' && elementMatches(change, needle);
    const properties = change.properties.filter(
      (p) => (filters.scope === 'all' || p.scope === filters.scope) && (!needle || byElement || propertyMatches(p, needle)),
    );
    properties.forEach((property, index) => rows.push({ change, first: index === 0, property }));
  }
  return rows;
}

/** Counts for the filter buttons: each ignores its own dimension, so it shows what clicking it gives. */
export function kindCounts(changes: Change[], filters: Filters): Record<'all' | ChangeKind, number> {
  const others = { ...filters, kind: 'all' as const };
  const counts = { all: 0, added: 0, modified: 0, deleted: 0 };
  for (const change of changes) {
    if (!matches(change, others)) continue;
    counts.all++;
    counts[change.kind]++;
  }
  return counts;
}

export interface ClassCount {
  ifcType: string;
  added: number;
  modified: number;
  deleted: number;
}

export function classCounts(changes: Change[]): ClassCount[] {
  const byType = new Map<string, ClassCount>();
  for (const change of changes) {
    let row = byType.get(change.ifcType);
    if (!row) {
      row = { ifcType: change.ifcType, added: 0, modified: 0, deleted: 0 };
      byType.set(change.ifcType, row);
    }
    row[change.kind]++;
  }
  return [...byType.values()].sort((a, b) => a.ifcType.localeCompare(b.ifcType));
}
