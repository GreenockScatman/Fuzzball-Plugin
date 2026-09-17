import { MAX_TEXT } from '../shared/constants';
import { isRendered, visibleRect } from './visibility';
export function concise(value: string, max = MAX_TEXT): string { return value.replace(/\s+/gu, ' ').trim().slice(0, max); }
export function visibleText(element: Element): string {
  let text = '', visited = 0;
  function walk(node: Node): void {
    if (++visited > 1500 || text.length >= MAX_TEXT * 2) return;
    if (node.nodeType === Node.TEXT_NODE) { text += ` ${node.textContent ?? ''}`; return; }
    if (!(node instanceof Element) || /^(INPUT|TEXTAREA|SELECT|SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName) || node.hasAttribute('contenteditable') || !isRendered(node)) return;
    if (!visibleRect(node) && getComputedStyle(node).display !== 'contents' && !(node instanceof HTMLSlotElement)) return;
    const children = node instanceof HTMLSlotElement ? node.assignedNodes({ flatten: true }) : node.shadowRoot?.childNodes ?? node.childNodes;
    for (const child of children) walk(child);
  }
  walk(element);
  return concise(text);
}
export function accessibleName(element: Element): string {
  if (element.matches('input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), textarea, select, [contenteditable]')) return '';
  const aria = concise(element.getAttribute('aria-label') ?? '');
  if (aria) return aria;
  const root = element.getRootNode() as Document | ShadowRoot;
  const labelled = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).slice(0, 10).map(id => root.getElementById?.(id)).filter((node): node is HTMLElement => !!node).map(visibleText).join(' ');
  if (concise(labelled)) return concise(labelled);
  if ('labels' in element) {
    const labels = (element as HTMLInputElement).labels;
    const name = labels ? concise(Array.from(labels).map(visibleText).join(' ')) : '';
    if (name) return name;
  }
  const image = element.matches('img, input[type=image]') ? element : Array.from(element.querySelectorAll('img[alt]')).find(node => !!visibleRect(node));
  if (image?.getAttribute('alt')) return concise(image.getAttribute('alt')!);
  if (element instanceof HTMLInputElement && /^(button|submit|reset)$/.test(element.type) && element.value) return concise(element.value);
  return concise(element.getAttribute('title') ?? '') || visibleText(element);
}
