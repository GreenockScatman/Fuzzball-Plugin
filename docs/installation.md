# Windows installation and acceptance testing

## Build and install

1. Install Node.js 22 or newer if it is not already available. Open PowerShell in the extension project.
2. Run `npm.cmd ci` and `npm.cmd run check`.
3. Open `chrome://extensions` in Chrome 120 or newer.
4. Turn on **Developer mode** in the top-right corner.
5. Choose **Load unpacked** and select `fuzzball-web-control\dist`.
6. Verify the extension is named **Fuzzball Web Control**, version **0.1.1**, and has no manifest/load errors. Pin it using Chrome's Extensions menu.

For this workspace, the generated directory is:

```text
C:\Users\risto\OneDrive\Documents\Projects\fuzzball-web-control\dist
```

After a source change, run `npm.cmd run build`, click the extension's **Reload** button in `chrome://extensions`, and reload any previously controlled test page. Do not load the source directory: Chrome needs the generated JavaScript bundles.

## Pairing

1. Start the Fuzzball Windows desktop application with browser control enabled.
2. Use its tray action **Copy browser-extension pairing token**. Do not paste the token into a command, issue report or browser page.
3. Open the extension popup. Paste into **Pairing token**.
4. Keep port **8765**, or enter the same port configured in Fuzzball. The host is fixed to `127.0.0.1` and the protocol uses `/`.
5. Click **Save token and reconnect**. Expected: **Connected to Fuzzball**.
6. Close and reopen the popup. Expected: empty password input with a masked saved-token placeholder, never the saved token itself.

If Fuzzball restricts `allowed_extension_ids`, copy this unpacked extension's ID from its `chrome://extensions` card and add it through your normal Fuzzball configuration process. The extension never edits that configuration.

## Troubleshooting

| State or symptom | Meaning and next step |
| --- | --- |
| Pairing token required | No saved token. Copy it from Fuzzball's tray menu and save it in the popup. |
| Waiting for Fuzzball | The server is stopped, the port is different, or the socket is reconnecting. Start Fuzzball, check its browser-control status, and compare ports. Expected automatic recovery after startup/restart. |
| Pairing rejected | The token, extension Origin or allowlist check failed. Copy the current token and check Fuzzball's allowed extension IDs. Click Save token and reconnect to retry. |
| Protocol mismatch | Peer versions or heartbeat settings are incompatible. Align the desktop/extension protocol, then reconnect. No arbitrary protocol fields can be added to v1. |
| Connected to Fuzzball | Authentication completed. Site access and focused-window checks still apply. |
| Web control paused | Toggle Web control enabled back on. The socket stayed open. See the enabled-state caveat below. |
| Permission required for this site | Open the popup on that HTTP/HTTPS page and click Allow on this site. Accept Chrome's prompt. If the browser itself has withheld access, enable it in the extension's Site access settings. |
| This page cannot be controlled | Use an ordinary HTTP/HTTPS page outside incognito. Browser-internal pages, Web Store pages, files and unsupported schemes cannot be controlled. |
| Ready | Connected, locally enabled and the current site has a grant. Close the popup and leave the intended browser window focused before issuing a command. |
| Fuzzball cannot update its enabled flag | The existing desktop protocol has no live state update. After setting the desired toggle value, click Save token and reconnect with the token field blank. |
| Remove access to this site is disabled | A broad all-sites grant may cover it. Use Remove all website access, then grant only wanted sites again. |
| `stale_document`, `navigation_changed`, `element_disappeared` | The page, candidate set or target changed, or 15 seconds elapsed. Ask Fuzzball for a fresh snapshot/action. |
| `element_not_interactable` | Target is hidden, disabled, covered, retargeted, offscreen or inside an unsupported embedding. Make it visible and request a fresh scan. |
| `unsupported_capability` | The target/action is outside the supported click and safe-anchor-new-tab capabilities. Downloads, direct form submit/reset and unsafe URL schemes are rejected. |
| `timeout` | Chrome did not complete within the request deadline, or a snapshot was already running. Wait for it to finish and make a fresh request. Old timed-out commands will not be queued for later. |
| `malformed_response` | Message failed runtime validation or its request ID was reused. Check the peer against the protocol document; do not log raw messages. A session also requires reconnect after 10,000 distinct requests. |
| `no_active_tab` | Focus the intended normal Chrome window and its desired tab. With several profiles, leave only the intended browser instance focused. |

## Internal toggle compatibility

Local pause is immediate and never causes an automatic disconnect. Requests while paused receive `extension_disabled`; an unsolicited v1 error notice is also sent. The currently inspected Fuzzball server stores enabled state only from `hello` and ignores that unsolicited notice for state changes. A desktop update is needed to make its status indicator follow toggles while connected.

Until then, **Save token and reconnect** explicitly synchronizes the chosen toggle value. Re-enabling a session whose handshake said `enabled:false` needs this step before the desktop selects it again. This is a known acceptance limitation, not a passed live-state test.

## Manual acceptance checklist

These are manual checks to perform on your Windows desktop. They were not performed against a running Fuzzball instance or live Google/YouTube accounts during development.

