import { concise, visibleText } from '../content/accessible-name';
import { closestComposed, isInteractable } from '../content/visibility';
import type { Metadata } from './generic';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const VIDEO_CARD = 'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-grid-media, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model, .yt-lockup-view-model, .yt-lockup-view-model-wiz';
const TITLE_CONTENT = '#video-title, #video-title-link, .yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, h3, [role=heading]';
const VIDEO_TITLE = 'a#video-title, a#video-title-link, a.yt-lockup-metadata-view-model__title, a.yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title a, .yt-lockup-metadata-view-model-wiz__title a, h3 a[href], [role=heading] a[href], a[role=heading]';
const EXCLUDED = 'ytd-masthead, ytd-guide-renderer, ytd-mini-guide-renderer, nav, header, footer, [role=navigation], [role=banner], ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, [is-ad], [data-ad-slot], [data-sponsored]';

function videoDestination(element: HTMLAnchorElement): URL | null {
  try {
    const url = new URL(element.href);
    if (!HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || element.hasAttribute('download')) return null;
    return url.pathname === '/watch' && !!url.searchParams.get('v') || /^\/shorts\/[^/]+$/.test(url.pathname) ? url : null;
  } catch { return null; }
}

function samePlayback(first: URL, second: URL): boolean {
  if (first.origin !== second.origin || first.pathname !== second.pathname || first.hash !== second.hash) return false;
  // Ignore only known tracking parameters; timestamps, playlists and unknown
  // parameters can change activation and must remain distinct.
  const normalized = (url: URL) => {
    const params = new URLSearchParams(url.search);
    for (const key of ['pp', 'si', 'feature']) params.delete(key);
    params.sort();
    return params.toString();
  };
  return normalized(first) === normalized(second);
}

export function youtube(element: Element, page: URL): Partial<Metadata> | null {
  if (!HOSTS.has(page.hostname) || !(element instanceof HTMLAnchorElement)) return null;
  if (closestComposed(element, EXCLUDED)) return { scope: 'any' };
  const destination = videoDestination(element);
  const card = closestComposed(element, VIDEO_CARD);
  if (!destination) return card || new URL(element.href).pathname === '/results' ? { scope: 'any' } : null;
  const isTitle = element.matches(VIDEO_TITLE);
  if (!card && !isTitle) return null;

  if (card && !isTitle) {
    const titles = [...card.querySelectorAll<HTMLAnchorElement>(VIDEO_TITLE), ...card.shadowRoot?.querySelectorAll<HTMLAnchorElement>(VIDEO_TITLE) ?? []];
    const title = titles.find(link => {
      const target = videoDestination(link);
      return closestComposed(link, VIDEO_CARD) === card && target && samePlayback(destination, target) && !!visibleText(link) && isInteractable(link);
    });
    if (title) return { skip: true };
  }

  // Fuzzball v1 filters main_content strictly, but also accepts search_result
  // semantics for search_results requests. This serves both selectors without
  // duplicating a video candidate or widening scope on unrelated links.
  const metadata: Partial<Metadata> = { role: 'link', scope: 'main_content', semantic_kind: page.pathname === '/results' ? 'search_result' : 'video' };
  if (isTitle) {
    const name = visibleText(element) || concise(element.getAttribute('title') ?? '');
    if (name) metadata.name = name;
  } else if (card) {
    // Some cards expose only a clickable image; its heading is a sibling.
    const headings = [...card.querySelectorAll(TITLE_CONTENT), ...card.shadowRoot?.querySelectorAll(TITLE_CONTENT) ?? []];
    const heading = headings.find(node => {
      if (closestComposed(node, VIDEO_CARD) !== card || !visibleText(node)) return false;
      const link = node instanceof HTMLAnchorElement ? node : node.querySelector<HTMLAnchorElement>('a[href]');
      const target = link && videoDestination(link);
      return !link || !!target && samePlayback(destination, target);
    });
    if (heading) metadata.name = visibleText(heading);
  }
  return metadata;
}
