# Bots pane

The Bots tab shows a tree of the host's harnesses and bots. Tapping an installed harness tile opens a new chat on it. Tapping an unavailable harness opens nothing.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-04-05-sending-to-every-harness.spec.ts` › "Bots pane: tapping an installed harness opens a chat on it; an unavailable harness opens nothing"

## Sub-features

- `bots-open-installed` tap an installed harness row, a chat opens on it and a send reaches that harness [UNCOVERED]
- `bots-unavailable` unavailable harness (for example Pi) opens no chat and sends nothing [UNCOVERED]

## How to get to it (user POV)

- Top nav, first tab (`Bots`). Expand the host row, then a harness group, then its `New chat` row.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- A wrapper binary for each harness you expect installed (see harness-send-matrix); the committed fixture only installs OMP and Hermes.

- **Open the pane.** `await pair(page,bridge); await page.getByRole('tab').nth(0).click({noWaitAfter:true})`; `getByRole('tab').nth(0)` has `aria-selected` true.
- **Reveal.** Click `getByTestId('tree-row-host:<hostId>')`, then each group row until `getByTestId('tree-row-<hostId>:new:harness:claude')` is visible (ids come from the roster; read the host id from `/roster`).
- **Installed.** Click the claude row; `getByRole('button',{name:'Choose harness',exact:true})` contains `Claude Code · Change`; send replies.
- **Unavailable.** Click `tree-row-<hostId>:new:harness:pi`; the host row stays, and `composer(page)` and the chip have count 0.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/bots-pane.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the tree, the opened chat and a reply, and `bridge.log` must show no `harness=pi` turn.

## Gotchas

- `tree-row-<id>` testIDs exist (`components/Tree.tsx`), but the exact `new:harness:<id>` suffix is built in `lib/bots-tree.ts` and `Tree` ids contain colons; use `getByTestId` with the exact string.
- The app's "Session unavailable" Alert for an unavailable harness is native only; on web nothing appears, so assert the absence of a chat.
- Installed state needs the wrapper binary in the bridge `bin` dir, or Claude Code, Codex and Grok rows are inert too.
