# Live surface (Hermes)

In a Hermes chat the Options sheet has a Live surface switch. When on, a live surface replaces the transcript: an artifact card with Version tabs, a Receipts in Hermes row, quick replies with a timing line, control prompts with option radios, and an Ask Hermes chip that routes a question through Hermes.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-10-11-voice-live-surface-annotation-and-lab.spec.ts` › "11.04 Live surface: artifact card with Version n tabs switches the shown fx0 version"; "11.07 Live surface: a quick turn streams the reply, adds a version, a control prompt and the timing line"

## Sub-features

- `live-versions` artifact card Version n tabs switch the shown version [UNCOVERED].
- `live-open-stage` Open live artifact in stage opens ArtifactStage; Back returns [UNCOVERED].
- `live-receipts` "Receipts in Hermes: n" expands and collapses the list [UNCOVERED].
- `live-quick-turn` a quick reply streams, adds a version, a control prompt and the timing line [UNCOVERED].
- `live-control-prompt` tapping a control option records an intent and lands a receipt [UNCOVERED].
- `live-ask-hermes` the Ask Hermes chip toggles ask mode and routes the question [UNCOVERED].

## How to get to it (user POV)

- Open a chat, choose Hermes as the harness, open the chat options and switch Live surface on.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Needs a scripted loopback z0bridge stand-in (the draft's `rc3-11-fx-fixture.ts`, not committed) passed to the bridge only through `DASH_Z0BRIDGE_URL` and `DASH_Z0BRIDGE_TOKEN_FILE`. Without it the surface cannot attach.

- **Open the surface.** `await pair(page,bridge)`, click `getByRole('button',{name:'Create new chat'})` for a full-screen chat, `getByRole('button',{name:'Choose harness'})` then the Hermes row, `getByRole('button',{name:'Chat options'})`, then `page.getByRole('switch',{name:'Live surface',exact:true}).click()`. `getByTestId('live-surface')` becomes visible.
- **Versions.** In `getByTestId('live-artifact')` click `getByRole('tab',{name:'Version 1',exact:true})`; it gets `aria-selected=true` and the matching iframe title shows.
- **Stage.** `getByRole('button',{name:'Open live artifact in stage'})` opens an `iframe[title="HTML preview"]` (sandboxed); Back returns.
- **Receipts.** Click `getByRole('button',{name:'Receipts in Hermes: 2'})` to expand and again to collapse.
- **Quick turn and control prompt.** `send(page,'<text>')`; the reply, a new Version tab and `getByTestId('live-timing')` appear. Click a `getByRole('radio',{name:/Grid layout/})` in the control radiogroup: it becomes checked and "Picked Grid layout" shows.
- **Ask Hermes.** `getByRole('switch',{name:'Ask Hermes',exact:true})` toggles the composer placeholder between `Live surface · quick reply` and `Ask Hermes through the live surface`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/live-surface.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, plus the fixture's recorded requests. Check that every request carried the z0bridge bearer and the intent POST body holds the picked option.

## Gotchas

- The draft imports `startFxFixture` from `rc3-11-fx-fixture`, and calls `createBridge(persistSession,archiveClaude)`. Neither exists in this checkout's `fixtures.ts` (one-argument `createBridge`); the fixture must be committed and the signature aligned first.
- The fixture bridge's own Hermes row is scripted ACP, not a live Hermes; never point the app at a real z0bridge.
- The draft opens the sheet through `Chat options`; this checkout's fixtures use the label `Options. Current surface: Chat`. Both exist, but pick the one that matches the screen (full-screen versus windowed chat).
- Draft locators all exist in app source (checked by grep).
