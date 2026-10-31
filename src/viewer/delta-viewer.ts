import type { MeshData } from '@ifc-lite/geometry';
import { DEFAULT_OVERLAY_THEME, Renderer, type PickResult } from '@ifc-lite/renderer';
import type { Box } from '../engine/load';
import type { Overlay } from './overlay';

/** How see-through unchanged elements are in the X-ray. */
const GHOST_ALPHA = 0.11;
/** See-through, so the stage background in style.css shows behind the model. */
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
/** Crisp lines and soft contact shadows, so solid elements do not read as flat colour. */
const ENHANCEMENT = {
  enabled: true,
  separationLines: { enabled: true, quality: 'high', intensity: 0.55, radius: 1 },
  contactShading: { quality: 'low', intensity: 0.45, radius: 0.6 },
} as const;
const HOVER_INTERVAL_MS = 70;
const CLICK_TOLERANCE = 4;
const FRAME_MS = 450;

function union(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** White selection keeps the change's own colour readable around it, where the default blue replaced it. */
function applyTheme(renderer: Renderer) {
  renderer.setOverlayTheme({ ...DEFAULT_OVERLAY_THEME, selection: [1, 1, 1, 1] });
}

const vec = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });

export interface PickHit {
  side: 'head' | 'base';
  id: number;
}

interface Pane {
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  overlay: Overlay | null;
  selected: Set<number>;
  dirtyOverlay: boolean;
}

/** One renderer for the new version, plus a second one only while the wipe view is in use. */
export class DeltaViewer {
  private head: Pane;
  private base: Pane | null = null;
  private wipeAt: number | null = null;
  private dirty = true;
  private lastTime = 0;
  private running = false;
  private drag: { x: number; y: number; startX: number; startY: number; pan: boolean } | null = null;
  private resizeObserver: ResizeObserver;
  private clearWidth: number | null = null;
  private hoverId: number | null = null;
  private lastHoverPick = 0;
  private hoverPicking = false;
  /** Decides which hovered elements are worth outlining: the changed ones. */
  isHoverable: (hit: PickHit) => boolean = () => false;
  /** Fires the first time someone moves the camera. */
  onFirstInteraction: () => void = () => {};
  onPick: (hit: PickHit | null) => void = () => {};

  private constructor(private stage: HTMLElement, canvas: HTMLCanvasElement, private baseCanvas: HTMLCanvasElement) {
    this.head = { renderer: new Renderer(canvas), canvas, overlay: null, selected: new Set(), dirtyOverlay: false };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.bindInput();
  }