1. **Build/load:** Run the build and load `dist` as above. Expected: the extension card loads without errors and the popup opens.
2. **Pair:** Copy the token from the Fuzzball tray, save it in the popup and reopen the popup. Expected: connection succeeds; the saved token is not revealed.
3. **Connection:** Confirm **Connected to Fuzzball** and verify the desktop detects the companion. Expected: exactly the intended Chrome profile/session is selected.
4. **Pause:** Turn off Web control enabled without closing Chrome. Expected: the extension stays connected and blocks snapshots/actions with `extension_disabled`. Check the desktop indicator separately: the existing server's cached flag is a known limitation until its protocol supports live updates.
5. **Resume:** Turn it back on without reinstalling. Expected: the same socket remains open and local control resumes. If the handshake originally occurred while paused, explicitly reconnect to synchronize the desktop flag.
6. **Missing permission:** Visit a harmless new site without granting access. Expected: the popup says **Permission required for this site**. A direct snapshot request receives `permission_required`. The desktop may instead fail session selection with `no_active_tab` before sending a request, because the authoritative heartbeat allows `active_tab:null` for an unpermitted tab.
7. **Grant/revoke:** Click Allow on this site and accept Chrome's dialog. Request a control. Then click Remove access to this site and request again. Expected: control works only during the grant. For a broad grant, remove all website access first.
8. **Multiple windows:** Open two or three normal Chrome windows, each with a different allowed page and active tab. Focus window B and request a snapshot/action; then focus C and repeat. Expected: each response uses that window's actual ID and active tab ID. Minimize Chrome or focus Notepad and request again: expected `no_active_tab`, with no background click. Return focus to Chrome before subsequent tests.
9. **Playlist:** On `music.youtube.com`, grant access, locate a visible playlist titled **Real Human Beans**, close the popup and ask Fuzzball to click that playlist. Expected: a playlist candidate is matched and activated; account/library availability is yours to supply.
10. **Main player:** Make the player bar's Play button visible. Ask Fuzzball for the main player Play control. Expected: its candidate is `media_control` in scope `any`; row Play controls use `main_content`. Matching behavior and any clarification are owned by Fuzzball.
11. **Ambiguous Play:** Display multiple rows with Play buttons plus the player bar. Request Play ambiguously. Expected: distinct candidates remain present and Fuzzball asks for clarification if necessary; the extension does not collapse or guess among them.
12. **Named Google result:** On an ordinary regional Google search page, find a visible organic result titled **Top Recipes**, grant access and ask to click it. Expected: title used as name and `scope:search_results`. If that exact title is not present, use the local fixture procedure below rather than inventing a live result.
13. **Top organic result:** Use a Google page with header/filter links and, if present, ads above the organic results. Ask “click the top link.” Expected: organic `search_results` ordinal 1 is used, rather than a header, sponsored or related link. Inspect matching behavior in Fuzzball if it chooses a different scope.
14. **New tab:** Ask to open the first organic result in a new tab. Expected: a new background tab in the same window with the original tab as opener; the original remains active. Buttons, download anchors and unsafe schemes fail cleanly.
15. **Stale target:** On a harmless test page, trigger a command that requests confirmation (for example a no-op button labelled Remove test item). After Fuzzball has selected it and before confirming, navigate the same tab elsewhere, then confirm. Expected: `stale_document`, `navigation_changed` or `element_disappeared`, and no activation on either the old or new page. Repeat with a delay over 15 seconds; a fresh snapshot is required.
16. **Reconnect/restart:** Stop Fuzzball, wait for Waiting for Fuzzball, then start it. Expected: automatic reconnection within the bounded retry/alarm schedule. Repeat after Chrome restart. To exercise worker restart separately, open `chrome://serviceworker-internals`, find this extension's worker and stop it if the Chrome version exposes that control; focus an allowed normal page and allow up to a minute for the reconnect alarm. Authentication failures require an explicit pairing save.
17. **Protected pages:** Visit `chrome://settings`, a Chrome Web Store page and a local file URL; also check an incognito window. Expected: no injection or action. Incognito does not expose the extension because the manifest disallows it.
18. **Privacy:** Open `chrome://extensions`, click this extension's service-worker Inspect link, and observe normal Console messages while taking snapshots/clicks on harmless fixtures. Expected: only request IDs, state, counts, codes and success flags; no token, URL, page content or labels. Closing DevTools restores normal worker suspension behavior. Do not copy storage or WebSocket hello frames into diagnostic reports.

## Local fixtures and browser smoke checks

`npm.cmd run test:browser` serves an ephemeral fixture only on `127.0.0.1`, runs eleven rendered checks in a separate headless Chrome profile under ignored `.tools`, then closes the server. It covers a normal control, open shadow DOM, hidden/offscreen/covered controls, private descendant exclusion and actual click dispatch, plus YouTube title matching, scoped result metadata, thumbnail deduplication and title activation. The test harness simulates a YouTube URL while rendering only local fixtures. It does not establish real extension permission prompts, service-worker installation, live YouTube behavior or desktop pairing.

For a manually viewable fixture on a machine with Python installed, open a separate PowerShell in this project and run:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory tests/fixtures
```

Open `http://127.0.0.1:8000/generic.html`, `google.html` or `youtube-music.html` and grant this local site. Stop the fixture server with Ctrl+C when finished. These pages verify generic labels/visibility and multiple controls; site-specific adapter classification is host-dependent and is covered by automated fixture tests, not by pretending a localhost page is Google or YouTube Music.

Do not confirm real purchases, deletions or account changes merely to test the extension. Use no-op local controls for stale-action/confirmation tests.
