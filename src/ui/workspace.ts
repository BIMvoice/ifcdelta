import { classCounts, kindCounts, matches, NO_FILTERS, tableRows, type Filters, type TableRow } from '../app/filters';
import { elementRows, type Comparison } from '../engine/compare';
import { describeGeometry } from '../engine/format';
import type { LoadedModel } from '../engine/load';
import type { FlatRow } from '../engine/properties';
import type { Change, ChangeKind, ElementRef, PropertyChange } from '../engine/types';
import { DeltaViewer, type PickHit } from '../viewer/delta-viewer';
import { buildBaseOverlay, buildHeadOverlay, type VersionView } from '../viewer/overlay';
import { h, icon, ICONS } from './dom';
import { VirtualList } from './virtual-list';

export interface WorkspaceOptions {
  comparison: Comparison;
  baseModel: LoadedModel;
  headModel: LoadedModel;
  viewer: DeltaViewer | null;
  stage: HTMLElement;
  baseOffset: number;
  /** Streams the whole old version, for the wipe view. Only runs if wipe is opened. */
  loadBaseScene: (add: (meshes: Parameters<DeltaViewer['addHeadMeshes']>[0]) => void) => Promise<void>;
  onChangeFiles: () => void;
}

type VersionMode = VersionView | 'wipe';
type Selection = { change: Change } | { unchanged: ElementRef } | null;

const SIGIL: Record<ChangeKind, string> = { added: '+', modified: '~', deleted: '−' };
const KIND_LABEL: Record<ChangeKind, string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };
const LIST_ROW = 58;
const TABLE_ROW = 46;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const titleOf = (change: Change) => change.name || change.ifcType;

function changeSummary(change: Change): string {
  if (change.kind !== 'modified') return KIND_LABEL[change.kind];
  const parts: string[] = [];
  if (change.geometry) parts.push(describeGeometry(change.geometryDelta));
  const dataRows = change.properties.filter((p) => p.scope === 'data').length;
  if (change.data) parts.push(dataRows ? plural(dataRows, 'property', 'properties') : 'Data changed');
  return parts.join(' · ');
}

function sigil(kind: ChangeKind) {
  return h('span', { class: `sigil ${kind}`, 'aria-hidden': 'true' }, SIGIL[kind]);
}

