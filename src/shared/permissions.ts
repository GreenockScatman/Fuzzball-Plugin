import { ControlError } from '../protocol/errors';
export interface Site { supported: boolean; origin?: string; pattern?: string; domain: string; reason: string }
export function inspectSite(raw?: string, incognito = false): Site {
  const unavailable = (reason: string): Site => ({ supported: false, domain: '', reason });
  if (incognito) return unavailable('Incognito tabs cannot be controlled.');
  try {
    const url = new URL(raw ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) return unavailable('This page cannot be controlled: use an HTTP or HTTPS website.');
    if (url.hostname === 'chromewebstore.google.com' || url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) return unavailable('Chrome protects its Web Store from extensions.');
    // Chrome match patterns apply across ports; explain this in the popup/docs.
    return { supported: true, origin: url.origin, pattern: `${url.protocol}//${url.hostname}/*`, domain: url.host, reason: '' };
  } catch { return unavailable('This page has no supported web address.'); }
}
export async function hasPermission(url: string): Promise<boolean> {
  const site = inspectSite(url);
  return site.supported && await chrome.permissions.contains({ origins: [site.pattern!] });
}
export async function focusedTab(checkPermission = true): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  let window: chrome.windows.Window;
  try { window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch { throw new ControlError('no_active_tab'); }
  if (!window.focused || window.id === undefined || window.incognito) throw new ControlError(window.incognito ? 'restricted_page' : 'no_active_tab');
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab || tab.id === undefined || !tab.url) throw new ControlError('no_active_tab');
  if (!inspectSite(tab.url, tab.incognito).supported) throw new ControlError('restricted_page');
  if (checkPermission && !await hasPermission(tab.url)) throw new ControlError('permission_required');
  return tab as chrome.tabs.Tab & { id: number; url: string };
}
export function safeLink(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return null;
    return url.href;
  } catch { return null; }
}
