# Testing Dash

Dash has distinct **source**, **browser/runtime**, **native build**, and **real-phone** evidence. A green unit suite is not a phone screenshot, a real bridge session, or an Android manifest check. This inventory is grounded in the integration-lane source at commit `8de8eea4af5e3daf1b7596160d6b6121ff051cae`.

Run commands from the repository root in an isolated checkout unless a step says otherwise. Do not take over an existing bridge, Metro session, or phone while gathering evidence.

## Quick start

The commands below are keys in root `package.json` (except the explicit `bun test` and `bun scripts/...` invocations).

| Purpose | Exact command |
| --- | --- |
| Full registered source checks | `bun run test` |
| App, bridge and shared unit suite | `bun run test:unit` |
| Mutation suite | `bun run test:mutate` |
| TypeScript checks for app, bridge and scripts | `bun run typecheck` |
| ESLint | `bun run lint` |
| Verify-dash **test subcommand** (not its live doctor) | `bun run verify` |

`bun run test` invokes the app/bridge/shared unit suite **plus** the explicitly listed root regression tests. It does not automatically discover every new test in `scripts/`. `bun run verify` runs `bun scripts/verify-dash/control-dash.ts test`, which invokes a selected unit suite and records a receipt; it does **not** exercise a live phone or automatically run `doctor`. For a single test, use `bun test scripts/assert-nav-dots.test.ts` as an existing example.

## Verification layers

| Layer | Command | Catches | Cannot catch | Runs |
| --- | --- | --- | --- | --- |
| Unit | `bun run test:unit`; broader `bun run test` | Pure store transitions, parser/protocol boundaries, geometry constants and regression assertions | Actual Yoga/Android layout, network/service behavior, or physical input | Local; root `test` in CI |
| TDD | `bun test app/src bridge/src shared` (red before fix, green after; see `.cursor/skills/tdd/SKILL.md`) | Missing behavioral assertions exposed by a deliberate failing regression test | Native pixels, lifecycle behavior, untested edge cases | Local workflow; committed tests later in CI |
| Mutation | `bun scripts/mutate.ts --threshold 80 --max 200` | Weak assertions that let altered exported constants, equality or logic survive; target list below | Untargeted files, device rendering, real connectivity | Local; CI mutation matrix (minimum score **80**) |
| Typecheck/Lint | `bun run typecheck`; `bun run lint` | Type errors across app/bridge/scripts and lint violations | Semantic regressions, runtime crashes, UI usability | Local and CI |
| Runtime (verify-dash) | `bun scripts/verify-dash/control-dash.ts doctor`; `bun scripts/verify-dash/control-dash.ts roster` | Live bridge HTTP/pairing/roster reachability with the existing deployment | Touch targets, IME, pixels, native permissions, offline process recovery | Controlled local integration host; not CI |
| Device (Maestro + assert-nav-dots) | `bash .maestro/check-nav-dots.sh` | Real-device nav-flow visibility and screenshot-based pill/dot geometry, using `.maestro/nav-dots.yaml` and `bun scripts/assert-nav-dots.ts` | Full-screen functional coverage, all Android variants, and voice/stylus behavior | Phone/device runner; not CI |
| Proof scripts | `node scripts/chat-window-proof.mjs`; `node scripts/chat-rows-proof.mjs` | Rendered Expo-web chat/layout regressions at scripted viewports using controlled fixtures | Real Android IME, accessibility services, live model replies, native timing | Isolated local browser/Expo web; not CI |
| CI gates | `bun run typecheck`; `bun run lint`; `bun run test`; `bun scripts/mutate.ts --threshold 80 --max 200` | Type, lint, registered tests and mutation regressions before PR acceptance | Maestro/device execution, full native APK/manifest, real bridge/runtime proofs, frame-time traces | CI (four matrix gates plus `required-gates` aggregation) |

Sources: `AGENTS.md` (Verification), `CONTRIBUTING.md`, `.cursor/skills/verify-dash/SKILL.md`, `.cursor/skills/tdd/SKILL.md`, `.github/workflows/ci.yml`, and `scripts/verify-dash/control-dash.ts`.

### Mutation: current target files

`scripts/mutate.ts` is a Bun mutator that temporarily edits targeted source files, runs paired tests, and restores the originals; it is **not Stryker**. Run it on a clean checkout without concurrent edits. The actual target array on this source revision includes all of:

- App/geometry/flows: `app/src/lib/pending-queue.ts`, `app/src/trace/chip-state.ts`, `app/src/lib/rail-turns.ts`, `app/src/lib/chat-window.ts`, `app/src/components/golden-nav.ts`, `app/src/components/bridge-pull.ts`, `app/src/motion.ts`, `app/src/lib/orb-phase.ts`.
- App/annotation: `app/src/lib/annotate/strokes.ts`, `app/src/lib/annotate/pointer.ts`, `app/src/lib/annotate/align.ts`, `app/src/lib/annotate/compose.ts`.
- Bridge: `bridge/src/model-health.ts`, `bridge/src/model-roles.ts`, `bridge/src/thinking-summary.ts`, `bridge/src/turn-summaries.ts`, `bridge/src/z0live-state.ts`, `bridge/src/roster.ts`.
- Shared: `shared/model-roles.ts`, `shared/thinking-summary.ts`, `shared/protocol.ts`, `shared/z0live-state.ts`.

The CI job uses the explicit `--threshold 80 --max 200` invocation. A surviving mutant indicates an assertion gap; the score is not a measure of device or end-to-end quality. The shorter five-file list in `AGENTS.md` is historical guidance, not the complete current `TARGETS` array.

## Choosing the gate for a bug

