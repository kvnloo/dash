# Dash MBP integration army

Real Expo UI → authenticated real Bun bridge → deterministic stdio ACP fixture.
No HTTP/WebSocket route mocks, debug-store seeding, real model credentials, live services, phone, or owner agent homes.
The fixture is not a model turn. It implements initialize/session/new/load/prompt/cancel and streams delayed text, errors, and resource links.
Each test has its own bridge, HOME, credential/config/outbox directories, loopback port, PID namespace, and browser context.
A fixture-native Hermes SQLite row and a fixture-only discoverable OMP process support persisted-session journeys. The separate ephemeral regression intentionally omits them.

## Chat-index HTTP ownership journey (#493)

`chat-index-ownership.spec.ts` pairs normally, then selects a loopback TCP/HTTP relay
through Settings. Isolated real bridges index archived AgentsView source rows;
native-only roster overlays are unpaged and cannot exercise cursor ownership.
The relay holds actual response bytes without changing payloads: one journey replaces
the endpoint through Settings before releasing the old head, then reloads; another lets the normal
30-second head refresh supersede a held tail and checks that the unchanged
304/cursor path can request a fresh tail.

The app invalidates list state synchronously on endpoint/account replacement.
Each request owns both that endpoint generation and its list-state instance;
late success, error, bad-cursor recovery and promise cleanup cannot act for a new
owner. A new head invalidates pending tails while a valid 304 preserves loaded
rows and the pagination cursor. Distinct filter keys remain independently cached.

The single persisted default-head slot has an opaque random namespace saved with
settings, rotated on active address/authentication identity replacement. Snapshot
writes are serialized and the envelope must match that namespace on cold boot.
Legacy unbound snapshots are ignored, not attributed to the current account.
No token or authentication identity is added to cache keys or snapshot envelopes.
This covers heads only, not endpoint scoping of saved conversation/history/drafts.
The endpoint-replacement journey failed on the old app (75 old rows admitted
after replacement) and passed on `770121d3`, including cold reload. The cursor
journey passes in both arms; it is a pagination boundary check, not proof of a
previously failing unchanged-cursor race. Neither result is native acceptance.

## Mesh/native roster journey (#474, #476, #481)

`mesh-roster.spec.ts` starts two isolated real bridges named `groot` and `mbp`, pairs the
real web app only with groot, and checks both hosts' identically named live OMP sessions,
finished Codex/Claude JSONL chats and mbp's nonzero Hosts count. `fixtures.ts` seeds only
external discovery and native files, never app stores or HTTP routes. Stopping the peer
exercises last-good cache through an authenticated roster refresh and browser reload.
The local-only peer endpoint is checked separately to prevent recursive mesh fanout.
Status: authored, not executed in the memory-limited wiring worktree; no acceptance claimed.

Production prerequisite: explicitly provision each peer's own authenticated credential in
`$DASH_CREDENTIAL_DIR/peer-roster-tokens.json` (default `~/.dash`), owned by the bridge user
with mode 0600. Keys are exact Tailscale DNS labels; values are peer token strings (port
4747), or objects with `token` and `port`. No credential is inferred or copied from the local
bridge token. Only discovered tailnet computer addresses are used (loopback requires the
existing explicit `DASH_ALLOW_LOOPBACK=1` switch for isolated army bridges). Missing,
unsafe or unprovisioned credentials leave the peer undiscovered. Native peer roster rows
remain view-only: existing archive SSH routing is unchanged. No credential provisioning,
live service or device changes are part of this journey.

## OpenUI / GenUI native reply journey

`openui-native.spec.ts` uses `bridgeOptions.generatedUI` in `fixtures.ts` to enable
fenced replies from the stdio ACP fixture over the real bridge. It sends through
the composer, holds an unfinished OpenUI fence until the loading UI is visible,
then releases it via the fixture's existing `army-release` file. The completed
reply must expose #484's native card heading, percentage progressbar, list and
table roles from #488's bounded catalog. The old Roadmap-only hookup fails this
journey. Separate cases reject an unknown action component without showing source
and retain the `genui` / `openui` JSON card formats.

Run only this feature with the verify-dash skill's isolated stack:
`army-stack.sh drive <run> 1 e2e/mbp-army/openui-native.spec.ts`.
ACP turn files and the normal bridge log back the visible assertions; no route
mocks or app store seeding. Web evidence does not prove native screen-reader or
text-selection behavior. No passing receipt is claimed merely by adding specs.

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

Append confirmed bugs immediately and under a file lock to the private army bug ledger (its path lives in the private ops notes, never here), with the owner's required id/title/severity/repro steps/evidence path/suspected file:line keys. Do not publish fixture credentials or real secrets. Never fix app code in this qualification lane.

Web evidence is not native phone/context-gauge acceptance; it does not prove native IME, voice, Android attachment permissions, or live model behavior.

`delta-replay.spec.ts` forwards the real authenticated bridge stream through an
owned WebSocket relay. It duplicates a delta within one batch and replays an
already-applied delta immediately before fresh text. Both cases require the exact
original agent reply and one actual agent invocation. The app retains individual
frames until the store rejects stale sequences against its applied watermark,
then appends the accepted text once per batch.

Both replay journeys failed with duplicated visible text on the old app and
passed on `770121d3`. These are filtered browser/bridge receipts, not complete
release qualification.

## Authenticated hello admission

`hello-admission.spec.ts` selects an owned relay through Settings. The relay
preserves Origin/authentication and withholds the real authenticated hello while
accepting WebSocket OPEN and forwarding keepalive. The old client never closed
that unadmitted socket. The corrected client times it out, retries, and recovers
through Settings while retaining the draft and streaming a real fixture reply.
Transport OPEN alone neither admits sends nor resets retry/failover state.

## Terminal retention

`terminal-retention.spec.ts` holds a real local summary provider to its production
deadline, adds 50 real settled rejected turns, and reconnects a subscriber. The
old bridge returned `lost`; the corrected bridge replays text and terminal `done`
before applying the settled-turn cap. This does not prove automatic post-error
app reattachment or the ten-minute expiry timer.
