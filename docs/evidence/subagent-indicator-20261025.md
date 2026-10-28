# Subagent indicator restoration

## What happened

The indicator was **not removed**. `0baa272` introduced WorkersStrip and `0132b7c`
made it an expandable shared Tree. Both are ancestors of served app `05e3bb5`
(`fix/hide-status-bar-20261025`, also the initial turbo base). The served ChatScreen
still mounts it above the composer and calls useSessionWorkers.

The strip's HTTP poll remained on `settings.token` instead of the identity-aware
`executionToken(settings)` used by the chat socket. Initial identity support is
`b0a3f50`; `657e81b` migrated other observation reads, but not this strip. An
identity-enrolled app can have no valid legacy token: every worker read is then
401, caught silently, leaving the empty initial list and rendering nothing.

The fix actually existed off the served lineage: `d7306b4` on
`sol/attached-dock-20261021` changes this exact header, ported as `0cba27d` on
`program/composer-20261022`. Neither is an ancestor of `05e3bb5`. These were
bundled with the larger attached-dock/composer work rather than shipped alone.
`git log --all -S/-G`, the complete worktree registry, and direct source reads
were used; 44 registered worktrees retained the component at inspection time.

History corroborates the original UI: ctx session
`bcd5f39e-a041-802a-8e26-e2529c02024c`, event
`20d27127-6c9b-8410-b6df-4275609afd34`, describes the collapsed subagent line;
`1677256c-3154-83d1-96ac-b7fee6c7381d` describes the tree/shimmer on the phone.
Read-only clean/state.db inspection confirms the current parent's active child
sessions retain exact parent_session_id links.

## Data path

- Hermes ACP `session/update` tool_call/tool_call_update events are accepted in
  `bridge/src/acp/client.ts`; acpParts emits tool parts to the Turn sink, and the
  app stores them as reply activity. There is no dedicated subagent-count store
  or Hermes-specific delegation extension driving WorkersStrip.
- The strip independently polls authenticated `/hermes/workers` every 3 seconds.
  `HermesSessions.workers` resolves the visible profile/session and compression
  lineage; `readSessionWorkers` reads recent non-ended children from native
  state.db by parent_session_id (also supporting PARENT_SESSION headless runs).
- Bridge `10a5115`, including this reader, is present in served bridge `6f050cb`.
  No bridge change or restart is required.
- Read-only live HTTP probe: missing legacy credential -> **401**; valid existing
  bridge credential -> **200**, **7 workers** at observation time. No credential
  or transcript was saved in the evidence.

## Repair

- Extract the status parser/request into `app/src/lib/session-workers.ts`; mint
  the normal scoped identity token, with existing legacy compatibility only for
  settings without enrollment. Never fall back after an identity failure.
- Scope samples to bridge/profile/session to hide another chat's workers
  synchronously; abort in-flight reads on cleanup. Poll unless explicitly
  background/inactive (AppState can initially be unknown).
- Keep the existing strip/tree presentation. No entrance animations added.
- Add identity-header, legacy HTTP, parser, completion and rejection coverage.
- Complete older AsyncStorage test doubles with getItem: the served base's
  composer-draft persistence otherwise causes an unrelated full-suite import
  error. This is test-only; draft persistence runtime is untouched.

## Qualification boundary

All execution is through admitted MBP fleet jobs. The rendered proof uses the
actual hook and WorkersStrip/Tree in an isolated Expo Web component harness,
with disposable identity tokens and worker fixtures, not a live model turn.
No shared Dash service was restarted, no APK was installed and no phone was
operated. Turbo integration and physical-device acceptance remain with the
parent/integration lane.

## Executed checks

- MBP `fleet-mbp-15a743159877430b`: `bun test app/src bridge/src shared`
  **1018 passed, 1 skipped, 0 failed**, 6161 assertions across 152 files.
  The skip is the existing environment-gated native Hermes pinned-context test.
- Same job: full `bun run typecheck` **exit 0** (app, bridge and scripts).
- MBP `fleet-mbp-674869ebc65744a9`: mutation **88**, threshold **80**;
  156 mutants: 137 killed, 18 survived, 1 timeout, 0 invalid. This earlier
  snapshot has identical production repair bytes; the later changes complete
  test doubles and add the isolated render runner/evidence.
- Initial fleet snapshot lacked Git metadata; initializing/indexing the owned
  snapshot resolved the workspace-inventory fixture failure. The missing
  AsyncStorage.getItem mock was then corrected in the test-only files above.
- Render runner's first attempt failed before export because Bun does not accept
  `stderr: "stdout"`; the runner now writes a separate export-errors.log.

## Landing on the rc3 roadmap trunk

Only the production repair landed here (`WorkersStrip.tsx` and the new
`session-workers.ts`). The branch's unit tests, the test-double completions and
`scripts/qualify-workers-render.mjs` were left behind: the unit tests are junk
under the O15 law, and the render runner depends on a test helper that is not on
this trunk. The checks above describe the original branch, not this trunk.
