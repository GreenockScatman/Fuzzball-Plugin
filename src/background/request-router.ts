import { CAPABILITIES, CANDIDATE_TTL_MS, MAX_CANDIDATES, MAX_MESSAGE_BYTES, PROTOCOL_VERSION, REQUEST_TIMEOUT_MS, type Capability } from '../shared/constants';
import { focusedTab, hasPermission, inspectSite, safeLink } from '../shared/permissions';
import { ControlError, errorCode, requireCondition } from '../protocol/errors';
import type { Request, Response, FrameSnapshot, ContentReply, Candidate, Snapshot } from '../protocol/messages';
import type { Activation } from '../content/action-executor';
import { record } from '../protocol/validation';
type Frame = { frameId: number; parentFrameId: number; url: string; documentId: string };
type Route = { tabId: number; windowId: number; topDocument: string; topChromeDocument: string; frame: Frame; frameDocument: string; frames: Frame[]; expires: number; generation: number; navigation: number };
type Work = { controller: AbortController; timer: ReturnType<typeof setTimeout> };
type Permit = { route: Route; signal: AbortSignal; deadline: number };
export class RequestRouter {
  private pending = new Map<string, Work>();
  private seen = new Set<string>();
  private routes = new Map<string, Route>();
  private authorizations = new Map<string, Permit>();
  private busySnapshot = false;
  private generation = 0;
  private navigation = new Map<number, number>();
  private cleanup?: ReturnType<typeof setTimeout>;
  constructor(private readonly ready: () => boolean, private readonly enabled: () => boolean, private readonly capabilities: readonly Capability[] = CAPABILITIES) {}
  cancel(): void {
    this.generation++;
    for (const work of this.pending.values()) { work.controller.abort(); clearTimeout(work.timer); }
    this.pending.clear(); this.routes.clear(); this.authorizations.clear(); this.seen.clear(); clearTimeout(this.cleanup);
  }
  invalidate(tabId: number): void {
    this.navigation.set(tabId, (this.navigation.get(tabId) ?? 0) + 1);
    for (const [id, route] of this.routes) if (route.tabId === tabId) this.routes.delete(id);
    for (const [id, permit] of this.authorizations) if (permit.route.tabId === tabId) this.authorizations.delete(id);
  }
  private check(signal?: AbortSignal): void {
    requireCondition(this.ready(), 'not_connected');
    requireCondition(this.enabled(), 'extension_disabled');
    requireCondition(!signal?.aborted, 'timeout');
  }
  async handle(request: Request): Promise<Response> {
    const fail = (code: ReturnType<typeof errorCode>): Response => request.type === 'perform_action'
      ? { type: 'action_result', protocol_version: PROTOCOL_VERSION, request_id: request.request_id, ok: false, error_code: code, message: code }
      : { type: 'error', protocol_version: PROTOCOL_VERSION, request_id: request.request_id, error_code: code, message: code };
    // Retain the entire session's replay set; force a fresh session at a bounded limit.
    if (this.seen.has(request.request_id) || this.seen.size >= 10_000) return fail('malformed_response');
    this.seen.add(request.request_id);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    try {
      this.check();
      const deadline = Date.now() + REQUEST_TIMEOUT_MS;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort('timeout'); reject(new ControlError('timeout')); }, REQUEST_TIMEOUT_MS);
        controller.signal.addEventListener('abort', () => reject(new ControlError(controller.signal.reason === 'timeout' ? 'timeout' : 'not_connected')), { once: true });
      });
      this.pending.set(request.request_id, { controller, timer: timer! });
      return await Promise.race([request.type === 'page_snapshot_request' ? this.snapshot(request, controller.signal) : this.action(request, controller.signal, deadline), timeout]);
    } catch (error) { return fail(errorCode(error)); }
    finally { const work = this.pending.get(request.request_id); if (work) clearTimeout(work.timer); this.pending.delete(request.request_id); }
  }
  private async send<T>(tabId: number, frame: Pick<Frame, 'documentId'>, message: Record<string, unknown>): Promise<T> {
    let reply: ContentReply<T>;
    try { reply = await chrome.tabs.sendMessage(tabId, { channel: 'fuzzball-content', ...message }, { documentId: frame.documentId }); }
    catch { throw new ControlError('navigation_changed'); }
    requireCondition(record(reply) && typeof reply.ok === 'boolean', 'malformed_response');
    if (!reply.ok) throw new ControlError(reply.error_code);
    return reply.value;
  }
  private async sameTab(tabId: number, windowId: number, signal: AbortSignal): Promise<void> {
    this.check(signal);
    const tab = await focusedTab();
    this.check(signal);
    requireCondition(tab.id === tabId && tab.windowId === windowId, 'navigation_changed');
  }
  private async visibleFrame(tabId: number, frame: Frame, frames: Frame[]): Promise<boolean> {
    let current = frame;
    const visited = new Set<number>();
    while (current.frameId !== 0) {
      if (visited.has(current.frameId)) return false;
      visited.add(current.frameId);
      const parent = frames.find(candidate => candidate.frameId === current.parentFrameId);
      if (!parent || !await this.send<boolean>(tabId, parent, { command: 'frame-visible', url: current.url })) return false;
      current = parent;
    }
    return true;
  }
  private async snapshot(request: Extract<Request, { type: 'page_snapshot_request' }>, signal: AbortSignal): Promise<Response> {
    requireCondition(this.capabilities.includes('list_interactive_elements'), 'unsupported_capability');
    requireCondition(!this.busySnapshot, 'timeout');
    this.busySnapshot = true;
    try {
      const tab = await focusedTab(); this.check(signal);
      const navigation = this.navigation.get(tab.id) ?? 0;
      const all = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      const frames: Frame[] = [];
      for (const frame of all ?? []) {
        if (inspectSite(frame.url).supported && await hasPermission(frame.url)) frames.push(frame);
      }
      const top = frames.find(frame => frame.frameId === 0);
      requireCondition(top, 'restricted_page');
      frames.sort((a, b) => a.frameId - b.frameId);
      const injected: Frame[] = [];
      for (const frame of frames) {
        this.check(signal);
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [frame.documentId] }, files: ['content/content-script.js'], world: 'ISOLATED' });
          injected.push(frame);
        } catch { if (frame.frameId === 0) throw new ControlError('restricted_page'); }
      }
      const max = Math.min(request.max_elements, MAX_CANDIDATES);
      const main = await this.send<FrameSnapshot>(tab.id, top, { command: 'snapshot', max });
      const combined: Candidate[] = [];
      const gathered: { snapshot: FrameSnapshot; frame: Frame }[] = [{ snapshot: main, frame: top }];
      for (const frame of injected) {
        if (frame.frameId === 0) continue;
        this.check(signal);
        try {
          if (await this.visibleFrame(tab.id, frame, injected)) gathered.push({ snapshot: await this.send<FrameSnapshot>(tab.id, frame, { command: 'snapshot', max }), frame });
        } catch { /* A disappearing/inaccessible child must not fail the main page. */ }
      }
      await this.sameTab(tab.id, tab.windowId, signal);
      const identity = await this.send<{ document_id: string }>(tab.id, top, { command: 'identity' });
      requireCondition(identity.document_id === main.document_id, 'stale_document');
      this.check(signal);
      requireCondition(navigation === (this.navigation.get(tab.id) ?? 0), 'navigation_changed');
      this.routes.clear();
      const response: Snapshot = { type: 'page_snapshot', protocol_version: PROTOCOL_VERSION, request_id: request.request_id, page: { tab_id: tab.id, window_id: tab.windowId, document_id: main.document_id, url: main.url, title: main.title, window_focused: true, permission: 'granted', restricted: false }, elements: combined };
      const encoder = new TextEncoder();
      let bytes = encoder.encode(JSON.stringify(response)).length;
      for (const { snapshot, frame } of gathered) {
        for (const candidate of snapshot.elements) {
          if (combined.length >= max) break;
          const candidateBytes = encoder.encode(JSON.stringify(candidate)).length + 8;
          if (bytes + candidateBytes > MAX_MESSAGE_BYTES) break;
          bytes += candidateBytes;
          combined.push(candidate);
          this.routes.set(candidate.id, { tabId: tab.id, windowId: tab.windowId, topDocument: main.document_id, topChromeDocument: top.documentId, frame, frameDocument: snapshot.document_id, frames: injected, expires: Date.now() + CANDIDATE_TTL_MS, generation: this.generation, navigation });
        }
      }
      const ordinals = new Map<string, number>();
      for (const candidate of combined) { const key = `${candidate.role}:${candidate.scope}`; candidate.ordinal = (ordinals.get(key) ?? 0) + 1; ordinals.set(key, candidate.ordinal); }
      clearTimeout(this.cleanup); this.cleanup = setTimeout(() => this.routes.clear(), CANDIDATE_TTL_MS);
      return response;
    } finally { this.busySnapshot = false; }
  }
  private async validateRoute(route: Route, signal: AbortSignal): Promise<void> {
    requireCondition(route.generation === this.generation, 'not_connected');
    requireCondition(route.navigation === (this.navigation.get(route.tabId) ?? 0), 'navigation_changed');
    requireCondition(Date.now() < route.expires, 'element_disappeared');
    await this.sameTab(route.tabId, route.windowId, signal);
    const identity = await this.send<{ document_id: string }>(route.tabId, { documentId: route.topChromeDocument }, { command: 'identity' });
    requireCondition(identity.document_id === route.topDocument, 'stale_document');
    requireCondition(await hasPermission(route.frame.url), 'permission_required');
    requireCondition(await this.visibleFrame(route.tabId, route.frame, route.frames), 'element_not_interactable');
    this.check(signal);
    requireCondition(route.navigation === (this.navigation.get(route.tabId) ?? 0), 'navigation_changed');
  }
  async authorize(id: string, sender: chrome.runtime.MessageSender): Promise<{ ok: boolean; code?: string }> {
    const permit = this.authorizations.get(id);
    if (!permit || sender.tab?.id !== permit.route.tabId || sender.documentId !== permit.route.frame.documentId) return { ok: false };
    this.authorizations.delete(id);
    try { await this.validateRoute(permit.route, permit.signal); requireCondition(Date.now() < permit.deadline, 'timeout'); return { ok: true }; }
    catch (error) { return { ok: false, code: errorCode(error) }; }
  }
  private async action(request: Extract<Request, { type: 'perform_action' }>, signal: AbortSignal, deadline: number): Promise<Response> {
    requireCondition(this.capabilities.includes('click_element') && (!request.action.open_in_new_tab || this.capabilities.includes('open_link_in_new_tab')), 'unsupported_capability');
    const current = await focusedTab(); this.check(signal);
    requireCondition(current.id === request.tab_id, 'navigation_changed');
    const route = this.routes.get(request.action.element_id);
    requireCondition(route, 'element_disappeared');
    requireCondition(route.tabId === request.tab_id && route.topDocument === request.document_id, 'stale_document');
    await this.validateRoute(route, signal);
    const authorization = crypto.randomUUID();
    this.authorizations.set(authorization, { route, signal, deadline });
    try {
      const result = await this.send<Activation>(route.tabId, route.frame, { command: 'activate', documentId: route.frameDocument, action: request.action, authorization, deadline });
      if (request.action.open_in_new_tab) {
        await this.validateRoute(route, signal);
        const url = typeof result.url === 'string' ? safeLink(result.url) : null;
        requireCondition(url, 'unsupported_capability');
        this.check(signal); requireCondition(Date.now() < deadline, 'timeout');
        await chrome.tabs.create({ url, openerTabId: route.tabId, windowId: route.windowId, active: false });
      }
      this.check(signal);
      return { type: 'action_result', protocol_version: PROTOCOL_VERSION, request_id: request.request_id, ok: true, error_code: null, message: request.action.open_in_new_tab ? 'Opened link in a new tab.' : 'Activation attempted successfully.' };
    } finally { this.authorizations.delete(authorization); this.routes.delete(request.action.element_id); }
  }
}
