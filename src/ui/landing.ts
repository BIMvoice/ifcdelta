import { h, icon, ICONS } from './dom';

export interface LandingHandlers {
  onCompare: (oldFile: File, newFile: File) => void;
}

const isIfc = (file: File) => /\.ifc$/i.test(file.name);

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Pick two IFC files. Two dropped at once are ordered by date, oldest first. */
export function createLanding(handlers: LandingHandlers, message?: string) {
  const files: { old: File | null; new: File | null } = { old: null, new: null };
  const status = h('p', { class: 'landing-note', role: 'status' }, message ?? '');
  if (message) status.classList.add('error');

  const slot = (side: 'old' | 'new', label: string) => {
    const input = h('input', { type: 'file', accept: '.ifc', 'data-slot': side, class: 'visually-hidden' });
    const title = h('span', { class: 'slot-title' }, 'Choose or drop an IFC file');
    const detail = h('span', { class: 'slot-detail' }, side === 'old' ? 'The earlier version' : 'The later version');
    const box = h('label', { class: `slot slot-${side}` }, input, h('span', { class: 'slot-label' }, label), title, detail);
    const render = () => {
      const file = files[side];
      box.classList.toggle('filled', !!file);
      title.textContent = file ? file.name : 'Choose or drop an IFC file';
      detail.textContent = file ? sizeLabel(file.size) : side === 'old' ? 'The earlier version' : 'The later version';
    };
    input.addEventListener('change', () => {
      if (input.files?.[0]) setFile(side, input.files[0]);
      input.value = '';
    });
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.classList.add('over');
    });
    box.addEventListener('dragleave', () => box.classList.remove('over'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('over');
      const dropped = [...(e.dataTransfer?.files ?? [])];
      if (dropped.length > 1) setBoth(dropped);
      else if (dropped[0]) setFile(side, dropped[0]);
    });
    return { box, render };
  };

  const oldSlot = slot('old', 'Old version');
  const newSlot = slot('new', 'New version');

  const compare = h('button', { class: 'primary compare-btn', disabled: true, onclick: () => files.old && files.new && handlers.onCompare(files.old, files.new) }, 'Compare versions');
  const swap = h(
    'button',
    {
      class: 'icon-btn swap-btn',
      'aria-label': 'Swap old and new',
      title: 'Swap old and new',
      onclick: () => {
        [files.old, files.new] = [files.new, files.old];
        render();
      },
    },
    icon(ICONS.swap),
  );

  function render() {
    oldSlot.render();
    newSlot.render();
    compare.disabled = !(files.old && files.new);
    swap.disabled = !(files.old || files.new);
  }

  function setFile(side: 'old' | 'new', file: File) {
    if (!isIfc(file)) {
      status.textContent = `${file.name} is not an .ifc file.`;
      status.classList.add('error');
      return;
    }
    status.textContent = '';
    status.classList.remove('error');
    files[side] = file;
    render();
  }

  function setBoth(dropped: File[]) {
    const ifcs = dropped.filter(isIfc).slice(0, 2).sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name));
    if (ifcs.length < 2) {
      status.textContent = 'Drop two .ifc files to fill both versions.';
      status.classList.add('error');
      return;
    }
    status.textContent = `${ifcs[0].name} was saved first, so it is the old version. Use swap if that is wrong.`;
    status.classList.remove('error');
    files.old = ifcs[0];
    files.new = ifcs[1];
    render();
  }

  const root = h(
    'main',
    { class: 'landing' },
    h(
      'div',
      { class: 'landing-inner' },
      h('div', { class: 'brand brand-large' }, icon(ICONS.mark), 'ifcdelta'),
      h('h1', {}, 'See what changed between two versions of an IFC model.'),
      h('p', { class: 'lede' }, 'Geometry and data, element by element. Your files stay on this computer.'),
      h('div', { class: 'slots' }, oldSlot.box, swap, newSlot.box),
      h('div', { class: 'landing-actions' }, compare, status),
    ),
  );
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const dropped = [...(e.dataTransfer?.files ?? [])];
    if (dropped.length > 1) setBoth(dropped);
    else if (dropped[0]) setFile(files.old ? 'new' : 'old', dropped[0]);
  });
  render();
  return root;
}

export interface ProgressView {
  root: HTMLElement;
  update: (label: string, fraction: number) => void;
}

export function createProgress(oldName: string, newName: string): ProgressView {
  const label = h('p', { class: 'progress-label', role: 'status' }, 'Starting');
  const bar = h('div', { class: 'progress-bar' });
  const root = h(
    'main',
    { class: 'landing progress' },
    h(
      'div',
      { class: 'landing-inner progress-inner' },
      h('div', { class: 'brand brand-large' }, icon(ICONS.mark), 'ifcdelta'),
      h('div', { class: 'progress-files' }, h('span', {}, oldName), icon(ICONS.arrow), h('span', {}, newName)),
      h('div', { class: 'progress-track' }, bar),
      label,
    ),
  );
  return {
    root,
    update(text, fraction) {
      label.textContent = text;
      bar.style.width = `${Math.round(fraction * 100)}%`;
    },
  };
}
