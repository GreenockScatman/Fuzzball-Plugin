# Fuzzball Web Control

A Chrome Manifest V3 companion for the Windows Fuzzball desktop assistant. It lists visible controls in the focused Chrome tab and dispatches a click or opens an ordinary link in a new tab. Site access is granted explicitly from the popup. There are no runtime dependencies, remote scripts, analytics, or cloud connections.

**Compatibility note:** the existing Fuzzball v1 server has no live enabled-state update message. The extension enforces its internal pause immediately and keeps its socket open, but the server's stored enabled flag changes only on a new handshake. See [protocol differences](docs/fuzzball-browser-protocol.md). The Python application was not modified.

## Build and load on Windows

Use Node.js 22 or newer and Chrome 120 or newer. In PowerShell, from this directory:

```powershell
npm.cmd ci
npm.cmd run check
```

This runs type checking, ESLint, Vitest and the production build. To build alone:

```powershell
npm.cmd run build
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select **this project's `dist` directory**, not the source directory.
5. Pin **Fuzzball Web Control** from Chrome's Extensions menu.

This workspace also contains an ignored, checksum-verified portable Node installation used during development. If Node is not on your PATH, this session's installation can be used without a system install:

```powershell
$env:Path = "$PWD\.tools\node-v24.21.0-win-x64;$env:Path"
npm.cmd run check
```

The portable tools are not part of the extension or required on other machines.

## Pair and grant access

Start Fuzzball with its browser-control server enabled. In Fuzzball's tray menu select **Copy browser-extension pairing token**. Open the extension popup, paste the token, keep port **8765** unless Fuzzball uses another port, then click **Save token and reconnect**. The default connection is `ws://127.0.0.1:8765/`, following the desktop-generated protocol.

The popup should show **Connected to Fuzzball**. Navigate to the site you want to control, open the popup and click **Allow on this site**. Accept Chrome's permission prompt. Close the popup, focus that Chrome page, and issue the voice command to Fuzzball.

The saved token is never filled back into the input. A blank token field preserves the saved token when changing the port or reconnecting. It is stored only in `chrome.storage.local`, with content-script access disabled. The popup receives only a `hasToken` flag.

Site grants are specific to scheme and hostname, and Chrome applies them across all ports. HTTP and HTTPS grants are separate. **Remove access to this site** revokes a narrow grant. The optional all-websites control includes a warning and an explicit acknowledgement. A broad grant must be removed with **Remove all website access** before individual sites can be excluded; Chrome cannot subtract one origin from a broad host grant.

## Internal pause

Turn off **Web control enabled** to stop inspections and actions immediately. The socket remains connected and requests fail with `extension_disabled`. The extension also sends the valid v1 error envelope with that code. Turn the toggle back on to permit local control again.

The current desktop server ignores unsolicited errors when updating its cached enabled flag and rejects the prompt's proposed `status` message. If the handshake occurred while paused, re-enabling locally cannot make that server select the session: click **Save token and reconnect**, leaving the token blank, to synchronize the flag. No automatic disconnect occurs when toggling. A compatible desktop protocol update is needed for full live pause-state reporting.

Uninstalling the extension or disabling it globally in `chrome://extensions` stops its reporting entirely. Fuzzball cannot conclusively distinguish those states from a closed browser or disconnected companion.

## How it works

The service worker authenticates with the local server, then handles strict, size-limited JSON requests. It selects the active tab in the last-focused **normal** Chrome window and verifies that window is currently focused. It checks site permissions before injecting the bundled content script into Chrome's isolated world.

Each snapshot scans afresh, walking ordinary DOM and open shadow roots. Accessible names come from ARIA labels/references, associated labels, image alternatives, button input values, titles and bounded visible text. Text inputs, passwords, textareas, editable regions, scripts and hidden text are excluded. Visibility checks include clipping, viewport intersection, hidden/inert ancestors, disabled state, pointer events and hit testing for covering elements.

Google organic results get `semantic_kind: search_result`, `scope: search_results` and role/scope ordinals. Ads, header links and related links are excluded from that group. The YouTube Music adapter recognizes playlist/song destinations, confidently labelled albums/artists, and player/item media controls. Main-player and item Play controls remain separate. Unrecognized layouts retain the generic role-based fallback. Fuzzball performs command matching and clarification.

Regular YouTube has a separate adapter for video titles and cards, including class-based lockups and cards with only a clickable thumbnail. Video links are available in `main_content`; search-page videos also carry `semantic_kind: search_result`. Equivalent title/thumbnail links in one card use a single visible title target. See the [YouTube repair notes](docs/youtube-troubleshooting.md) for diagnosis and reload steps.

Each candidate receives a random ID backed by an in-memory element reference for 15 seconds. A new snapshot replaces the previous candidate set. Chrome navigation events, document identities, changed names/destinations and final authorization protect against stale targets. Normal activation uses DOM `.click()`; safe new-tab actions use `chrome.tabs.create` with an opener. Success means dispatch completed, not that a website completed a transaction.

## Permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Local pairing/settings/profile ID, plus non-secret retry state in session storage. |
| `scripting` | Inject bundled code into permitted documents in the isolated world. |
| `tabs` | Read active-tab eligibility and create requested link tabs. |
| `alarms` | Reconnect after service-worker suspension. |
| `webNavigation` | Enumerate frame/document IDs and invalidate targets on normal and SPA navigation. No browsing history is stored. |
| Optional `http://*/*`, `https://*/*` | Allow popup-initiated grants for individual sites or all web sites. No website access is mandatory at install. |

The manifest does not request debugger, cookies, history, downloads, webRequest, clipboard, native messaging, file URL or incognito access.

## Connection lifecycle

The worker starts on installation, Chrome startup and worker restart. It sends the token only in `hello`, waits for `hello_ack`, then sends active-tab heartbeats immediately and every negotiated interval up to 20 seconds. Missing acknowledgements cause reconnection. Disconnections invalidate all pending requests and candidate routes; actions are never queued for reconnection.

Reconnect delay grows exponentially from roughly 0.75–1 second to 22.5–30 seconds with jitter. A 30-second Chrome alarm is a suspension fallback and may be delayed by Chrome. Retry state and authentication/protocol blocks survive worker restarts within the browser session. Pairing failure waits for an explicit **Save token and reconnect**, rather than repeatedly trying the same token. Restarting Chrome permits another attempt. Token/port saves replace obsolete sockets and timers immediately.

Chrome 120 is the minimum because this implementation uses the [30-second alarm support](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and the [WebSocket worker keepalive behavior](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets) introduced in Chrome 116.

## Test commands

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

The last command uses an isolated headless Chrome profile and a temporary loopback-only fixture server. It verifies rendered visibility and actual DOM activation; it does not install the extension or pair with Fuzzball. If Chrome is installed elsewhere:

```powershell
$env:CHROME_PATH = 'C:\path\to\chrome.exe'
npm.cmd run test:browser
```

See [installation and manual acceptance](docs/installation.md), [security and privacy](docs/security.md), [protocol implementation notes](docs/fuzzball-browser-protocol.md), and the [completion report](docs/completion-report.md).

## Project structure

```text
manifest.json                     MV3 permissions, CSP and entry points
package.json / package-lock.json   scripts and locked development tools
tsconfig.json                     strict TypeScript checks
build.mjs                         esbuild bundles and static-file copies
eslint.config.mjs                 ESLint configuration
vitest.config.ts                  DOM test configuration
src/
  background/                     service-worker.ts, connection-manager.ts, request-router.ts
  content/                        content-script.ts, element-scanner.ts, accessible-name.ts,
                                  visibility.ts, action-executor.ts, candidate-store.ts
  adapters/                       generic.ts, google-search.ts, youtube-music.ts, youtube.ts
  popup/                          popup.html, popup.css, popup.ts
  protocol/                       messages.ts, validation.ts, errors.ts
  shared/                         constants.ts, settings.ts, permissions.ts, logging.ts
tests/
  fixtures/                       generic.html, google.html, youtube-music.html, youtube.html
  *.test.ts                       transport, protocol, permissions/popup, scanner/actions,
                                  routing, content lifecycle and manifest tests
  helpers.ts                      Chrome API and DOM-layout mocks
scripts/browser-smoke.mjs          rendered Chrome smoke checks
docs/
  browser_extension_protocol.md   unmodified copy of the desktop protocol authority
  fuzzball-browser-protocol.md     implementation differences and versioning
  installation.md                 pairing, troubleshooting and acceptance checklist
  security.md                     trust boundaries and limitations
  completion-report.md            delivered files and verification record
  youtube-troubleshooting.md      regular YouTube title-matching repair and reload steps
dist/                             generated extension; load this directory into Chrome
```

## Known limits

Canvas-only controls, closed shadow roots, protected browser pages and incognito are unsupported. Some sites reject synthetic activation or require trusted gestures. Frame scanning needs permission for both the child and each embedding parent; hidden, clipped, transformed, opaque, ambiguously embedded or inaccessible frames are skipped. Frame groups follow the top document, then Chrome frame-ID order. Arbitrary iframe navigation that no longer matches the embedding `src` is skipped.

Direct form submit/reset controls, download links, unsafe URL schemes, typing, uploads and automation beyond a single supported action are rejected. The scanner is bounded to 200 returned candidates and 20,000 visited elements, so very large pages may omit later controls. Risk metadata is advisory; Fuzzball owns confirmation. Site markup can change, and fixture results do not establish live Google/YouTube compatibility. The 15-second candidate lifetime may require a fresh snapshot if voice confirmation takes longer.

Permission and focus verification crosses Chrome's process boundary; an action already dispatched cannot be revoked if the user changes focus immediately afterward. The extension does not claim to verify remote transaction completion.
