import { inspectSite, type Site } from '../shared/permissions';
import { validatePort } from '../shared/settings';
import type { ConnectionState } from '../background/connection-manager';
interface PopupStatus { state: ConnectionState; diagnostic: string; enabled: boolean; port: number; hasToken: boolean; protocolVersion: number; extensionVersion: string }
const labels: Record<ConnectionState, string> = { waiting: 'Waiting for Fuzzball', connecting: 'Waiting for Fuzzball', connected: 'Connected to Fuzzball', token_required: 'Pairing token required', pairing_rejected: 'Pairing rejected', protocol_mismatch: 'Protocol mismatch' };
export function connectionLabel(state: ConnectionState): string { return labels[state] ?? 'Waiting for Fuzzball'; }
export function renderStatus(status: PopupStatus, doc = document, initial = false): void {
  doc.getElementById('connection')!.textContent = connectionLabel(status.state);
  (doc.getElementById('enabled') as HTMLInputElement).checked = status.enabled;
  (doc.getElementById('token') as HTMLInputElement).placeholder = status.hasToken ? '•••••••• (saved securely in this profile)' : 'Paste token from Fuzzball';
  if (initial) (doc.getElementById('port') as HTMLInputElement).value = String(status.port);
  doc.getElementById('protocol')!.textContent = String(status.protocolVersion);
  doc.getElementById('version')!.textContent = status.extensionVersion;
  doc.getElementById('diagnostic')!.textContent = !status.enabled ? `Web control paused. The Fuzzball connection stays open. ${status.diagnostic}` : status.diagnostic || (status.state === 'connected' ? 'Ready' : connectionLabel(status.state));
}
export function mountPopup(doc = document): () => void {
  const input = (id: string) => doc.getElementById(id) as HTMLInputElement;
  const button = (id: string) => doc.getElementById(id) as HTMLButtonElement;
  const note = (message: string) => { doc.getElementById('diagnostic')!.textContent = message; };
  const send = (message: Record<string, unknown>) => chrome.runtime.sendMessage({ channel: 'fuzzball-popup', ...message });
  let site: Site = { supported: false, domain: '', reason: '' };
  let broad = false, granted = false, stopped = false;
  const refreshSite = async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    site = inspectSite(tab?.url, tab?.incognito);
    granted = !!site.pattern && await chrome.permissions.contains({ origins: [site.pattern] });
    const permissions = await chrome.permissions.getAll();
    broad = !!permissions.origins?.some(origin => ['http://*/*', 'https://*/*', '*://*/*', '<all_urls>'].includes(origin));
    doc.getElementById('domain')!.textContent = site.domain || 'Unsupported page';
    doc.getElementById('permission')!.textContent = !site.supported ? site.reason : granted ? 'Site access granted' : 'Permission required for this site';
    button('allow').disabled = !site.supported || granted;
    button('remove').disabled = !site.supported || !granted || broad;
    button('remove-all').disabled = !permissions.origins?.length;
    if (broad) doc.getElementById('permission')!.textContent += '. Remove all website access before revoking one site.';
  };
  const refresh = async (initial = false) => {
    const status: PopupStatus = await send({ command: 'status' });
    if (stopped) return;
    renderStatus(status, doc, initial); await refreshSite();
    if (status.enabled && status.state === 'connected' && (!site.supported || !granted)) note(site.supported ? 'Permission required for this site' : 'This page cannot be controlled');
  };
  const complete = async (request: Promise<unknown>) => {
    try { await request; await refreshSite(); } catch { note('Permission change failed. Try reopening the popup.'); }
  };
  button('allow').addEventListener('click', () => {
    // No awaited operation before request: Chrome requires the original user gesture.
    if (site.supported && site.pattern) void complete(chrome.permissions.request({ origins: [site.pattern] }));
  });
  button('remove').addEventListener('click', () => { if (site.pattern && !broad) void complete(chrome.permissions.remove({ origins: [site.pattern] })); });
  input('all-consent').addEventListener('change', () => { button('allow-all').disabled = !input('all-consent').checked; });
  button('allow-all').addEventListener('click', () => {
    if (input('all-consent').checked) void complete(chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] }));
  });
  button('remove-all').addEventListener('click', () => {
    void complete(chrome.permissions.getAll().then(permissions => chrome.permissions.remove({ origins: permissions.origins ?? [] })));
  });
  input('enabled').addEventListener('change', () => {
    void send({ command: 'enabled', enabled: input('enabled').checked }).then(() => refresh()).catch(() => note('Could not save the control setting.'));
  });
  doc.getElementById('pairing')!.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const port = validatePort(input('port').value);
      const token = input('token').value;
      input('token').value = '';
      void send({ command: 'pair', token, port }).then(result => { if (result?.ok === false) note('Check the token and port, then try again.'); else void refresh(); }).catch(() => note('Could not save pairing settings.'));
    } catch { note('Port must be a whole number between 1 and 65535.'); }
  });
  void refresh(true).catch(() => note('Unable to read extension status. Reload the extension.'));
  const timer = setInterval(() => { void refresh().catch(() => {}); }, 2000);
  return () => { stopped = true; clearInterval(timer); };
}
if (typeof chrome !== 'undefined' && document.getElementById('pairing')) {
  const dispose = mountPopup(); addEventListener('pagehide', dispose, { once: true });
}
