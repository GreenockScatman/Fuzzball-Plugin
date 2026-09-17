import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager, backoff } from '../src/background/connection-manager';
import { mockChrome, flush } from './helpers';
import type { Request, Response } from '../src/protocol/messages';
class Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const ack = { type: 'hello_ack', protocol_version: 1, session_id: 'session1', heartbeat_interval_ms: 20_000 };
const snapshotRequest = { type: 'page_snapshot_request', protocol_version: 1, request_id: 'request1', max_elements: 200 };
let managers: ConnectionManager[] = [];
beforeEach(() => { mockChrome(); vi.useFakeTimers(); vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { managers.forEach(manager => manager.dispose()); managers = []; vi.useRealTimers(); });
function create() {
  const sockets: Socket[] = [];
  const settings = vi.fn(async () => ({ token: 'private-test-token', port: 8765, enabled: true, instanceId: 'profile1' }));
  const route = vi.fn(async (request: Request): Promise<Response> => ({ type: 'error', protocol_version: 1, request_id: request.request_id, error_code: 'no_active_tab', message: 'no_active_tab' }));
  const cancel = vi.fn();
  const manager = new ConnectionManager({ settings, activeTab: async () => ({ tab_id: 123, window_id: 45, window_focused: true }), route, cancel, socket: () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; } });
  managers.push(manager);
  return { manager, sockets, settings, route, cancel };
}
async function connect() { const state = create(); await state.manager.start(); state.sockets[0].open(); state.sockets[0].receive(ack); await flush(); return state; }
describe('authenticated WebSocket lifecycle', () => {
  it('sends the token only in hello with capabilities and profile identity', async () => { const { sockets, manager } = await connect(); const hello = JSON.parse(sockets[0].send.mock.calls[0][0]); expect(hello.type).toBe('hello'); expect(hello.auth_token).toBe('private-test-token'); expect(hello.instance_id).toBe('profile1'); expect(hello.capabilities).toHaveLength(3); expect(manager.ready).toBe(true); });
  it('does not connect without a token', async () => { const { manager, settings, sockets } = create(); settings.mockResolvedValue({ token: '', port: 8765, enabled: true, instanceId: 'profile1' }); await manager.start(); expect(sockets).toHaveLength(0); expect(manager.status.state).toBe('token_required'); });
  it('does not process requests before hello_ack', async () => { const { manager, sockets, route } = create(); await manager.start(); sockets[0].open(); sockets[0].receive(snapshotRequest); await flush(); expect(route).not.toHaveBeenCalled(); expect(sockets[0].send).toHaveBeenCalledOnce(); });
  it('routes requests after authentication', async () => { const { sockets, route } = await connect(); sockets[0].receive(snapshotRequest); await flush(); expect(route).toHaveBeenCalledOnce(); expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0]).request_id).toBe('request1'); });
  it('blocks automatic retries after authentication rejection including worker restart', async () => { const { manager, sockets } = create(); await manager.start(); sockets[0].open(); sockets[0].receive({ type: 'error', protocol_version: 1, error_code: 'not_connected', message: 'Authentication failed' }); await flush(); expect(manager.status.state).toBe('pairing_rejected'); await vi.advanceTimersByTimeAsync(120_000); await manager.alarm('fuzzball-reconnect'); expect(sockets).toHaveLength(1); const restarted = create(); await restarted.manager.start(); expect(restarted.sockets).toHaveLength(0); expect(restarted.manager.status.state).toBe('pairing_rejected'); });
  it('treats policy close as pairing rejected without logging its reason', async () => { const { manager, sockets } = create(); await manager.start(); sockets[0].onclose?.({ code: 1008 }); expect(manager.status.state).toBe('pairing_rejected'); });
  it('reports protocol mismatch and waits for explicit reconnect', async () => { const { manager, sockets } = create(); await manager.start(); sockets[0].open(); sockets[0].receive({ ...ack, protocol_version: 2 }); await flush(); expect(manager.status.state).toBe('protocol_mismatch'); await manager.alarm('fuzzball-reconnect'); expect(sockets).toHaveLength(1); await manager.start(true); expect(sockets).toHaveLength(2); });
  it('sends active-tab heartbeats immediately and every 20 seconds', async () => { const { sockets } = await connect(); await vi.advanceTimersByTimeAsync(20_000); const messages = sockets[0].send.mock.calls.map(call => JSON.parse(call[0])); const beats = messages.filter(m => m.type === 'heartbeat'); expect(beats).toHaveLength(2); expect(beats[0].active_tab).toEqual({ tab_id: 123, window_id: 45, window_focused: true }); expect(beats[0].instance_id).toBeUndefined(); expect(JSON.stringify(beats)).not.toContain('private-test-token'); });
  it('reconnects after missed heartbeat acknowledgements', async () => { const { sockets, manager } = await connect(); await vi.advanceTimersByTimeAsync(60_000); expect(manager.status.state).toBe('waiting'); expect(sockets[0].close).toHaveBeenCalled(); });
  it('stays healthy while acknowledgements arrive', async () => { const { sockets, manager } = await connect(); for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(20_000); sockets[0].receive({ type: 'heartbeat_ack', protocol_version: 1 }); await flush(); } expect(manager.ready).toBe(true); });
  it('reconnects with bounded exponential backoff', async () => { const { manager, sockets } = create(); await manager.start(); sockets[0].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(1001); expect(sockets).toHaveLength(2); expect(backoff(0, 0)).toBe(750); expect(backoff(1, 1)).toBe(2000); expect(backoff(999, 1)).toBe(30_000); });
  it('uses the fallback alarm after worker restart', async () => { const { manager } = create(); await manager.alarm('unrelated'); expect(chrome.alarms.create).not.toHaveBeenCalled(); await manager.alarm('fuzzball-reconnect'); expect(chrome.alarms.create).toHaveBeenCalledWith('fuzzball-reconnect', { periodInMinutes: .5 }); });
  it('drops results from a disconnected session and never replays its request', async () => { const { sockets, route, manager, cancel } = await connect(); let resolve!: (response: Response) => void; route.mockImplementation(() => new Promise(done => { resolve = done; })); sockets[0].receive(snapshotRequest); await flush(); sockets[0].onclose?.({ code: 1006 }); await manager.start(true); resolve({ type: 'error', protocol_version: 1, request_id: 'request1', error_code: 'timeout', message: 'timeout' }); await flush(); expect(sockets[1].send).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalled(); expect(route).toHaveBeenCalledOnce(); });
  it('keeps the socket open on pause and sends the supported v1 disabled envelope', async () => { const { sockets, manager, cancel } = await connect(); manager.setEnabled(false); expect(sockets[0].close).not.toHaveBeenCalled(); expect(manager.ready).toBe(true); expect(JSON.parse(sockets[0].send.mock.calls.at(-1)![0])).toEqual({ type: 'error', protocol_version: 1, error_code: 'extension_disabled', message: 'Web control paused.' }); expect(cancel).toHaveBeenCalled(); });
  it('documents the server status limitation without sending an unsupported message', async () => { const { sockets, manager } = await connect(); manager.setEnabled(false); manager.setEnabled(true); await flush(); expect(manager.ready).toBe(true); expect(manager.status.diagnostic).toContain('cannot update its enabled flag'); expect(sockets[0].send.mock.calls.map(call => JSON.parse(call[0]).type)).not.toContain('status'); });
  it('replaces obsolete sockets immediately on pairing changes', async () => { const { sockets, manager } = await connect(); const oldHandler = sockets[0].onclose; await manager.start(true); oldHandler?.({ code: 1006 }); expect(sockets[0].close).toHaveBeenCalledOnce(); expect(sockets).toHaveLength(2); expect(manager.status.state).toBe('connecting'); });
  it('times out a stalled handshake', async () => { const { manager, sockets } = create(); await manager.start(); await vi.advanceTimersByTimeAsync(5000); expect(manager.status.state).toBe('waiting'); expect(sockets[0].close).toHaveBeenCalled(); });
  it('handles invalid JSON and oversized frames without logging payloads', async () => { const { sockets, manager } = await connect(); sockets[0].onmessage?.({ data: 'secret invalid payload' }); await flush(); expect(manager.ready).toBe(false); expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('secret'); });
});
