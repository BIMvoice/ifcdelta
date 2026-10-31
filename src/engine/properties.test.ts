import { describe, expect, it } from 'vitest';
import { diffRows, isGeometricName } from './properties';

const row = (group: string, name: string, value: string) => ({ group, name, value });

describe('diffRows', () => {
  it('reports a value that changed', () => {
    expect(diffRows([row('Pset', 'FireRating', 'REI 60')], [row('Pset', 'FireRating', 'REI 90')])).toEqual([
      { group: 'Pset', name: 'FireRating', before: 'REI 60', after: 'REI 90', scope: 'data' },
    ]);
  });

  it('ignores what did not change, in any order', () => {
    const a = [row('P', 'A', '1'), row('P', 'B', '2')];
    expect(diffRows(a, [...a].reverse())).toEqual([]);
  });

  it('reports a property appearing and one disappearing', () => {
    expect(diffRows([row('P', 'Old', '1')], [row('P', 'New', '2')])).toEqual([
      { group: 'P', name: 'New', before: null, after: '2', scope: 'data' },
      { group: 'P', name: 'Old', before: '1', after: null, scope: 'data' },
    ]);
  });

  it('keeps same-named properties in different sets apart', () => {
    expect(diffRows([row('A', 'X', '1'), row('B', 'X', '1')], [row('A', 'X', '1'), row('B', 'X', '2')])).toHaveLength(1);
  });

  it('files placement properties under geometry', () => {
    expect(diffRows([row('P', 'Elevation', '1')], [row('P', 'Elevation', '2')])[0].scope).toBe('geometry');
  });
});

describe('isGeometricName', () => {
  it('catches placement names without catching ordinary ones', () => {
    for (const name of ['Elevation', 'ObjectPlacement', 'Base Offset', 'Top Offset', 'Reference Level']) expect(isGeometricName(name)).toBe(true);
    for (const name of ['FireRating', 'Location', 'Position', 'Offset', 'IsExternal']) expect(isGeometricName(name)).toBe(false);
  });
});
