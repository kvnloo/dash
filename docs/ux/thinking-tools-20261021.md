# Wrapped thinking and tool replies

The v1 protocol remains v1. New reply data rides in optional `status.part`; old clients continue to parse the existing status text. `shared/reply-parts.ts` validates reasoning, tool start/argument snapshots, output deltas, finish/duration, and requested detail snapshots. The bridge sequences and replays these events with the turn.

## Display and streaming

Chat bottom controls select Hide / Compact / Full per conversation. Compact is the default: a fixed three-line, naturally wrapped tail under a one-line header. Thinking and a grouped tool stack live above the independently streaming answer. Tap/long-press expands; horizontal swipe collapses. Individual calls have separate expandable args/output and live/good/error accents. Full opens bounded scrollable panes, rather than pushing the answer out of the viewport.

Reply parts use the same per-reply rAF notification mechanism as text.ts. Interleaved chunks are compacted by kind/call ID, so a long turn does not evict its starts. Tests assert that hundreds of part updates leave the conversation-store identity unchanged. Done/stopped/error and persistence checkpoints include received parts. History reply subscription IDs are conversation-scoped, not database-row scoped.

## Bridge boundaries

- Real Hermes gateway stream-json tool IDs, input, output, native duration and error state are retained. Reasoning aliases are accepted when emitted.
- ACP agent_thought_chunk and tool_call/tool_call_update include nested content wrappers (the current native Hermes shape), rawInput/rawOutput, and updated rawInput.
- OMP/Pi thinking_delta and cumulative tool_execution_update/end; Codex command/search/file/MCP item lifecycle; Claude thinking/tool-use/tool-result envelopes map to the same parts.
- History reads active user/assistant/tool rows, including empty assistant tool-call rows, reasoning/reasoning_content and serialized tool_calls. DB access remains readonly/query_only. Native parts take precedence over an older API projection that omits them.
- Normal tool args/output previews are capped at 8 KiB (UTF-8 bytes); retained full details share a 1 MiB per-turn budget. Detail requests are explicit and read from the existing turn cache or the exact visible profile/session/message. Already-subscribed sockets only can request cached live-turn details. History requests use existing authenticated profile/session routing.
- Obvious credential patterns and sensitive assignment values are redacted before transport. Output buffers unfinished lines so split token strings are not sent one piece at a time. Legacy ACP tool statuses carry bounded metadata only, not a second uncapped rawInput/rawOutput copy.

## Evidence / limitations

Captured native samples are in bridge/src/fixtures/{hermes,codex,claude}-parts.jsonl and acp-parts.json. They came from a harmless printf probe; the Hermes gateway sample was launched in a scratch tmux session. Claude hooks/system frames and unrelated metadata were removed from fixtures; protocol payloads were retained.

OMP execution was blocked by the host lifecycle scanner (executable larger than its scan cap). Pi is not installed. Their tests are explicitly source-contract fixtures, not claimed live captures. References reviewed:

- can1357/oh-my-pi packages/tui/src/chat/{thinking-display,tool-execution}.ts, upstream main 35352fcaa504c40a25c3acc63d781522ffe3c731.
- kvnloo/oh-my-pi equivalent tool renderer, fork main 1882f586a73b6548e2639a0ae597e8a11d6c0b3a. Bounded preview/tail, dirty/coalesced repaint and expanded output guided this implementation, not copied renderer code.
- pingdotgg/t3code packages/client-runtime/src/t3ToolSummary.ts: grouped tool summaries preserve failure counts rather than treating all calls as successes.
- anomalyco/opencode packages/session-ui/src/tools/tool-renderer.tsx: collapsed groups, running-state aggregation, per-tool detail, and scroll-aware collapse.

The installed Hermes stream_json.py explicitly does not emit reasoning progress and caps source tool output at 5000 characters. Dash cannot reconstruct content never transmitted. The new UI will show thinking from ACP/providers that expose it and native stored reasoning on history refresh; live gateway reasoning needs an upstream Hermes emitter change. Current native ACP sample omitted rawInput but included a command content wrapper, which is shown as the available argument summary; it must not be represented as full original JSON arguments. Provider-hidden reasoning is never invented. Unavailable full source output beyond the upstream cap cannot be restored from the live preview; stored native tool messages can be requested after history backfill.

## Reproduce browser proof

Export from app/ with EXPO_PUBLIC_DEBUG=1 and EXPO_PUBLIC_DEBUG_AUTONAV=0 using Expo export --platform web; serve the output on an isolated loopback port. From the repo root run:

    DASH_PROOF_ORIGIN=http://127.0.0.1:18763 DASH_PROOF_DIR=/absolute/evidence/path node scripts/verify-thinking-tools.mjs

The script launches isolated headless Chromium at 412x915, exercises the actual exported Expo ChatScreen with a deterministic synthetic reasoning/three-tools/answer stream, asserts stable Compact header geometry, tap/long-press/swipe and Hide, and saves six frames per mode plus final status screenshots. This is renderer evidence, not a live-model concurrency claim. No phone is used.
