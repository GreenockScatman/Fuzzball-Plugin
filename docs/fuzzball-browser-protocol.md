# Protocol implementation and compatibility

The authority is [browser_extension_protocol.md](browser_extension_protocol.md), copied without changes from the neighbouring Fuzzball project's `contextual_voice_assistant/docs/browser_extension_protocol.md`. Its complete contents were read before implementation. The desktop's `browser_control/models.py`, `protocol.py` and relevant server handling were also inspected read-only to verify the strict schema and pause behavior.

Central values live in `src/shared/constants.ts`. Types are in `src/protocol/messages.ts`; incoming WebSocket validation is in `src/protocol/validation.ts`. The endpoint constructor in `src/shared/settings.ts` accepts only `127.0.0.1` and an integer port from 1 through 65535. No host field is exposed by the popup. The path is `/`.

## Differences from the original extension prompt

| Subject | Prompt example | Authoritative contract and implementation |
| --- | --- | --- |
| WebSocket path | `/browser-control` | Desktop documents the root endpoint. Use `ws://127.0.0.1:8765/`. |
| Heartbeat identity | `instance_id` in each heartbeat | Send `active_tab` containing `tab_id`, `window_id`, `window_focused`, or `null`. Installation identity appears in `hello` only. |
| Live enabled update | `status` with `enabled` | No `status` message exists in the document or desktop schema. Unknown message types are rejected. Pause is reported through the allowed `error` envelope with `extension_disabled`; local enforcement is immediate. The current server does not update its enabled flag from that message. |
| Extra candidate fields | Possible `risk_hint`, context or destination URL | Unknown fields are forbidden. Use supported `semantic_kind` for risk. URLs, DOM references and frame routing remain internal; no `risk_hint`, `href`, selector, context or DOM-path fields are transmitted. |
| Roles | Broad interactive/ARIA role vocabulary | Wire roles are exactly `link`, `button`, `menuitem`, `tab`, `other`; summary controls are buttons and other eligible controls use `other`. |
| Scope and ordinals | Ordinals in meaningful semantic groups | Wire ordinals are one-based **within role/scope** groups. Scope is exactly `any`, `main_content`, `search_results`. Google organic results use `search_results`. |
| Names | ARIA references and labels | Hidden referenced text is deliberately excluded, even where full accessibility-name algorithms can include it. Neither names nor text may contain hidden descendants or text-input values. |
| Form buttons | General relevant form controls | Direct form submission/reset is outside the authority's v1 boundary; these actions return `unsupported_capability`. They may be listed with conservative semantics. |
| Candidate limit | Example maximum 200 | Desktop request model permits 1–1000, but extension returns at most 200 and never more than requested. |
| Error codes | Prompt's shorter list | All desktop-defined codes are centralized, including `unsupported_browser`, `no_match` and `ambiguous_match`. The extension emits only codes appropriate to its own operations. |

## The enabled-state limitation

The server sets `session.enabled` from `hello`. Its accepted incoming messages are `hello`, `heartbeat`, `page_snapshot`, `action_result` and `error`. After authentication it handles heartbeat and response/error messages; it does not accept another hello as a state update. The unsolicited `extension_disabled` error is valid but cannot resolve a pending request or update the cached enabled flag without server support.

Consequently:

- The socket remains authenticated when the user toggles pause.
- Pending work is cancelled, candidates are invalidated and new requests are rejected while paused.
- When the initial handshake said `enabled:true`, the desktop may still try a snapshot while locally paused; that request receives `extension_disabled`.
- When the initial handshake said `enabled:false`, the desktop will not select the session after a local re-enable until a new handshake occurs.
- Clicking **Save token and reconnect**, with the token field blank, synchronizes the flag through a user-requested handshake.

Full live state synchronization cannot be implemented solely in this extension while obeying the authoritative schema and the requirement to stay connected. No speculative `status` message is sent. No Python files were modified.

## Wire examples

Authenticated hello:

```json
{"type":"hello","protocol_version":1,"auth_token":"<user-supplied token>","extension_version":"0.1.0","instance_id":"<profile UUID>","browser":{"name":"chrome","version":"<detected version>"},"enabled":true,"capabilities":["list_interactive_elements","click_element","open_link_in_new_tab"]}
```

Heartbeat after acknowledgement:

```json
{"type":"heartbeat","protocol_version":1,"active_tab":{"tab_id":123,"window_id":45,"window_focused":true}}
```

Unsolicited pause notice:

```json
{"type":"error","protocol_version":1,"error_code":"extension_disabled","message":"Web control paused."}
```

Snapshot failure:

```json
{"type":"error","protocol_version":1,"request_id":"<same request ID>","error_code":"permission_required","message":"permission_required"}
```

Successful action:

```json
{"type":"action_result","protocol_version":1,"request_id":"<same request ID>","ok":true,"error_code":null,"message":"Click dispatched."}
```

## Bounds and lifecycle

Messages are UTF-8 JSON objects no larger than 262,144 bytes. Snapshot candidate collection stops before reaching this byte limit, including for multibyte labels. Unknown fields/types, invalid scalar types, oversized payloads and incompatible versions fail safely. `hello_ack` heartbeat intervals must be between 1 and 25 seconds; the default is 20 seconds, and sends are capped at 20 seconds for the worker keepalive.

Requests time out after 3.5 seconds, leaving margin inside the desktop's default 4-second timeout. Each request has a cancellation signal and a map entry cleaned on completion, timeout or disconnect. A concurrent snapshot receives `timeout` immediately rather than invalidating a snapshot already being built. An action carries an internal deadline and a one-use background authorization. No action is retained for a future connection.

Duplicate request IDs are rejected throughout a session. The replay set is bounded to 10,000 IDs; further requests fail safely until reconnect. Candidate IDs are random UUIDs, valid only for the latest snapshot, and expire after 15 seconds. They are not selectors. Chrome document IDs and content-script document IDs are both revalidated. SPA navigation and history/fragment changes invalidate candidates even if the document is otherwise reused.

All transmitted candidate names/text are bounded to 300 characters (inside the protocol's 500-character ceiling). Titles are at most 500 characters. The page URL omits user info, query strings and fragments, preserving origin/path for identification while reducing exposure of URL-carried credentials. Actual link destinations are validated locally at activation and never added to candidate wire data.

## Versioning policy

Protocol version 1 is pinned. Changing a message type, adding a field, or changing field meaning requires an agreed desktop/extension protocol update and corresponding runtime validation tests. The authority forbids unknown fields, so adding supposedly optional metadata unilaterally is not backwards compatible. Extension package versions are separate from protocol versions. A protocol mismatch blocks retries until the user explicitly reconnects after aligning the two peers.

The minimum Chrome version is 120: [Chrome's service-worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) describes the alarm and WebSocket milestones. Injection uses Chrome's [document-targeted scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) in `ISOLATED` mode. Permission requests use the [permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions) directly from popup button handlers.
