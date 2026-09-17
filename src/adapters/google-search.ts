import { visibleText } from '../content/accessible-name';
import { closestComposed, isRendered } from '../content/visibility';
import type { Metadata } from './generic';
export function isGoogleSearch(url: URL): boolean {
  return /^(www\.)?google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(url.hostname) && url.pathname === '/search';
}
export function googleSearch(element: Element, url: URL): Partial<Metadata> | null {
  if (!isGoogleSearch(url) || !element.matches('a[href]')) return null;
  const heading = element.querySelector('h3');
  if (!heading || !isRendered(heading) || !closestComposed(element, '#search, #rso')) return null;
  if (closestComposed(element, '#tads, #bottomads, [data-text-ad], [data-ad-client], [data-ad-slot], [data-sponsored], [aria-label="Ads"], nav, header, [role=navigation]')) return null;
  const block = element.closest('.MjjYud, .g, [data-hveid]');
  if (block && Array.from(block.querySelectorAll('span, [aria-label]')).some(node => isRendered(node) && /^(Sponsored|Ad|Ads)$/i.test(visibleText(node)))) return null;
  const name = visibleText(heading);
  return name ? { name, semantic_kind: 'search_result', scope: 'search_results', role: 'link' } : null;
}
