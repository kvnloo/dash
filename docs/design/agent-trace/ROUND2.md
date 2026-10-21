# Round 2: shared analysis contract

These are standalone HTML prototypes, not Dash application or agent-execution code. All data is a frozen historical cohort, including quota and running states. No phone is accessed by the builder or verifier.

## Four operator questions

| View | Question | Evidence / drilldown | Missing evidence |
| --- | --- | --- | --- |
| A Timeline | What happened, why does it matter, what do we check next? | Latest-first vertical dispatch cards, project/tool search, interruption filter, workers, paginated calls, error/gap keyboard jumps | Completion does not prove acceptance or merge |
| B Handoffs | Did work return, and did a successor inherit it? | Latest multiworker batch by default, batch chooser, 960/1800 px scrollable lanes, viewport minimap, historical playhead, full run evidence | No causal parent spans; no invented connectors; resume matching remains heuristic |
| C Capacity | Where should the next useful paid work go? | Timestamped lane pace, pricing coverage, Hermes tool aggregates, separately disclosed 7-day omp sample | Historical quota cannot authorize current routing; null cost is unpriced |
| D Pocket | Which decision deserves my attention? | Three recent candidate batches, category counts, per-run read/action, collapsed older candidates | Owner keywords are not verified outstanding requests |

Neutral phase styling replaces the rainbow. Gold means proposed owner attention/selection, red means failure/interruption, green means reported completion. Older cards lose the elevated surface and are folded, not made illegible. Font faces are retained from round 1 and inlined. Main copy is 15-17 px; evidence metadata is 12-14 px. Buttons, links, selects, input and disclosure controls have at least 44 px height. At 412 px the main trace is vertical; only B's intentionally wide lane area scrolls horizontally.

## Data and model provenance

- `data/trace-20261020.json` is unchanged R1 data.
- `data/trace-r2.json` adds allowlisted `project`, `short_goal`, and `label` to each worker and dispatch batch. All counters, events, costs, historical quotas and times are unchanged. Classification uses private goal text and repository/worktree paths locally; no raw titles, prompts, paths or outputs enter committed JSON/HTML. Labels are deliberately coarse, not private session-title excerpts. Mixed-project batches use their most common worker label; expand for individual labels.
- `data/interpretations-r2.json` contains real generated text, not author-written fallback insights. Model/provider: `gpt-6.1-sol` / `openai-codex`. Generation command is implemented by `tools/interpret_r2.py` using `hermes chat --provider openai-codex -m gpt-6.1-sol -t '' --oneshot -Q --safe-mode --max-turns 1 --in <prototype-root> --query-file <prompt>` and a 420-second subprocess timeout. Tools are disabled: this is one model text-generation pass, not delegated implementation.
- Input includes all 51 sanitized dispatch batches, worker status/calls/errors/cost/quiet-gap/owner-category/resume summaries, heuristic definitions, quota snapshot and separate omp aggregates. Output covers every run, six sections, four view reads and three goal-linked recommendations per view.
- Cache has source, prompt and canonical insight-content SHA-256 digests. The offline builder refuses stale source hashes. Confidence is the model's self-assessment, not a calibrated score. Text is visibly separated from deterministic facts. No model call happens at page load.
- Local generation evidence (prompt, raw output, CLI stderr/session receipt) is retained in the worker's run directory, not Git.

## Feedback protocol: `dash.trace.feedback/v1`

Every read and suggested action has a collapsed, per-target working thread. Open “Discuss this read” or “Respond to action” to see cached agent text, replies, and controls. Agree / Disagree / Ask are present for reads and actions; actions also have Do it / Not now. Disagree offers a text box for context. Ask accepts up to 4,000 characters. No synthetic live agent response is displayed: only cached model text and optional actual endpoint replies appear.

“Do it” is an intent record only. It does not run a worker, access a device, merge, or authorize broad execution. Dash must separately reconcile scope and obtain any required approvals.

Persistence:

