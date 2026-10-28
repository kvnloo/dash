# Dash verification map

This directory is the maintained source for verifying what a Dash user can see and do. Read this index before driving the app, then use the matching feature file as the recipe. Every recipe runs through the e2e tester army (`e2e/mbp-army`), and nothing else counts as proof. See [`../SKILL.md`](../SKILL.md) for launch, doctor, drive, evidence and cleanup.

## Baseline preconditions

- A stack is up for the commit under test: `army-stack.sh up <run>`, then `army-stack.sh doctor <run>` prints `doctor: stack '<run>' is worth driving`.
- The private headless Sway is running (`army-stack.sh sway-up`). The physical display, the owner's phone and the live bridge are never touched.
- Each test gets its own real bridge from `createBridge()` in `e2e/mbp-army/fixtures.ts`: a temporary HOME, a loopback port, a PID namespace, and `hermes`/`omp` that resolve to the scripted fixture agent `e2e/mbp-army/fixture-agent.ts`. The bridge also has the gate enabled with a seeded dry-run approval (`seed-gate.ts`). It exposes a native OMP row and a Hermes row named `army-fixture-session`.
- The fixture agent's replies are scripted by prompt text. Any prompt streams `ARMY_STREAM_BEGIN `, then `ARMY_REPLY: <prompt>` after 350 ms. With `ARMY_SLOW` the reply comes after 9 s, with `ARMY_HANG` it never ends (until Stop), and with `ARMY_ERROR` the agent fails with `ARMY_EXPECTED_AGENT_ERROR`.

## Driving conventions

- Start every journey with the fixture helpers: `pair(page, bridge)` pairs over Tailscale and selects the Chats tab, and `openChat(page, bridge)` also creates and opens an owned `New chat` window. Then use `composer(page)`, `send(page, text)`, `chooseHarness(page, name)` and `chatRow(page)`.
- Prefer accessible roles and names (`getByRole('button', {name: 'Send', exact: true})`), then `data-testid` (`getByTestId('chat-window')`). Never use coordinates, tab order, `networkidle`, or the first roster row.
- The cold app opens on Orchestra. Select Chats explicitly.
- Quote names exactly as the app renders them. RN Web does not always expose `aria-expanded`, so assert the rendered element instead.
- Drive one feature per test. Use a new run name for every run, because `run.py` overwrites a result that has the same name.

## Proof and skip reporting

- A feature is proven only by a passing army test on the exact commit. The proof includes the receipt (`<run>-receipt.json`), `final.png`, `video.webm` and `trace.zip`, and `bridge.log` for side effects.
- Capture the user action and the resulting state, not only the final screen. Check the side effect too, for example the bytes the bridge received or the rejection the gate persisted.
- Mark a feature `UNCOVERED` when no committed army test drives it. Do not report it as verified through a different feature's test, a unit test or a screenshot.
- Report a precondition the fixture cannot provide as a failing journey, and put the reason in that feature's `Gotchas`. Never weaken a journey to make it pass.
- Web evidence is not native acceptance. Native IME, voice audio, Android permissions, notifications, share sheet and live model behaviour need a native army lane, which does not exist yet.

## Feature entry contract

Each feature file starts with an H1 title, one paragraph on what the user sees, and a `Status:` line:

- `Status: COVERED`, followed by the `e2e/mbp-army/<file>.spec.ts` › "<exact test title>" of each committed army test that drives the feature.
- `Status: UNCOVERED`, which means no committed army test drives it. The line may name a draft spec that is not committed yet, but a draft never counts as coverage.

Then come exactly four H2 sections, in this order:

