# Reply-memory ownership and qualification

The conversation store owns checkpointed history. The keyed streaming stores own
only in-flight copies. Completion, error, Stop and lost-turn paths checkpoint text
and parts, notify settlement observers (including the legacy voice final-text
flush), then release those copies. Deletion, ended-chat cleanup and forgetting
also release reply caches. Summary cleanup includes blocks older than the saved
64-block window. A stale completion must not evict still-streaming content or
explicitly loaded post-completion details.

## Bridge terminal retention

The bridge keeps a finishing turn addressable while its terminal summaries are
pending. Only after emitting `done` does it mark the turn settled, start the
ten-minute replay TTL, and apply the 50-settled-turn cap. Running and
summary-pending turns do not consume that cap. Expiry deletes only the same turn
instance, not a later turn that reused its ID. Admission, drain and voice counts
continue to use settlement, not agent-process exit.

`e2e/mbp-army/terminal-retention.spec.ts` is an unexecuted army regression for
pending-summary retention under cap pressure and explicit subscriber reconnect.
It runs the real fixture agent, holds local summary HTTP requests until the
production deadline aborts them, and creates real rejected OMP steer turns.
It expects an explicitly attached subscriber to receive terminal events before
the newly settled oldest turn becomes cap-eligible. It does not exercise the
ten-minute TTL or ID-reuse expiry. Parent qualification remains required.

This is not automatic post-error reconnect recovery. The app's reconnect
selection excludes replies already in `error`, so retaining the bridge turn
alone does not cause that client to request an attachment. That separate
consumer contract needs an explicit terminal-pending identity and a real app
subscriber regression before recovery can be claimed.

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
