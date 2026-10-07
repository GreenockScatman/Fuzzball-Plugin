# YouTube title and video-order repair (0.1.4)

## Saved-source investigation and visibility repair: 2026-10-05

The 16:19 desktop logs confirm that extension **0.1.3** was connected, while both the named-video and third-result requests still received zero candidates. The earlier stale-version diagnosis therefore did not explain this retest.

The user supplied a Chrome view-source save in `Temp` and a screenshot showing the search results. The file was parsed without executing its scripts or fetching its resources. Its decoded HTML contains YouTube's initial shell, embedded search-result data and the rule `body{padding:0;margin:0;overflow-y:scroll}`; it does not contain the fully hydrated video-card DOM. The user's file was preserved and was not copied into tests or build output.

Inspection exposed a bug in `src/content/visibility.ts`: it intersected every candidate with the body rectangle whenever body overflow was scrollable. When body overflow propagates to the root, Chrome clips against the viewport instead. A body can have zero height while positioned descendants are visible and clickable. Intersecting with that zero-height rectangle incorrectly excludes every control.

A rendered Chrome fixture using the saved body's overflow rule and a fixed content shell reproduced the empty scan before the repair. The visibility calculation now uses the viewport for root overflow and propagated body overflow. Ordinary scroll/clip containers retain their own clipping checks, and a body still clips when the root's overflow prevents propagation. The patched fixture discovers three screenshot-title videos and dispatches the third video's click; genuinely clipped controls remain excluded.

Desktop regression coverage also verifies that “Adorable Kittens Meet a Playful Piglet” and ordinal 3 both select the third screenshot video despite its emoji and title suffix. A temporary read-only live probe encountered a focused Google tab rather than the supplied YouTube page, so it did not establish the live YouTube body's dimensions. The temporary probe was removed and the production content script was rebuilt.

Verification: **304 desktop tests pass**, with two optional tests skipped; **169 extension tests pass**, along with type checking, linting and the production build; **18 rendered Chrome checks pass**. The desktop suite was run with temporary files outside OneDrive after an unrelated file-replacement permission failure in its synced temporary directory.

Reload Web Control at `chrome://extensions`, confirm **0.1.4**, refresh the YouTube tab, and restart Fuzzball. On the screenshot's page, test “click the third video link on the page” and “click the link that says Adorable Kittens Meet a Playful Piglet”. Both should open the kittens/piglet video. Repeat on the YouTube home page. Live voice acceptance remains a retest.

## Earlier repair: 0.1.3

The new desktop log records an authenticated Chrome connection followed by repeated `no_match` failures for both named videos and the third result. A temporary read-only instance of Fuzzball's existing loopback browser server confirmed that the connected extension was still **0.1.1**, and its focused `https://www.youtube.com/` page snapshot returned **zero candidates**. Chrome's extension registration points to this project's `dist` folder. The diagnostic server was stopped after inspection; the pairing token was neither printed nor changed.

The scanner's previous traversal budget counted every DOM element, including decorations and hidden markup. A regression fixture with 20,100 non-interactive elements before two visible videos reproduced the empty result. The scanner now queries actionable controls separately from bounded shadow-root discovery, so decorative nodes cannot consume its control budget. Interleaved shadow-root controls retain page order. This fixes a reproduced mechanism for empty scans; the exact structure of the current live page was not inspected.

The desktop log also shows “open YouTube and search for cat videos” being planned as `open_youtube` with a query. Argument cleanup discarded that query, opening only the home page. Explicit search requests now preserve the query by converting that proposed step to `youtube_search` before cleanup. Plain home-page requests do not reuse stale queries.

Desktop logs now include the connected extension version and candidate, usable-candidate and video counts before matching, including failed matches. They do not record page titles, target titles, search queries, candidate text or pairing tokens.

Current verification: **302 desktop tests pass**, with two optional live transcription tests skipped; **167 extension tests pass**, and type checking, linting and build pass. The rendered Chrome harness also covers video extraction after the large decorative prefix. Live voice acceptance remains a retest.

Restart Fuzzball, reload **Fuzzball Web Control** at `chrome://extensions`, and refresh the YouTube tab. Confirm the popup reads **0.1.3** before testing named and third-video commands on both home and search pages. The latest unpacked build is in this project's `dist` folder. A reload is necessary: the read-only runtime check showed that rebuilding on disk had not updated the running 0.1.1 extension.

## Earlier repair: 0.1.2

The latest report concerns named videos and commands such as “click the third video link on the page” on both YouTube home and search pages. The available desktop log ends on 2026-09-24; it cannot establish the exact failure of this latest report. No existing YouTube tab was accessible through the browser tools. The diagnosis below is reproduced in local fixtures, rather than claimed as an observation of the user's current live page.

Regression tests exposed missing titles for class-based lockup cards and image-only links with sibling headings, extra channel/related links in the main-content group, and lost video classification when titles contained words such as “remove”. The adapter now handles these layouts, extracts clean visible titles, retains video classification, and keeps equivalent thumbnail/title targets deduplicated. Playback timestamps and separate cards remain distinct.