- localStorage key `dash.trace.feedback.v1.<source_sha256>`, shared by the four files on the same origin. File URLs and HTTP URLs have different storage scope; use the served URLs for shared sessions.
- Records contain stable event ID, UTC ISO timestamp, view, target, kind, text, context (including exact interpretation text), the insight-content digest at response time, delivery state and optional server reply.
- Settings persist an optional endpoint under `dash.trace.feedback.endpoint.v1`. No endpoint is shipped or configured by default. Clearing the endpoint stops delivery. Replies are retained locally and can be exported as `dash-trace-feedback.json`, schema `dash.trace.feedback-export/v1`, with dataset hash and all records.
- Saving an endpoint does not flush older replies silently. “Retry unsent” explicitly delivers stored unsent/failed records using their original IDs and interpretation digest. New responses POST automatically while an endpoint is configured. Delivery state is shown in each thread; export works even without delivery.

POST JSON fields:

| Field | Meaning |
| --- | --- |
| `schema` | `dash.trace.feedback/v1` |
| `id` | Stable client event ID; use as an idempotency key |
| `at` | UTC ISO response time |
| `dataset_sha256` | Exact sanitized cohort digest |
| `interpretation_sha256` | Canonical model-output content digest at response time |
| `view` | `a`, `b`, `c`, `d` |
| `target` | `view-a`, `view-a-action-0`, `section-timeline`, `section-timeline-action`, `read-run-47`, `action-run-47`, etc. Internal IDs are correlation keys, not human labels |
| `kind` | `agree`, `disagree`, `ask`, `do_it`, `not_now` |
| `text` | Free text for `ask`, otherwise empty |
| `context` | Optional run/label plus exact original interpretation text |
| `execution` | Always `proposal_only` |

Client uses `Content-Type: application/json`, `credentials: omit`, no redirects, and a 10-second timeout. Endpoint URL must be HTTP(S), without embedded username/password. A cross-origin endpoint must implement OPTIONS/CORS for the exact review origin and JSON POST. An HTTPS page must use an HTTPS endpoint. Do not send bearer tokens through this prototype. For production Dash, use a controlled same-origin authenticated bridge rather than a public anonymous command endpoint.

Success: return a 2xx JSON object with `id` exactly matching the event ID. An optional `reply: {text: "..."}` is displayed as an actual agent/endpoint reply. Non-2xx, timeout, invalid JSON and mismatched acknowledgement IDs retain the event as failed for explicit retry. Endpoint must deduplicate event IDs; a retry after a lost response may repeat a previously accepted event. Endpoint responses are rendered with textContent, not HTML. Persist a confirmed decision or command in Dash's authoritative state separately; never treat an accepted feedback event as evidence of executed work.

## Rebuild and verify

From the repository root:

    python3 docs/design/agent-trace/tools/build.py
    python3 docs/design/agent-trace/tools/test_r2.py
    python3 docs/design/agent-trace/tools/verify_r2.py

`build.py` now defaults to R2 and needs no network/model. `--r1` invokes the original builder; the checked-in `*-r1.html` files are byte-identical to the original commit and retained for comparison. Do not run the old renderer when publishing R2.

To deliberately regenerate labels from locally available logs without refreshing the frozen counters:

    python3 docs/design/agent-trace/tools/prepare_r2.py

To regenerate the model cache (real paid/provider inference):

    python3 docs/design/agent-trace/tools/interpret_r2.py --evidence-dir <run-dir>/llm

The live exporter in `tools/export_trace.py` now emits the same allowlisted labels. The explicitly named artifact-store copy is synchronized with it. Regenerating a full live export is separate from enriching this frozen cohort; do not relabel current telemetry as historical.

Verifier uses its own headless Chromium process with desktop/compositor variables removed from the child environment, no CDP connection to an owner's browser, and no phone/ADB calls. System Chromium is selected explicitly because this host's Python Playwright expects a headless-shell revision that is not installed. It captures actual tailnet-served pages at 412x915 (top, middle, expanded evidence) and 1440x900, plus desktop light-theme checks. Its local loopback server verifies feedback POST/readback, explicit retry, JSON export, escaped free text and real server-reply rendering. It also checks horizontal overflow, >=44 px controls, keyboard jumps and lane zoom/pan. Runtime output is `captures/r2/verification.json`.

Main screenshots: `captures/r2/{a-trace,b-lanes,c-stats,d-pocket}-{phone-top,phone-middle,phone-expanded,desktop}.png`.

## Open

- http://100.113.138.100:4186/a-trace.html
- http://100.113.138.100:4186/b-lanes.html
- http://100.113.138.100:4186/c-stats.html
- http://100.113.138.100:4186/d-pocket.html

Comparison: replace `.html` with `-r1.html`. No app code, production service endpoint or phone state changes.