export function createWorkspace(options: WorkspaceOptions) {
  const { comparison, baseModel, headModel, viewer, stage, baseOffset } = options;
  const { changes, summary } = comparison;
  const total = changes.length;

  const state = {
    filters: { ...NO_FILTERS } as Filters,
    view: 'model' as 'model' | 'data',
    version: 'overlay' as VersionMode,
    wipe: 0.5,
    selection: null as Selection,
    wipeLoading: false,
  };

  // Lookups for clicks in the 3D view.
  const byHeadId = new Map<number, Change>();
  const byBaseId = new Map<number, Change>();
  for (const change of changes) {
    if (change.head) byHeadId.set(change.head.expressId, change);
    if (change.base) byBaseId.set(change.base.expressId, change);
  }

  // Filtered lists, rebuilt in refresh().
  let shownChanges: Change[] = changes;
  let rows: TableRow[] = [];

  // ── Change list ────────────────────────────────────────────────────────────
  const countNumber = h('span', { class: 'count-number' });
  const countLabel = h('span', { class: 'count-label' });
  const kindButtons = h('div', { class: 'chip-row four', role: 'group', 'aria-label': 'Filter by kind of change' });
  const scopeButtons = h('div', { class: 'chip-row three', role: 'group', 'aria-label': 'Filter by geometry or data' });
  const search = () => {
    const input = h('input', {
      type: 'search',
      placeholder: 'Search elements or properties',
      'aria-label': 'Search changes',
      oninput: (e: Event) => setFilters({ query: (e.target as HTMLInputElement).value }),
    });
    return input;
  };
  const listSearch = search();
  const emptyList = h('p', { class: 'empty', hidden: true });
  const listViewport = h('div', { class: 'list-scroll scroll', tabindex: '-1' });
  const notes = h('div', { class: 'notes' });
  const list = new VirtualList<Change>(listViewport, LIST_ROW, (change) => {
    const selected = isSelected(change);
    return h(
      'button',
      {
        class: `change-row${selected ? ' selected' : ''}`,
        'aria-pressed': String(selected),
        title: titleOf(change),
        onclick: () => select({ change }, true),
      },
      sigil(change.kind),
      h(
        'span',
        { class: 'change-text' },
        h('span', { class: 'change-title' }, titleOf(change)),
        h('span', { class: 'change-sub' }, `${change.ifcType}${change.storey ? ` · ${change.storey}` : ''}`),
        h('span', { class: 'change-what' }, changeSummary(change)),
      ),
    );
  });
  const changesPanel = h(
    'aside',
    { class: 'panel changes-panel', 'aria-label': 'Changes' },
    h('div', { class: 'panel-head' }, h('div', { class: 'count' }, countNumber, countLabel), kindButtons, scopeButtons, listSearch),
    listViewport,
    emptyList,
    notes,
  );

  // ── Data table ─────────────────────────────────────────────────────────────
  const tally = h('div', { class: 'tally', role: 'group', 'aria-label': 'Filter by kind of change' });
  const tableSearch = search();
  const tableScopes = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter by geometry or data' });
  const tableScroll = h('div', { class: 'table-scroll scroll', role: 'region', 'aria-label': 'Property changes', tabindex: '0' });
  const tableInner = h('div', { class: 'table-inner' });
  const tableHeader = h(
    'div',
    { class: 'table-row table-header' },
    h('span', {}),
    h('span', {}, 'Element'),
    h('span', {}, 'Class'),
    h('span', {}, 'Storey'),
    h('span', {}, 'Property'),
    h('span', {}, 'Old'),
    h('span', {}, 'New'),
  );
  tableInner.append(tableHeader);
  tableScroll.append(tableInner);
  const tableEmpty = h('p', { class: 'empty', hidden: true });
  const table = new VirtualList<TableRow>(
    tableScroll,
    TABLE_ROW,
    (row) => {
      const { change, first, property } = row;
      const selected = isSelected(change);
      const before = property ? property.before : change.kind === 'deleted' ? 'Whole element' : null;
      const after = property ? property.after : change.kind === 'added' ? 'Whole element' : null;
      return h(
        'button',
        { class: `table-row${first ? ' first' : ''}${selected ? ' selected' : ''}`, onclick: () => select({ change }, true) },
        first ? sigil(change.kind) : h('span', {}),
        h('span', { class: 'cell strong', title: first ? titleOf(change) : null }, first ? titleOf(change) : ''),
        h('span', { class: 'cell mono dim', title: first ? change.ifcType : null }, first ? change.ifcType : ''),
        h('span', { class: 'cell dim', title: first ? change.storey ?? null : null }, first ? change.storey ?? '' : ''),
        property
          ? h('span', { class: 'cell-stack', title: `${property.group} / ${property.name}` }, h('span', { class: 'cell' }, property.name), h('span', { class: 'cell mono small dim' }, property.group))
          : h('span', { class: 'cell dim' }, KIND_LABEL[change.kind]),
        valueCell(before, 'before'),
        valueCell(after, 'after'),
      );
    },
    tableInner,
  );
  const tablePanel = h(
    'section',
    { class: 'panel table-panel', 'aria-label': 'Data changes' },
    tally,
    h('div', { class: 'table-tools' }, tableSearch, tableScopes),
    tableScroll,
    tableEmpty,
  );

  function valueCell(value: string | null, side: 'before' | 'after') {
    return h('span', { class: `cell mono value ${side}${value === null ? ' none' : ''}`, title: value }, value ?? '—');
  }

  // ── Inspector ──────────────────────────────────────────────────────────────
  const inspector = h('div', { class: 'inspector scroll' });
  const classList = h('div', { class: 'class-list' });
  const stageSlot = h('div', { class: 'stage-slot', 'aria-hidden': 'true' });
  const sidePanel = h('aside', { class: 'panel side-panel', 'aria-label': 'Selected element' }, stageSlot, inspector, classList);

  // ── Top bar ────────────────────────────────────────────────────────────────
  const tabs = h('div', { class: 'segmented tabs', role: 'group', 'aria-label': 'View' });
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, icon(ICONS.mark), 'ifcdelta'),
    h(
      'div',
      { class: 'files' },
      h('span', { class: 'file old', title: baseModel.fileName }, baseModel.fileName),
      icon(ICONS.arrow),
      h('span', { class: 'file new', title: headModel.fileName }, headModel.fileName),
    ),
    tabs,
    h('button', { class: 'ghost', onclick: options.onChangeFiles }, 'Change files'),
  );

  const root = h('div', { class: 'workspace', 'data-view': state.view }, topbar, h('div', { class: 'panels' }, changesPanel, tablePanel, h('div', { class: 'center' }), sidePanel));

  // ── Stage controls, which live inside the 3D stage ─────────────────────────
  const versionBar = h('div', { class: 'segmented version-bar', 'data-stage-ui': true, role: 'group', 'aria-label': 'Which version to show' });
  const hint = h(
    'div',
    { class: 'stage-hint' },
    h('span', { class: 'swatch added' }, 'Added'),
    h('span', { class: 'swatch modified' }, 'Shape or position'),
    h('span', { class: 'swatch data-only' }, 'Data only'),
    h('span', { class: 'swatch deleted' }, 'Deleted'),
  );
  const stageMessage = h('p', { class: 'stage-message', role: 'status', hidden: true });
  const fitButton = h(
    'button',
    { class: 'icon-btn fit-btn', 'data-stage-ui': true, 'aria-label': 'Fit the model in view', title: 'Fit the model in view', onclick: () => viewer?.fit() },
    icon(ICONS.fit),
  );
  const seam = h('div', {
    class: 'seam',
    'data-stage-ui': true,
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Move the seam between old and new',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    hidden: true,
  });
  seam.append(h('span', { class: 'seam-grip' }, icon(ICONS.grip)));
  const seamLabels = h('div', { class: 'seam-labels', hidden: true }, h('span', {}, 'Old'), h('span', {}, 'New'));
  const help = h('p', { class: 'stage-help' }, 'Drag to orbit, shift-drag to pan, scroll to zoom');
  const stageUi = h('div', { class: 'stage-ui' }, seam, seamLabels, help, h('div', { class: 'stage-bottom' }, h('div', { class: 'stage-controls' }, versionBar, fitButton), hint), stageMessage);
  stage.append(stageUi);

  if (!viewer) {
    stageMessage.hidden = false;
    stageMessage.textContent = 'The 3D view needs WebGPU, which this browser does not offer. The data comparison below is complete.';
    versionBar.hidden = true;
    hint.hidden = true;
    help.hidden = true;
    fitButton.hidden = true;
  }

  function placeSeam() {
    seam.style.left = `${state.wipe * 100}%`;
    seam.setAttribute('aria-valuenow', String(Math.round(state.wipe * 100)));
    viewer?.setWipe(state.version === 'wipe' ? state.wipe : null);
  }
  seam.addEventListener('pointerdown', (e) => {
    seam.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  seam.addEventListener('pointermove', (e) => {
    if (!seam.hasPointerCapture(e.pointerId)) return;
    const rect = stage.getBoundingClientRect();
    state.wipe = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    placeSeam();
  });
  seam.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    state.wipe = Math.min(1, Math.max(0, state.wipe + step));
    placeSeam();
  });

  // ── Selection ──────────────────────────────────────────────────────────────
  function isSelected(change: Change) {
    return !!state.selection && 'change' in state.selection && state.selection.change === change;
  }

  function select(selection: Selection, frame = false) {
    state.selection = selection;
    list.refresh();
    table.refresh();
    renderInspector();
    if (!viewer) return;
    const head: number[] = [];
    const base: number[] = [];
    if (selection && 'change' in selection) {
      const { change } = selection;
      if (change.head?.meshed) head.push(change.head.expressId);
      if (change.base?.meshed) {
        head.push(change.base.expressId + baseOffset);
        base.push(change.base.expressId);
      }
      if (frame) {
        const box = DeltaViewer.unionBoxes(
          change.head ? headModel.sceneBoxes.get(change.head.expressId) : undefined,
          change.base ? baseModel.sceneBoxes.get(change.base.expressId) : undefined,
        );
        viewer.frame(box);
      }
    } else if (selection) {
      head.push(selection.unchanged.expressId);
    }
    viewer.setSelection(head, base);
  }

  function selectStep(delta: number) {
    const current = state.selection && 'change' in state.selection ? shownChanges.indexOf(state.selection.change) : -1;
    const next = shownChanges[Math.min(shownChanges.length - 1, Math.max(0, current + delta))];
    if (!next) return;
    select({ change: next }, true);
    list.scrollToIndex(shownChanges.indexOf(next));
    table.scrollToIndex(rows.findIndex((row) => row.change === next));
  }

  function onPick(hit: PickHit | null) {
    if (!hit) {
      select(null);
      return;
    }
    let change: Change | undefined;
    if (hit.side === 'base') change = byBaseId.get(hit.id);
    else if (hit.id >= baseOffset) change = byBaseId.get(hit.id - baseOffset);
    else change = byHeadId.get(hit.id);
    if (change) {
      select({ change });
      list.scrollToIndex(shownChanges.indexOf(change));
      table.scrollToIndex(rows.findIndex((row) => row.change === change));
      return;
    }
    const model = hit.side === 'base' ? baseModel : headModel;
    const id = hit.id;
    select({
      unchanged: {
        expressId: id,
        globalId: model.store.entities.getGlobalId(id) || '',
        ifcType: model.store.entities.getTypeName(id),
        name: model.store.entities.getName(id) || '',
        meshed: true,
      },
    });
  }
  if (viewer) viewer.onPick = onPick;

  function renderInspector() {
    const selection = state.selection;
    if (!selection) {
      inspector.replaceChildren(
        h(
          'div',
          { class: 'inspector-empty' },
          h('h2', {}, total ? plural(total, 'change') : 'No differences'),
          h('p', {}, total ? 'Pick one in the list or click a coloured element to see exactly what changed.' : `Every compared element is the same in both versions (${summary.unchanged.toLocaleString()}).`),
        ),
      );
      return;
    }
    if ('unchanged' in selection) {
      const ref = selection.unchanged;
      inspector.replaceChildren(
        h(
          'div',
          { class: 'inspector-head' },
          h('div', { class: 'kind-line' }, h('span', { class: 'chip-kind unchanged' }, 'Unchanged'), ref.ifcType),
          h('h2', {}, ref.name || ref.ifcType),
          h('p', {}, 'This element is the same in both versions.'),
          ref.globalId && h('code', { class: 'guid' }, ref.globalId),
        ),
      );
      return;
    }
    const { change } = selection;
    const ref = change.head ?? change.base!;
    const head = h(
      'div',
      { class: 'inspector-head' },
      h('div', { class: 'kind-line' }, h('span', { class: `chip-kind ${change.kind}` }, `${SIGIL[change.kind]} ${KIND_LABEL[change.kind]}`), change.ifcType),
      h('h2', {}, titleOf(change)),
      change.kind === 'modified' && h('p', {}, changeSummary(change)),
      change.storey && h('p', { class: 'dim' }, change.storey),
      ref.globalId && h('code', { class: 'guid' }, ref.globalId),
      change.matchedBy && h('p', { class: 'note' }, 'Its GlobalId changed between versions, so it was paired by matching content.'),
      !ref.meshed && h('p', { class: 'note' }, 'This element has no geometry to show in 3D.'),
    );
    const body = change.kind === 'modified' ? renderChangedRows(change) : renderAllRows(change);
    inspector.replaceChildren(head, body);
    inspector.scrollTop = 0;
  }

  function renderChangedRows(change: Change) {
    if (change.properties.length === 0) {
      return h('p', { class: 'empty inline' }, 'The fingerprint differs, but no readable attribute or property does.');
    }
    return h('div', { class: 'prop-list' }, ...change.properties.map(renderChangedRow));
  }

  function renderChangedRow(property: PropertyChange) {
    return h(
      'div',
      { class: 'prop' },
      h('div', { class: 'prop-title' }, h('span', { class: 'prop-name' }, property.name), h('span', { class: 'prop-group' }, property.group)),
      h(
        'div',
        { class: 'prop-values' },
        h('span', { class: `value-box before${property.before === null ? ' none' : ''}` }, property.before ?? '—'),
        icon(ICONS.arrow),
        h('span', { class: `value-box after${property.after === null ? ' none' : ''}` }, property.after ?? '—'),
      ),
    );
  }

  function renderAllRows(change: Change) {
    const model = change.kind === 'added' ? headModel : baseModel;
    const ref = change.kind === 'added' ? change.head! : change.base!;
    const flat = elementRows(model, ref);
    if (flat.length === 0) return h('p', { class: 'empty inline' }, 'No attributes or properties.');
    const groups = new Map<string, FlatRow[]>();
    for (const row of flat) {
      const group = groups.get(row.group);
      if (group) group.push(row);
      else groups.set(row.group, [row]);
    }
    return h(
      'div',
      { class: 'all-props' },
      ...[...groups].map(([name, group]) =>
        h(
          'section',
          { class: 'all-group' },
          h('h3', {}, name),
          h('dl', {}, ...group.flatMap((row) => [h('dt', {}, row.name), h('dd', { class: `whole ${change.kind}` }, row.value)])),
        ),
      ),
    );
  }

  // ── Filters and rendering ──────────────────────────────────────────────────
  function setFilters(next: Partial<Filters>) {
    state.filters = { ...state.filters, ...next };
    refresh();
  }

  function chip(label: string, count: number | null, on: boolean, kind: string, action: () => void) {
    return h(
      'button',
      { class: `chip ${kind}${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: action },
      h('span', { class: 'chip-label' }, label),
      count !== null && h('span', { class: 'chip-count' }, count.toLocaleString()),
    );
  }

  function renderFilters() {
    const { filters } = state;
    const counts = kindCounts(changes, filters);
    kindButtons.replaceChildren(
      chip('All', counts.all, filters.kind === 'all', 'all', () => setFilters({ kind: 'all' })),
      chip('Added', counts.added, filters.kind === 'added', 'added', () => setFilters({ kind: 'added' })),
      chip('Modified', counts.modified, filters.kind === 'modified', 'modified', () => setFilters({ kind: 'modified' })),
      chip('Deleted', counts.deleted, filters.kind === 'deleted', 'deleted', () => setFilters({ kind: 'deleted' })),
    );
    const scopes: [Filters['scope'], string][] = [['all', 'Everything'], ['geometry', 'Geometry'], ['data', 'Data']];
    scopeButtons.replaceChildren(...scopes.map(([key, label]) => chip(label, null, filters.scope === key, 'all', () => setFilters({ scope: key }))));
    tableScopes.replaceChildren(
      ...scopes.map(([key, label]) => h('button', { class: filters.scope === key ? 'on' : '', 'aria-pressed': String(filters.scope === key), onclick: () => setFilters({ scope: key }) }, label)),
    );
    const tallies: ['all' | ChangeKind, string][] = [['all', 'changed elements'], ['added', '+ added'], ['modified', '~ modified'], ['deleted', '− deleted']];
    tally.replaceChildren(
      ...tallies.map(([key, label]) =>
        h(
          'button',
          { class: `tally-item ${key}${filters.kind === key ? ' on' : ''}`, 'aria-pressed': String(filters.kind === key), onclick: () => setFilters({ kind: key }) },
          h('span', { class: 'tally-number' }, counts[key].toLocaleString()),
          h('span', { class: 'tally-label' }, label),
        ),
      ),
    );
    classList.replaceChildren(
      h('h3', {}, 'Changes by class'),
      ...classCounts(changes).map((row) =>
        h(
          'button',
          {
            class: `class-row${filters.ifcType === row.ifcType ? ' on' : ''}`,
            'aria-pressed': String(filters.ifcType === row.ifcType),
            onclick: () => setFilters({ ifcType: filters.ifcType === row.ifcType ? null : row.ifcType }),
          },
          h('span', { class: 'class-name' }, row.ifcType),
          h(
            'span',
            { class: 'class-counts' },
            row.added > 0 && h('span', { class: 'added' }, `+${row.added}`),
            row.modified > 0 && h('span', { class: 'modified' }, `~${row.modified}`),
            row.deleted > 0 && h('span', { class: 'deleted' }, `−${row.deleted}`),
          ),
        ),
      ),
    );
    for (const input of [listSearch, tableSearch]) if (input.value !== filters.query) input.value = filters.query;
  }

  function renderNotes() {
    const items: string[] = [];
    if (summary.reidentified) items.push(`${plural(summary.reidentified, 'element')} got a new GlobalId but ${summary.reidentified === 1 ? 'is' : 'are'} otherwise identical, so ${summary.reidentified === 1 ? 'it counts' : 'they count'} as unchanged.`);
    if (summary.ambiguousGroups) items.push(`${plural(summary.ambiguousGroups, 'group')} of identical elements could not be paired one to one, so ${summary.ambiguousGroups === 1 ? 'it reads' : 'they read'} as added and deleted.`);
    if (!summary.geometryCompared) items.push('Geometry could not be compared because one version has no geometry. Only data differences are listed.');
    items.push(`${summary.unchanged.toLocaleString()} unchanged`);
    notes.replaceChildren(...items.map((text) => h('p', {}, text)));
  }

  function shownIds() {
    return new Set(shownChanges.map((change) => change.id));
  }

  function renderOverlay() {
    if (!viewer) return;
    const shown = shownIds();
    const view: VersionView = state.version === 'wipe' ? 'new' : state.version;
    viewer.setOverlay(buildHeadOverlay({ changes, shown, view, baseOffset }));
    if (viewer.hasWipe) viewer.setBaseOverlay(buildBaseOverlay(changes, shown));
  }

  function renderVersionBar() {
    const modes: [VersionMode, string][] = [['overlay', 'Overlay'], ['old', 'Old'], ['new', 'New'], ['wipe', 'Wipe']];
    versionBar.replaceChildren(
      ...modes.map(([key, label]) =>
        h('button', { class: state.version === key ? 'on' : '', 'aria-pressed': String(state.version === key), disabled: state.wipeLoading, onclick: () => void setVersion(key) }, label),
      ),
    );
    const wiping = state.version === 'wipe';
    seam.hidden = !wiping;
    seamLabels.hidden = !wiping;
    placeSeam();
  }

  async function setVersion(version: VersionMode) {
    if (version === 'wipe' && viewer && !viewer.hasWipe) {
      state.wipeLoading = true;
      renderVersionBar();
      stageMessage.hidden = false;
      stageMessage.textContent = 'Loading the old version for the wipe';
      try {
        await viewer.initWipe(options.loadBaseScene);
        stageMessage.hidden = true;
      } catch (error) {
        console.error(error);
        state.wipeLoading = false;
        stageMessage.textContent = 'The wipe could not load the old version. Overlay, Old and New still work.';
        renderVersionBar();
        return;
      }
      state.wipeLoading = false;
    }
    state.version = version;
    renderVersionBar();
    renderOverlay();
  }

  function setView(view: 'model' | 'data') {
    state.view = view;
    root.dataset.view = view;
    stage.dataset.view = view;
    tabs.replaceChildren(
      h('button', { class: view === 'model' ? 'on' : '', 'aria-pressed': String(view === 'model'), onclick: () => setView('model') }, '3D model'),
      h('button', { class: view === 'data' ? 'on' : '', 'aria-pressed': String(view === 'data'), onclick: () => setView('data') }, 'Data table'),
    );
    list.refresh();
    table.refresh();
    fitToStage();
  }

  function fitToStage() {
    if (!viewer) return;
    const panels = view3dPanelsWidth();
    viewer.setClearWidth(panels === null ? null : Math.max(1, window.innerWidth - panels));
    viewer.fit();
  }

  /** Space the side panels take up over the full-bleed stage. Docked or stacked, they cover none of it. */
  function view3dPanelsWidth() {
    if (state.view !== 'model' || window.innerWidth <= 1100) return null;
    return changesPanel.offsetWidth + sidePanel.offsetWidth + 64;
  }

  function refresh() {
    shownChanges = changes.filter((change) => matches(change, state.filters));
    rows = tableRows(changes, state.filters);
    renderFilters();
    countNumber.textContent = shownChanges.length.toLocaleString();
    countLabel.textContent = total === shownChanges.length ? plural(total, 'change').replace(/^[\d,. ]+/, '') : `of ${plural(total, 'change')}`;
    list.setItems(shownChanges);
    table.setItems(rows);
    const emptyText = total === 0 ? 'These two versions are identical.' : 'No changes match these filters.';
    emptyList.hidden = shownChanges.length > 0;
    emptyList.textContent = emptyText;
    tableEmpty.hidden = rows.length > 0;
    tableEmpty.textContent = emptyText;
    renderOverlay();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('input, textarea, [role="slider"]')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectStep(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      select(null);
    } else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) {
      viewer?.fit();
    }
  };
  window.addEventListener('keydown', onKey);

  renderNotes();
  renderVersionBar();
  renderInspector();
  refresh();

  return {
    root,
    /** Runs once the panels are in the page, so the first fit can measure them. */
    mounted() {
      setView('model');
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      stageUi.remove();
      root.remove();
    },
  };
}
