import { CAPABILITIES, HEARTBEAT_MS, HEARTBEAT_TIMEOUT_MS, PROTOCOL_VERSION, RECONNECT_ALARM } from '../shared/constants';
import { endpoint, type Settings } from '../shared/settings';
import { decode, encode, record } from '../protocol/validation';
import { errorCode } from '../protocol/errors';
import type { ActiveTab, Request, Response, Outgoing } from '../protocol/messages';
import { log, setLogSecrets } from '../shared/logging';
export type ConnectionState = 'waiting' | 'connecting' | 'connected' | 'token_required' | 'pairing_rejected' | 'protocol_mismatch';
export interface ConnectionStatus { state: ConnectionState; diagnostic: string }
interface Dependencies {
  settings: () => Promise<Settings>;
  activeTab: () => Promise<ActiveTab | null>;
  route: (request: Request) => Promise<Response>;
  cancel: () => void;
  socket?: (url: string) => WebSocket;
}
export function backoff(attempt: number, random = Math.random()): number { return Math.floor(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (.75 + random * .25)); }
export class ConnectionManager {
  status: ConnectionStatus = { state: 'waiting', diagnostic: '' };
  settings?: Settings;
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private handshake?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private attempt = 0;
  private nextAttempt = 0;
  private lastAck = 0;
  private starting = false;
  private blocked = false;
  private pendingRestart = false;
  constructor(private readonly deps: Dependencies) {}
  get ready(): boolean { return this.status.state === 'connected' && this.socket?.readyState === 1; }
  private state(state: ConnectionState, diagnostic = ''): void { this.status = { state, diagnostic }; log({ state }); }
  async start(force = false): Promise<void> {
    if (this.starting) { if (force) this.pendingRestart = true; return; }
    if (!force && (this.blocked || this.socket || Date.now() < this.nextAttempt)) return;
    this.starting = true;
    try {
      if (force) { this.stopSocket(); this.blocked = false; this.attempt = 0; this.nextAttempt = 0; await chrome.storage.session.remove('connectionRetry'); }
      await chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: .5 });
      this.settings = await this.deps.settings();
      setLogSecrets([this.settings.token]);
      if (!this.settings.token) { this.state('token_required'); return; }
      if (!force) {
        const stored = (await chrome.storage.session.get('connectionRetry')).connectionRetry;
        const saved = record(stored) ? stored : {};
        if (saved?.blocked === 'pairing_rejected' || saved?.blocked === 'protocol_mismatch') { this.blocked = true; this.state(saved.blocked); return; }
        if (typeof saved?.nextAttempt === 'number' && saved.nextAttempt > Date.now()) { this.nextAttempt = saved.nextAttempt; this.retry = setTimeout(() => { void this.start(); }, this.nextAttempt - Date.now()); return; }
        if (typeof saved?.attempt === 'number') this.attempt = saved.attempt;
      }
      clearTimeout(this.retry);
      const epoch = ++this.epoch;
      const ws = (this.deps.socket ?? (url => new WebSocket(url)))(endpoint(this.settings.port));
      this.socket = ws; this.state('connecting');
      const current = () => this.socket === ws && this.epoch === epoch;
      this.handshake = setTimeout(() => { if (current()) this.lost(); }, 5000);
      ws.onopen = () => {
        if (!current()) return;
        this.send({ type: 'hello', protocol_version: PROTOCOL_VERSION, auth_token: this.settings!.token, extension_version: chrome.runtime.getManifest().version, instance_id: this.settings!.instanceId, browser: { name: 'chrome', version: /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'unknown' }, enabled: this.settings!.enabled, capabilities: CAPABILITIES });
      };
      ws.onmessage = event => { if (current()) void this.receive(event.data, epoch).catch(() => this.lost()); };
      ws.onclose = event => {
        if (!current()) return;
        if (event.code === 1008) this.block('pairing_rejected'); else this.lost();
      };
      ws.onerror = () => { if (current()) this.lost(); };
    } catch { this.lost(); }
    finally { this.starting = false; if (this.pendingRestart) { this.pendingRestart = false; void this.start(true); } }
  }
  private send(message: Outgoing): void { if (this.socket?.readyState === 1) this.socket.send(encode(message)); }
  private async receive(raw: unknown, epoch: number): Promise<void> {
    let message;
    try { message = decode(raw); }
    catch (error) {
      const code = errorCode(error);
      if (code === 'protocol_mismatch') this.block('protocol_mismatch');
      else if (this.ready) { this.send({ type: 'error', protocol_version: PROTOCOL_VERSION, error_code: code, message: code }); this.lost(); }
      else this.lost();
      return;
    }
    if (message.type === 'error') {
      if (message.error_code === 'protocol_mismatch') { this.block('protocol_mismatch'); return; }
      if (!this.ready && message.error_code === 'not_connected') { this.block('pairing_rejected'); return; }
      this.status.diagnostic = message.error_code;
      return;
    }
    if (message.type === 'hello_ack') {
      if (this.ready) { this.lost(); return; }
      clearTimeout(this.handshake); this.attempt = 0; this.lastAck = Date.now(); this.state('connected');
      await chrome.storage.session.remove('connectionRetry');
      if (epoch !== this.epoch || !this.ready) return;
      this.heartbeat = setInterval(() => { void this.pulse().catch(() => this.lost()); }, Math.min(message.heartbeat_interval_ms, HEARTBEAT_MS));
      await this.pulse(); return;
    }
    if (!this.ready) return;
    if (message.type === 'heartbeat_ack') { this.lastAck = Date.now(); return; }
    const response = await this.deps.route(message);
    if (this.epoch !== epoch || !this.ready) return;
    this.send(response);
    log({ request_id: message.request_id, ...(response.type === 'page_snapshot' ? { candidate_count: response.elements.length } : { error_code: response.error_code, ok: response.type === 'action_result' && response.ok }) });
  }
  async pulse(): Promise<void> {
    if (!this.ready) return;
    if (Date.now() - this.lastAck >= HEARTBEAT_TIMEOUT_MS) { this.lost(); return; }
    const epoch = this.epoch;
    const active_tab = await this.deps.activeTab();
    if (epoch === this.epoch && this.ready) this.send({ type: 'heartbeat', protocol_version: PROTOCOL_VERSION, active_tab });
  }
  setEnabled(enabled: boolean): void {
    if (this.settings) this.settings.enabled = enabled;
    // The authoritative v1 rejects unknown message types, including "status".
    // Report a pause through its valid error envelope; the desktop currently
    // ignores unsolicited errors when updating its cached session.enabled flag.
    if (this.ready && !enabled) this.send({ type: 'error', protocol_version: PROTOCOL_VERSION, error_code: 'extension_disabled', message: 'Web control paused.' });
    this.status.diagnostic = 'Fuzzball v1 cannot update its enabled flag while connected. Reconnect to synchronize it.';
    if (!enabled) this.deps.cancel();
    else void this.pulse().catch(() => this.lost());
  }
  async alarm(name: string): Promise<void> { if (name === RECONNECT_ALARM) await this.start(); }
  private stopSocket(): void {
    ++this.epoch; clearTimeout(this.retry); clearTimeout(this.handshake); clearInterval(this.heartbeat);
    const ws = this.socket; this.socket = undefined;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); }
    this.deps.cancel();
  }
  private block(state: 'pairing_rejected' | 'protocol_mismatch'): void { this.stopSocket(); this.blocked = true; this.state(state); void chrome.storage.session.set({ connectionRetry: { blocked: state } }); }
  private lost(): void {
    this.stopSocket(); this.state('waiting');
    const delay = backoff(this.attempt++); this.nextAttempt = Date.now() + delay;
    void chrome.storage.session.set({ connectionRetry: { nextAttempt: this.nextAttempt, attempt: this.attempt } });
    this.retry = setTimeout(() => { void this.start(); }, delay);
  }
  dispose(): void { this.stopSocket(); this.blocked = true; }
}
