# Fuzzball browser companion protocol v1

This document is the complete contract for a future Chrome extension that provides restricted webpage interaction to Fuzzball. The extension inspects and acts on the page; Fuzzball never receives a DOM, selector, script, XPath, coordinate, cookie, form value, password, or page source.

## Architecture and trust boundary

Fuzzball runs an optional WebSocket server on `ws://127.0.0.1:8765`. It is bound to the IPv4 loopback address only. The socket isn't encrypted because traffic cannot leave the machine, so security depends on loopback binding, Chrome-extension Origin validation, and a 256-bit random pairing token.

The extension is untrusted until it completes the authenticated `hello` exchange. Page strings remain untrusted after authentication: they are data for matching and must never be treated as prompts, instructions, code, or selectors.

The extension owns temporary element IDs. An ID is meaningful only for the `tab_id` and `document_id` in the snapshot that produced it. Fuzzball returns the opaque ID unchanged and never interprets it.

The sequence for one click is:

1. The extension authenticates and advertises capabilities.
2. Fuzzball verifies that the application captured at Ctrl+Q is a supported foreground Chrome process.
3. Fuzzball requests a bounded page snapshot from the selected extension session.
4. The extension returns only visible interactive element summaries.
5. Fuzzball applies deterministic matching and, only when configured, bounded OpenRouter resolution.
6. Fuzzball asks for voice confirmation if local text or semantic checks indicate risk.
7. Fuzzball sends one `perform_action` containing the original tab, document and element ID.
8. The extension revalidates all three values plus active-tab, visibility and enabled state before clicking.

There is no coordinate, keyboard, screenshot, computer-vision or JavaScript fallback.

## Configuration

```yaml
browser_control:
  enabled: true
  transport: "websocket"
  host: "127.0.0.1"
  port: 8765
  protocol_version: 1
  request_timeout_ms: 4000
  heartbeat_interval_ms: 20000
  heartbeat_timeout_ms: 45000
  confirmation_timeout_ms: 30000
  max_message_bytes: 262144
  max_candidates: 200
  fuzzy_match_threshold: 0.86
  ambiguity_margin: 0.08
  allow_remote_candidate_resolution: true
  supported_processes: ["chrome.exe"]
  allowed_extension_ids: []
  token_path: "data/browser_extension_pairing.json"
```

The configuration model only accepts `127.0.0.1`; `0.0.0.0`, IPv6-any and LAN addresses are invalid. Protocol v1 supports Chrome only. To add Edge later, Fuzzball must explicitly add its process and browser identity, and the extension must be packaged for and tested in Edge; changing the process list alone is not an assertion of compatibility.

If disabled, missing its `websockets` dependency, unable to bind the port, or otherwise unable to start, browser webpage control becomes unavailable while the rest of Fuzzball continues normally.

## Pairing and Origin authentication

On first use, Fuzzball writes a token produced by `secrets.token_urlsafe(32)` to the configured ignored `data/*.json` path. It uses atomic replacement and requests owner-only file permissions where the platform supports them. No default token is committed, printed during startup, logged, sent to OpenRouter, or included in exceptions.

The user can copy it from the tray item **Copy browser-extension pairing token**. Explicit development commands are also available:

```powershell
python scripts/browser_control_token.py --copy
python scripts/browser_control_token.py --show
```

The WebSocket request must have an Origin matching `chrome-extension://<32 lowercase a-p characters>`. When `allowed_extension_ids` is non-empty, the Origin ID must be in that list. With an empty list, any syntactically valid unpacked Chrome extension Origin may authenticate with the token.

## Common envelope rules

Every message is one UTF-8 JSON object with `type` and `protocol_version`. Request/response pairs also require `request_id`. Unknown fields, unknown message types, malformed JSON, invalid field types, incompatible versions, and messages exceeding `max_message_bytes` are rejected. Fuzzball never logs raw messages.

Fuzzball correlates a response only with the pending request having the same ID and session. An unknown, delayed or wrong-session ID is ignored and cannot complete another request.

## Handshake

The extension's first message must be:

```json
{
  "type": "hello",
  "protocol_version": 1,
  "auth_token": "<pairing token>",
  "extension_version": "0.1.0",
  "instance_id": "<stable profile-installation UUID>",
  "browser": {"name": "chrome", "version": "140.0.0.0"},
  "enabled": true,
  "capabilities": [
    "list_interactive_elements",
    "click_element",
    "open_link_in_new_tab"
  ]
}
```

`instance_id` identifies one extension installation/profile but isn't a credential. Reconnecting the same instance replaces its previous session.

Fuzzball acknowledges:

