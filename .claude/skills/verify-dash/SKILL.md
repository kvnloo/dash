---
name: verify-dash
description: "The only way to test Dash (Expo app + Bun bridge): drive the real web app against a real isolated bridge and a scripted fixture agent using the e2e tester army (e2e/mbp-army, Playwright) on a private headless Sway on the MBP, then capture its evidence and receipt. Use it before you claim any Dash app, bridge or protocol change works, when you review or merge a Dash PR, or when you add a feature (add its army spec). Never use native_journeys, ad-hoc scripts, unit tests or the owner's phone as proof."
---

# Verify Dash with the tester army

**Rule (owner's, no exceptions):** Dash testing means the e2e tester army and nothing else. A feature works only when a committed army spec drove it on the exact commit and the run's receipt says it passed. If no spec covers it, say `UNCOVERED`. Do not say "works", "verified" or "fixed".

The army is a Playwright suite in `e2e/mbp-army`. Each test gets:

- The real Expo web export, served from loopback.
- Its own real Bun bridge (`bridge/index.ts`), with a temporary HOME, a loopback port, a PID namespace (bwrap) and the gate enabled in dry-run mode.
- The scripted ACP agent `e2e/mbp-army/fixture-agent.ts`, which stands in for `omp` and `hermes`.

It never uses route mocks, store seeding, live services, real credentials, the physical display or a phone. On the MBP it runs headed Chromium inside a private headless Sway. `e2e/mbp-army/README.md` is the army's own reference.

The runner is Playwright test (`node node_modules/playwright/cli.js test`), already a root devDependency. `@testerarmy/e2e` on npm only provides hosted Kernel/Limrun engines for the `e2e` runner. Those engines need paid API keys, and Dash does not use it. Adopting it is an owner decision.

All commands below run from the repo root of the checkout under test. `$ARMY_BASE` defaults to `~/dash-e2e-army-20261025`. The Playwright config refuses any other private runtime. The helper is `.claude/skills/verify-dash/scripts/army-stack.sh` (call it `army-stack.sh` below). A `<run>` name is `<branch-slug>-<sha7>-<what>`, for example `rc3-2c948dc-send-stream`, and is never reused.

**Headless and CI path:** if `scripts/army.sh` exists on your branch (build-gate PR #456), `bun run test` is the whole-suite runner that writes the O15 release receipt. Read `TESTING.md` there and use it for release gating. Do not duplicate it here. This skill's MBP path stays the way to drive one feature and look at it.

## Launch

1. **Deps, once per checkout:** run `bun install --frozen-lockfile` in the repo root, then in `app/`, then in `bridge/`. Bun lives in `~/.bun/bin`. Playwright Chromium must be in `~/.cache/ms-playwright`. If it is missing, run `node node_modules/playwright/cli.js install chromium`.
2. **Private display:** run `army-stack.sh sway-up`. If the headless Sway is already running on `$ARMY_BASE/virtual-runtime/wayland-1`, the command reuses it, because it belongs to someone else. Otherwise it starts one with `WLR_BACKENDS=headless` and `WLR_RENDERER=pixman`, with `WAYLAND_DISPLAY`, `DISPLAY` and `SWAYSOCK` unset. Never point a browser at `/run/user/<uid>`.
3. **Stack:** run `army-stack.sh up <run>`. It does three things:
   - Exports the web app from this checkout's HEAD (`CI=1 EXPO_PUBLIC_DEBUG=0 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun node_modules/expo/bin/cli export --platform web`) into `$ARMY_BASE/stack-<run>/web-export`.
   - Serves the export with `e2e/mbp-army/serve.py` on a free loopback port.
   - Records the sha, the port and the server pid in `$ARMY_BASE/stack-<run>/state.env`.

   The stack is ready when the command prints `up: serving <sha> at http://127.0.0.1:<port>`. The export takes a few minutes.

You do not start a bridge. Every test starts its own bridge and stops it, from `createBridge()` in `e2e/mbp-army/fixtures.ts`. The bridge code comes from this checkout (`ARMY_BRIDGE_ROOT` is the repo root). Never drive or restart the owner's live bridge.

## Doctor

Run `army-stack.sh doctor <run>`. It is read-only and checks that:

- The private Sway is up.
- The runtime is not `/run/user`.
- The pid in `state.env` is our `serve.py` for this stack.
- The URL serves the Dash index.
- HEAD still equals the exported sha and has no tracked edits since the export.
- bun, node, bwrap and Playwright Chromium are present.
- The run name has no earlier result.

Drive only after it prints `doctor: stack '<run>' is worth driving`. If anything looks off mid-run, run doctor again first. If HEAD moved, run `down`, then `up` under a new run name.

## Drive

Run the army against the stack:

```bash
army-stack.sh drive <run> <workers> [playwright args]
# one feature:  army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "composer typing, Send and streamed ACP reply"
# whole suite:  army-stack.sh drive <run> 4
```

`drive` calls `python3 e2e/mbp-army/run.py <run> <workers> ...` with `ARMY_WEB` (the stack URL), `ARMY_BRIDGE_ROOT` (this checkout) and `ARMY_BASE`. `run.py` runs headed Chromium on the private display and samples thermal and load telemetry. `drive` then writes the receipt. It exits with Playwright's exit code.

- Pick the feature's recipe in [`features/`](features/README.md). Each file names the covering army test, or says `UNCOVERED`.
- Workers: use 1 for a single feature. For the suite, start at 4 and back off when environment errors or thermal throttling show up. The MBP is shared.
- Some specs are expected to FAIL. They pin a known bug or an unmounted feature, and their titles say "expect FAIL at <sha>". A failure in one of them is the expected result. Do not edit it to make it pass.

**Add a spec** (any new or changed user-facing behaviour needs one):

1. Write the journey from the feature file as a `test('<behaviour in user words>', async ({page, bridge}) => {...})` in `e2e/mbp-army/army.spec.ts`, or in a new `e2e/mbp-army/<feature>.spec.ts` that imports from `./fixtures`.
2. Start from `pair(page, bridge)` or `openChat(page, bridge)`. Act through accessible roles and names or `data-testid`. Script the agent with prompt tokens: `ARMY_SLOW` (9 s reply), `ARMY_HANG` (never ends) and `ARMY_ERROR` (agent error).
3. Assert what the user sees, and also the side effect (bridge files, gate outbox, `bridge.log`).
4. Run it alone with `drive <run> 1 <file> -g "<title>"`. Then update the feature file's `Status:` line and sub-feature tags, and the index in `features/README.md`.
5. When `e2e/mbp-army/features.json` exists (build-gate PR), add the feature there too.

Never add `test.only`, retries, `networkidle` waits, or route or store mocks.

## Evidence

Everything stays under `$ARMY_BASE` and survives cleanup. Run `army-stack.sh evidence <run>` to list it.

| Path | What it proves |
|---|---|
| `$ARMY_BASE/<run>-receipt.json` | The receipt: sha, dirty flag, Playwright args, exit code, passed/failed/skipped counts, every test with its status, and the evidence paths. |
| `$ARMY_BASE/<run>/<test-dir>/final.png` | The screen at the end of each test. Failures also get `test-failed-1.png` and `error-context.md`. |
| `$ARMY_BASE/<run>/<test-dir>/video.webm`, `trace.zip` | The user action and the resulting state over time. Open with `node node_modules/playwright/cli.js show-trace <trace.zip>`. |
| `$ARMY_BASE/<run>/<test-dir>/bridge.log`, `console.json`, `action-metrics.json` | Side effects on the real bridge, page errors, and action timings. |
| `$ARMY_BASE/<run>.json`, `<run>.log`, `<run>-html/` | The Playwright JSON report, the list output and the HTML report. |
| `$ARMY_BASE/<run>-wall.json`, `<run>-startup.json`, `<run>-telemetry.jsonl` | Wall time, exit code, discovery and first-test latency, and load and thermal samples. |

Proof standards:

- The test drove the real user path, not internal setters or test-only endpoints.
- The receipt names the exact sha with `dirty: false`.
- The covering test is `passed`.
- The screenshot or video shows the action and the result.
- The side effect is in `bridge.log` or the bridge's files.

Before you assign a failure to the app, read its `error-context.md`, `console.json`, `bridge.log` and trace. Web evidence does not prove native IME, voice audio, Android permissions or live model behaviour.

## Cleanup

Run `army-stack.sh down <run>`. It kills only the `serve.py` pid that `up` recorded, after checking that the pid's command line is that stack's server. It then deletes the stack's web export. It keeps `stack-<run>/{state.env,serve.log,web-export.log}` and every `$ARMY_BASE/<run>*` evidence file.

- Per-test bridges stop on their own, because the fixture calls `stop()` and bwrap uses `--die-with-parent`.
- If a run was killed, find leftovers with `pgrep -af "army-bridge .*<checkout path>"` and kill only those pids.
- Stop Sway only if `sway-up` started it in this session: `kill $(cat $ARMY_BASE/sway.pid)`.
- Never kill by process name. Never touch servers, bridges or Sway that you did not start. Other agents share the MBP and `$ARMY_BASE`.

After cleanup, run `army-stack.sh evidence <run>` again. Every path must still be listed.

## Helpers

`scripts/army-stack.sh` (executable). Every subcommand prints what it did:

```bash
.claude/skills/verify-dash/scripts/army-stack.sh sway-up
.claude/skills/verify-dash/scripts/army-stack.sh up       <run>
.claude/skills/verify-dash/scripts/army-stack.sh doctor   <run>
.claude/skills/verify-dash/scripts/army-stack.sh drive    <run> <workers> [playwright args...]
.claude/skills/verify-dash/scripts/army-stack.sh evidence <run>
.claude/skills/verify-dash/scripts/army-stack.sh down     <run>
```

The army's own tools:

- `e2e/mbp-army/run.py`: the headed run on the private display.
- `e2e/mbp-army/serve.py`: an SPA static server.
- `e2e/mbp-army/summarize.py`: benchmark summary.
- `e2e/mbp-army/microbench.ts`: framework overhead.

Confirmed app bugs go to the private army bug ledger described in `e2e/mbp-army/README.md`.

## Ban list

None of these count as Dash testing or proof. Do not run them to verify, and do not cite them:

- **native_journeys**, and any other native journey runner, Maestro (`.maestro/`), `scripts/assert-nav-dots*`, or `fleet-*.sh` flows.
- **Ad-hoc harnesses:**
  - `scripts/verify-dash/control-dash.ts` and `bun run verify`.
  - `scripts/*-proof.mjs`, `verify-*.mjs` and `ux-*.mjs`.
  - `debug-screenshots.mjs` and `debug:shots`.
  - One-off Playwright or Puppeteer scripts outside `e2e/mbp-army`.
  - curl or WebSocket pokes at a bridge.
  - A Metro or Expo dev server you click through by hand.
- **Unit tests as proof:** `bun test`, `bun run test:unit`, mutation scores and typecheck or lint are hygiene. They never show that a feature works.
- **The owner's S25 and the live app:** no adb, no screenshots, no installs, no UI driving, no notifications to test with. The same goes for the owner's live bridge and agent homes on any host. Never restart the live groot bridge.
- **The physical display:** never `/run/user/<uid>` and never the owner's compositor.
- **Weakened specs:** no `test.only`, no `test.skip` without a reason, no retries, no loosening assertions, and no deleting a failing test to get green.
