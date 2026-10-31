import { describe, expect, it } from 'vitest';
import type { Change, PropertyChange } from '../engine/types';
import { classCounts, kindCounts, matches, NO_FILTERS, tableRows } from './filters';

const geo: PropertyChange = { group: 'Geometry', name: 'Position X', before: '1 m', after: '2 m', scope: 'geometry' };
const fire: PropertyChange = { group: 'Pset_WallCommon', name: 'FireRating', before: 'REI 60', after: 'REI 90', scope: 'data' };

function change(partial: Partial<Change> & Pick<Change, 'id' | 'kind'>): Change {
  return { geometry: false, data: false, container: false, ifcType: 'IfcWall', name: partial.id, properties: [], ...partial };
}

const moved = change({ id: 'moved', kind: 'modified', geometry: true, properties: [geo] });
const rated = change({ id: 'rated', kind: 'modified', data: true, properties: [fire] });
const both = change({ id: 'both', kind: 'modified', geometry: true, data: true, properties: [geo, fire] });
const added = change({ id: 'added', kind: 'added', geometry: true, data: true, ifcType: 'IfcDoor' });
const deleted = change({ id: 'deleted', kind: 'deleted', geometry: true, data: true });
const all = [moved, rated, both, added, deleted];

describe('matches', () => {
  it('lets everything through with no filters', () => {
    expect(all.filter((c) => matches(c, NO_FILTERS))).toHaveLength(5);
  });

  it('counts an element that changed in both ways under each scope', () => {
    expect(matches(both, { ...NO_FILTERS, scope: 'geometry' })).toBe(true);
    expect(matches(both, { ...NO_FILTERS, scope: 'data' })).toBe(true);
    expect(matches(moved, { ...NO_FILTERS, scope: 'data' })).toBe(false);
    expect(matches(rated, { ...NO_FILTERS, scope: 'geometry' })).toBe(false);
  });

  it('searches names, classes, GlobalIds and property names and values, ignoring case', () => {
    const withGuid = change({ id: 'g', kind: 'added', head: { expressId: 1, globalId: 'ABC123', ifcType: 'IfcWall', name: '', meshed: true } });
    expect(matches(withGuid, { ...NO_FILTERS, query: 'abc123' })).toBe(true);
    expect(matches(rated, { ...NO_FILTERS, query: 'firerating' })).toBe(true);
    expect(matches(rated, { ...NO_FILTERS, query: 'rei 90' })).toBe(true);
    expect(matches(rated, { ...NO_FILTERS, query: 'ifcwall' })).toBe(true);
    expect(matches(rated, { ...NO_FILTERS, query: 'nope' })).toBe(false);
  });
});

describe('tableRows', () => {
  it('gives one row per changed property, with the element named on the first', () => {
    const rows = tableRows([both], NO_FILTERS);
    expect(rows.map((r) => [r.first, r.property?.name])).toEqual([[true, 'Position X'], [false, 'FireRating']]);
  });

  it('gives an added or deleted element one whole row', () => {
    expect(tableRows([added], NO_FILTERS)).toEqual([{ change: added, first: true, property: null }]);
  });

  it('narrows rows to the scope, and marks the first remaining row', () => {
    const rows = tableRows([both], { ...NO_FILTERS, scope: 'data' });
    expect(rows).toHaveLength(1);
    expect(rows[0].property).toBe(fire);
    expect(rows[0].first).toBe(true);
  });

  it('shows only the matching properties when the search hit a property', () => {
    expect(tableRows([both], { ...NO_FILTERS, query: 'firerating' }).map((r) => r.property?.name)).toEqual(['FireRating']);
  });

  it('shows all properties when the search hit the element itself', () => {
    expect(tableRows([both], { ...NO_FILTERS, query: 'both' })).toHaveLength(2);
  });
});

describe('counts', () => {
  it('kind counts ignore the kind filter but honour the others', () => {
    expect(kindCounts(all, { ...NO_FILTERS, kind: 'added' })).toEqual({ all: 5, added: 1, modified: 3, deleted: 1 });
    expect(kindCounts(all, { ...NO_FILTERS, ifcType: 'IfcDoor' })).toEqual({ all: 1, added: 1, modified: 0, deleted: 0 });
  });

  it('class counts split by kind and sort by name', () => {
    expect(classCounts(all)).toEqual([
      { ifcType: 'IfcDoor', added: 1, modified: 0, deleted: 0 },
      { ifcType: 'IfcWall', added: 0, modified: 3, deleted: 1 },
    ]);
  });
});
