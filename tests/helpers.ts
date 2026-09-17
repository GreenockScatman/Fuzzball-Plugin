import { vi } from 'vitest';
export function event() { return { addListener: vi.fn(), removeListener: vi.fn() }; }
export function mockChrome() {
  const local: Record<string, unknown> = {}, session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({ get: vi.fn(async () => ({ ...data })), set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }), remove: vi.fn(async (key: string) => { delete data[key]; }), setAccessLevel: vi.fn(async () => {}) });
  const mock = {
    runtime: { id: 'a'.repeat(32), getManifest: () => ({ version: '0.1.0' }), getURL: (path: string) => `chrome-extension://${'a'.repeat(32)}/${path}`, sendMessage: vi.fn(), onMessage: event(), onStartup: event(), onInstalled: event() },
    storage: { local: area(local), session: area(session), sync: { set: vi.fn() } },
    alarms: { create: vi.fn(async () => {}), onAlarm: event() },
    windows: { getLastFocused: vi.fn(async () => ({ id: 45, focused: true, incognito: false })), onFocusChanged: event() },
    tabs: { query: vi.fn(async () => [{ id: 123, windowId: 45, url: 'https://example.com/', incognito: false }]), sendMessage: vi.fn(), create: vi.fn(async () => ({ id: 124 })), onRemoved: event(), onActivated: event() },
    permissions: { contains: vi.fn<(_permissions: chrome.permissions.Permissions) => Promise<boolean>>().mockResolvedValue(true), request: vi.fn(async () => true), remove: vi.fn(async () => true), getAll: vi.fn(async (): Promise<{ origins: string[] }> => ({ origins: ['https://example.com/*'] })), onRemoved: event() },
    scripting: { executeScript: vi.fn(async () => []) },
    webNavigation: { getAllFrames: vi.fn(async () => [{ frameId: 0, parentFrameId: -1, documentId: 'chrome-main', url: 'https://example.com/' }]), onCommitted: event(), onHistoryStateUpdated: event(), onReferenceFragmentUpdated: event() },
  };
  vi.stubGlobal('chrome', mock);
  return { mock, local, session };
}
export function layout() {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const x = Number(this.getAttribute('data-x') ?? 10), y = Number(this.getAttribute('data-y') ?? 10);
    const rect = new DOMRect(x, y, 160, 30);
    return Object.assign([rect], { item: (i: number) => i === 0 ? rect : null });
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return new DOMRect(Number(this.getAttribute('data-x') ?? 0), Number(this.getAttribute('data-y') ?? 0), 800, 600); });
}
export async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
