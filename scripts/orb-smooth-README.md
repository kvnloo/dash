# Real AgentOrb before/after measurement

Run from `/mnt/zer0models/workspace/zer0/products/dash/.worktrees/orb-smooth`.
The runner refuses render/CPU work outside hostname `mbp`. It uses existing MBP
Expo and Playwright dependencies, installs nothing, and controls no phone,
preview, Metro service, or bridge. The exported fixture's HTTP server and browser
are private to the fleet job and close on exit.

## Baseline

```sh
/home/kvn/.local/bin/fleet-build --node mbp --wait 1800 --mem 3G --cpus 2 --timeout 900 \
  --fetch scripts/orb-smooth-results \
  --out /mnt/zer0models/workspace/zer0/data/operations/sol-runs/20261022-orb-smooth/baseline-clean-run \
  -- bash scripts/orb-smooth-fleet.sh baseline
```

Baseline sources come from `scripts/orb-smooth-baseline.tar`, made with:

```sh
git archive 8c32128a68f1cd8026b7090f66a8d39bd5360e29 \
  app/src/components/AgentOrb.tsx app/src/components/OrbMotion.tsx \
  app/src/lib/orb-phase.ts app/src/motion-ambient.ts app/src/theme.ts app/src/turbo.ts \
  > scripts/orb-smooth-baseline.tar
```

Archive SHA-256: `9a6ec4bbdd2f2d63b6cb9fb92de65e3b42c92e683e78efb77ad80019306d43cb`.
Extraction happens ONLY inside the shipped remote snapshot. This never reverts
shared-worktree orb edits. Source copies and per-file SHA-256 are fetched back.

## After parent edits

```sh
/home/kvn/.local/bin/fleet-build --node mbp --wait 1800 --mem 3G --cpus 2 --timeout 900 \
  --fetch scripts/orb-smooth-results \
  --out /mnt/zer0models/workspace/zer0/data/operations/sol-runs/20261022-orb-smooth/after-final \
  -- bash scripts/orb-smooth-fleet.sh after
```

`after` imports current worktree app sources without restoring the baseline tar.
Baseline defaults to `EXPO_PUBLIC_DASH_TURBO=0`, i.e. a 6000 ms shared-clock
period. Current after clock is unwrapped, advancing one cycle per 6000ms; the
measurement detects both baseline resets and after integer crossings. Modulo 1
is used only to schedule seam screenshots, never to change renderer input.
`ORB_SAMPLE_MS` can be set remotely to 6500–15000;
default 7200 ms per case (covers at least one normal wrap).

## Scope and artifacts

This is the **actual AgentOrb renderer** and **actual OrbMotionProvider**, compiled
by Expo/Metro to React Native Web. Real React Navigation controls focus. No renderer,
clock, phase function, geometry, or math is replaced or reimplemented. Only the
snapshot's entry point is replaced with an isolated fixture.

The 19 measured cases are eight phases × (one 220px hero / twenty 64px orbs),
plus inactive+display:none, animated=false, and fresh-page prefers-reduced-motion.
A separate real navigation blur check records detachment versus stable transforms.
The exact SVG contract is one layer for baseline and two equal four-path color
layers for after, selected by the output directory name. After path d is checked
before/after each case and observed for mutation/replacement throughout timing.
After also measures all eight destination phases with and without an interruption
at the first frame ≥80ms. Every 450–600ms sequence has actual rendered zero,
60–120ms early, and end transform/phase checkpoints. The angular continuity bound
is fastest phase speed (120°/s) × current-plus-previous rAF interval + 0.5°.
Screenshot replays are separate from these measurements; actual capture spans
are recorded rather than pretending screenshots freeze a specific millisecond.

Each result directory contains:
- `summary.md`, `summary.json`: MBP-generated compact table and observed adjacent
  transform-change cadence, including unchanged-frame runs. This is not hardware FPS.
- `metrics.json`: per-case interval p50/p95/p99/max, >25/>50 ms interval counts,
  CDP task/script/layout/style duration deltas, long tasks, distinct rendered
  transforms, actual shared-clock-wrap angle/scale jumps, completion/errors.
- `<case>.json`: every observed rAF timestamp, shared clock value, real computed
  transform/angle/scale, document visibility, and long tasks.
- `<case>.png`: actual rendered phase screenshots **outside** timing windows.
- `seam-<phase>-before/after.png`: actual rendered wrap-adjacent screenshots for
  listening/speaking/connecting; `metrics.json` records the clock before/after
  each screenshot (captures can cross the desired boundary).
- `unfocused.png`, `source/`, `provenance.json`, `run.log`, and exported `site/`.
- `transition-<phase>[-interrupted].json`: full rAF transforms, phase labels,
  two SVG layers/path d, angular bounds and zero/early/end checkpoints.
- `transition-<phase>[-interrupted]-zero/early/end.png`: separate visual replays.

**Limitations:** browser rAF measures browser scheduling, not Android UI-thread
or hardware-presentation FPS. Computed-style sampling adds equal instrumentation
overhead. Hidden test exercises the app's real OrbActivity gate plus display:none,
not OS background suspension. Real document visibility is recorded, not faked.
Production React Profiler callbacks are disabled; no React commit-count claims.
Screenshot capture is excluded from frame measurements. No thermal/battery/device
claim. Run validation before or after, not concurrently with timing measurements:

```sh
fleet-build --node mbp --wait 1800 --mem 3G --cpus 2 --timeout 1200 \
  --fetch scripts/orb-smooth-validation-results \
  --out /mnt/zer0models/workspace/zer0/data/operations/sol-runs/20261022-orb-smooth/validation-final \
  -- node scripts/orb-smooth-validate.mjs
```

Validation uses cached app/bridge/root dependencies. It creates a Git index (no
commit) in the isolated fleet snapshot for the real workspace inventory test.
App, bridge and scripts typechecks; focused/full tests; stock, orb-targeted and
three semantic mutations are logged separately. When full tests fail it repeats
with the six baseline source files and without new continuity tests to distinguish
preexisting failures. Dependency source copies happen only after validation so
their TypeScript does not accidentally enter the scripts tsconfig include glob.
