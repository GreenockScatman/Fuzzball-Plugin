import { beforeEach, describe, expect, it } from 'vitest';
import { decode, encode } from '../src/protocol/validation';
import { endpoint, loadSettings, savePairing, validatePort } from '../src/shared/settings';
import { redact, setLogSecrets } from '../src/shared/logging';
import { mockChrome } from './helpers';
import { MAX_MESSAGE_BYTES } from '../src/shared/constants';
const valid = { type: 'perform_action', protocol_version: 1, request_id: 'req1', tab_id: 123, document_id: 'doc1', action: { kind: 'click', element_id: 'opaque', open_in_new_tab: false } };
describe('strict wire protocol', () => {
  it('decodes a valid request', () => expect(decode(JSON.stringify(valid))).toEqual(valid));
  it.each(['not JSON', 'null', '[]', '{}', JSON.stringify({ ...valid, extra: true }), JSON.stringify({ ...valid, action: { ...valid.action, selector: '#buy' } }), JSON.stringify({ ...valid, action: { ...valid.action, kind: 'type' } }), JSON.stringify({ ...valid, action: { ...valid.action, open_in_new_tab: 'false' } }), JSON.stringify({ ...valid, tab_id: 1.5 }), JSON.stringify({ ...valid, request_id: '' }), 'x'.repeat(MAX_MESSAGE_BYTES + 1)])('rejects malformed input %#', raw => expect(() => decode(raw)).toThrow('malformed_response'));
  it('rejects incompatible versions', () => expect(() => decode(JSON.stringify({ ...valid, protocol_version: 2 }))).toThrow('protocol_mismatch'));
  it('bounds UTF-8 bytes and outgoing messages', () => { expect(() => decode(JSON.stringify({ ...valid, padding: '🫘'.repeat(70_000) }))).toThrow(); expect(() => encode({ text: 'x'.repeat(MAX_MESSAGE_BYTES) })).toThrow(); });
  it.each([0, 1001, -1, '200', 1.5])('rejects invalid snapshot limit %s', max_elements => expect(() => decode(JSON.stringify({ type: 'page_snapshot_request', protocol_version: 1, request_id: 'id', max_elements }))).toThrow());
});
describe('private settings', () => {
  beforeEach(() => mockChrome());
  it('stores a stable profile identifier and restricts storage to trusted contexts', async () => { const first = await loadSettings(); expect((await loadSettings()).instanceId).toBe(first.instanceId); expect(chrome.storage.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' }); });
  it('stores the token only locally and preserves it for a blank save', async () => { await savePairing('example-token', '8888'); await savePairing('', 8889); expect((await loadSettings()).token).toBe('example-token'); expect(chrome.storage.sync.set).not.toHaveBeenCalled(); });
  it.each([0, 65536, -1, 1.5, '1e3', 'abc', '', ' 80', true, null])('rejects invalid port %s', value => expect(() => validatePort(value)).toThrow());
  it.each([1, 65535, '8765'])('accepts valid port %s', value => expect(validatePort(value)).toBe(Number(value)));
  it('uses only the authoritative loopback endpoint', () => { expect(endpoint(8765)).toBe('ws://127.0.0.1:8765/'); expect(() => endpoint(8765, 'localhost')).toThrow(); expect(() => endpoint(8765, '192.168.1.2')).toThrow(); });
  it('redacts tokens, URLs, page text and nested fields', () => { const result = redact({ auth_token: 'secret', token: 'secret', url: 'https://private/?token=secret', snapshot: { text: 'secret' }, state: 'connected', request_id: 'abc-123' }); expect(JSON.stringify(result)).not.toContain('secret'); expect(result.state).toBe('connected'); });
  it('redacts the saved token if a peer echoes it inside a permitted log field', () => { setLogSecrets(['saved-pairing-secret']); expect(redact({ request_id: 'prefix-saved-pairing-secret' }).request_id).toBe('[redacted]'); setLogSecrets([]); });
});
