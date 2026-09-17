const allowed = new Set(['request_id', 'state', 'protocol_version', 'candidate_count', 'error_code', 'ok']);
let secrets: string[] = [];
export function setLogSecrets(values: string[]): void { secrets = values.filter(Boolean); }
export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, allowed.has(key) && (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value) && !secrets.some(secret => value.includes(secret))) ? value : '[redacted]']));
}
export function log(fields: Record<string, unknown>): void { console.info('[Fuzzball]', redact(fields)); }
