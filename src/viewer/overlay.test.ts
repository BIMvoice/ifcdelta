import { describe, expect, it } from 'vitest';
import type { Change, ElementRef } from '../engine/types';
import { buildBaseOverlay, buildHeadOverlay, COLOURS, type VersionView } from './overlay';

const OFFSET = 1000;
const ref = (expressId: number, meshed = true): ElementRef => ({ expressId, globalId: `g${expressId}`, ifcType: 'IfcWall', name: '', meshed });

function change(partial: Partial<Change> & Pick<Change, 'id' | 'kind'>): Change {
  return { geometry: false, data: false, container: false, ifcType: 'IfcWall', name: '', properties: [], ...partial };
}

const added = change({ id: 'a', kind: 'added', geometry: true, data: true, head: ref(1) });
const deleted = change({ id: 'd', kind: 'deleted', geometry: true, data: true, base: ref(2) });
const moved = change({ id: 'm', kind: 'modified', geometry: true, head: ref(3), base: ref(3) });
const rated = change({ id: 'r', kind: 'modified', data: true, head: ref(4), base: ref(4) });
const changes = [added, deleted, moved, rated];
const shown = new Set(changes.map((c) => c.id));

const build = (view: VersionView, visible: ReadonlySet<string> = shown) => buildHeadOverlay({ changes, shown: visible, view, baseOffset: OFFSET });

describe('buildHeadOverlay', () => {
  it('overlay shows both versions: new copies solid, the old copy of a move see-through', () => {
    const { colours, hidden, solid, alpha } = build('overlay');
    expect(hidden.size).toBe(0);
    expect(colours.get(1)).toEqual(COLOURS.added);
    expect(colours.get(2 + OFFSET)).toEqual(COLOURS.deleted);
    expect(colours.get(3)).toEqual(COLOURS.modified);
    expect(colours.get(4)).toEqual(COLOURS.dataOnly);
    expect(solid.has(3 + OFFSET)).toBe(false);
    expect(alpha.get(3 + OFFSET)).toBeGreaterThan(0);
    expect(alpha.get(3 + OFFSET)).toBeLessThan(1);
  });

  it('old hides what only the new version has, and draws old copies solid', () => {
    const { hidden, solid } = build('old');
    expect(hidden.has(1)).toBe(true);
    expect(hidden.has(3)).toBe(true);
    expect(solid.has(3 + OFFSET)).toBe(true);
    expect(solid.has(2 + OFFSET)).toBe(true);
    expect(hidden.has(4)).toBe(false);
  });

  it('new hides what only the old version has', () => {
    const { hidden, solid } = build('new');
    expect(hidden.has(2 + OFFSET)).toBe(true);
    expect(hidden.has(3 + OFFSET)).toBe(true);
    expect(solid.has(1)).toBe(true);
    expect(solid.has(3)).toBe(true);
  });

  it('a filtered-out change fades into the ghost, and its old copy goes away', () => {
    const { colours, hidden, solid } = build('overlay', new Set(['a']));
    expect(colours.has(3)).toBe(false);
    expect(solid.has(3)).toBe(false);
    expect(hidden.has(3 + OFFSET)).toBe(true);
    expect(hidden.has(2 + OFFSET)).toBe(true);
  });

  it('a filtered-out addition still stays out of the old version', () => {
    expect(build('old', new Set()).hidden.has(1)).toBe(true);
  });

  it('skips elements with no geometry', () => {
    const typeOnly = change({ id: 't', kind: 'modified', data: true, head: ref(9, false), base: ref(9, false) });
    const { colours } = buildHeadOverlay({ changes: [typeOnly], shown: new Set(['t']), view: 'overlay', baseOffset: OFFSET });
    expect(colours.size).toBe(0);
  });
});

describe('buildBaseOverlay', () => {
  it('paints the old version under its own ids', () => {
    const { colours, solid } = buildBaseOverlay(changes, shown);
    expect(colours.get(2)).toEqual(COLOURS.deleted);
    expect(colours.get(3)).toEqual(COLOURS.modified);
    expect(colours.get(4)).toEqual(COLOURS.dataOnly);
    expect(colours.has(1)).toBe(false);
    expect(solid.has(3)).toBe(true);
  });

  it('hides a filtered-out deletion, which would otherwise read as unchanged', () => {
    const { hidden, colours } = buildBaseOverlay(changes, new Set());
    expect(hidden.has(2)).toBe(true);
    expect(hidden.has(3)).toBe(false);
    expect(colours.size).toBe(0);
  });
});
