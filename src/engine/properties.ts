import { QuantityType, RelationshipType } from '@ifc-lite/data';
import {
  extractAllEntityAttributes,
  extractAllMaterialsOnDemand,
  extractClassificationsOnDemand,
  extractPropertiesOnDemand,
  extractQuantitiesOnDemand,
  extractTypeEntityOwnProperties,
  extractTypeEntityOwnQuantities,
  getInheritanceChainAcrossSchemas,
  quantitySiScale,
  roundToScale,
  scaledPropertyValue,
  type IfcDataStore,
  type ProjectUnits,
} from '@ifc-lite/parser';
import type { DataFingerprintInput } from '@ifc-lite/diff';
import { formatValue } from './format';
import type { PropertyChange } from './types';

/**
 * Names that describe where something sits, not what it is. A pure move must read as a geometry
 * change only, so these stay out of the data hash. Same rule as the IFClite viewer: narrow on
 * purpose, because a custom "Location" property is ordinary data.
 */
const GEOMETRIC_NAME = /elevation|placement|coordinate|reference\s*level|(height|base|top|bottom|level|z)\s*offset/i;
export const isGeometricName = (name: string) => GEOMETRIC_NAME.test(name);

/** Attributes that are references into the file, so they differ on every save. */
const SKIPPED_ATTRIBUTES = new Set(['GlobalId', 'OwnerHistory', 'ObjectPlacement', 'Representation']);

const QUANTITY_UNITS: Partial<Record<QuantityType, string>> = {
  [QuantityType.Length]: 'm',
  [QuantityType.Area]: 'm²',
  [QuantityType.Volume]: 'm³',
  [QuantityType.Weight]: 'kg',
  [QuantityType.Time]: 's',
};

const typeObjectCache = new Map<string, boolean>();
export function isTypeObject(ifcType: string): boolean {
  const key = ifcType.toUpperCase();
  let cached = typeObjectCache.get(key);
  if (cached === undefined) {
    cached = getInheritanceChainAcrossSchemas(key).includes('IfcTypeObject');
    typeObjectCache.set(key, cached);
  }
  return cached;
}

function readProperties(store: IfcDataStore, id: number, ifcType: string) {
  return isTypeObject(ifcType) ? extractTypeEntityOwnProperties(store, id) : extractPropertiesOnDemand(store, id);
}

function readQuantities(store: IfcDataStore, id: number, ifcType: string) {
  return isTypeObject(ifcType) ? extractTypeEntityOwnQuantities(store, id) : extractQuantitiesOnDemand(store, id);
}

/** Names only, down to the leaf IfcMaterial: entity references change on every save. */
export function materialNames(store: IfcDataStore, id: number): string[] {
  const names: string[] = [];
  for (const material of extractAllMaterialsOnDemand(store, id)) {
    const leaves = [
      ...(material.layers ?? []).map((l) => l.materialName ?? l.name),
      ...(material.profiles ?? []).map((p) => p.materialName ?? p.name),
      ...(material.constituents ?? []).map((c) => c.materialName ?? c.name),
      ...(material.materials ?? []).map((m) => m.name),
    ].filter((n): n is string => !!n);
    if (leaves.length) names.push(...leaves);
    else if (material.name) names.push(material.name);
  }
  return names;
}

function classificationLabels(store: IfcDataStore, id: number): string[] {
  return extractClassificationsOnDemand(store, id)
    .map((c) => {
      const system = c.system?.trim() ?? '';
      const code = (c.identification || c.name || '').trim();
      return system || code ? `${system}:${code}` : '';
    })
    .filter(Boolean);
}

function typeAssignments(store: IfcDataStore, id: number) {
  return store.relationships.getRelated(id, RelationshipType.DefinesByType, 'inverse').map((typeId) => ({
    globalId: store.entities.getGlobalId(typeId) || undefined,
    name: store.entities.getName(typeId) || undefined,
    type: store.entities.getTypeName(typeId) || undefined,
  }));
}

