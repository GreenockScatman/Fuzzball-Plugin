import { closestComposed } from '../content/visibility';
import { visibleText } from '../content/accessible-name';
import type { Metadata } from './generic';
export function youtubeMusic(element: Element, url: URL, name: string): Partial<Metadata> | null {
  if (url.hostname !== 'music.youtube.com') return null;
  const player = closestComposed(element, 'ytmusic-player-bar');
  if (player && /\b(play|pause|next|previous|mute|shuffle|repeat)\b/i.test(name)) return { semantic_kind: 'media_control', scope: 'any' };
  const item = closestComposed(element, 'ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer');
  if (item && /^(play|pause)(\b|$)/i.test(name) && !element.matches('a[href]')) return { semantic_kind: 'media_control', scope: 'main_content' };
  if (!(element instanceof HTMLAnchorElement)) return null;
  let destination: URL;
  try { destination = new URL(element.href); } catch { return null; }
  if (destination.hostname !== url.hostname) return null;
  const context = item ? visibleText(item) : '';
  if (destination.pathname === '/playlist' && destination.searchParams.has('list')) {
    const persistent = closestComposed(element, 'ytmusic-guide-entry-renderer, ytmusic-guide-section-renderer, nav, [role=navigation], #guide, #guide-wrapper');
    return { semantic_kind: 'playlist', scope: 'main_content', priority: persistent ? 100 : 20 };
  }
  if (destination.pathname === '/watch' && destination.searchParams.has('v')) return { semantic_kind: 'song', scope: 'main_content' };
  if (destination.pathname.startsWith('/browse/')) {
    if (/\balbum\b/i.test(context)) return { semantic_kind: 'album', scope: 'main_content' };
    if (/\bartist\b/i.test(context)) return { semantic_kind: 'artist', scope: 'main_content' };
  }
  if (item && url.pathname === '/search') return { semantic_kind: 'search_result', scope: 'main_content' };
  return null;
}
