# Turbo in a Dash z0live call (DA-002)

Start voice from an attached local Hermes chat and say **“turbo, <task>”**. The
Dash voice client consumes the final transcript instead of sending it to the
normal Hermes conversation. The Voice screen shows lane count and actual finish
time; the call reads a short result if you haven't spoken again or ended it.
Annotation capture still collects speech as markup rather than running Turbo.

## Host setup

Opt in on the paired Dash bridge with `DASH_TURBO_FREE_LANES`. This is an ordered,
comma-separated list of `provider:hermes-profile` entries; supported labels are
`groq`, `cerebras`, and `opencode` (for the DeepSeek free lane). Use at least two
distinct providers and profiles. Register the profiles in the host's z0bridge
and pin them to their intended free routes; disable paid fallbacks and tools in
the profiles themselves. The spoken task is shared with these routes; do not
include secrets. Dash does not infer credentials, pricing or actual model from
a profile name.

The bridge uses the existing `DASH_Z0BRIDGE_URL` and
`DASH_Z0BRIDGE_TOKEN_FILE` settings. Optionally set `DASH_TURBO_META_PROFILE` to
a separate tools-disabled Hermes profile pinned to Opus 5.5; it synthesizes
completed answers, but is never a worker fallback. Unset the free-lane list to
disable Turbo.

Short requests start two lanes and reserve the third as free fallback. Tasks
longer than 140 characters start up to three, bounded by the configured pool.
A refused or terminally failed lane can be replaced from reserve; an ambiguous
turn start is not replayed. One run per bridge; 85 seconds for inference plus
best-effort cancellation. The bridge's `turbo.lane.*` and `turbo.finished` events
show the configured route, accepted turn ID and outcome without logging prompts.

This command returns answers or implementation proposals; it does not write to
the preview or send text into a coding agent automatically. For a Dash change,
submit the chosen proposal using the existing **New Turbo request** tray. Its
Studio agent still uses `turbo-new` and `turbo-promote` with the existing gate.
This is Dash's voice surface, not a change to the separate z0live desktop app.
