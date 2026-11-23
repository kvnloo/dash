# Live surface (Hermes)

In a Hermes chat the Options sheet has a Live surface switch. When on, a live surface replaces the transcript: an artifact card with Version tabs, a Receipts in Hermes row, quick replies with a timing line, control prompts with option radios, and an Ask Hermes chip that routes a question through Hermes.

Status: COVERED by `e2e/mbp-army/live-surface.spec.ts` (feature `live-surface-fx0`) against the loopback z0bridge `--fx` stand-in `e2e/mbp-army/fixture-fx.ts` (`bridgeOptions: { liveFx: true }`). The fixture answers instantly, so the army proves Dash's own path (bridge relay + render) stays under 2 s; real libfx latency is a device check.

## Sub-features

- `live-versions` artifact card Version n tabs switch the shown version [COVERED].
- `live-open-stage` Open live artifact in stage opens ArtifactStage; Back returns [COVERED].
- `live-receipts` "Receipts in Hermes: n" expands and collapses the list [COVERED].
- `live-quick-turn` a quick reply streams, adds a version, a control prompt and the timing line [COVERED].
- `live-control-prompt` tapping a control option records an intent and lands a receipt [COVERED].
- `live-ask-hermes` the Ask Hermes chip toggles ask mode and routes the question [COVERED].

## How to get to it (user POV)

- Open a chat, choose Hermes as the harness, open the chat options and switch Live surface on.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `bridgeOptions: { liveFx: true }` starts `fixture-fx.ts` and passes it to the bridge only through `DASH_Z0BRIDGE_URL` and `DASH_Z0BRIDGE_TOKEN_FILE`. Requests and the receipts "held in Hermes" land in `<bridge.dir>/army-fx.jsonl`. It has no `/v1/health`, so ordinary Hermes turns stay on the scripted ACP peer.

- **Open the surface.** `openChat`, `chooseHarness(page,'Hermes')`, send one message (the Surface row needs a conversation), then `Options. Current surface: Chat` → `Surface, Current: Chat · switch to Live surface`. `getByTestId('live-surface')` becomes visible.
- **Versions.** In `getByTestId('live-artifact')` click `getByRole('tab',{name:'Version 1',exact:true})`; it gets `aria-selected=true` and the matching iframe title shows.
- **Stage.** `getByRole('button',{name:'Open live artifact in stage'})` opens an `iframe[title="HTML preview"]` (sandboxed); Back returns.
- **Receipts.** Click `getByRole('button',{name:'Receipts in Hermes: 2'})` to expand and again to collapse.
- **Quick turn and control prompt.** `send(page,'<text>')`; the reply, a new Version tab and `getByTestId('live-timing')` appear. Click a `getByRole('radio',{name:/Grid layout/})` in the control radiogroup: it becomes checked and "Picked Grid layout" shows. The timing line reads `control n.n s`; the bridge log has `live.control ... ms=` and `live.intent ... hermesChild=... hermesMessage=...`.
- **Ask Hermes.** `getByRole('switch',{name:'Ask Hermes',exact:true})` toggles the composer placeholder between `Live surface · quick reply` and `Ask Hermes through the live surface`.
- **Run.** `army-stack.sh drive <run> 1 e2e/mbp-army/live-surface.spec.ts`, or the whole army with `bun run test`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, plus the fixture's recorded requests. Check that every request carried the z0bridge bearer and the intent POST body holds the picked option.

## Gotchas

- The fixture bridge's own Hermes row is scripted ACP, not a live Hermes; never point the app at a real z0bridge.
- Windowed chats open the sheet through `Options. Current surface: Chat`; full-screen chats use `Chat options`.
