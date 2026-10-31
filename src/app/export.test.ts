import { describe, expect, it } from 'vitest';
import type { Change, ElementRef } from '../engine/types';
import { elementsCsv, exportFileName, globalIdOf, listSeparator, propertiesCsv } from './export';
import { NO_FILTERS, tableRows } from './filters';

const ref = (globalId: string): ElementRef => ({ expressId: 1, globalId, ifcType: 'IfcWall', name: 'W', meshed: true });

function change(partial: Partial<Change> & Pick<Change, 'id' | 'kind'>): Change {
  return { geometry: false, data: false, container: false, ifcType: 'IfcWall', name: 'W', properties: [], ...partial };
}

const rated = change({
  id: 'r',
  kind: 'modified',
  data: true,
  storey: 'Level 1',
  head: ref('GUID1'),
  base: ref('GUID1'),
  properties: [{ group: 'Pset_WallCommon', name: 'FireRating', before: 'REI 60', after: 'REI 90', scope: 'data' }],
});
const added = change({ id: 'a', kind: 'added', geometry: true, data: true, head: ref('GUID2') });

/** Without the byte order mark and the final line break. */
const lines = (csv: string) => csv.slice(1).trimEnd().split('\r\n');

describe('elementsCsv', () => {
  it('writes one row per element, with its GlobalId', () => {
    expect(lines(elementsCsv([rated, added], ','))).toEqual([
      'Change,GlobalId,Old GlobalId,Name,Class,Storey,Geometry changed,Data changed,What changed',
      'Modified,GUID1,,W,IfcWall,Level 1,No,Yes,1 property',
      'Added,GUID2,,W,IfcWall,,Yes,Yes,Added',
    ]);
  });

  it('starts with a byte order mark, so Excel reads m² correctly', () => {
    expect(elementsCsv([], ',').charCodeAt(0)).toBe(0xfeff);
  });

  it('reports both GlobalIds when an element was paired by content', () => {
    const paired = change({ id: 'p', kind: 'modified', geometry: true, head: ref('NEW'), base: ref('OLD') });
    expect(globalIdOf(paired)).toBe('NEW');
    expect(lines(elementsCsv([paired], ','))[1].startsWith('Modified,NEW,OLD,')).toBe(true);
  });

  it('uses the only GlobalId of a deleted element', () => {
    expect(globalIdOf(change({ id: 'd', kind: 'deleted', base: ref('GONE') }))).toBe('GONE');
  });
});

describe('propertiesCsv', () => {
  it('writes one row per changed property, and one for a whole element', () => {
    expect(lines(propertiesCsv(tableRows([rated, added], NO_FILTERS), ',')).slice(1)).toEqual([
      'Modified,GUID1,,W,IfcWall,Level 1,Pset_WallCommon,FireRating,REI 60,REI 90',
      'Added,GUID2,,W,IfcWall,,,Whole element,,',
    ]);
  });

  it('repeats the element on each row, unlike the table on screen', () => {
    const two = change({
      id: 't',
      kind: 'modified',
      data: true,
      head: ref('G'),
      base: ref('G'),
      properties: [
        { group: 'P', name: 'A', before: '1', after: '2', scope: 'data' },
        { group: 'P', name: 'B', before: '3', after: '4', scope: 'data' },
      ],
    });
    const body = lines(propertiesCsv(tableRows([two], NO_FILTERS), ',')).slice(1);
    expect(body.every((line) => line.startsWith('Modified,G,,W,'))).toBe(true);
    expect(body).toHaveLength(2);
  });
});

describe('cell safety', () => {
  const named = (name: string) => lines(elementsCsv([change({ id: 'x', kind: 'added', name })], ','))[1].split(',Added')[0];

  it('quotes separators, quotes and line breaks', () => {
    expect(lines(elementsCsv([change({ id: 'x', kind: 'added', name: 'Wall, "big"' })], ','))[1]).toContain('"Wall, ""big"""');
    expect(lines(elementsCsv([change({ id: 'x', kind: 'added', name: 'a;b' })], ';'))[1]).toContain('"a;b"');
    expect(elementsCsv([change({ id: 'x', kind: 'added', name: 'two\nlines' })], ',')).toContain('"two\nlines"');
  });

  it('stops text from a file running as a formula', () => {
    for (const attack of ['=1+1', '+1+1', '-1+1', '@SUM(A1)']) {
      expect(lines(elementsCsv([change({ id: 'x', kind: 'added', name: attack })], ','))[1]).toContain(`'${attack}`);
    }
    expect(named('Plain')).not.toContain("'");
  });
});

describe('listSeparator', () => {
  it('follows the decimal mark, as Excel does', () => {
    expect(listSeparator('en-US')).toBe(',');
    expect(listSeparator('de-DE')).toBe(';');
    expect(listSeparator('ro-RO')).toBe(';');
    expect(listSeparator('nl-NL')).toBe(';');
  });
});

describe('exportFileName', () => {
  it('names both versions and strips unsafe characters', () => {
    expect(exportFileName('Tower A.ifc', 'tower/b:c.IFC', 'elements')).toBe('Tower-A_to_tower-b-c_elements.csv');
  });
});
