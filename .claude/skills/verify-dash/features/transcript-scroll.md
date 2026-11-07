# Transcript scroll and history

While a reply streams, the transcript follows the newest text. Scrolling up stops the follow and shows a `Latest reply` button; tapping it jumps to the newest content and resumes the follow. A quick scroll button with an unread badge is designed for the same job. Scrolling to the top of a long chat pages in older history under a skeleton header.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.15 scrolling up stops auto-follow while content streams; Latest reply scrolls to newest and resumes follow"; "07.16 RC3 #385/#393 jump-to-latest quick scroll button with unread badge shows when scrolled up and hides after tap"; "07.18 scrolling to the top of a long session loads older history with a skeleton header"

## Sub-features

- `scroll-follow` view chases new chunks while a reply streams [UNCOVERED]
- `scroll-pause` wheel up stops the follow while content keeps arriving [UNCOVERED]
- `scroll-latest` `Latest reply` jumps to newest and follow resumes (the click path is exercised only inside the prompt-rail test, not the follow behaviour) [UNCOVERED]
- `scroll-quick-button` `quick-scroll-button` with unread badge, `Jump to latest...` [UNCOVERED] (expected FAIL at 2c948dc: not mounted)
- `scroll-history` top of a long chat loads older rows, `SkeletonRow` header while loading [UNCOVERED]

## How to get to it (user POV)

- Send a prompt and watch the reply stream; scroll the transcript with wheel or touch.
- Open a long saved chat and scroll to its start.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent emits one short reply, so there is nothing to follow. The draft needs an `ARMY_R07_SLOW` scenario (many timed chunks) from an uncommitted fixture-agent extension. History paging needs a 120-message Hermes chat written into the isolated HOME by uncommitted `rc3-chat-index-seed.ts` while the bridge is stopped (`bridge.stop()`, seed, `bridge.start()`).
- Throttle the network with a CDP `Network.emulateNetworkConditions` latency so the skeleton is observable.

- **Start streaming.** `await openChat(page,bridge)`; `await send(page,'ARMY_HANG ARMY_R07_SLOW follow journey')`; wait for `ARMY_SLOW_CHUNK_08`.
- **Scroll up.** `page.mouse.move` over `getByTestId('transcript-viewport')`, then `page.mouse.wheel(0,-2500)` five times. Read the inner scroller's `scrollTop`/`scrollHeight`: distance from the bottom is over 200 px and stays so while `scrollHeight` grows.
- **Latest.** `await page.getByRole('button',{name:/^Latest( live)? reply$/}).click()`. Distance from the bottom is 60 px or less, and `ARMY_SLOW_DONE` ends in the viewport.
- **Quick button (draft).** `page.getByTestId('quick-scroll-button')` with `aria-label` `/^Jump to latest/`, above the composer; gone after tap.
- **History.** Open the seeded row by title; `ARMY_HIST_A_119` visible, `ARMY_HIST_Q_000` absent; wheel up until `ARMY_HIST_Q_000` is visible, and a text-free 72 px skeleton row was seen in between.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/transcript-scroll.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm` showing the pause and resume, `trace.zip`, `bridge.log`; scroll distances recorded in assertions, not just the screenshot.

## Gotchas

- The scroller is a nested overflow div under `transcript-viewport`; locate it by computed `overflow-y`, not by role.
- `Latest reply` is a PromptRail control and may need the rail to be laid out; it reads `Latest live reply` during a running turn.
- `QuickScrollButton` has no importer at this checkout, so `quick-scroll-button` does not exist; the draft is expected to fail.
- The skeleton has no text or role: match a 72 px row with a 28 px orb. A fast network never shows it, so add latency.
- Do not wheel before the first chunks land; there is nothing to scroll.
