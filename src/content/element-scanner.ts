import { MAX_CANDIDATES } from '../shared/constants';
import type { Candidate } from '../protocol/messages';
import { generic, riskKind } from '../adapters/generic';
import { googleSearch } from '../adapters/google-search';
import { youtubeMusic } from '../adapters/youtube-music';
import { youtube } from '../adapters/youtube';
import { accessibleName, visibleText } from './accessible-name';
import { isInteractable, actionableElement, ACTIONABLE_SELECTOR, closestComposed, parentElement } from './visibility';
import { CandidateStore } from './candidate-store';
export function* elements(root: Document | ShadowRoot | Element): Generator<Element> {
  for (const child of root.children) {
    yield child;
    if (child.shadowRoot) yield* elements(child.shadowRoot);
    yield* elements(child);
  }
}
function actionableSources(): HTMLElement[] {
  const sources: HTMLElement[] = [];
  const roots: (Document | ShadowRoot)[] = [document];
  let hostsVisited = 0;
  for (let index = 0; index < roots.length && index < 200; index++) {
    const root = roots[index];
    // Query native controls first: decorative/hidden nodes must not consume
    // the control budget before the page's actual links are reached.
    for (const node of root.querySelectorAll(ACTIONABLE_SELECTOR)) {
      if (sources.length >= 20_000) break;
      if (node instanceof HTMLElement) sources.push(node);
    }
    for (const node of root.querySelectorAll('*')) {
      if (++hostsVisited > 50_000) break;
      if (node.shadowRoot) roots.push(node.shadowRoot);
    }
  }
  const paths = new Map<HTMLElement, Element[]>();
  for (const source of sources) {
    const path: Element[] = [];
    for (let node: Element | null = source; node; node = parentElement(node)) path.unshift(node);
    paths.set(source, path);
  }
  return sources.sort((a, b) => {
    if (a === b) return 0;
    const first = paths.get(a)!, second = paths.get(b)!;
    let index = 0;
    while (first[index] && first[index] === second[index]) index++;
    if (!first[index]) return -1;
    if (!second[index]) return 1;
    if (first[index].getRootNode() !== second[index].getRootNode()) return first[index].getRootNode() instanceof ShadowRoot ? -1 : 1;
    return first[index].compareDocumentPosition(second[index]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}
export function scan(store: CandidateStore, max: number): Candidate[] {
  store.begin();
  const limit = Math.min(MAX_CANDIDATES, Math.max(1, max));
  const found: { element: HTMLElement; candidate: Candidate; priority: number; order: number }[] = [];
  const seen = new Set<HTMLElement>();
  const url = new URL(location.href);
  const sources = actionableSources();
  // Persistent YouTube Music navigation remains useful even when a large
  // expanded player precedes it in DOM order.
  sources.sort((a, b) => Number(!!closestComposed(b, 'ytmusic-guide-entry-renderer, nav, [role=navigation], #guide')) - Number(!!closestComposed(a, 'ytmusic-guide-entry-renderer, nav, [role=navigation], #guide')));
  for (const element of sources) {
    if (found.length >= MAX_CANDIDATES * 3) break;
    if (element.matches('textarea, select, [contenteditable], input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image])')) continue;
    const action = actionableElement(element);
    if (!action || seen.has(action) || !isInteractable(action)) continue;
    const name = accessibleName(action) || accessibleName(element), text = visibleText(action) || visibleText(element);
    const parentAction = action.parentElement ? actionableElement(action.parentElement) : null;
    if (parentAction && parentAction !== action && accessibleName(parentAction) === name
        && (!(action instanceof HTMLAnchorElement) || action.href === (parentAction as HTMLAnchorElement).href)) continue;
    const video = youtube(action, url);
    const metadata = { ...generic(action), ...googleSearch(action, url), ...youtubeMusic(action, url, name), ...video };
    if (metadata.skip) continue;
    if (!(metadata.name ?? name) && !text) continue;
    // A verified YouTube watch link remains a video even if its title says
    // "remove" or "buy". The desktop still checks risky label text itself.
    if (!video || !['video', 'search_result'].includes(video.semantic_kind ?? '')) metadata.semantic_kind = riskKind(metadata.name ?? name, action) ?? metadata.semantic_kind;
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
