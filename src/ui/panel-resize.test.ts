import { describe, expect, it } from 'vitest';
import { clampWidth } from './panel-resize';

const limits = { min: 280, max: 520 };

describe('clampWidth', () => {
  it('keeps a width that fits', () => {
    expect(clampWidth(400, limits, 1600, 600)).toBe(400);
  });

  it('stops at the limits', () => {
    expect(clampWidth(100, limits, 1600, 600)).toBe(280);
    expect(clampWidth(900, limits, 1600, 600)).toBe(520);
  });

  it('gives way so what sits beside it keeps its room', () => {
    expect(clampWidth(500, limits, 1200, 800)).toBe(400);
  });

  it('never goes under the minimum, even in a tiny window', () => {
    expect(clampWidth(500, limits, 900, 800)).toBe(280);
  });

  it('rounds to whole pixels', () => {
    expect(clampWidth(333.6, limits, 1600, 600)).toBe(334);
  });
});
