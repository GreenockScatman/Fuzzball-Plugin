import { ConnectionManager } from './connection-manager';
import { RequestRouter } from './request-router';
import { loadSettings, savePairing } from '../shared/settings';
import { focusedTab } from '../shared/permissions';
import { PROTOCOL_VERSION } from '../shared/constants';
import { record, boundedString, exactKeys } from '../protocol/validation';
import { errorCode } from '../protocol/errors';

const manager: ConnectionManager = new ConnectionManager({
  settings: loadSettings,
  activeTab: async () => {
    try { const tab = await focusedTab(); return { tab_id: tab.id, window_id: tab.windowId, window_focused: true }; } catch { return null; }
  },
  route: request => router.handle(request), cancel: () => router.cancel(),
});
const router: RequestRouter = new RequestRouter(() => manager.ready, () => manager.settings?.enabled ?? false);
const boot = () => { void manager.start(); };
chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(boot);
chrome.alarms.onAlarm.addListener(alarm => { void manager.alarm(alarm.name); });
chrome.permissions.onRemoved.addListener(() => router.cancel());
const invalidate = (details: { tabId: number; frameId: number }) => {
  router.invalidate(details.tabId);
  void chrome.tabs.sendMessage(details.tabId, { channel: 'fuzzball-content', command: 'invalidate' }, { frameId: details.frameId }).catch(() => {});
};
chrome.webNavigation.onCommitted.addListener(invalidate);
chrome.webNavigation.onHistoryStateUpdated.addListener(invalidate);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(invalidate);
chrome.tabs.onRemoved.addListener(tabId => router.invalidate(tabId));
chrome.tabs.onActivated.addListener(() => { void manager.pulse(); });
chrome.windows.onFocusChanged.addListener(() => { void manager.pulse(); });
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !record(message)) return;
  if (message.channel === 'fuzzball-authorize' && boundedString(message.authorization)) {
    void router.authorize(message.authorization, sender).then(respond); return true;
  }
  if (sender.tab || sender.url !== chrome.runtime.getURL('popup/popup.html') || message.channel !== 'fuzzball-popup') return;
  const handle = async () => {
    if (message.command === 'status') {
      if (!manager.settings) await manager.start();
      const settings = manager.settings;
      return { ...manager.status, enabled: settings?.enabled ?? true, port: settings?.port ?? 8765, hasToken: !!settings?.token, protocolVersion: PROTOCOL_VERSION, extensionVersion: chrome.runtime.getManifest().version };
    }
    if (message.command === 'enabled' && typeof message.enabled === 'boolean' && exactKeys(message, ['channel', 'command', 'enabled'])) {
      await chrome.storage.local.set({ enabled: message.enabled }); manager.setEnabled(message.enabled); return { ok: true };
    }
    if (message.command === 'pair' && typeof message.token === 'string' && exactKeys(message, ['channel', 'command', 'token', 'port'])) {
      await savePairing(message.token, message.port); await manager.start(true); return { ok: true };
    }
    return { ok: false, error: 'Invalid settings request.' };
  };
  void handle().then(respond, error => respond({ ok: false, error: errorCode(error) }));
  return true;
});
boot();