/** What the data fingerprint hashes for one element. Mirrors the IFClite viewer's adapter. */
export function dataInput(store: IfcDataStore, id: number, ifcType: string, units: ProjectUnits): DataFingerprintInput {
  const attributes = extractAllEntityAttributes(store, id);
  const predefinedType = attributes.find((a) => a.name === 'PredefinedType')?.value;
  const tag = isTypeObject(ifcType) ? attributes.find((a) => a.name === 'Tag')?.value : undefined;
  return {
    ifcType,
    name: store.entities.getName(id) || undefined,
    description: store.entities.getDescription(id) || undefined,
    objectType: store.entities.getObjectType(id) || undefined,
    predefinedType: predefinedType ? String(predefinedType) : undefined,
    tag: tag ? String(tag) : undefined,
    propertySets: readProperties(store, id, ifcType)
      .filter((set) => !isGeometricName(set.name))
      .map((set) => ({
        name: set.name,
        properties: set.properties
          .filter((p) => !isGeometricName(p.name))
          .map((p) => ({ name: p.name, value: scaledPropertyValue(p.value, p.dataType, units) })),
      }))
      .filter((set) => set.properties.length > 0),
    quantitySets: readQuantities(store, id, ifcType)
      .filter((set) => !isGeometricName(set.name))
      .map((set) => ({
        name: set.name,
        quantities: set.quantities
          .filter((q) => !isGeometricName(q.name))
          .map((q) => ({ name: q.name, value: roundToScale(q.value * quantitySiScale(q, units)) })),
      }))
      .filter((set) => set.quantities.length > 0),
    typeAssignments: typeAssignments(store, id),
    materials: materialNames(store, id),
    classifications: classificationLabels(store, id),
  };
}

/** Everything readable about an element, flattened to `group / name → value`. */
export interface FlatRow {
  group: string;
  name: string;
  value: string;
}

export function flattenElement(store: IfcDataStore, id: number, ifcType: string, units: ProjectUnits): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const attribute of extractAllEntityAttributes(store, id)) {
    if (SKIPPED_ATTRIBUTES.has(attribute.name)) continue;
    if (attribute.value === null || attribute.value === undefined || attribute.value === '') continue;
    rows.push({ group: 'Attributes', name: attribute.name, value: formatValue(attribute.value) });
  }
  for (const set of readProperties(store, id, ifcType)) {
    for (const property of set.properties) {
      rows.push({ group: set.name, name: property.name, value: formatValue(scaledPropertyValue(property.value, property.dataType, units)) });
    }
  }
  for (const set of readQuantities(store, id, ifcType)) {
    for (const quantity of set.quantities) {
      const unit = QUANTITY_UNITS[quantity.type as QuantityType];
      const value = formatValue(roundToScale(quantity.value * quantitySiScale(quantity, units)));
      rows.push({ group: set.name, name: quantity.name, value: unit ? `${value} ${unit}` : value });
    }
  }
  const types = typeAssignments(store, id).map((t) => `${t.name ?? 'Unnamed'} (${t.type ?? 'type'})`).sort();
  if (types.length) rows.push({ group: 'Type', name: 'Assigned type', value: types.join(', ') });
  const materials = materialNames(store, id).sort();
  if (materials.length) rows.push({ group: 'Material', name: 'Materials', value: materials.join(', ') });
  const classifications = classificationLabels(store, id).sort();
  if (classifications.length) rows.push({ group: 'Classification', name: 'References', value: classifications.join(', ') });
  return rows;
}

const rowKey = (row: { group: string; name: string }) => `${row.group}\u0000${row.name}`;

/** Only what differs. A row missing on one side reads as a value appearing or disappearing. */
export function diffRows(before: FlatRow[], after: FlatRow[]): PropertyChange[] {
  const old = new Map(before.map((row) => [rowKey(row), row]));
  const changes: PropertyChange[] = [];
  const seen = new Set<string>();
  for (const row of after) {
    const key = rowKey(row);
    seen.add(key);
    const previous = old.get(key);
    if (previous?.value === row.value) continue;
    changes.push(toChange(row, previous?.value ?? null, row.value));
  }
  for (const row of before) {
    if (!seen.has(rowKey(row))) changes.push(toChange(row, row.value, null));
  }
  return changes;
}

function toChange(row: FlatRow, before: string | null, after: string | null): PropertyChange {
  const geometric = isGeometricName(row.group) || isGeometricName(row.name);
  return { group: row.group, name: row.name, before, after, scope: geometric ? 'geometry' : 'data' };
}
