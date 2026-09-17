# Delivery and verification record

Updated to **0.1.1** with the regular YouTube title-matching repair. See [the diagnosis and reload instructions](youtube-troubleshooting.md).

The project is implemented in this separate workspace. The generated unpacked extension is `dist/`. The Fuzzball Python application was inspected read-only for its protocol and was not modified. No Git repository existed in the workspace at the start; no commit, push, pull request, deployment or store publication was performed.

## Files delivered

All source files are newly created. The complete layout is in [README.md](../README.md#project-structure).

- Root: `manifest.json`, `package.json`, `package-lock.json`, `tsconfig.json`, `build.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `README.md`.
- Background: `src/background/service-worker.ts`, `connection-manager.ts`, `request-router.ts`.
- Content: `src/content/content-script.ts`, `element-scanner.ts`, `accessible-name.ts`, `visibility.ts`, `action-executor.ts`, `candidate-store.ts`.
- Adapters: `src/adapters/generic.ts`, `google-search.ts`, `youtube-music.ts`, `youtube.ts`.
- Popup: `src/popup/popup.html`, `popup.css`, `popup.ts`.
- Protocol: `src/protocol/messages.ts`, `validation.ts`, `errors.ts`.
- Shared: `src/shared/constants.ts`, `settings.ts`, `permissions.ts`, `logging.ts`.
- Tests: `tests/protocol-settings.test.ts`, `transport.test.ts`, `permissions-popup.test.ts`, `scanner-actions.test.ts`, `router.test.ts`, `content-lifecycle.test.ts`, `manifest.test.ts`, `youtube.test.ts`, `helpers.ts`, plus `fixtures/generic.html`, `google.html`, `youtube-music.html`, `youtube.html`.
- Development browser check: `scripts/browser-smoke.mjs`.
- Documentation: `docs/installation.md`, `security.md`, `fuzzball-browser-protocol.md`, `completion-report.md`, `youtube-troubleshooting.md`, and an unchanged copy of `docs/browser_extension_protocol.md` from the desktop project.
- Generated output: `dist/manifest.json`, `dist/background/service-worker.js`, `dist/content/content-script.js`, `dist/popup/popup.html`, `popup.css`, `popup.js`.

`node_modules`, the portable Node/isolated Chrome test profile under `.tools`, and `dist` are ignored build/development artifacts. No credential was supplied or included.

## Implemented behavior

The build uses **esbuild**, TypeScript, plain HTML/CSS and **Vitest with jsdom**. No UI framework or runtime library is bundled.

Permissions are `storage`, `scripting`, `tabs`, `alarms`, `webNavigation`, plus optional HTTP/HTTPS hosts. Their individual purposes are documented in the [README permission table](../README.md#permissions). Host grants are explicit, revocable and checked before use. Internal/browser/file/incognito/Web Store pages fail safely. CSP restricts executable code to the bundle and connections to loopback WebSockets.

The worker authenticates at `ws://127.0.0.1:8765/`, sends active-tab heartbeats, backs off with jitter, uses an alarm fallback, blocks repeated failed authentication, recreates state after worker startup, and cancels pending work after disconnect. Pairing tokens stay in trusted-context local storage and the hello handshake; the popup sees only whether one is saved.

Scanning covers visible ordinary/open-shadow DOM, uses bounded accessible names and text, applies main-content preference, and excludes private form/hidden/script contents. Google results are classified into organic result scope with correct role/scope ordinals. YouTube Music playlist, song, confidently identified album/artist and separate player/item media controls are supported, with generic fallback.

Opaque candidates expire after 15 seconds and are invalidated by new snapshots/navigation. Actions require focused-window/tab, permission, document, candidate and interaction checks plus final background authorization. Click success means dispatch; new-tab actions validate ordinary anchor destinations and use Chrome's tabs API with an opener.

## Verification

Commands used:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run test:browser
```

The final fixture suite contains **158 passing tests across 8 files**, covering transport, validation, storage, permissions/popup, DOM scanning, adapters, action execution, navigation/routing, content lifecycle and manifest restrictions. This includes UTF-8 snapshot byte limits, redaction of a token echoed in a request ID, organic-result ordinals through the complete scanner, and 13 regular YouTube regressions. Type checking and linting pass. The production build succeeds.

The real Chrome headless smoke check passes **11 rendered checks**: visible button, open shadow root, hidden/offscreen exclusion, covered-element exclusion, private descendant exclusion, ordinary result-label fallback, actual DOM click dispatch, YouTube title matching, YouTube scoped result metadata, thumbnail deduplication, and title activation. It uses a separate test profile and a loopback fixture, not the user's browsing profile. YouTube host selection is simulated only in the local test harness.

The first test run needed fixture-path and mock typing corrections. Subsequent tests passed. The sandbox prevented esbuild traversing a parent directory, so build/test commands required the execution tool's approved filesystem escalation. One expanded-suite attempt was rejected by automatic approval review due to the account usage limit; after the user requested retry, all 142 tests passed. These tooling events did not change extension permissions or runtime behavior.

## Checks still requiring the user's desktop

No live Fuzzball pairing, unpacked-extension installation UI, Chrome restart/suspension acceptance, multiple visible Chrome windows, permission prompt UI, or live Google/YouTube Music account interaction was manually verified. Exact Windows steps and expected results are in [installation.md](installation.md#manual-acceptance-checklist). Automated mocks and a headless DOM smoke test are not presented as proof of those manual flows.

## Protocol differences and remaining limits

The full discrepancy table is in [fuzzball-browser-protocol.md](fuzzball-browser-protocol.md#differences-from-the-original-extension-prompt). The main differences are the root WebSocket path, active-tab heartbeats, strict candidate fields/roles/scopes, role/scope ordinals, and absent live status message. Risk hints use `semantic_kind`; destination URLs stay internal. Direct form submissions are rejected under the desktop v1 boundary.

**Unresolved desktop compatibility:** local pause is implemented and does not disconnect. The existing desktop server cannot change its cached enabled flag while connected because its authoritative v1 schema has no status update. A valid unsolicited `extension_disabled` error reports pause, and paused requests return that code, but a user-requested reconnect is currently necessary to synchronize the cached flag. A Python/protocol change would be needed for full live reporting; it is outside this task's authorized scope.

Other limits are canvas/closed-shadow DOM, protected pages, synthetic activation restrictions, conservative frame support, large-page bounds, 15-second target expiry, and site markup changes. Frame groups are ordered after the main document, then by Chrome frame ID. Live-site results remain unverified. Uninstalling or globally disabling the extension prevents reporting entirely.

## Load the delivered build

Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select:

```text
C:\Users\risto\OneDrive\Documents\Projects\fuzzball-web-control\dist
```

Then copy the token from Fuzzball's tray, save it in the popup, and grant the intended website from **Allow on this site**.
