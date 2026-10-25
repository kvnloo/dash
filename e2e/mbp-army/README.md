# Dash MBP integration army

Real Expo UI → authenticated real Bun bridge → deterministic stdio ACP fixture.
No HTTP/WebSocket route mocks, debug-store seeding, real model credentials, live services, phone, or owner agent homes.
The fixture is not a model turn. It implements initialize/session/new/load/prompt/cancel and streams delayed text, errors, and resource links.
Each test has its own bridge, HOME, credential/config/outbox directories, loopback port, PID namespace, and browser context.
A fixture-native Hermes SQLite row and a fixture-only discoverable OMP process support persisted-session journeys. The separate ephemeral regression intentionally omits them.

## Host preparation

Use the served source SHAs, not current branch names:
- App base: `05e3bb506c84361eb53c4800484f431dc492d8e0`
- Bridge: `6f050cb` (a separate sibling worktree at `../bridge`)
- Tests: this branch, no app edits.

Install root and app deps with `bun install`, and bridge root/bridge deps likewise, using admitted `fleet-build --node mbp-host --class test`. The fleet account differs from the desktop account; only grant scratch-specific access and revoke home traversal afterward. Export with `CI=1 EXPO_PUBLIC_DEBUG=0 EXPO_PUBLIC_DEBUG_AUTONAV=0 bun node_modules/expo/bin/cli export --platform web --output-dir <scratch>/web-export` through fleet-build.

Serve with `python3 e2e/mbp-army/serve.py <scratch>/web-export 18400`. The handler falls back to index.html for React Navigation reloads. No production routing changes.

## Virtual display only

The owner revoked physical-screen use. NEVER launch these browsers with `/run/user/1000` as XDG_RUNTIME_DIR. Use an owned headless Sway with WLR_BACKENDS=headless, WLR_HEADLESS_OUTPUTS=1, WLR_LIBINPUT_NO_DEVICES=1, WLR_RENDERER=pixman, and XDG_RUNTIME_DIR=`~/dash-e2e-army-20261025/virtual-runtime` (0700). Unset inherited WAYLAND_DISPLAY/DISPLAY/SWAYSOCK before starting Sway. `wayland-1` in that private directory is NOT the physical compositor's same-named socket.

`run.py` fails closed if that private socket is missing. It sets the private runtime, starts headed Chromium, writes reports, wall times and periodic thermal/load telemetry. Physical Hyprland clients must remain unchanged. Capture virtual output using `XDG_RUNTIME_DIR=<private> WAYLAND_DISPLAY=wayland-1 grim <output.png>`.

```
python3 e2e/mbp-army/run.py qualification-eight 8
python3 e2e/mbp-army/run.py baseline-one 1
```

Start at eight workers, back off when environment errors or thermal-throttle deltas appear. Keep result names distinct; never overwrite a failure run. Full parallelism is explicit, retries are zero, video/trace are always on, failure screenshots are automatic, and every test also captures final.png. Safe seeded exploratory workers cover 390 and 800 px widths.

The suite is run by the existing `playwright/test` export in Playwright 1.64.1; no new test dependency is needed.

## Performance

`microbench.ts` separately measures headed browser launch (5 samples), context/page creation and inert local-HTML click/fill (20 samples each), with no slowMo, tracing or video. This isolates framework overhead from Dash rendering/bridge timers. Run only on the private display, with `ARMY_BENCH=<output.json>`.

`startup-reporter.ts` measures CLI start→test discovery and CLI start→first test; `run.py` measures full subprocess wall time, including report/video finalization. Compare identical suites and report speedup `T1/TN` and efficiency `T1/(N*TN)`. Shared-host workloads and order effects limit causal conclusions.

Official sources (no numeric latency targets):
- https://playwright.dev/docs/test-parallel — OS worker isolation, worker/browser reuse, explicit fullyParallel and worker count.
- https://playwright.dev/docs/browser-contexts — contexts are isolated and described as fast and cheap, not a millisecond SLA.
- https://playwright.dev/docs/best-practices — user-visible behavior, isolation, resilient locators, avoid unnecessary waits.

## Scope and triage

Inspect error-context.md, console.json, bridge.log, screenshot/video and trace before assigning an app bug. The context card can open even when RN Web does not expose aria-expanded; assert the rendered card, not that attribute. The cold app opens Orchestra, so select Chats explicitly. New chat from the workspace header initially opens a full screen; return and select its exact row to exercise the window. Do not select the first roster row. Do not use networkidle (polling is intentional).

Append confirmed bugs immediately and under a file lock to `/mnt/zer0models/workspace/zer0/data/operations/dash-e2e-army/bugs.jsonl`, with the owner's required id/title/severity/repro steps/evidence path/suspected file:line keys. Do not publish fixture credentials or real secrets. Never fix app code in this qualification lane.

Web evidence is not native phone/context-gauge acceptance; it does not prove native IME, voice, Android attachment permissions, or live model behavior.
