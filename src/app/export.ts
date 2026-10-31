import { changeSummary, KIND_LABEL } from '../engine/format';
import type { Change } from '../engine/types';
import type { TableRow } from './filters';

/** Excel splits a CSV on the system's list separator, which is `;` wherever the decimal mark is a comma. */
export function listSeparator(locale?: string): ',' | ';' {
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value;
  return decimal === ',' ? ';' : ',';
}

/**
 * Text from a file must never run as a formula when the sheet is opened, so anything Excel would
 * treat as one is forced to text. That includes a plain negative value like `-3.312 m`.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string, separator: string): string {
  const safe = neutralise(value);
  return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows: string[][], separator: string): string {
  // The byte order mark makes Excel read units like m² and non-English names correctly.
  return `﻿${rows.map((row) => row.map((value) => cell(value, separator)).join(separator)).join('\r\n')}\r\n`;
}

/** The new GlobalId, or the only one if the element exists on one side. */
export const globalIdOf = (change: Change) => change.head?.globalId || change.base?.globalId || '';

/** Only when an element was paired by content does its old GlobalId differ. */
const oldGlobalIdOf = (change: Change) => (change.base && change.head && change.base.globalId !== change.head.globalId ? change.base.globalId : '');

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** One row per element. */
export function elementsCsv(changes: Change[], separator: string = listSeparator()): string {
  const header = ['Change', 'GlobalId', 'Old GlobalId', 'Name', 'Class', 'Storey', 'Geometry changed', 'Data changed', 'What changed'];
  const rows = changes.map((change) => [
    KIND_LABEL[change.kind],
    globalIdOf(change),
    oldGlobalIdOf(change),
    change.name,
    change.ifcType,
    change.storey ?? '',
    yesNo(change.geometry),
    yesNo(change.data),
    changeSummary(change),
  ]);
  return toCsv([header, ...rows], separator);
}

/** One row per changed property, with the element repeated on each so the sheet can be filtered. */
export function propertiesCsv(tableRows: TableRow[], separator: string = listSeparator()): string {
  const header = ['Change', 'GlobalId', 'Old GlobalId', 'Name', 'Class', 'Storey', 'Group', 'Property', 'Old value', 'New value'];
  const rows = tableRows.map(({ change, property }) => [
    KIND_LABEL[change.kind],
    globalIdOf(change),
    oldGlobalIdOf(change),
    change.name,
    change.ifcType,
    change.storey ?? '',
    property?.group ?? '',
    property?.name ?? 'Whole element',
    property?.before ?? '',
    property?.after ?? '',
  ]);
  return toCsv([header, ...rows], separator);
}

/** `old_to_new_elements.csv`, without characters a file system might refuse. */
export function exportFileName(oldName: string, newName: string, what: string): string {
  const clean = (name: string) => name.replace(/\.ifc$/i, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60);
  return `${clean(oldName)}_to_${clean(newName)}_${what}.csv`;
}
