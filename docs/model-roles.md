# Model roles and thinking summaries

## Registry

`shared/model-roles.ts` is the dependency-free wire contract; `bridge/src/model-roles.ts`
resolves assignments. The host reads only `modelRoles` and `retry.fallbackChains`
from OMP's `~/.omp/agent/config.yml`. It never returns the YAML file itself.

Precedence is field-wise: `$DASH_CONFIG_DIR/model-roles.yml` (default `~/.dash`),
then OMP, then Dash defaults. Neither file is written by Dash. Override example:

```yaml
modelRoles:
  smol: local/qwen3-4b-q4km
  orchestrator: '@default'
retry:
  fallbackChains:
    smol: [openai-codex/gpt-6-luna]
```

Aliases: `large` → `slow`, `planning` → `plan`, `orchestrating` → `orchestrator`.
`@role` selectors and fallback references resolve recursively, with cycle protection.
An explicitly empty fallback array disables inherited fallbacks. Model and fallback
precedence are independent. Source identifies the model assignment, not every
inherited fallback entry. Unassigned orchestrator inherits the resolved default.

The registry includes all current OMP built-ins (including commit, memory, widget,
image, web, speech, dictation) plus orchestrator. Unconfigured non-chat kinds are
unassigned, not falsely routed to a chat model. It is a role registry, not a claim
that Dash implements image generation, TTS, or an arbitrary provider's transport.
Jev's judge role is an evaluator; the summary generator does not send prose tasks
to Jev just because it appears in tiny's general-purpose fallback chain.

GET `/models` requires the bridge's existing execution/identity authorization and
is read-only. Settings → Models shows assignment, source, purpose, fallbacks and
health. Local health means endpoint reachability and inventory membership, not
latency or correctness. Cloud OAuth health is unknown; the app never infers that
an OMP account is unavailable just because Dash lacks an API key.

The tiny default is the actual groot llama.cpp router model `local/qwen3-4b-q4km`
on `http://100.113.138.100:11530/v1`; `DASH_TINY_URL` overrides the base URL. The
older cognition serving.json advertised Qwen3.5 on localhost:11500, but that
endpoint was offline during qualification. The active router was verified with
GET /v1/models and its `z0-farm-llama.service` definition, without restarting it.

## Thinking summary lifecycle

The chat's Thinking summaries switch is opt-in and persisted per chat. It applies
to the next typed or voice turn. It is not a retroactive revocation of a request
already sent; it does not run on historical messages. Only the host sends inference
requests. The phone receives validated `status.summary` packets and uses the keyed
text store for summary subscriptions; persisted summaries survive app restart.

Reasoning `ReplyPart` updates from ACP/Hermes/legacy parsers reach `Turn.part`.
Answer tokens close a
reasoning block; action labels are added to the turn trace. Each block receives
live (one line, at most every four seconds) and final (one or two lines) summaries.
The turn chip summarizes reasoning and action labels. A generation is advisory,
not verification that a claimed action succeeded. Prompts explicitly distinguish
plans from completed actions. No summary is shown when providers fail.

Smol is attempted first, tiny second; each request gets at most 750 ms and the
whole generation gets at most 1.5 seconds. Real fetches are aborted at the deadline.
The live throttle does not suppress finals. SHA-256 caches include chat/turn scope,
model assignment, mode and redacted text; they are bounded and memory-only. Errors
are not cached. In-flight duplicates coalesce. No raw trace is logged. PEM blocks,
credential assignments, bearer tokens, known token prefixes, JWT-like and long
opaque strings are redacted before inference and again on output.

Supported summary transports in this draft: local OpenAI-compatible llama.cpp and
Anthropic's messages API using an existing `ANTHROPIC_API_KEY` in the bridge's
process environment. No credential files are read by the transport. No credentials
are accepted over the phone or returned by the registry. There is deliberately no
attempt to scrape OMP's OAuth credentials. Codex OAuth (including the currently
assigned gpt-6-luna) and Jev generation are NOT implemented summary transports;
they fail closed and the live request tries tiny. This is a remaining acceptance
blocker, not evidence that the owner's OMP/Codex account is unavailable.

The general role fallback chain is exposed for consumers. The live summary policy
specifically tries the smol and tiny primary assignments, not arbitrary evaluator
fallbacks or an unbounded chain of paid providers. That distinction preserves the
live deadline and avoids sending private trace text to Jev.

`TurnSummaries.finish` waits for pending finals and the turn summary before the
`done` packet, but it does not block answer streaming. The summary chip's time is
host-observed elapsed turn/block time, not model inference latency.

## Thinking-tools worker integration

This branch is stacked on `origin/sol/dash-thinking-tools-20261021` at
`0c93fde7ba3ff882e3fe3f630760707e2edba887` (it was pushed during qualification).
Both branches retain the v1 status envelope. Summary and reply-part payloads are
mutually exclusive and malformed combinations fail closed.

`Turn.part` is the single reasoning hook for ACP, Hermes and legacy harness
parsers. It feeds reasoning text and tool-start labels into TurnSummaries before
emitting the worker's wrapped disclosure previews. There is no second ACP
reasoning callback, so chunks cannot be double-counted. Both keyed parts and
keyed summaries are retained. The overall chip is in the reply header; block
summary chips sit beside the wrapped thinking/tool section. Hide detail mode
hides the block summaries but retains the overall turn chip.

## Hermes mapping (documentation only)

Hermes `model.default` / `model.provider` correspond conceptually to Dash's default
and inherited orchestrator. Hermes `delegation.model` / `delegation.provider` map
to task (not automatically to smol). Hermes auxiliary models are feature-scoped:
fast utility/title/summary jobs map conceptually to smol/tiny, vision to vision,
planning to plan. These are conceptual mappings, not an invented Hermes @role
schema or a configuration import. Dash does NOT change any Hermes configuration,
profile, credential pool, auxiliary setting or delegation model.

References:
- https://github.com/kvnloo/oh-my-pi/blob/main/packages/coding-agent/src/config/model-roles.ts
- https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/config/model-resolver.ts
- https://github.com/kvnloo/oh-my-pi/blob/main/docs/settings.md
- https://hermes-agent.nousresearch.com/docs/user-guide/configuration

## Verification

`bun test app/src bridge/src shared`, `bun run typecheck`, `bun scripts/mutate.ts`.
The mutation target list includes the new registry, summary, lifecycle and wire
modules, rather than reporting only the pre-existing suite's mutation score.

For a real recorded trace in a private JSON file containing `{ "text": "..." }`:

`bun scripts/prove-model-summary.ts /private/recorded-reasoning.json`

An optional second argument changes only the direct diagnostic deadline (ms),
not the live summarizer's 1.5-second budget. Output contains sanitized summaries,
model ids, latencies and failures; it never prints the raw recorded reasoning.
