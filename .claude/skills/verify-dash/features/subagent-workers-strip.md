# Subagent workers strip

When subagents of the chat's session are running, a compact strip above the transcript reads `<n> subagents working` and can be opened to see what each is doing. It disappears when none are working.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.19 running subagents show \"<n> subagents working\" in the workers strip"

## Sub-features

- `workers-count` strip reads `<n> subagents working` for running child sessions [UNCOVERED]
- `workers-expand` tap the strip to list the workers [UNCOVERED]
- `workers-clear` strip is absent when no child is running [UNCOVERED]

## How to get to it (user POV)

- Open a chat whose agent delegated work to subagents; the strip sits at the top of the chat.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent never spawns subagents. The draft writes two child rows (`source='delegate'`, `parent_session_id` set, fresh `last_activity_at`) into the isolated HOME's Hermes `state.db` with a small `bun:sqlite` helper after seeding the parent chat via uncommitted `rc3-chat-index-seed.ts`. That is a fixture write into the bridge's own data, not a mock of Dash traffic.

- **Open the seeded chat.** `await pair(page,bridge)`; click the chat row filtered by title `ARMY R07 workers`; `ARMY_WORKERS_ANSWER` is visible.
- **Strip absent first.** `page.getByRole('button',{name:/subagents working$/})` count is 0.
- **Add two running children** to `state.db`, then `page.getByRole('button',{name:'2 subagents working',exact:true})` is visible within 20 s.
- **Expand.** Click the strip; the accessibility state is expanded and the worker rows show.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/workers.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` showing `2 subagents working`; `video.webm`; `trace.zip`; `bridge.log`.

## Gotchas

- The strip is derived from the bridge's session scan, so it appears only after the bridge re-reads `state.db`; poll with a long timeout.
- Hermes columns `last_activity_description` and `ended_at` are missing in the fixture schema; the helper must `ALTER TABLE` first.
- The strip is a button but RN Web may not expose `aria-expanded`; assert the rendered worker list.
- The count includes only children that are still active, so stale `last_activity_at` hides them.
