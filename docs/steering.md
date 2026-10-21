# Steering a running Hermes turn

In an existing Hermes chat, the busy phases `thinking`, `tool`, and `streaming`
expose Steer as the composer primary action. Queue instead selects the next turn;
Stop remains separate. The split control follows the thumb-side setting and mode
switches use the existing selection haptic. Idle chats retain normal Send.

The wire message adds optional `mode: "steer" | "queue"`; omitted means queue.
Queueing from a busy Dash-owned reply keeps the existing local pending FIFO.
Queueing to an externally running Hermes session uses its gateway FIFO. A queued
receipt is not displayed as model execution: only actual stream activity changes
it to started. Steers are sent immediately, bypassing the local continuation
claim, because they control the already-running turn rather than start another.

The bridge attaches to the owning gateway and submits a generation-fenced
`session.steer` using the proven z0live relay / z0bridge send-helper mechanism.
`hermes-steer.py` discovers the gateway read-only and never starts one or launches
an agent. The installed Hermes Python is obtained via `--print-runtime-command`.
Host deployments can select `DASH_HERMES_BIN` and `DASH_HERMES_SOURCE`; the latter
defaults to the existing host runtime checkout, `/workspace/hermes-home/hermes-agent`.
Profile selection stays child-local in `HERMES_HOME`; inherited explicit remote
TUI gateway URLs are removed. Prompt text goes over stdin, not argv.

This implementation uses the direct helper fallback: the host currently runs
z0bridge's identity-only service, not the full send service on :4787. It does not
enable or deploy z0bridge PR #5, enroll a new credential, or migrate #81's broader
send/SSE transport. A future z0bridge send adapter must preserve its terminal
accept/refuse rule and never retry through this fallback after dispatch.

Results:

- Accepted steer: a delivery receipt marks the user message Steered with the
  bridge acknowledgement timestamp, including after reconnect/replay. Its text
  lands at the running agent's next tool boundary. No independent assistant
  reply is invented, and no other viewer's reply is copied onto the steer.
- Explicit `no_running_turn`, `stale_generation`, or `execution_not_ready`:
  steering was not accepted. The bridge visibly reports the fallback and submits
  the text once through the existing `hermes chat --resume ... --query-file -
  --format stream-json` next-turn route.
- Unsupported control, authorization refusal, unknown outcome, disconnect or
  cancellation: fail visibly; never retry or silently queue. Managed/safe-mode
  Hermes worker sessions currently refuse steering. Their policy is not changed.

A steer accepted by the gateway is not a synchronous model-consumption guarantee.
It is consumed at a tool boundary. Stopping Dash's thin client does not cancel
another viewer's running agent. Offline steers are not automatically replayed as
ordinary next-turn messages. The native `/v1/runs` API is not used for this path.

## Deterministic checks

    bun test bridge/src/hermes-steer.test.ts shared/protocol-steer.test.ts app/src/lib/composer-mode.test.ts app/src/store/steer.test.ts
    bun run typecheck
    bun run lint
    bun run test
    bun scripts/mutate.ts

Live qualification must use a newly created owned scratch gateway-hosted tmux
session, never a person's live session. Queue a harmless long terminal sleep,
observe its tool-start event, then send a distinct steer while that tool runs.
Verify the original turn's final response and the exact native transcript, not
just the steer acceptance. Also verify idle queueing and idle-steer fallback.
