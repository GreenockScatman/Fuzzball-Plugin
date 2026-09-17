import { DEFAULT_PORT, HOST, SOCKET_PATH } from './constants';
export interface Settings { token: string; port: number; enabled: boolean; instanceId: string }
export function validatePort(value: unknown): number {
  const port = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  return port;
}
export function endpoint(port: number, host = HOST): string {
  if (host !== HOST) throw new Error('Only 127.0.0.1 is allowed.');
  return `ws://${HOST}:${validatePort(port)}${SOCKET_PATH}`;
}
export async function loadSettings(): Promise<Settings> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const data = await chrome.storage.local.get(['token', 'port', 'enabled', 'instanceId']);
  const instanceId = typeof data.instanceId === 'string' && /^[0-9a-f-]{36}$/i.test(data.instanceId) ? data.instanceId : crypto.randomUUID();
  if (instanceId !== data.instanceId) await chrome.storage.local.set({ instanceId });
  let port = DEFAULT_PORT;
  try { port = validatePort(data.port ?? DEFAULT_PORT); } catch { /* Recover from invalid local settings. */ }
  return { token: typeof data.token === 'string' ? data.token : '', port, enabled: data.enabled !== false, instanceId };
}
export async function savePairing(token: string, port: unknown): Promise<void> {
  const values: { port: number; token?: string } = { port: validatePort(port) };
  if (token.trim()) {
    if (token.trim().length > 1024 || /\s/.test(token.trim())) throw new Error('Invalid pairing token.');
    values.token = token.trim();
  }
  await chrome.storage.local.set(values);
}