The desktop assistant was also patched in the neighboring `Fuzzball/contextual_voice_assistant` project. Its YouTube ordinal selection previously used the extension's entire role/scope group: the third entry could be a playlist rather than the third video. It now counts only usable classified video links for numbered content requests. Home-page named-video requests also accept a search-results scope by mapping it to main content. Explicit video-title and numbered-video command forms are planned locally; ordinary searches, other commands and compound requests retain remote planning. The browser wire protocol remains version 1.

Verification: all 165 extension tests, type checking, linting and production build pass. All 299 desktop tests pass, with two opt-in live transcription tests skipped. Fourteen headless Chrome fixture checks pass, including home/search title discovery, thumbnail deduplication, third-video activation and the correct URL for a named video opened in a new tab. These do not prove live YouTube or microphone recognition.

To test the patch:

1. Restart Fuzzball from the updated desktop project.
2. Open `chrome://extensions`, reload **Fuzzball Web Control**, and refresh the YouTube tab. The rebuilt unpacked extension is in this project's `dist` folder; confirm popup version **0.1.2**, a connected assistant, and existing site access for YouTube.
3. Focus YouTube home with at least three visible videos. Say “click the third video link on the page”. Expect the third visible video, excluding navigation, channels, advertisements and playlists.
4. Return to home, then say “open the video titled [exact visible title]”. Expect that video's watch page.
5. Repeat both commands on a YouTube search page. Also try “open the third video in a new tab”. Expect a new tab for the third visible video.

Only visible, interactable candidates count. If an error remains, retain its wording and command time for diagnosis. The patch has not been committed or published.

## Earlier repair: 0.1.1

### Evidence and diagnosis

The desktop's `contextual_voice_assistant/logs/assistant.log` records a successful YouTube search on 2026-09-14 at 21:25:11, followed by a title-click request at 21:25:23 with `role: link`, `scope: main_content`. The result is `no_match`. The authenticated extension session was connected; no permission, timeout or activation error was recorded for that request.

Version 0.1.0 had a YouTube Music adapter only. Regular YouTube video cards passed through the generic adapter, which only assigned `main_content` beneath `<main>` or `[role=main]`. A card built from YouTube custom elements without those landmarks therefore fell into `scope:any` and was excluded by the desktop's strict main-content filter. The same video could also appear twice through its thumbnail and title links, producing ambiguous matches.

The original logs intentionally do not contain raw snapshots, so they cannot prove which elements were present on the user's exact page. A local fixture reproducing the custom-element structure and logged request failed before the patch: the title was unavailable in `main_content`. Public YouTube search did not expose a usable live DOM through the available web reader. No live signed-in YouTube page was inspected or acted upon during this repair.

### Patch

`src/adapters/youtube.ts` recognizes normal YouTube video-card/title structures, newer lockup title structures, and a heading-link fallback. The scanner invokes it separately from the existing YouTube Music adapter.

- Video links get `scope:main_content`, so the logged title request can find them.
- Videos on `/results` additionally get `semantic_kind:search_result`. The existing desktop matcher accepts that semantic value for `scope:search_results`, supporting either request without duplicate candidate IDs or a wire-schema change.
- The visible video title is used as the name rather than a verbose ARIA label containing uploader/view/duration metadata.
- Equivalent thumbnail links are omitted only when an interactable title link exists in the same card. Hidden titles do not remove visible thumbnail alternatives. Different timestamps, playlist parameters and separate result cards remain distinct.
- Header, channel and related links are not promoted into the video group; known sponsored containers are excluded from that group.
- All existing candidate expiry, permission, visibility, document and click checks still run.

The one-based ordinals remain within role/scope groups. Google continues to use `scope:search_results` for organic results; its adapter and the desktop application were not changed. This YouTube representation uses the desktop's already-supported semantic fallback to accommodate the logged main-content request.

### Historical verification and reloading

The new regression file has 13 passing tests. The full suite passes 158 tests across 8 files; type checking, linting and the production build pass. Eleven headless Chrome checks pass, including rendered YouTube title selection, matching metadata, thumbnail deduplication and actual title-link activation on a local fixture with a simulated YouTube URL. These are fixture checks, not a claim of live-site acceptance.

To apply the rebuilt extension:

1. Open `chrome://extensions` and click **Reload** on **Fuzzball Web Control**.
2. Refresh the YouTube tab so its old content script is replaced.
3. Open the popup and verify version **0.1.1**, Connected to Fuzzball, and site access granted for `www.youtube.com`.
4. Focus the YouTube results tab, make the intended video title visible and ask Fuzzball to click that exact title again.

If it still fails, record the command time and reported error code. The worker Console's snapshot candidate count can help distinguish an empty scan from a desktop scope/matching problem without copying tokens or raw page content. The desktop logs also showed occasional scope/context mistakes on other sites; those planner decisions were outside this extension-only patch.
