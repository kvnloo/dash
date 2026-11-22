# Reply-memory ownership and qualification

The conversation store owns checkpointed history. The keyed streaming stores own
only in-flight copies. Completion, error, Stop and lost-turn paths checkpoint text
and parts, notify settlement observers (including the legacy voice final-text
flush), then release those copies. Deletion, ended-chat cleanup and forgetting
also release reply caches. Summary cleanup includes blocks older than the saved
64-block window. A stale completion must not evict still-streaming content or
explicitly loaded post-completion details.

## Bridge terminal retention

Finishing turns remain addressable while terminal summaries are pending. The
ten-minute replay TTL and 50-settled-turn cap begin only after `done`. Running and
summary-pending turns do not consume that cap. Expiry checks the turn instance
before deleting, so a later turn reusing its ID is not removed.

The real bridge regression `e2e/mbp-army/terminal-retention.spec.ts` holds local
summary HTTP requests to the production deadline, applies cap pressure with 50
real rejected turns, and explicitly reconnects a subscriber. The old bridge
returned `lost`; the corrected bridge replayed its reply and terminal `done`.
It also checks legitimate settled-turn eviction. This does not qualify the
ten-minute TTL, ID-reuse expiry timing, or automatic app post-error reattachment.
The app excludes `error` replies from its reconnect selection; bridge retention
alone does not establish that separate consumer behavior.

## Native reply rendering

`BotFace` also uses an independently transformed native View for its eyes. Driving
an SVG `G` with Reanimated `animatedProps` is unsafe with the installed Fabric
synchronous-props path: Android logs `RetryableMountingLayerException` because
those SVG child tags have no SurfaceMountingManager entry. This restores the
previously qualified native-view implementation, without a native dependency or
APK change.

## Reproduce without touching the owner's phone

`reply-lifetime.test.ts` exercises the real stores and lifecycle functions. The
Chromium probe imports those same stores, replacing only storage/identity adapters
with inert fixtures. It completes and deletes 384 synthetic replies in three
batches, forces browser GC between batches, checks checkpoint contents, records
`Runtime.getHeapUsage`, and saves a Chrome heap snapshot. This is a store-lifecycle
reproduction, **not the complete Expo UI or a Hermes/Android memory measurement**.

Run the suite on an admitted MBP worker. Provide the unchanged base as explicit
inputs, rather than silently treating an arbitrary checkout as the baseline:

```bash
git show 05e3bb5:app/src/store/app.ts > "$TMPDIR/dash-app-before.ts"
git show 05e3bb5:app/src/components/BotFace.tsx > "$TMPDIR/dash-face-before.tsx"
fleet-build --node mbp --cpus 1 --class test --timeout 1200 \
  --input "$TMPDIR/dash-app-before.ts:.memory-inputs/app-before.ts" \
  --input "$TMPDIR/dash-face-before.tsx:.memory-inputs/BotFace-before.tsx" \
  --fetch .memory-receipts --out "$TMPDIR/dash-memory-receipts" \
  -- bash scripts/fleet-memory-proof.sh
```

The runner also typechecks the app, runs app/bridge/shared unit tests and mutation
gates, exports Expo web, and exercises the eye-layer renderer contract. Baseline
failure must name the intended contract, not an import/dependency error. Source
hashes bind the production files used in each arm. `MEMORY_PHASE=after` reruns only
the candidate gates in the isolated cache; it does not rerun baseline evidence.

## Phone attribution limits

Read-only Android observation showed growth in native allocation and private
Unknown memory, while Java heap and Graphics remained much smaller. Native and
Unknown categories **do not distinguish Hermes allocations from other C++ memory**.
On the observed Samsung build, the printed TOTAL PSS equals resident table PSS
plus SwapPss; keep RSS, resident PSS and swap separate when comparing samples.

The JavaScript cache leak is reproducible independently. The unsafe SVG update
path is confirmed by native logcat. Neither observation proves these repairs
explain all multi-gigabyte native/private growth. A post-rollout, same-workload
Android memory series is still required. No service restart, APK installation,
phone navigation or live-phone heap snapshot is part of this runner.

## Dev-client performance measure buffer (DA-069)

Kevin's phone runs the dev client from a channel Metro (`expo start --dev-client`,
no `--no-dev`), so it executes React's development renderer. Once
`console.timeStamp` and `performance.measure` exist, that renderer records one
`performance.measure` per component render ("performance tracks"). React
Native's native `PerformanceEntryReporter` keeps every measure in
`PerformanceEntryKeyedBuffer` until `performance.clearMeasures()` is called,
and nothing in Dash read or cleared them. A streaming chat re-renders on every
frame, so this buffer grew for as long as a reply streamed.

Evidence (Android 15 x86_64 emulator, Expo Go 57.0.9, dev bundle from Metro,
fixture ACP agent streaming ~25 text deltas/s for 5 minutes, `dumpsys meminfo`
TOTAL PSS every 30 s, after 20 s of streaming):

| Build | PSS start → +4 min | Rate |
|---|---|---|
| staging, run 1 | 929 → 1245 MB | ~78 MB/min |
| staging, run 2 | 1072 → 1383 MB | ~77 MB/min |
| measures trimmed, run 1 | 1063 → 1201 MB | ~34 MB/min |
| measures trimmed, run 2 | 1019 → 1222 MB | ~50 MB/min |

A 120 s heapprofd capture on staging attributed 62.8 MB of 118 MB still-unreleased
native allocations to `PerformanceEntryKeyedBuffer::add` ←
`PerformanceEntryReporter::reportMeasure` ← `NativePerformance::reportMeasure`.
With the trim, that stack no longer appears; the remaining growth is Hermes heap
(the growing reply and its copies). An idle open chat window (no stream) stayed
flat on staging (619.7 → 619.8 MB native over 150 s).

`app/src/lib/performance-buffer.ts` clears measures every 2 s from both
bootstraps. Production React records no measures, so the trim costs nothing
there. Marks are untouched. The army journey `chat-memory.spec.ts` records
measures at a dev-renderer rate during a real streaming reply and requires the
timeline to stay bounded (staging retained all 6080; trimmed kept at most 380).

Not qualified here: the S25 itself, release builds, and real model traffic. The
emulator renders with SwiftShader, so absolute numbers differ from the phone.
Things tested and ruled out as the main driver on the emulator: re-rendering the
reply at most every 250 ms, re-lexing only the growing Markdown block, and a
static streaming orb. A single huge `<Text>` (no Markdown) was worse
(~158 MB/min): Fabric's Android `TextMeasureCache`/`LineMeasureCache` keep up to
1024 entries keyed by the full attributed string.
