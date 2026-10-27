# Tool rows and thinking

Under a reply the user sees what the agent did: a `N tools · <time>` header, a collapsed `Reasoning · <summary>` block with a tail preview, tool rows that expand to arguments and output, same-name runs grouped (`read ×3`), a retained-output loader for truncated output, live `running` tools with Inspect and Stop, three detail modes (Hide, Compact, Full), and a `working · <tool>` orb on a working turn.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.05 tool call rows: label, expand (aria-expanded), tool_detail loads full output, collapse; reasoning preview shows tail"; "07.06 RC3 #420 consecutive tool calls render as grouped CompactToolRow rows with count and model accessibilityLabel"; "07.07 a running tool shows live status; Inspect shows Waiting for output… and closes; Stop ends it"; "07.08 detail mode Hide/Compact/Full changes how many thinking/tool blocks are visible in the same reply"; "07.09 a working turn shows \"working · <tool>\" with an orb under the latest assistant message"

## Sub-features

- `tool-row` row label, expand, Output (truncated), `Load retained output` sends `tool_detail`, full tail arrives, collapse [UNCOVERED]
- `tool-group` same-name consecutive calls grouped as `read ×3` in the turn tree [UNCOVERED]
- `tool-compact-row` `CompactToolRow` grouped rows with count [UNCOVERED] (expected FAIL at 2c948dc: not mounted)
- `reasoning-preview` collapsed `Reasoning · ...` with tail preview [UNCOVERED]
- `tool-live` running tool, Inspect shows `Waiting for output…`, `Close tool details`, Stop [UNCOVERED]
- `detail-mode` `Details Hide` / `Details Compact` / `Details Full` [UNCOVERED]
- `working-orb` `working · <tool>` with `agent-orb` under the latest reply [UNCOVERED]

## How to get to it (user POV)

- Read any agent reply with tool use; tap a tool row to expand it, tap Inspect for full details.
- Chat options (`Chat options` toggle) then `Details Hide|Compact|Full`.
- Watch a chat while the host agent is mid-tool.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent streams only plain text, with no tool calls, reasoning or retained output. The draft needs `ARMY_R07_TOOLS` / `ARMY_R07_LIVETOOL` scenarios in an uncommitted fixture-agent extension, and (for `working-orb`) uncommitted `rc3-chat-index-seed.ts` plus Hermes `state.db` SQL edits inside the isolated HOME.

- **Send the tools scenario.** `await send(page,'ARMY_HANG ARMY_R07_TOOLS tool rows journey')`; wait for `ARMY_TOOLS_DONE`. `page.getByText(/^4 tools · /)` is visible.
- **Expand a row.** `page.locator('[data-testid^="tree-row-"][data-testid$=":call:r07-big"]').click()`. Its `aria-expanded` becomes `true` and an `Output (truncated)` row appears.
- **Load full output.** `await page.getByRole('button',{name:/^bash: Load retained output/}).click()`. A `tool_detail` frame is sent (capture with `page.on('websocket')`) and `bash: retained output capped at 1 MiB.` shows.
- **Group.** Row `:group:r07-read-1` has `aria-label` `read ×3`; click expands.
- **Live tool.** After `ARMY_R07_LIVETOOL`, the call row contains `running`; click it, then `:inspect:r07-live`. `page.getByRole('button',{name:'Close tool details',exact:true})` and `Waiting for output…` show. `page.getByRole('button',{name:'Stop',exact:true}).click()` ends it.
- **Detail mode.** `await page.getByRole('button',{name:'Chat options',exact:true}).click()`, then `page.getByRole('button',{name:'Details Full',exact:true}).click()`. Reasoning button `aria-expanded` is `true`; with `Details Hide` no `tree-row-` and no `N tools` header remain.
- **Orb.** On a seeded working turn `page.getByText('working · armyprobe',{exact:true})` shows with `getByTestId('agent-orb')` beside it, below the answer.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/tool-rows.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` shows the expanded row/output; `video.webm`; `trace.zip` with the `tool_detail` frame; `bridge.log`.

## Gotchas

- RN Web does not always expose `aria-expanded` for these rows; the tree rows and the Reasoning button do carry it, other containers may not. Assert the rendered output when in doubt.
- Tool rows are tree rows, found by `data-testid` suffix (`:call:<id>`, `:output:<id>`, `:inspect:<id>`, `:group:<id>`), not by role.
- `CompactToolRow` has no importer at this checkout, so `Read, 3 successful calls, ...` names do not exist; 07.06 is expected to fail.
- Default detail mode is Compact; Hide removes the tree entirely, so assert counts after switching back.