  static async create(stage: HTMLElement, canvas: HTMLCanvasElement, baseCanvas: HTMLCanvasElement): Promise<DeltaViewer> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser.');
    const viewer = new DeltaViewer(stage, canvas, baseCanvas);
    await viewer.head.renderer.init();
    applyTheme(viewer.head.renderer);
    viewer.resize();
    viewer.start();
    return viewer;
  }

  addHeadMeshes(meshes: MeshData[]) {
    this.head.renderer.addMeshes(meshes, true);
    this.invalidate();
  }

  /** Merge what was streamed in, so ghosting and picking work on whole batches. */
  finishLoading(pane: Pane = this.head) {
    const device = pane.renderer.getGPUDevice();
    const pipeline = pane.renderer.getPipeline();
    if (device && pipeline) pane.renderer.getScene().finalizeStreaming(device, pipeline);
    this.invalidate();
  }

  /** Width in px left clear between the panels that float over the stage, or null if none do. */
  setClearWidth(width: number | null) {
    this.clearWidth = width;
  }

  /** Fit the whole model into the part of the stage no panel covers. */
  fit() {
    const bounds = this.head.renderer.getModelBounds();
    if (!bounds) return;
    let padding = 1.25;
    if (this.clearWidth) {
      const { width, height } = this.stage.getBoundingClientRect();
      const across = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
      const modelAspect = across / Math.max(bounds.max.y - bounds.min.y, 1e-3);
      padding = Math.max(padding, (Math.min(modelAspect, width / height) * height * 1.05) / this.clearWidth);
    }
    void this.head.renderer.getCamera().frameBounds(bounds.min, bounds.max, 0, padding);
    this.invalidate();
  }

  frame(box: Box | undefined) {
    if (!box) return;
    const width = this.stage.getBoundingClientRect().width;
    const padding = this.clearWidth ? Math.max(3, (2.2 * width) / this.clearWidth) : 3;
    void this.head.renderer.getCamera().frameBounds(vec(box.min), vec(box.max), FRAME_MS, padding);
    this.invalidate();
  }

  static unionBoxes = union;

  setOverlay(overlay: Overlay) {
    this.head.overlay = overlay;
    this.head.dirtyOverlay = true;
    this.invalidate();
  }

  setSelection(headIds: number[], baseIds: number[]) {
    this.head.selected = new Set(headIds);
    if (this.base) this.base.selected = new Set(baseIds);
    this.invalidate();
  }

  get hasWipe() {
    return this.base !== null;
  }

  async initWipe(addMeshes: (add: (meshes: MeshData[]) => void) => Promise<void>) {
    if (this.base) return;
    const renderer = new Renderer(this.baseCanvas);
    await renderer.init();
    applyTheme(renderer);
    const pane: Pane = { renderer, canvas: this.baseCanvas, overlay: null, selected: new Set(), dirtyOverlay: false };
    this.base = pane;
    this.resize();
    await addMeshes((meshes) => {
      renderer.addMeshes(meshes, true);
      this.invalidate();
    });
    this.finishLoading(pane);
  }

  setBaseOverlay(overlay: Overlay) {
    if (!this.base) return;
    this.base.overlay = overlay;
    this.base.dirtyOverlay = true;
    this.invalidate();
  }

  /** `at` is the seam position from 0 to 1, or null to leave the wipe view. */
  setWipe(at: number | null) {
    this.wipeAt = at;
    this.baseCanvas.hidden = at === null;
    if (at !== null) this.baseCanvas.style.clipPath = `inset(0 ${(1 - at) * 100}% 0 0)`;
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  private start() {
    if (this.running) return;
    this.running = true;
    const tick = (time: number) => {
      if (!this.running) return;
      const dt = this.lastTime ? time - this.lastTime : 16;
      this.lastTime = time;
      const camera = this.head.renderer.getCamera();
      const moving = camera.update(dt);
      if (moving || this.dirty) {
        this.dirty = false;
        this.draw(this.head);
        if (this.base && this.wipeAt !== null) {
          this.syncCamera();
          this.draw(this.base);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private syncCamera() {
    if (!this.base) return;
    const from = this.head.renderer.getCamera();
    const to = this.base.renderer.getCamera();
    const position = from.getPosition();
    const target = from.getTarget();
    const up = from.getUp();
    to.setPosition(position.x, position.y, position.z);
    to.setTarget(target.x, target.y, target.z);
    to.setUp(up.x, up.y, up.z);
    to.setFOV(from.getFOV());
  }

  private draw(pane: Pane) {
    const { renderer, overlay } = pane;
    if (overlay && pane.dirtyOverlay) {
      const device = renderer.getGPUDevice();
      const pipeline = renderer.getPipeline();
      if (device && pipeline) {
        renderer.getScene().setColorOverrides(overlay.colours, device, pipeline);
        pane.dirtyOverlay = false;
      }
    }
    renderer.render({
      clearColor: CLEAR,
      hiddenIds: overlay?.hidden,
      ghostExceptIds: overlay?.solid ?? null,
      ghostAlpha: GHOST_ALPHA,
      transparencyOverrides: overlay?.alpha,
      selectedIds: pane.selected,
      hoverOutline: pane === this.head && this.hoverId !== null ? { id: this.hoverId } : null,
      visualEnhancement: ENHANCEMENT,
    });
  }

  private resize() {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.head.renderer.resize(width, height);
    this.base?.renderer.resize(width, height);
    this.invalidate();
  }

  private bindInput() {
    const { stage } = this;
    stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('[data-stage-ui]')) return;
      stage.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, pan: e.button !== 0 || e.shiftKey };
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!this.drag) {
        if (e.pointerType === 'mouse') void this.hoverAt(e);
        return;
      }
      this.onFirstInteraction();
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      const camera = this.head.renderer.getCamera();
      if (this.drag.pan) camera.pan(dx, dy);
      else camera.orbit(dx, dy);
      this.invalidate();
    });
    const release = (e: PointerEvent) => {
      if (!this.drag) return;
      const { startX, startY, pan } = this.drag;
      this.drag = null;
      stage.classList.remove('dragging');
      if (!pan && Math.hypot(e.clientX - startX, e.clientY - startY) < CLICK_TOLERANCE) void this.pickAt(e);
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', () => {
      this.drag = null;
      stage.classList.remove('dragging');
    });
    stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.onFirstInteraction();
        const rect = stage.getBoundingClientRect();
        this.head.renderer.getCamera().zoom(e.deltaY, false, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        this.invalidate();
      },
      { passive: false },
    );
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Outline a changed element under the pointer, at most every few frames. */
  private async hoverAt(e: PointerEvent) {
    const now = performance.now();
    if (this.hoverPicking || now - this.lastHoverPick < HOVER_INTERVAL_MS) return;
    if (this.wipeAt !== null || (e.target as HTMLElement).closest('[data-stage-ui]')) return this.setHover(null);
    this.lastHoverPick = now;
    this.hoverPicking = true;
    try {
      const rect = this.stage.getBoundingClientRect();
      const hit = await this.head.renderer.pick(e.clientX - rect.left, e.clientY - rect.top, { hiddenIds: this.head.overlay?.hidden });
      this.setHover(hit && this.isHoverable({ side: 'head', id: hit.expressId }) ? hit.expressId : null);
    } finally {
      this.hoverPicking = false;
    }
  }

  private setHover(id: number | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.stage.classList.toggle('over-change', id !== null);
    this.invalidate();
  }

  private async pickAt(e: PointerEvent) {
    const rect = this.stage.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const onBase = this.base !== null && this.wipeAt !== null && x / rect.width < this.wipeAt;
    const pane = onBase ? this.base! : this.head;
    const hit: PickResult | null = await pane.renderer.pick(x, y, { hiddenIds: pane.overlay?.hidden });
    this.onPick(hit ? { side: onBase ? 'base' : 'head', id: hit.expressId } : null);
  }
}
