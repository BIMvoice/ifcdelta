import { buildComponentFingerprints, buildDataFingerprint, diffModels, initDiff, type ContentMatch, type DiffEntry, type EntityFingerprint } from '@ifc-lite/diff';
import { extractProjectUnits, getInheritanceChainAcrossSchemas, spatialContainerPath, type IfcDataStore } from '@ifc-lite/parser';
import { describeChangeGeometry } from './delta';
import { geometryRows } from './format';
import type { LoadedModel } from './load';
import { dataInput, diffRows, flattenElement, isTypeObject } from './properties';
import type { Change, ChangeKind, ComparisonSummary, ElementRef } from './types';

type Fingerprint = EntityFingerprint<number>;

/** An opening is the void between a wall and a door, so its own add or delete is noise. */
const EXCLUDED_TYPES = ['IfcOpeningElement'];

const productCache = new Map<string, boolean>();
function isProduct(ifcType: string): boolean {
  const key = ifcType.toUpperCase();
  let cached = productCache.get(key);
  if (cached === undefined) {
    cached = getInheritanceChainAcrossSchemas(key).includes('IfcProduct');
    productCache.set(key, cached);
  }
  return cached;
}

/** Everything with a mesh, plus products and type objects that carry a GlobalId. */
function* comparableIds(model: LoadedModel): Generator<number> {
  const { store, hashes } = model;
  const seen = new Set<number>();
  for (const id of hashes.keys()) {
    seen.add(id);
    yield id;
  }
  for (const [typeKey, ids] of store.entityIndex.byType) {
    if (!isProduct(typeKey) && !isTypeObject(typeKey)) continue;
    for (const id of ids) {
      if (!seen.has(id) && store.entities.getGlobalId(id)) {
        seen.add(id);
        yield id;
      }
    }
  }
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function fingerprintModel(model: LoadedModel, onProgress?: (fraction: number) => void): Promise<Fingerprint[]> {
  await initDiff();
  const { store } = model;
  const units = extractProjectUnits(store.source, store.entityIndex);
  const ids = [...comparableIds(model)];
  const out: Fingerprint[] = [];
  let lastBreath = performance.now();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const globalId = store.entities.getGlobalId(id);
    const ifcType = store.entities.getTypeName(id);
    const input = dataInput(store, id, ifcType, units);
    const fingerprint: Fingerprint = {
      // A mesh without a GlobalId cannot be tracked across versions, so it reads as added and deleted.
      key: globalId || `no-guid:${model.fileName}:${id}`,
      ifcType,
      dataHash: buildDataFingerprint(input),
      components: buildComponentFingerprints(input),
      geometryHash: model.hashes.get(id),
      ref: id,
    };
    const box = model.worldBoxes.get(id);
    if (box) fingerprint.aabb = box;
    const volume = model.volumes.get(id);
    if (volume !== undefined) fingerprint.volume = volume;
    const container = spatialContainerPath(store, id);
    if (container !== undefined) fingerprint.container = container;
    out.push(fingerprint);
    if (performance.now() - lastBreath > 40) {
      onProgress?.(i / ids.length);
      await breathe();
      lastBreath = performance.now();
    }
  }
  onProgress?.(1);
  return out;
}

function elementRef(model: LoadedModel, fingerprint: Fingerprint): ElementRef {
  const { store } = model;
  const id = fingerprint.ref;
  const path = fingerprint.container?.split('/');
  return {
    expressId: id,
    globalId: store.entities.getGlobalId(id) || '',
    ifcType: fingerprint.ifcType,
    name: store.entities.getName(id) || '',
    storey: path?.[path.length - 1],
    meshed: model.hashes.has(id),
  };
}

function toChange(
  id: string,
  kind: ChangeKind,
  baseModel: LoadedModel,
  headModel: LoadedModel,
  base: Fingerprint | undefined,
  head: Fingerprint | undefined,
  flags: { geometry: boolean; data: boolean; container: boolean; matchedBy?: Change['matchedBy'] },
): Change {
  const baseRef = base && elementRef(baseModel, base);
  const headRef = head && elementRef(headModel, head);
  const main = headRef ?? baseRef!;
  return {
    id,
    kind,
    ...flags,
    base: baseRef,
    head: headRef,
    ifcType: main.ifcType,
    name: main.name,
    storey: main.storey,
    geometryDelta: base && head && flags.geometry ? describeChangeGeometry(base, head) : undefined,
    properties: [],
  };
}

