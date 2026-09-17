import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusedTab, hasPermission, inspectSite } from '../src/shared/permissions';
import { connectionLabel, mountPopup, renderStatus } from '../src/popup/popup';
import { mockChrome, flush } from './helpers';
let mock: ReturnType<typeof mockChrome>['mock'];
describe('page eligibility and focus', () => {
  beforeEach(() => { mock = mockChrome().mock; });
  it.each(['chrome://settings', 'chrome-extension://aaa/page', 'view-source:https://example.com', 'about:blank', 'file:///C:/test', 'data:text/plain,test', 'https://chromewebstore.google.com/detail/test', 'https://chrome.google.com/webstore/detail/test'])('rejects restricted page %s', url => expect(inspectSite(url).supported).toBe(false));
  it('rejects incognito', () => expect(inspectSite('https://example.com', true).reason).toContain('Incognito'));
  it('safely derives origin and port-independent Chrome permission pattern', () => expect(inspectSite('https://example.com:8443/path?secret=1')).toMatchObject({ origin: 'https://example.com:8443', pattern: 'https://example.com/*', domain: 'example.com:8443' }));
  it('checks permission only for eligible sites', async () => { expect(await hasPermission('https://example.com')).toBe(true); expect(await hasPermission('chrome://settings')).toBe(false); expect(chrome.permissions.contains).toHaveBeenCalledTimes(1); });
  it('selects the active tab in the last focused normal window', async () => { expect((await focusedTab()).id).toBe(123); expect(chrome.windows.getLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] }); expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, windowId: 45 }); });
  it('rejects an unfocused browser window', async () => { vi.mocked(mock.windows.getLastFocused).mockResolvedValue({ id: 45, focused: false, incognito: false }); await expect(focusedTab()).rejects.toThrow('no_active_tab'); });
  it('returns permission_required before injection', async () => { vi.mocked(mock.permissions.contains).mockResolvedValue(false); await expect(focusedTab()).rejects.toThrow('permission_required'); });
});
describe('popup privacy and explicit grants', () => {
  const status = { state: 'connected' as const, diagnostic: '', enabled: true, port: 8765, hasToken: true, protocolVersion: 1, extensionVersion: '0.1.0' };
  beforeEach(() => { mock = mockChrome().mock; document.documentElement.innerHTML = readFileSync('src/popup/popup.html', 'utf8'); vi.mocked(mock.runtime.sendMessage).mockResolvedValue(status); });
  it('renders connection states with a masked saved-token placeholder', () => { renderStatus(status); expect((document.getElementById('token') as HTMLInputElement).value).toBe(''); expect((document.getElementById('token') as HTMLInputElement).placeholder).toContain('••••'); expect(connectionLabel('pairing_rejected')).toBe('Pairing rejected'); expect(connectionLabel('protocol_mismatch')).toBe('Protocol mismatch'); });
  it('renders untrusted diagnostics as text', () => { renderStatus({ ...status, diagnostic: '<img src=x onerror=alert(1)>' }); expect(document.querySelector('#diagnostic img')).toBeNull(); expect(document.getElementById('diagnostic')!.textContent).toContain('<img'); });
  it('requests site permission synchronously in the button click handler', async () => { vi.mocked(mock.permissions.contains).mockResolvedValue(false); const dispose = mountPopup(); await flush(); expect(chrome.permissions.request).not.toHaveBeenCalled(); (document.getElementById('allow') as HTMLButtonElement).click(); expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] }); dispose(); });
  it('revokes a site grant', async () => { const dispose = mountPopup(); await flush(); (document.getElementById('remove') as HTMLButtonElement).click(); expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ['https://example.com/*'] }); dispose(); });
  it('requires warning acknowledgement before requesting all websites', async () => { const dispose = mountPopup(); await flush(); const allow = document.getElementById('allow-all') as HTMLButtonElement; allow.click(); expect(chrome.permissions.request).not.toHaveBeenCalled(); const consent = document.getElementById('all-consent') as HTMLInputElement; consent.checked = true; consent.dispatchEvent(new Event('change')); allow.click(); expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://*/*', 'https://*/*'] }); expect(document.querySelector('.warning')!.textContent).toContain('private pages'); dispose(); });
  it('does not falsely promise per-site revocation under a broad grant', async () => { vi.mocked(mock.permissions.getAll).mockResolvedValue({ origins: ['https://*/*'] }); const dispose = mountPopup(); await flush(); expect((document.getElementById('remove') as HTMLButtonElement).disabled).toBe(true); dispose(); });
  it('clears the token field after saving and never requests sync storage', async () => { const dispose = mountPopup(); await flush(); (document.getElementById('token') as HTMLInputElement).value = 'example-test-token'; document.getElementById('pairing')!.dispatchEvent(new Event('submit', { cancelable: true })); expect((document.getElementById('token') as HTMLInputElement).value).toBe(''); expect(chrome.storage.sync.set).not.toHaveBeenCalled(); dispose(); });
});
