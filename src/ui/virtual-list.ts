/** Fixed-height windowing, so a model with tens of thousands of changes still scrolls smoothly. */
export class VirtualList<T> {
  private items: T[] = [];
  private spacer: HTMLElement;
  private content: HTMLElement;
  private frame = 0;

  constructor(
    private viewport: HTMLElement,
    private rowHeight: number,
    private renderRow: (item: T, index: number) => HTMLElement,
    host: HTMLElement = viewport,
  ) {
    this.spacer = document.createElement('div');
    this.spacer.className = 'vlist-spacer';
    this.content = document.createElement('div');
    this.content.className = 'vlist-content';
    this.spacer.appendChild(this.content);
    host.appendChild(this.spacer);
    viewport.addEventListener('scroll', () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.schedule()).observe(viewport);
  }

  setItems(items: T[]) {
    this.items = items;
    this.spacer.style.height = `${items.length * this.rowHeight}px`;
    if (this.viewport.scrollTop > items.length * this.rowHeight) this.viewport.scrollTop = 0;
    this.draw();
  }

  /** Redraw what is on screen, for example after the selection moved. */
  refresh() {
    this.draw();
  }

  scrollToIndex(index: number) {
    if (index < 0) return;
    const top = index * this.rowHeight;
    const { scrollTop, clientHeight } = this.viewport;
    const offset = this.spacer.offsetTop;
    if (top + offset < scrollTop) this.viewport.scrollTop = top + offset;
    else if (top + this.rowHeight + offset > scrollTop + clientHeight) this.viewport.scrollTop = top + this.rowHeight + offset - clientHeight;
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    const { scrollTop, clientHeight } = this.viewport;
    const overscan = 6;
    const first = Math.max(0, Math.floor(scrollTop / this.rowHeight) - overscan);
    const last = Math.min(this.items.length, Math.ceil((scrollTop + clientHeight) / this.rowHeight) + overscan);
    this.content.style.transform = `translateY(${first * this.rowHeight}px)`;
    const rows: HTMLElement[] = [];
    for (let i = first; i < last; i++) rows.push(this.renderRow(this.items[i], i));
    this.content.replaceChildren(...rows);
  }
}