function fromEntry(entry: DiffEntry<number>, base: LoadedModel, head: LoadedModel): Change | null {
  if (entry.state === 'unchanged') return null;
  return toChange(entry.key, entry.state, base, head, entry.base, entry.head, {
    geometry: entry.state === 'modified' ? entry.changeKinds.includes('geometry') : true,
    // A move to another storey is information, not shape, so it counts on the data side.
    data: entry.state === 'modified' ? entry.changeKinds.includes('data') || entry.changeKinds.includes('container') : true,
    container: entry.changeKinds.includes('container'),
  });
}

function fromMatch(match: ContentMatch<number>, base: LoadedModel, head: LoadedModel): Change | null {
  const kind = match.kind;
  if (kind !== 'moved' && kind !== 'reshaped' && kind !== 'respecified') return null;
  const b = match.base[0];
  const h = match.head[0];
  if (!b || !h) return null;
  return toChange(h.key, 'modified', base, head, b, h, {
    geometry: kind !== 'respecified',
    data: kind === 'respecified',
    container: false,
    matchedBy: kind,
  });
}

export interface Comparison {
  changes: Change[];
  summary: ComparisonSummary;
}

export function compareFingerprints(baseModel: LoadedModel, headModel: LoadedModel, base: Fingerprint[], head: Fingerprint[]): Comparison {
  const diff = diffModels(base, head, { scope: 'both', excludeTypes: EXCLUDED_TYPES, matchUnpairedByContent: true });
  const changes: Change[] = [];
  for (const entry of diff.entries) {
    const change = fromEntry(entry, baseModel, headModel);
    if (change) changes.push(change);
  }
  let reidentified = 0;
  let ambiguousGroups = 0;
  for (const match of diff.contentMatches ?? []) {
    if (match.kind === 'renamed') {
      reidentified += match.head.length;
      continue;
    }
    if (match.kind === 'duplicated' || match.kind === 'deduplicated' || match.kind === 'ambiguous') {
      ambiguousGroups++;
      continue;
    }
    const change = fromMatch(match, baseModel, headModel);
    if (change) changes.push(change);
  }
  const hasHashes = (fingerprints: Fingerprint[]) => fingerprints.some((f) => f.geometryHash !== undefined);
  const count = (kind: ChangeKind) => changes.filter((c) => c.kind === kind).length;
  return {
    changes: sortChanges(changes),
    summary: {
      added: count('added'),
      modified: count('modified'),
      deleted: count('deleted'),
      unchanged: diff.counts.unchanged + reidentified,
      reidentified,
      ambiguousGroups,
      geometryCompared: hasHashes(base) && hasHashes(head),
    },
  };
}

const KIND_ORDER: Record<ChangeKind, number> = { modified: 0, added: 1, deleted: 2 };

export function sortChanges(changes: Change[]): Change[] {
  return changes.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.ifcType.localeCompare(b.ifcType) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** Fill in which properties differ, for every modified element. Runs after the first paint. */
export async function computePropertyChanges(
  changes: Change[],
  baseModel: LoadedModel,
  headModel: LoadedModel,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const baseUnits = extractProjectUnits(baseModel.store.source, baseModel.store.entityIndex);
  const headUnits = extractProjectUnits(headModel.store.source, headModel.store.entityIndex);
  let lastBreath = performance.now();
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    change.properties = change.geometry && change.kind === 'modified' ? geometryRows(change.geometryDelta) : [];
    if (change.kind === 'modified' && change.base && change.head) {
      const before = flattenElement(baseModel.store, change.base.expressId, change.base.ifcType, baseUnits);
      const after = flattenElement(headModel.store, change.head.expressId, change.head.ifcType, headUnits);
      change.properties.push(...diffRows(before, after));
      if (change.container) {
        change.properties.push({ group: 'Spatial', name: 'Container', before: change.base.storey ?? null, after: change.head.storey ?? null, scope: 'data' });
      }
    }
    if (performance.now() - lastBreath > 40) {
      onProgress?.(i / changes.length);
      await breathe();
      lastBreath = performance.now();
    }
  }
  onProgress?.(1);
}

/** All properties of one element, for the inspector on an added or deleted element. */
export function elementRows(model: LoadedModel, ref: ElementRef) {
  const store: IfcDataStore = model.store;
  return flattenElement(store, ref.expressId, ref.ifcType, extractProjectUnits(store.source, store.entityIndex));
}