```json
{
  "type": "hello_ack",
  "protocol_version": 1,
  "session_id": "<runtime UUID>",
  "heartbeat_interval_ms": 20000
}
```

The extension must not send snapshots or action results before `hello_ack`.

## Heartbeat and active-window status

At approximately the acknowledged interval, the extension sends:

```json
{
  "type": "heartbeat",
  "protocol_version": 1,
  "active_tab": {
    "tab_id": 123,
    "window_id": 45,
    "window_focused": true
  }
}
```

`active_tab` may be `null` when there is no permitted active tab. Fuzzball replies:

```json
{"type":"heartbeat_ack","protocol_version":1}
```

A session becomes stale when no heartbeat or valid page snapshot updates it before `heartbeat_timeout_ms`. Fuzzball closes and removes stale sessions and cancels their pending requests.

If several instances are connected, Fuzzball selects the sole capable, enabled session reporting a focused Chrome window. Zero or multiple focused candidates fail safely with `no_active_tab`; Fuzzball never guesses a profile.

## Page snapshot

Fuzzball requests:

```json
{
  "type": "page_snapshot_request",
  "protocol_version": 1,
  "request_id": "<UUID>",
  "max_elements": 200
}
```

The extension must inspect only the active tab in its focused Chrome window and reply:

```json
{
  "type": "page_snapshot",
  "protocol_version": 1,
  "request_id": "<same UUID>",
  "page": {
    "tab_id": 123,
    "window_id": 45,
    "document_id": "<navigation-specific opaque ID>",
    "url": "https://music.youtube.com/home",
    "title": "YouTube Music",
    "window_focused": true,
    "permission": "granted",
    "restricted": false
  },
  "elements": [
    {
      "id": "element-17",
      "role": "link",
      "name": "Real Human Beans",
      "text": "Real Human Beans",
      "semantic_kind": "playlist",
      "scope": "main_content",
      "ordinal": 1,
      "visible": true,
      "enabled": true
    }
  ]
}
```

Field contract:

- `document_id` must change on navigation or document replacement.
- `permission` is exactly `granted`, `required`, or `denied`.
- `restricted` is true when Chrome doesn't permit inspection or action.
- `role` is exactly `link`, `button`, `menuitem`, `tab`, or `other`.
- `name` is the concise accessible name when available; `text` is concise visible text. At least one is required. Neither may include hidden descendants, input values or unrelated surrounding content.
- `semantic_kind` is a short classification such as `playlist`, `media_control`, `search_result`, `purchase`, `delete`, `submit`, `permission`, or `download`. Fuzzball treats it as advisory and performs its own risk checks.
- `scope` is `any`, `main_content`, or `search_results`. Organic results must be classified `search_results`; navigation, adverts, account controls and unrelated links must not be.
- `ordinal` is the one-based order within the role/scope group, not raw DOM order.
- Only elements that the extension believes visible and interactive should normally be returned. Fuzzball still rejects `visible:false` and `enabled:false`.
- IDs duplicated within a snapshot are unusable.
- The extension must return no more than `max_elements`.

Only HTTP and HTTPS pages are eligible. Protected and local schemes such as `chrome://`, `chrome-extension://`, `edge://`, `about:`, `file:` and `data:` are rejected regardless of `restricted`.

## Action request and mandatory extension revalidation

Fuzzball sends:

```json
{
  "type": "perform_action",
  "protocol_version": 1,
  "request_id": "<UUID>",
  "tab_id": 123,
  "document_id": "<same document ID as snapshot>",
  "action": {
    "kind": "click",
    "element_id": "element-17",
    "open_in_new_tab": false
  }
}
```

Before clicking, the extension must verify atomically enough to avoid acting on a changed target:

1. The same Chrome window is focused and the same tab is active.
2. The current document ID exactly equals `document_id`.
3. The temporary ID still resolves within that document.
4. The element remains visible, enabled and interactable.
5. `open_in_new_tab:true` is accepted only for a link and only when the capability was advertised.

It returns:

```json
{
  "type": "action_result",
  "protocol_version": 1,
  "request_id": "<same UUID>",
  "ok": true,
  "error_code": null,
  "message": "Clicked Real Human Beans"
}
```

A failure sets `ok:false`, a non-null error code, and an optional concise user-facing message. Fuzzball controls final error wording and does not trust the extension message as authority.

## Error message

Either peer may use the common error envelope where applicable:

```json
{
  "type": "error",
  "protocol_version": 1,
  "request_id": "<UUID or omitted before a request exists>",
  "error_code": "permission_required",
  "message": "Concise diagnostic"
}
```

Defined error codes:

