import { describe, expect, it } from 'vitest';
import type { EntityFingerprint } from '@ifc-lite/diff';
import { describeChangeGeometry } from './delta';
import { describeGeometry, formatLength, formatNumber, formatValue, geometryRows } from './format';

describe('formatting', () => {
  it('drops float noise from numbers', () => {
    expect(formatNumber(3.6000000000000001)).toBe('3.6');
    expect(formatNumber(0.30000000000000004)).toBe('0.3');
    expect(formatNumber(12)).toBe('12');
  });

  it('formats values of every kind', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('True');
    expect(formatValue(1.23456789)).toBe('1.2346');
    expect(formatValue(['a', 1])).toBe('a, 1');
  });

  it('shows a length in millimetres under a metre, metres above', () => {
    expect(formatLength(0.45)).toBe('450 mm');
    expect(formatLength(32.2161)).toBe('32.216 m');
  });
});

function fingerprint(min: number[], max: number[], volume?: number) {
  return { key: 'k', ifcType: 'IfcWall', dataHash: '', ref: 1, aabb: { min, max }, volume } as unknown as EntityFingerprint<number>;
}

describe('describeChangeGeometry', () => {
  // Boxes are Y-up: x stays X, y is IFC Z, and z is minus IFC Y.
  it('reports a move in IFC axes', () => {
    const delta = describeChangeGeometry(fingerprint([0, 0, -1], [2, 3, 0]), fingerprint([0.45, 0, -2], [2.45, 3, -1]));
    expect(delta.moved?.before).toEqual([1, 0.5, 1.5]);
    expect(delta.moved?.after[0]).toBeCloseTo(1.45);
    expect(delta.moved?.after.slice(1)).toEqual([1.5, 1.5]);
    expect(delta.moved?.distance).toBeCloseTo(Math.hypot(0.45, 1));
    expect(delta.resized).toBeUndefined();
  });

  it('reports a height change on IFC Z', () => {
    const delta = describeChangeGeometry(fingerprint([0, 0, 0], [1, 3, 1]), fingerprint([0, 0, 0], [1, 4, 1]));
    expect(delta.resized?.before).toEqual([1, 1, 3]);
    expect(delta.resized?.after).toEqual([1, 1, 4]);
  });

  it('treats sub-millimetre differences as noise', () => {
    const delta = describeChangeGeometry(fingerprint([0, 0, 0], [1, 1, 1], 1), fingerprint([0.0001, 0, 0], [1.0001, 1, 1], 1.0001));
    expect(delta).toEqual({});
  });

  it('reports a volume only one side could prove', () => {
    const delta = describeChangeGeometry(fingerprint([0, 0, 0], [1, 1, 1], 1), fingerprint([0, 0, 0], [1, 1, 1]));
    expect(delta.volume).toEqual({ before: 1, after: undefined });
  });
});

describe('geometryRows', () => {
  const delta = describeChangeGeometry(fingerprint([0, 0, -1], [2, 3, 0], 6), fingerprint([0.45, 0, -1], [2.45, 3, 0], 6));

  it('gives old and new values only for the axes that changed', () => {
    expect(geometryRows(delta)).toEqual([{ group: 'Geometry', name: 'Position X', before: '1 m', after: '1.45 m', scope: 'geometry' }]);
  });

  it('still says something when the shape changed inside the same extents', () => {
    expect(geometryRows({}).map((r) => r.after)).toEqual(['Changed, same extents']);
    expect(describeGeometry({})).toBe('Shape changed, same extents');
  });

  it('summarises a move in a line', () => {
    expect(describeGeometry(delta)).toBe('Moved 450 mm');
  });
});