| Bug class | Cheapest useful gate | Required stronger evidence / gap |
| --- | --- | --- |
| Layout geometry and pager centering | `bun test app/src/components/golden-nav.test.ts`; mutation | Real `.maestro/nav-dots.yaml` screenshot plus `bun scripts/assert-nav-dots.ts`; broader page coverage **MISSING** ([#59](https://github.com/kvnloo/dash/issues/59)) |
| Protocol drift / parser compatibility | `bun test shared` and `bun run test:mutate` | Authenticated bridge/peer integration on the exact head; compiler success is not wire compatibility |
| Store races, replay and lifecycle | `bun test app/src bridge/src shared` with deterministic race fixtures | Real disconnect/restart/replay proof; systematic cross-process soak **MISSING** |
| Rendering and chat placement | `node scripts/chat-window-proof.mjs` and `node scripts/chat-rows-proof.mjs` | Real installed-phone layout, IME and scroll screenshots; browser keyboard styles are simulations |
| Native permissions, share intents and manifest | `bash scripts/verify-native-js.sh` and `python3 scripts/verify-native-manifest.py` with a **generated merged manifest argument** | Native prebuild/APK + actual share-source and permissions checks per `docs/native-android.md`; native manifest checking in root CI **MISSING** |
| Accessibility labels/actions | Focused unit accessibility tests and `node scripts/ux-qualify.mjs` on an isolated debug web export | TalkBack/Android accessibility traversal **MISSING**; label coverage tracked in [#156](https://github.com/kvnloo/dash/issues/156)–[#169](https://github.com/kvnloo/dash/issues/169), voice journey [#335](https://github.com/kvnloo/dash/issues/335) |
| Frame-time jank / interaction latency | Pure perf guard regressions and browser-render checks can flag some issues | Native frame-duration regression gate **MISSING**; tracked in [#378](https://github.com/kvnloo/dash/issues/378) and latency-baseline [#399](https://github.com/kvnloo/dash/issues/399) |

The native-manifest script takes an already **merged manifest XML file**, not an app configuration file; invoking it without that artifact is not a meaningful gate. `docs/rollout.md` describes release channels, not a device test. `docs/upstream-gate.md` describes authorization and dry-run safety; no local command can substitute for a real owner decision.

## Device and browser proof inventory

- `.maestro/check-nav-dots.sh` deletes a stale screenshot, runs `.maestro/nav-dots.yaml` on an already attached Expo Go session, requires fresh output, and passes that image to `scripts/assert-nav-dots.ts`. Its pixel checker also has unit coverage in `scripts/assert-nav-dots.test.ts`.
- `.maestro/inspect-nav.yaml`, `.maestro/inspect-bridge.yaml`, and `.maestro/inspect-keyboard.yaml` are **capture/inspection flows**. Screenshots alone do not contain assertions for every page or verify native keyboard behavior.
- `scripts/chat-rows-proof.mjs` checks real Expo-web Chats list presentation using isolated fixtures; `scripts/chat-window-proof.mjs` checks mounted Chats→window→close and simulated keyboard geometry.
- `scripts/keyboard-attach-proof.mjs` checks real Expo-web rendering with simulated IME style outputs; it explicitly does **not** prove Android IME behavior.
- `scripts/ink-render-proof.mjs` checks Expo-web pointer/gesture/Skia pixels; it is **not** S Pen or Android acceptance.
- `scripts/moodie-faces-proof.mjs` checks Expo-web character faces at scripted widths/reduced motion; `scripts/workspace-navigation-proof.mjs` checks actual Expo-web pane navigation.
- `scripts/verify-thinking-tools.mjs` uses a deliberately synthetic stream in a debug-enabled Expo-web renderer; `scripts/ux-qualify.mjs` requires an isolated debug web app; `scripts/genui-qualify.mjs` uses a built web export and seeded inline UI fixtures. These are browser proofs, not live model or phone evidence.
- `scripts/verify-orchestra.mjs` / `scripts/verify-orchestra-real.mjs` operate against a separately provisioned authenticated isolated bridge (not synthetic graph data); `scripts/verify-hermes-sessions.ts`, `scripts/verify-hermes-handoff.ts`, `scripts/verify-hermes-gateway-live.ts` and `scripts/verify-z0bridge-hermes.ts` require deliberate isolated scratch setup and live services. They are **not** CI matrix jobs.
- `scripts/gate-rehearsal.mjs` runs an isolated authorization rehearsal and refuses live posting; `scripts/package-living-night-proof.py` packages existing captures rather than generating device evidence.

### Unclassified proof scripts

- `scripts/lab-polish-proof.mjs`: its opening comment specifies headless browser isolation and input arguments, but does not define a complete accepted proof contract. Inspect assertions and required debug export before treating it as a gate. Do not count it as phone evidence.

## Evidence and handoff rules

1. **Unit**: identify the test command, exact commit, assertions and test output. Mutation evidence separately needs changed target set, score/threshold and restored-source proof. A written test without execution has status **NOT RUN**.
2. **Browser/runtime**: distinguish mocked debug seed from a live authenticated bridge. Capture exact head, command, environment category, relevant receipts and failure modes. A browser screenshot is not a physical-device observation.
3. **Native/device**: record the built artifact and merged-manifest provenance, installed version and actual Maestro/device actions with fresh screenshot or logs. Unit, browser, build and live-device acceptance are separate gates.
4. **CI**: verify each of the four matrix jobs and the `required-gates` aggregator on the submitted PR head. CI green alone does not assert device, live-agent or real-phone acceptance.
5. **No invented proof**: never report tests, UI acceptance, screenshots, performance gains or physical input checks as passed unless they ran against that exact head. The integration owner performs phone/device, service and manifest qualification.

See `.cursor/skills/verify-dash/SKILL.md` for safe runtime procedures and `docs/native-android.md` for native rollout limitations.

