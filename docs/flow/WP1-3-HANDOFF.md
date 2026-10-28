# Dash Flow WP1-WP3 handoff

> Landing note (rc3 integration): this handoff was written against the unit-test suite, the mutation gate
> and the `flow-law-seeds` / `flow-pen-web` scripts. Trunk dropped the unit suite and the mutation gate
> (e744041, O15), so those commands, the 11 unit-test files and the `docs/flow/wp1-3-evidence/` records
> were not landed. The gate for this work is the tester army (`bun run test`). The delivered scope below
> is unchanged and still opt-in: both `EXPO_PUBLIC_DASH_TURBO=1` and `EXPO_PUBLIC_DASH_FLOW_MODE=1`.

## Delivered

- `7cd3dc8` adds opt-in monotonic `flow-trace`, a bounded ring, paired native/JS epoch calibration, annotation trace hooks and the authenticated dev collector. Both `EXPO_PUBLIC_DASH_TURBO=1` and `EXPO_PUBLIC_DASH_FLOW_MODE=1` are required. Persisted stroke timestamps remain wall-clock values.
- `5423f45` adds current-generation acceptance, hides superseded live artifacts immediately, rejects delayed old events, and protects native generated-UI fences with rendered #114 fixtures. Ordinary programming code remains code.
- `df96333` preserves flow ink on mode/back exit and connects serialized draft storage with background flush and cold restore. A new failing regression exposed empty background writes during cold restore; the fix defers writes until restore settles. Clear remains explicit discard.
- `e9ba191` connects `attachClosedPenLoop` to the actual annotation finish handler. It stages a pending composer chip before screenshot/crop/upload, preserves typed text and reports capture/upload errors without sending a turn. Persistence mounts only in flow mode.
- The verification commit adds complete-operator mutation mode, stronger boundary/accessibility assertions, seeded law canaries and a reproducible browser proxy.

## Host verification

Executed serially, without installation, a phone, Metro, merge or PR.

| Gate | Observed result |
| --- | --- |
| `bun test app/src bridge/src shared` | 1911 pass, 0 fail before final assertion additions |
| `bun test app/src bridge/src shared scripts/mutate.test.ts` | Final 1922 pass, 0 fail, 254 files, 26871 assertions |
| `bun run typecheck` | Pass across app, bridge and scripts |
| `bun run lint` | Pass, zero warnings |
| `bun scripts/flow-law-seeds.ts` | Off, L3, L4 and L7 violations each produce failing assertions; source restored in `finally` |
| `bun scripts/mutate.ts --threshold 85` | 91%, 175 killed / 18 survived, 193 selected, no invalids/timeouts |
| `bun scripts/flow-pen-web.ts` | Browser proxy 43.2 ms pen-up to double-rAF chip marker; persisted, inactive after exit, ready attachment, typed text preserved, zero page errors |

The seeded canaries are reproducible rejection evidence, not a claim that the resumed WP1/WP2 implementation was authored in this session. The original attempts' red-first receipts were not retained here. This session's cold-restore race and mutation-all mode were directly observed failing before their fixes.

Complete-operator flow mutation results use `--file <target> --threshold 85 --all --max 10000`. Unlike the default plan, this enumerates every collected operator in each named module rather than sampling twelve branches. All modules meet 85%. The mutator's operator set remains limited to its existing equality/boolean/logic/numeric transformations; it is not Stryker or a complete semantic proof.

| Module | Killed / survived | Score |
| --- | --- | --- |
| flow-trace | 5 / 0 | 100% |
| generative-stream | 15 / 2 | 88% |
| GenerativeBlock | 23 / 1 | 96% |
| ink-persistence | 49 / 7 | 88% |
| annotate/io-core | 21 / 2 | 91% |
| stylus-mode | 8 / 0 | 100% |
| annotate/strokes | 27 / 4 | 87% |
| annotate/compose | 18 / 2 | 90% |
| annotate/pointer | 14 / 1 | 93% |
| annotate/align | 4 / 0 | 100% |

Raw results are in `wp1-3-evidence/mutation.json`; the browser receipt is `wp1-3-evidence/pen-web.json`. The browser fixture executes the real attachment/persistence helpers with localStorage, a canvas-generated PNG, injected crop/upload adapters and a deliberate one-second upload delay. Its chip is fixture DOM, not the app Composer or a native screenshot/Skia crop. It is a pipeline proxy, not G2 Brainstorm acceptance, native timing or proof of phone pixels. Native #114 tests execute real components through a host React Native web adapter forced to Android; they do not run an Android renderer.

## What S22+ G3 needs next

1. Keep flow mode off in the owner's build. Use an isolated S22+-only test Metro and candidate APK, never a shared S25 Metro. No device or service was changed by this task.
2. WP4 must supply the optional `DashStylus.getUptimeMillis()` reader. Until available, the trace calibration is null and native marks are refused. Capture MotionEvent uptime and genuine Skia frame markers before using the pen latency rows. Existing `input.pen`/`ink.up`/`ink.submit` hooks are JS receipt/submission points, not native digitizer/onDraw measurements.
3. WP5 must wire the remaining actual paint/audio/voice markers, including a real Composer chip paint marker. The removed pending-work `chip.paint` emission was upload completion, not paint; this task does not fabricate that native measurement. Trace stage names are available, but an enum alone is not an instrumented pipeline. The full per-turn voice/ink correlation belongs to the later turn-fusion work.
4. Prove a stylus injection path yields `TOOL_TYPE_STYLUS` in `pointerKind` on the S22+. It has no S Pen digitizer. If injection cannot prove the branch, real pen/side-button rows remain owner-approved S25 G4 work.
5. Run G0 bundle/lazy-chunk checks, G2 app journeys, and G3 #114, loop-to-composer and L3 exit/background/cold-start journeys. Record screenshot plus loaded JS SHA. Check actual Skia crop and bridge upload, including capture/upload failures and preserved draft text.
6. Collect dev-client and release-profile runs separately. Use N >= 100 per timing row, thermal/charge metadata, gfxinfo/perfetto, calibrated JS trace dumps and signed SHA-bound receipts. The web proxy is not a latency baseline.
7. Keep WP6 voice, WP7 quiet ink context/floor laws, WP8 Brainstorm, Bend/gdp law mapping and required G0-G3 promotion enforcement open. These host tests do not implement or certify those later packages. No phone latency, real-pen scanout or voice supersession claim is made.

The pre-existing untracked `node_modules` symlink is a local dependency reuse aid, not a deliverable or an installation. It is deliberately not committed.