| Code | Meaning |
| --- | --- |
| `not_connected` | No authenticated live companion session, including failed authentication. |
| `extension_disabled` | The authenticated extension reports its internal toggle off. |
| `protocol_mismatch` | The peer uses an incompatible protocol version. |
| `unsupported_capability` | Required advertised capability is absent. |
| `unsupported_browser` | The captured foreground process/browser isn't supported. |
| `permission_required` | Site access is missing or denied. |
| `restricted_page` | Chrome protects the page from extension control. |
| `no_active_tab` | No single focused active Chrome session/tab can be established. |
| `no_match` | No suitable visible enabled candidate matched. |
| `ambiguous_match` | Several candidates remain plausible. |
| `stale_document` | The document ID changed. |
| `element_disappeared` | The temporary element ID no longer resolves. |
| `element_not_interactable` | The element is hidden, disabled, covered, or otherwise not clickable. |
| `navigation_changed` | The active tab/window or navigation changed. |
| `timeout` | A request exceeded `request_timeout_ms`. |
| `malformed_response` | JSON or schema validation failed, or limits were exceeded. |
| `internal_error` | A recoverable internal companion error occurred. |

## Matching and OpenRouter boundary

Fuzzball rejects hidden, disabled, malformed and duplicate-ID candidates, then applies role and scope. Explicit ordinals use the extension's classification. Text matching normalizes Unicode NFKC, case, punctuation and whitespace; it prefers exact accessible names, then exact visible text, then contained-token/fuzzy similarity with a configured minimum score and ambiguity gap.

OpenRouter is used only when deterministic matching leaves several plausible candidates and `allow_remote_candidate_resolution` is true. It receives at most 20 summaries containing only ID, role, name, text, semantic kind and ordinal. It never receives the DOM, URL, hidden text, form/input values, cookies, authentication data, pairing token, or unrelated page content. Its strict response can contain only one ID enumerated in the supplied list. An invented ID, prose or additional action is rejected.

## Risk confirmation

Fuzzball requires a separate voice confirmation for elements resembling purchases, checkout/order placement, deletion/removal, sending/submitting, payments, account/security changes, permission grants, downloads, or installation. It checks both extension semantics and local text; it doesn't trust a page-supplied risk label. The pending action expires, is tied to the captured Chrome HWND and extension session, and still goes through extension revalidation after confirmation.

Typing, form submission, password handling, uploads, general autonomous browsing, and unconfirmed consequential actions are outside protocol v1.

## Privacy and diagnostics

Normal Fuzzball logs contain request/session IDs, connection state, candidate count, matching method/confidence, error code, and success/failure. They do not contain tokens, raw snapshots, candidate lists, URL query strings, full page content, or form data. Browser tool arguments/results and command history are redacted. The planner receives only connection availability; extension instance/session identifiers aren't sent to OpenRouter.

The tray shows local connection health. The browser-control service also exposes enabled/server state, connection count, extension-enabled state and negotiated capabilities to Fuzzball's planner context.

## Running the mock companion

Start Fuzzball, then run the development-only client in another terminal:

```powershell
python scripts/mock_browser_extension.py --token-file data/browser_extension_pairing.json --fixture youtube_music
```

Other fixtures are `search_results` and `risky_checkout`. Useful switches:

```powershell
python scripts/mock_browser_extension.py --token-file data/browser_extension_pairing.json --disabled
python scripts/mock_browser_extension.py --token-file data/browser_extension_pairing.json --fixture search_results --simulate timeout
python scripts/mock_browser_extension.py --token-file data/browser_extension_pairing.json --fixture risky_checkout --simulate stale_document
```

The mock authenticates, sends heartbeats, returns bounded snapshots, validates action tab/document/element state, and can simulate timeout, stale document, disappearing/disabled elements, and navigation change. It contains no real token. It is a test client, not extension code.

## Future extension implementation checklist

The separate extension project must implement exactly:

- Manifest permissions narrowly sufficient for the user-granted active sites and local WebSocket connection.
- The Origin-authenticated v1 `hello`/`hello_ack` exchange and internal enabled toggle.
- Heartbeats with focused-window status.
- A per-navigation opaque `document_id` and temporary non-selector element-ID map.
- A bounded extractor returning only visible interactive summaries in the schema above.
- Correct accessible names, visible text, semantic kinds, result scopes and ordinals.
- No passwords, input values, hidden text, page source, cookies or unrelated content.
- Capability negotiation, including separate `open_link_in_new_tab` support.
- Revalidation of active window/tab/document/element/visibility/enabled state immediately before action.
- Structured v1 results and error codes with the original request ID.
- Token storage appropriate for Chrome extension local storage; never page-accessible or logged.

The extension must not add JavaScript-evaluation, selector, XPath, coordinate, screenshot, typing, form, upload, purchase or autonomous-browsing commands outside this contract.
