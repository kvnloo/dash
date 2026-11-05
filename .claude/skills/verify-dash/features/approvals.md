# Approvals

Approvals shows the upstream-action approval outbox in dry-run mode ("Dry run · Nothing will be posted"). The user sees metrics (Pending, Bulk-ready, Blocked), can select bulk-safe items and approve them after a confirm, reject with a reason, edit or write the owner response, run Check dry run on approved items, open the repo link, and show history. Everything is disabled while the bridge is offline.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "approvals screen reads real dry-run outbox and persists rejection"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-09-10-orchestra-bots-approvals-and-trace-sc.spec.ts` › "metrics, Select all bulk-safe, Approve selected then Confirm approve sends gate_decide"

## Sub-features

- `approvals-open-reject` the screen reads the real outbox; Reject with a reason persists and shows in history [covered: "approvals screen reads real dry-run outbox and persists rejection"].
- `approvals-metrics-bulk` metrics, Select all bulk-safe, Approve selected (n), Confirm approve n [UNCOVERED].
- `approvals-select-group` Select group (n), per-item Select <id>, Cancel the confirm [UNCOVERED].
- `approvals-history` Show history / Hide history [covered: "approvals screen reads real dry-run outbox and persists rejection"] (Show history only).
- `approvals-review-edit` Review / edit, Write response, Save owner text, Approve item [UNCOVERED].
- `approvals-check-dry-run` Check dry run on an approved item fails closed offline [UNCOVERED].
- `approvals-repo-link` the repo link opens GitHub [UNCOVERED].
- `approvals-offline` every decision control is disabled when the bridge is down [UNCOVERED].

## How to get to it (user POV)

- Workspace header button "Upstream approvals, N pending" (shown when items are pending).
- Chats tab, Open settings, Review approvals.
- Tap an approvals notification (native).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The fixture bridge has the gate enabled with one seeded dry-run proposal (`seed-gate.ts`, body `ARMY_APPROVAL_FIXTURE: ...`, `example/army-fixture#1`). It is bulk-safe.

- **Open approvals.** `await pair(page,bridge)`, then `await page.getByRole('button',{name:/^(Upstream approvals|Approvals), 1 pending$/}).first().click({noWaitAfter:true})`. `getByText('Dry run · Nothing will be posted',{exact:true})` and the `ARMY_APPROVAL_FIXTURE:` text appear.
- **Reject.** `getByRole('button',{name:'Reject',exact:true}).click()`, fill `getByRole('textbox',{name:'Rejection reason',exact:true})`, click `getByRole('button',{name:'Confirm reject',exact:true})`. "No pending proposals" appears.
- **History.** `getByRole('button',{name:'Show history',exact:true}).click()`; `rejected · <reason>` shows.
- **Bulk (uncovered).** `getByTestId('approval-metrics')` reads Pending/Bulk-ready/Blocked. `Select all bulk-safe`, `Approve selected (n)`, then `Confirm approve n`; checkboxes are `getByRole('checkbox',{name:'Select <id>'})`; cards are `getByTestId('gate-card-<id>')`.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "approvals screen reads real dry-run outbox and persists rejection"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The test then polls the bridge's `gate/events.jsonl` in the bridge's temporary HOME for the rejection reason; confirm the history line on screen and that the outbox event holds the same reason.

## Gotchas

- Dry run only: the gate is `DASH_GATE_LIVE=0`; nothing is ever posted. Never turn live posting on.
- The workspace-header label is "Upstream approvals, N pending"; the test also accepts the older "Approvals, N pending" form.
- More than one item (bulk, group, human-text, CLA) needs the draft's extra gate seeds (`rc3-09-10-seed.ts gate`), which are not committed.
- Check dry run needs a `gh` stub in the bridge's temporary PATH and must fail closed (failed/stale), never post.
- External GitHub navigation must be stubbed with a context route.
- Draft locators all exist in app source (checked by grep).