1. `Sub-features`: short IDs, one line each. Each line is tagged with the covering test title or `UNCOVERED`.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with the tester army`: starts with `Preconditions:`, then labeled bullets that pair each user action with the exact Playwright locator or call and the observable result. It ends with the `army-stack.sh drive` command and the proof files.
4. `Gotchas`: traps that waste or invalidate a run.

## Features

The status counts were taken at the commit this map was written on. Maintain them with `/pstack:maintain-verification-skill` whenever a spec lands or a feature changes.

<!-- index:start -->
63 features: 20 COVERED, 43 UNCOVERED.


### Navigation shell

- [Top nav and pager](./top-nav-pager.md): UNCOVERED
- [Bridge pull-down sheet](./bridge-pull-sheet.md): UNCOVERED
- [Workspace header actions](./workspace-header.md): COVERED
- [Connection banner and reconnect](./connection-banner-reconnect.md): COVERED
- [Global search bar](./global-search.md): UNCOVERED
- [Deep links and stage links](./deep-links.md): UNCOVERED

### Chats

- [Chats list](./chats-list.md): COVERED
- [Chat row actions (long-press)](./chat-row-actions.md): UNCOVERED

### Chat screen

- [Full-screen chat](./full-screen-chat.md): COVERED
- [Chat window](./chat-window.md): COVERED
- [Chat options](./chat-options.md): COVERED
- [Identity badge and panel](./identity-badge.md): COVERED
- [Target switcher](./target-switcher.md): UNCOVERED
- [Context gauge](./context-gauge.md): COVERED

### Composer

- [Composer: type and Send](./composer-send.md): COVERED
- [Stop a running turn](./stop.md): COVERED
- [Queue and the queued stack](./queue.md): COVERED
- [Steer a running Hermes turn](./steer.md): COVERED
- [Drafts survive](./drafts.md): COVERED
- [Slash commands and @ mentions](./slash-and-mentions.md): UNCOVERED
- [Attachments](./attachments.md): COVERED
- [Mic: dictation and Live voice](./dictation-mic.md): UNCOVERED
- [Composer chips and bedtime capture gate](./composer-chips-and-capture.md): UNCOVERED

### Harnesses and sessions

- [Harness picker](./harness-picker.md): COVERED
- [Sending to every harness](./harness-send-matrix.md): UNCOVERED
- [Persisted sessions](./persisted-sessions.md): UNCOVERED
- [Bots pane](./bots-pane.md): UNCOVERED

### Delivery and errors

- [Delivery status and outbox](./delivery-status-outbox.md): UNCOVERED
- [Agent errors](./agent-errors.md): COVERED
- [A running turn survives a missing roster row](./running-turn-survives-roster.md): COVERED

### Transcript

- [Markdown and code blocks](./markdown-and-code.md): UNCOVERED
- [Links in replies](./links.md): UNCOVERED
- [Tool rows and thinking](./tool-rows-and-thinking.md): UNCOVERED
- [Prompt rail](./prompt-rail.md): COVERED
- [Transcript scroll and history](./transcript-scroll.md): UNCOVERED
- [Long reply and selection](./long-reply-and-selection.md): UNCOVERED
- [Inline media and artifact stage](./inline-media-artifact-stage.md): UNCOVERED
- [Send file to phone](./send-file-to-phone.md): UNCOVERED
- [Subagent workers strip](./subagent-workers-strip.md): UNCOVERED
- [Generative UI blocks](./genui-blocks.md): UNCOVERED

### Dialogs, sheets and notices

- [Themed dialogs and destructive confirms](./themed-dialogs.md): UNCOVERED
- [Bottom action sheet](./bottom-action-sheet.md): UNCOVERED
- [Attachment notice](./attachment-notice.md): UNCOVERED
- [Interactive tile](./interactive-tile.md): UNCOVERED

### Settings and pairing

- [Pair screen](./pair-screen.md): COVERED
- [First-run connect (Settings)](./first-run-connect.md): UNCOVERED
- [Paired bridges and Forget this bridge](./paired-bridges-forget.md): UNCOVERED
- [Models panel](./models-panel.md): UNCOVERED
- [Notifications](./notifications.md): UNCOVERED
- [Notices screen](./notices-screen.md): UNCOVERED
- [Thumb side (handedness)](./handedness.md): UNCOVERED
- [In-app feedback switch](./in-app-feedback.md): UNCOVERED

### Orchestra, approvals and trace

- [Orchestra graph](./orchestra-graph.md): UNCOVERED
- [Orchestra detail (product)](./orchestra-detail.md): UNCOVERED
- [Approvals](./approvals.md): COVERED
- [Needs Kevin](./needs-kevin.md): UNCOVERED
- [Trace screen](./trace-screen.md): UNCOVERED

### Voice, surfaces and lab

- [Voice screen](./voice-screen.md): UNCOVERED
- [Continuous voice pill and chat voice dock](./continuous-voice-pill.md): UNCOVERED
- [Live surface (Hermes)](./live-surface.md): UNCOVERED
- [Annotation mode](./annotation.md): UNCOVERED
- [Component lab](./component-lab.md): UNCOVERED

### Native only

- [Android share into Dash (share inbox)](./android-share-inbox.md): UNCOVERED
<!-- index:end -->
