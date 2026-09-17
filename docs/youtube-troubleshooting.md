# YouTube title matching fix (0.1.1)

## Evidence and diagnosis

The desktop's `contextual_voice_assistant/logs/assistant.log` records a successful YouTube search on 2026-09-14 at 21:25:11, followed by a title-click request at 21:25:23 with `role: link`, `scope: main_content`. The result is `no_match`. The authenticated extension session was connected; no permission, timeout or activation error was recorded for that request.

Version 0.1.0 had a YouTube Music adapter only. Regular YouTube video cards passed through the generic adapter, which only assigned `main_content` beneath `<main>` or `[role=main]`. A card built from YouTube custom elements without those landmarks therefore fell into `scope:any` and was excluded by the desktop's strict main-content filter. The same video could also appear twice through its thumbnail and title links, producing ambiguous matches.

The original logs intentionally do not contain raw snapshots, so they cannot prove which elements were present on the user's exact page. A local fixture reproducing the custom-element structure and logged request failed before the patch: the title was unavailable in `main_content`. Public YouTube search did not expose a usable live DOM through the available web reader. No live signed-in YouTube page was inspected or acted upon during this repair.

## Patch

`src/adapters/youtube.ts` recognizes normal YouTube video-card/title structures, newer lockup title structures, and a heading-link fallback. The scanner invokes it separately from the existing YouTube Music adapter.

- Video links get `scope:main_content`, so the logged title request can find them.
- Videos on `/results` additionally get `semantic_kind:search_result`. The existing desktop matcher accepts that semantic value for `scope:search_results`, supporting either request without duplicate candidate IDs or a wire-schema change.
- The visible video title is used as the name rather than a verbose ARIA label containing uploader/view/duration metadata.
- Equivalent thumbnail links are omitted only when an interactable title link exists in the same card. Hidden titles do not remove visible thumbnail alternatives. Different timestamps, playlist parameters and separate result cards remain distinct.
- Header, channel and related links are not promoted into the video group; known sponsored containers are excluded from that group.
- All existing candidate expiry, permission, visibility, document and click checks still run.

The one-based ordinals remain within role/scope groups. Google continues to use `scope:search_results` for organic results; its adapter and the desktop application were not changed. This YouTube representation uses the desktop's already-supported semantic fallback to accommodate the logged main-content request.

## Verification and reloading

The new regression file has 13 passing tests. The full suite passes 158 tests across 8 files; type checking, linting and the production build pass. Eleven headless Chrome checks pass, including rendered YouTube title selection, matching metadata, thumbnail deduplication and actual title-link activation on a local fixture with a simulated YouTube URL. These are fixture checks, not a claim of live-site acceptance.

To apply the rebuilt extension:

1. Open `chrome://extensions` and click **Reload** on **Fuzzball Web Control**.
2. Refresh the YouTube tab so its old content script is replaced.
3. Open the popup and verify version **0.1.1**, Connected to Fuzzball, and site access granted for `www.youtube.com`.
4. Focus the YouTube results tab, make the intended video title visible and ask Fuzzball to click that exact title again.

If it still fails, record the command time and reported error code. The worker Console's snapshot candidate count can help distinguish an empty scan from a desktop scope/matching problem without copying tokens or raw page content. The desktop logs also showed occasional scope/context mistakes on other sites; those planner decisions were outside this extension-only patch.
