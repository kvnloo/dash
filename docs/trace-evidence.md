# Trace intent and evidence (parent-review candidate)

This change is deliberately NOT registered in bridge/index.ts. No production or preview bridge, Metro, profile, cron job, consumer app or phone is changed by these modules. Parent review owns route admission and any service restart.

## Parent registration after review (not executed)

bridge/index.ts already defines `authorize`, `cors` and `handleOrchestra` (around lines 697/737 on the rollup base). Reuse exactly that execution authorization boundary:

    import { createTraceHttpHandler } from "./src/trace-http";
    import { collectTrace, traceRoots } from "./src/trace-collect";
    const handleTrace = createTraceHttpHandler({ authorize, collect: () => collectTrace(), roots: traceRoots() });

In the authenticated HTTP routing chain, before the generic fallback:

    const trace = await handleTrace(request);
    if (trace) return cors(trace);

Parent must review this registration on the CURRENT integration branch, not edit the served checkout. Review source SHA, MBP receipts, original ask, unknown checks, screenshots and allowed roots first. The historical restart command is `systemctl --user restart dash-bridge-4747`; only the parent may execute it in an idle-checked, qualified rollout transaction with rollback/device gates. This document is not restart authorization. Never infer phone acceptance from Metro logs.

Until admission, GET /trace/snapshot is unavailable on the shared bridge and the app truthfully restores the public bundled snapshot. No live bridge route is claimed by this commit.

## Data and contract

- Wire schema remains dash.trace.snapshot/v1; optional row evidence carries original request, HOTL 0.2 intent, check observations and typed artifacts separately. Static bundled JSON is unchanged and contains no private prompts.
- HOTL uses the canonical AODL fields specVersion/graphId/revision/intentGraph/policies/constraints/provenance. One declared task is not an inferred observed graph or compiled plan. The schema is pinned at kvnloo/aodl@55db6314f9e05c145dc47710ea6a7dba21d5af60 for independent checks.
- Run OWNER blocks and inline OWNER ASK lines are read verbatim; native sessions use their first persisted user message. Existing redaction applies before display; the card labels redaction. Explicit acceptance/test/verification bullets are copied, not invented. If absent, lettered BUILD declarations are copied with an owner-review warning. Missing criteria stay missing/unknown.
- Goal is a deterministic extract, not model-generated compression. Explicit CONSTRAINTS bullets are retained. No inference provider is called.
- Extraction is cached by source/hash in bounded memory; capture-trace writes deterministic INTENT.json copies in the operator-supplied private output tree. It never writes INTENT.json into sibling-owned run directories. Admission of per-run disk caches requires an ownership decision.
- The read-only collector samples bounded recent profile sessions, native phase metadata/tool counts, run directories and fleet exit receipts. It never shells out, executes report content, probes devices or activates a profile. SQLite is query_only/readonly. Unknown liveness is explicit and does not draw a pretend run-duration bar. Sources are observations, not a deduplicated census.
- Current limitations: run/session deduplication, exact product/repo correlation for all sources, tool error/density history and complete fleet-to-criterion association need further review. Run project labels are conservative name-based hints. Native source metadata is private.

## Validation and artifacts

Prose such as “tests passed”, “no ERROR” or “phone verified” cannot satisfy a check. A reviewed VALIDATION.json array can bind `{checkId,text,sourceHash,status,evidence:[absoluteReceiptPath]}` to the exact prompt source hash/check text. Every referenced receipt must be nonempty and inside a permitted root; missing, changed or inaccessible receipts leave unknown. This is an evidence display, not a new Bend verifier or authorization. Independent reviewer/receipt provenance still gates promotion; an agent-authored attestation is not owner confirmation.

Artifacts are discovered from report links/absolute paths and run-root images. PR/commit/page links are references, not fetched PR state. Missing PR titles/state are not fabricated. `dash://Trace|Lab|Settings|Approvals|Main` use existing app navigation; arbitrary schemes and screen names fail closed. Exact screen-state links (e.g. Orchestra view armed), Git branch history discovery and richer relative-path extraction are remaining work, not implicitly implemented.

GET /trace/artifact accepts a path only after authorization. Both lexical and canonical paths must remain within explicit roots; traversal, symlink escapes, hidden/credential/config/database/key paths, directories, active HTML/SVG and unknown types are refused. Reads open once with O_NOFOLLOW, compare inode/canonical path, and cap text at 256 KiB and images at 8 MiB; text is redacted and image signatures checked. no-store/nosniff/sandbox headers are sent. Supported image types are PNG/JPEG/WebP. Roots are sol-runs, project-artifacts, ~/.dash/attachments and products/*/docs; not all of home, profiles or arbitrary worktrees. Reports and filenames are data, never instructions.

The app polls only on the foreground Trace screen, with cancellation/timeout and a 15-second interval. Pairing changes and unavailable/invalid responses discard private old-host data and restore the public bundle. Live snapshots are not persisted to AsyncStorage. Old captured timestamps show “cached bridge snapshot”. Detail leads with intent, validation and artifacts, then collapsed metrics; six-artifact pagination bounds eager image loads.

## Reproduce on MBP

    fleet-build --node mbp --wait 1800 --timeout 600 -- bash scripts/qualify-trace.sh

This includes unit/parser/collector/auth/allowlist/client/fallback tests and app/bridge typechecks. `scripts/qualify-trace-full.sh` additionally records root tests/lint/typecheck, targeted lint, mutation, Android/web exports and screenshots. Root lint is independently reported; do not turn a known baseline lint failure into a green claim.

For private real-data browser proof, capture with `bun scripts/capture-trace.ts /absolute/private/output --proof` on the native host (tiny read-only source operation). This keeps only the actual trace run plus one real Dash image-producing run, source hashes and allowlisted image bytes. Transfer that minimal private input ONLY to the owner-controlled MBP, never a public remote or hosted model. Run the full script with per-command TRACE_PROOF_INPUT and TRACE_CANDIDATE_SHA. The proof runner replays captured real data through the actual authenticated handler on MBP loopback and verifies image SHA256. This is real-data replay, NOT a live groot→MBP connection or native phone proof.

`scripts/trace-proof-server.ts` is an optional owned read-only throwaway endpoint, not a shared service. Direct MBP access to groot :4889 was unreachable in this pass; no permission/ACL bypass is attempted. A replay is explicitly labelled instead. All owned temporary servers must be stopped after proof; no shared service restart is needed.
