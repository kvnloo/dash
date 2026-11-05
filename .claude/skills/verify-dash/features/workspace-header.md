# Workspace header actions

Under the top nav, each workspace shows a header with a heading ("Chats workspace") and action buttons: Open event trace, Create new chat, Open settings, and, when the gate has pending proposals, a labelled "Upstream approvals, N pending" button. The Orchestra header is title-only.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"; "approvals screen reads real dry-run outbox and persists rejection"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-00-01-navigation-shell-top-nav-and-bridge-p.spec.ts` › "Open event trace opens Trace"; "Create new chat opens a full-screen chat for the default harness"; "Open settings opens Settings"; "pending upstream approvals show the labelled action and open Approvals"; "Orchestra workspace header is title-only"

## Sub-features

- `header-create-chat` Create new chat opens a full-screen chat. [covered: "pairing, Chats tab, open and close real chat window"] (via `openChat()`)
- `header-approvals` the pending-approvals button opens Approvals. [covered: "approvals screen reads real dry-run outbox and persists rejection"]
- `header-trace` Open event trace opens Trace. [UNCOVERED]
- `header-settings` Open settings opens Settings. [UNCOVERED]
- `header-orchestra-title-only` Orchestra shows no Create new chat. [UNCOVERED]

## How to get to it (user POV)

- Select the Chats tab (or Bots); the header actions sit above the pane.
- Select Orchestra to see the title-only header.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired with `pair(page, bridge)` (lands on Chats). `seed-gate.ts` proposes one dry-run approval, so the approvals button shows `1 pending`.

- **Create new chat.** `await page.getByRole('button',{name:'Create new chat',exact:true}).click()`. A composer (`composer(page)`) is visible and `getByTestId('chat-window')` has count 0 (full screen, not windowed). `Back` returns to Chats.
- **Approvals.** `await page.getByRole('button',{name:/^(Upstream approvals|Approvals), 1 pending$/}).first().click()`. Text `Dry run · Nothing will be posted` appears.
- **Trace and Settings (not driven).** `getByRole('button',{name:'Open event trace',exact:true})` opens heading `Trace`; `getByRole('button',{name:'Open settings',exact:true})` opens heading `Settings`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "approvals screen reads real dry-run outbox and persists rejection"` (add a second run with `-g "pairing, Chats tab, open and close real chat window"` for Create new chat).
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. `final.png` shows the Approvals history; the gate event file (read in the test through `readGate`) must contain the rejection reason.

## Gotchas

- `openChat()` accepts either `Create new chat` or `New chat`; the RC3 label is `Create new chat`. Use it exactly in new tests.
- The approvals label is `Upstream approvals, 1 pending`; older builds say `Approvals, 1 pending`.
- The button name includes a count. Match with a regex if more proposals are seeded.
- Orchestra has no actions, so run header tests on Chats.
