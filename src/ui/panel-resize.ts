import { h } from './dom';

export interface PanelSize {
  /** The CSS variable holding this panel's width. */
  cssVar: string;
  storageKey: string;
  label: string;
  initial: number;
  min: number;
  max: number;
  /** Which side of the window the panel sits on, so a drag grows it the right way. */
  side: 'left' | 'right';
  /** What must stay clear in the window besides this panel. */
  reserved: () => number;
}

/** The panel's limits, tightened so what sits beside it keeps its room in a small window. */
export function clampWidth(width: number, size: Pick<PanelSize, 'min' | 'max'>, windowWidth: number, reserved: number): number {
  const room = windowWidth - reserved;
  return Math.round(Math.max(size.min, Math.min(size.max, room, width)));
}

function readStored(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function store(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // A private window can refuse this. The width still applies until the page closes.
  }
}

const KEY_STEP = 16;

/** A drag handle between a panel and the stage: pointer, arrow keys, and double-click to reset. */
export function createPanelHandle(size: PanelSize, onResized: () => void) {
  const root = document.documentElement;
  let width = size.initial;

  const handle = h('div', {
    class: `panel-handle handle-${size.side}`,
    role: 'separator',
    tabindex: '0',
    'aria-orientation': 'vertical',
    'aria-label': size.label,
    'aria-valuemin': String(size.min),
    'aria-valuemax': String(size.max),
    title: 'Drag to resize. Double-click to reset.',
  });

  function apply(next: number) {
    width = clampWidth(next, size, window.innerWidth, size.reserved());
    root.style.setProperty(size.cssVar, `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
  }

  function commit() {
    store(size.storageKey, width);
    onResized();
  }

  let drag: { x: number; width: number } | null = null;
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, width };
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const moved = e.clientX - drag.x;
    apply(drag.width + (size.side === 'left' ? moved : -moved));
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('resizing');
    commit();
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  handle.addEventListener('dblclick', () => {
    apply(size.initial);
    commit();
  });
  handle.addEventListener('keydown', (e) => {
    const direction = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!direction) return;
    e.preventDefault();
    e.stopPropagation();
    apply(width + direction * KEY_STEP * (size.side === 'left' ? 1 : -1));
    commit();
  });

  return {
    element: handle,
    get width() {
      return width;
    },
    /** Apply the saved width, or fit the current one to the window. */
    restore: () => apply(readStored(size.storageKey) ?? width),
    refit: () => apply(width),
  };
}
