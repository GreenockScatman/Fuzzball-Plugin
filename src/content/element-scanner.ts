import { MAX_CANDIDATES } from '../shared/constants';
import type { Candidate } from '../protocol/messages';
import { generic, riskKind } from '../adapters/generic';
import { googleSearch } from '../adapters/google-search';
import { youtubeMusic } from '../adapters/youtube-music';
import { youtube } from '../adapters/youtube';
import { accessibleName, visibleText } from './accessible-name';
import { isInteractable, actionableElement, ACTIONABLE_SELECTOR, closestComposed } from './visibility';
import { CandidateStore } from './candidate-store';
export function* elements(root: Document | ShadowRoot | Element): Generator<Element> {
  for (const child of root.children) {
    yield child;
    if (child.shadowRoot) yield* elements(child.shadowRoot);
    yield* elements(child);
  }
}
export function scan(store: CandidateStore, max: number): Candidate[] {
  store.begin();
  const limit = Math.min(MAX_CANDIDATES, Math.max(1, max));
  const found: { element: HTMLElement; candidate: Candidate; priority: number; order: number }[] = [];
  const seen = new Set<HTMLElement>();
  const url = new URL(location.href);
  let visited = 0;
  const sources: HTMLElement[] = [];
  for (const element of elements(document)) {
    if (++visited > 20_000) break;
    if (element instanceof HTMLElement && element.matches(ACTIONABLE_SELECTOR)) sources.push(element);
  }
  // Persistent YouTube Music navigation remains useful even when a large
  // expanded player precedes it in DOM order.
  sources.sort((a, b) => Number(!!closestComposed(b, 'ytmusic-guide-entry-renderer, nav, [role=navigation], #guide')) - Number(!!closestComposed(a, 'ytmusic-guide-entry-renderer, nav, [role=navigation], #guide')));
  for (const element of sources) {
    if (found.length >= MAX_CANDIDATES * 3) break;
    if (element.matches('textarea, select, [contenteditable], input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image])')) continue;
    const action = actionableElement(element);
    if (!action || seen.has(action) || !isInteractable(action)) continue;
    const name = accessibleName(action) || accessibleName(element), text = visibleText(action) || visibleText(element);
    if (!name && !text) continue;
    const parentAction = action.parentElement ? actionableElement(action.parentElement) : null;
    if (parentAction && parentAction !== action && accessibleName(parentAction) === name
        && (!(action instanceof HTMLAnchorElement) || action.href === (parentAction as HTMLAnchorElement).href)) continue;
    const metadata = { ...generic(action), ...googleSearch(action, url), ...youtubeMusic(action, url, name), ...youtube(action, url) };
    if (metadata.skip) continue;
    metadata.semantic_kind = riskKind(metadata.name ?? name, action) ?? metadata.semantic_kind;
    seen.add(action);
    found.push({ element: action, priority: metadata.priority ?? 0, order: found.length, candidate: { id: '', role: metadata.role, name: metadata.name ?? name, text, semantic_kind: metadata.semantic_kind, scope: metadata.scope, ordinal: 1, visible: true, enabled: true } });
  }
  // Bound the returned set by semantic priority and primary content, then restore DOM order.
  const ranked = [...found].sort((a, b) => b.priority - a.priority || Number(b.candidate.scope !== 'any') - Number(a.candidate.scope !== 'any') || a.order - b.order);
  const chosen = new Set(ranked.slice(0, limit));
  const ordinals = new Map<string, number>();
  return found.filter(item => chosen.has(item)).map(({ element, candidate }) => {
    const key = `${candidate.role}:${candidate.scope}`;
    const ordinal = (ordinals.get(key) ?? 0) + 1; ordinals.set(key, ordinal);
    return { ...candidate, ordinal, id: store.add(element, candidate.name) };
  });
}
