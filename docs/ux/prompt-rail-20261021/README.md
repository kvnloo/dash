# Prompt rail qualification

Runtime source: `c37396273fc766ef707d2356d2802918fdd36fd8`. Baseline: `9003c30` plus the identical synthetic-fixture additions from `b31d720`, before changing PromptRail. Both are production Expo web exports with `EXPO_PUBLIC_DEBUG=1 EXPO_PUBLIC_DEBUG_AUTONAV=0 EXPO_PUBLIC_RAIL_PERF=1`. Fixture count was exercised directly: 220 user prompts, 1,100 messages.

## Method

Isolated headless `/usr/bin/chromium`, Playwright, 412×915 CSS pixels, CPU throttle 4× through CDP, three trials per build. Each trial sends 120 pointer moves down/up the rail with an 8ms requested delay. The browser/Playwright back-pressure makes elapsed trial lengths differ: this is equal input count, not equal wall time. Collect rAF intervals, Long Tasks and CDP Performance ScriptDuration/TaskDuration deltas. Stop frame sampling **before** screenshot capture and release. This excludes final-jump rendering, which remains intentionally deferred until release. Estimated dropped frames use `max(0, round(interval / (1000/60)) - 1)`; they are not Chromium compositor counters or native-device measurements.

Earlier exploratory runs included screenshot latency in the rAF window and were replaced by the corrected final measurements below. A shared desktop host remains subject to other-worker contention. These results are evidence for this fixture and harness, not a universal 60fps guarantee.

## Final measurements

| Metric | Before trials | After trials |
| --- | --- | --- |
| p95 frame interval (ms) | 66.7 / 66.6 / 49.9 | 16.8 / 16.7 / 16.8 |
| Worst frame (ms) | 183.3 / 133.3 / 83.3 | 116.7 / 16.8 / 16.8 |
| Estimated dropped frames | 275 / 240 / 145 | 6 / 0 / 0 |
| JS ScriptDuration (ms) | 6816.4 / 5300.9 / 5021.9 | 923.5 / 975.7 / 556.4 |
| Main-thread TaskDuration (ms) | 10119.3 / 8789.9 / 7817.0 | 2505.8 / 2875.8 / 1714.0 |
| Long tasks >50ms | 80 / 52 / 33 | 1 / 0 / 0 |

Median JS script time falls 82.6%. The first final trial still has one 116.7ms frame; this is not a zero-jank claim. Web runs worklets on the browser JS runtime; native uses Reanimated's UI runtime, but physical native timings/haptics were not measured and no phone was touched.

## Behavior and pixels

The browser checks passed: transcript offset unchanged throughout drag, release changes it, actual clipboard read-back, explicit Continue confirmation then unsent draft, Latest reaches actual content end after virtualized height correction, error-state mouse-hover preview, close dismissal. The rail rendered 220 anchors with 10 distinct computed widths. No page errors were captured. Final jump alignment/cancellation on a native phone, screen-reader gestures and live-stream behavior are not qualified here.

All three PNGs were opened and inspected directly. The final error preview prioritizes the failure over partial success text. Popovers remain inside the 412px viewport with actions above the composer. Dense rail strokes are readable as a volume profile but individual 220-turn targets require scrubbing, not tapping 1px lines. The 44px rail/Latest/action targets remain interactive.

- [Before preview](before-popup.png)
- [After scrub preview](after-popup.png)
- [After error-hover preview](after-error-hover.png)
- [Before raw metrics](before-metrics.json), [after raw metrics](after-metrics.json)
- [Browser assertions](interactions.json)

## Checks

- Configured suite: 656 pass, 0 fail; 3,189 assertions.
- App, bridge and scripts typecheck: pass. ESLint: pass. Expo web export: pass.
- Full mutation: 97%, 89 killed / 3 survived / 0 timeout, 92 total. Survivors are in unchanged golden-nav/roster modules.
- Scoped rail mutation: 100%, 12 killed / 0 survived / 0 timeout.
- Existing pinned dependencies were reused through local worktree symlinks, without dependency/lockfile changes.

Reproduction scripts and full logs live in `/mnt/zer0models/workspace/zer0/data/operations/sol-runs/20261021-prompt-rail/`: `measure.mjs`, `interactions.mjs`, `tests-final.log`, `mutation-full.log`, `mutation-rail.log`, `typecheck.log`, `lint.log`, `export-after.log`. The scripts start isolated Chromium and use only loopback static exports on ports 18778/18779. They do not restart Dash services or contact a phone.

See [research, design and explicit omissions](../../design/PROMPT-RAIL.md). Generated smol summaries, true duration/tool/change telemetry and host-file opening are not implemented; the cached excerpt fallback is shipped rather than a fabricated integration.
