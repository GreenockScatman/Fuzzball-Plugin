import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../shared/constants';
import { ControlError, ERROR_CODES, requireCondition } from './errors';
import type { Incoming } from './messages';
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function boundedString(value: unknown, max = 200): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
export function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).every(key => keys.includes(key)); }
export function decode(raw: unknown): Incoming {
  requireCondition(typeof raw === 'string' && raw.length <= MAX_MESSAGE_BYTES && new TextEncoder().encode(raw).length <= MAX_MESSAGE_BYTES, 'malformed_response');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ControlError('malformed_response'); }
  requireCondition(record(value) && typeof value.type === 'string', 'malformed_response');
  requireCondition(value.protocol_version === PROTOCOL_VERSION, 'protocol_mismatch');
  const base = ['type', 'protocol_version'];
  let valid = false;
  switch (value.type) {
    case 'hello_ack': valid = exactKeys(value, [...base, 'session_id', 'heartbeat_interval_ms']) && boundedString(value.session_id) && Number.isInteger(value.heartbeat_interval_ms) && Number(value.heartbeat_interval_ms) >= 1000 && Number(value.heartbeat_interval_ms) <= 25_000; break;
    case 'heartbeat_ack': valid = exactKeys(value, base); break;
    case 'error': valid = exactKeys(value, [...base, 'request_id', 'error_code', 'message']) && (value.request_id === undefined || boundedString(value.request_id)) && ERROR_CODES.some(code => code === value.error_code) && boundedString(value.message, 300); break;
    case 'page_snapshot_request': valid = exactKeys(value, [...base, 'request_id', 'max_elements']) && boundedString(value.request_id) && Number.isInteger(value.max_elements) && Number(value.max_elements) >= 1 && Number(value.max_elements) <= 1000; break;
    case 'perform_action': {
      const action = value.action;
      valid = exactKeys(value, [...base, 'request_id', 'tab_id', 'document_id', 'action']) && boundedString(value.request_id) && Number.isInteger(value.tab_id) && Number(value.tab_id) >= 0 && boundedString(value.document_id) && record(action) && exactKeys(action, ['kind', 'element_id', 'open_in_new_tab']) && action.kind === 'click' && boundedString(action.element_id) && typeof action.open_in_new_tab === 'boolean';
      break;
    }
  }
  requireCondition(valid, 'malformed_response');
  return value as unknown as Incoming;
}
export function encode(value: unknown): string {
  const raw = JSON.stringify(value);
  requireCondition(new TextEncoder().encode(raw).length <= MAX_MESSAGE_BYTES, 'malformed_response');
  return raw;
}
