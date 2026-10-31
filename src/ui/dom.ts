type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((event: never) => void)>;

/** Small element builder. Everything from a file goes in as text, so a model can never inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(key.replace(/^on/, '').toLowerCase(), value as EventListener);
    else if (key === 'class') element.className = String(value);
    else if (key === 'style') element.style.cssText = String(value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An inline stroke icon from one path. Decorative, so hidden from screen readers. */
export function icon(d: string, width = 16, height = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export const ICONS = {
  arrow: 'M1 8h13M10 4l4 4-4 4',
  swap: 'M3 5h10M10 2l3 3-3 3M13 11H3M6 8l-3 3 3 3',
  file: 'M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13',
  mark: 'M8 2 15 14H1z',
  fit: 'M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11',
  grip: 'M6 3 2 8l4 5M10 3l4 5-4 5',
};
