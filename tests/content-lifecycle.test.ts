import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layout, mockChrome, flush } from './helpers';
import type { ContentReply, FrameSnapshot } from '../src/protocol/messages';
let mock: ReturnType<typeof mockChrome>['mock'];
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean | undefined;
let listener: Listener;
const context = globalThis as typeof globalThis & { __fuzzballInstalled?: boolean };
beforeEach(async () => {
  delete context.__fuzzballInstalled; vi.resetModules(); layout(); mock = mockChrome().mock;
  document.body.innerHTML = '<button type="button">Play</button><a href="https://example.com/">Link</a>';
  mock.runtime.sendMessage.mockResolvedValue({ ok: true });
  await import('../src/content/content-script');
  listener = mock.runtime.onMessage.addListener.mock.calls[0][0];
});
afterEach(async () => { await message({ command: 'invalidate' }); delete context.__fuzzballInstalled; vi.useRealTimers(); });
function message<T>(data: Record<string, unknown>): Promise<ContentReply<T>> { return new Promise(resolve => listener({ channel: 'fuzzball-content', ...data }, { id: mock.runtime.id }, value => resolve(value as ContentReply<T>))); }
async function snapshot() { const reply = await message<FrameSnapshot>({ command: 'snapshot', max: 200 }); if (!reply.ok) throw new Error(reply.error_code); return reply.value; }
function activation(value: FrameSnapshot) { return { command: 'activate', documentId: value.document_id, action: { kind: 'click', element_id: value.elements[0].id, open_in_new_tab: false }, authorization: 'permit', deadline: Date.now() + 3500 }; }
it('installs only one listener after repeated injection', async () => { vi.resetModules(); await import('../src/content/content-script'); expect(mock.runtime.onMessage.addListener).toHaveBeenCalledOnce(); });
it('fresh snapshots produce new opaque IDs without exposing DOM paths', async () => { const first = await snapshot(), second = await snapshot(); expect(first.elements[0].id).not.toBe(second.elements[0].id); expect(first.document_id).toBe(second.document_id); expect(JSON.stringify(first)).not.toMatch(/selector|xpath|auth_token/); });
it('requires background authorization before dispatching activation', async () => { const value = await snapshot(); const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click); const result = await message(activation(value)); expect(result.ok).toBe(true); expect(mock.runtime.sendMessage).toHaveBeenCalledWith({ channel: 'fuzzball-authorize', authorization: 'permit' }); expect(click).toHaveBeenCalledOnce(); });
it('does not click when the background rejects authorization', async () => { const value = await snapshot(); mock.runtime.sendMessage.mockResolvedValue({ ok: false, code: 'extension_disabled' }); const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click); expect(await message(activation(value))).toEqual({ ok: false, error_code: 'extension_disabled' }); expect(click).not.toHaveBeenCalled(); });
it('rechecks document identity after asynchronous authorization', async () => { const value = await snapshot(); let resolve!: (value: unknown) => void; mock.runtime.sendMessage.mockImplementation(() => new Promise(done => { resolve = done; })); const pending = message(activation(value)); await flush(); await message({ command: 'invalidate' }); resolve({ ok: true }); expect(await pending).toEqual({ ok: false, error_code: 'stale_document' }); });
it('rejects activation that arrives past its deadline', async () => { const value = await snapshot(); expect(await message({ ...activation(value), deadline: Date.now() - 1 })).toEqual({ ok: false, error_code: 'timeout' }); });
it('never treats arbitrary commands or selectors as actions', async () => { expect(await message({ command: 'eval', script: 'purchase()' })).toEqual({ ok: false, error_code: 'unsupported_capability' }); expect(await message({ ...activation(await snapshot()), action: { selector: 'button' } })).toEqual({ ok: false, error_code: 'malformed_response' }); });
it('ignores senders outside this extension', () => { const respond = vi.fn(); expect(listener({ channel: 'fuzzball-content', command: 'snapshot', max: 1 }, { id: 'foreign' }, respond)).toBeUndefined(); expect(respond).not.toHaveBeenCalled(); });
it('rejects a recycled control whose accessible name changed', async () => { const value = await snapshot(); document.querySelector('button')!.textContent = 'Purchase'; expect(await message(activation(value))).toEqual({ ok: false, error_code: 'element_not_interactable' }); });
