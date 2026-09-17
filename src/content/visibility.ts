export function parentElement(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}
export function closestComposed(element: Element, selector: string): Element | null {
  for (let current: Element | null = element; current; current = parentElement(current)) if (current.matches(selector)) return current;
  return null;
}
export const ACTIONABLE_SELECTOR = 'a[href], button, summary, input[type=button], input[type=submit], input[type=reset], input[type=image], [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=radio], [role=switch], [tabindex][aria-haspopup]';
export function actionableElement(element: Element): HTMLElement | null {
  const resolved = closestComposed(element, ACTIONABLE_SELECTOR);
  return resolved instanceof HTMLElement ? resolved : null;
}
export function isRendered(element: Element): boolean {
  if (!element.isConnected) return false;
  for (let current: Element | null = element; current; current = parentElement(current)) {
    const style = getComputedStyle(current);
    if (current.hasAttribute('hidden') || current.hasAttribute('inert') || current.getAttribute('aria-hidden') === 'true' || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0' || style.contentVisibility === 'hidden') return false;
    if (current instanceof HTMLDetailsElement && !current.open && !current.querySelector('summary')?.contains(element)) return false;
  }
  return true;
}
export function visibleRect(element: Element): DOMRect | null {
  if (!isRendered(element)) return null;
  for (const rect of element.getClientRects()) {
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor = parentElement(element); ancestor; ancestor = parentElement(ancestor)) {
      const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
      if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
    if (right - left >= 1 && bottom - top >= 1) return new DOMRect(left, top, right - left, bottom - top);
  }
  return null;
}
export function isEnabled(element: Element): boolean {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.getAttribute('aria-disabled') === 'true' || current.matches(':disabled') || getComputedStyle(current).pointerEvents === 'none') return false;
  }
  return true;
}
export function isInteractable(element: Element): boolean {
  const rect = visibleRect(element);
  if (!rect || !isEnabled(element)) return false;
  // Hit testing catches overlays without synthesizing pointer input.
  const points = [[.5, .5], [.15, .15], [.85, .85]];
  return points.some(([x, y]) => {
    let root: Document | ShadowRoot = element.ownerDocument;
    if (!root.elementFromPoint) return true; // DOM fixtures have no layout engine.
    let hit = root.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y);
    const seen = new Set<Element>();
    while (hit?.shadowRoot?.elementFromPoint && !seen.has(hit)) {
      seen.add(hit); root = hit.shadowRoot;
      const deeper = root.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y);
      if (!deeper || deeper === hit) break;
      hit = deeper;
    }
    for (let node = hit; node; node = parentElement(node)) if (node === element) return true;
    return false;
  });
}
