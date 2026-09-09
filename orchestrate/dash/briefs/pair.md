GOAL         Pairing HTTP and Pair screen stay claimable over Tailscale without speakers.
SCOPE        PairScreen, pair-api, pair-crypto, sonic-pair, bridge/pair-audio.ts, bridge/pair-decode.ts, /pair/* in index wiring only. Worktree `.worktrees/pair` branch `svc/pair`. Must not touch chat UI, AppNav, roster.
CONTEXT      docs/orchestration.md, .cursor/skills/verify-dash/features/pair.md, live dash-pair 100.78.215.21:4747
ACCEPTANCE   GET /pair returns 6-char code; control-dash pair exits 0; phone can Pair over Tailscale without MagicDNS mbp
VERIFY       bun scripts/verify-dash/control-dash.ts doctor && bun scripts/verify-dash/control-dash.ts pair
TIMEBOX      45m
FORBIDDEN    no second bridge, no POST /pair/claim unless brief says disposable, no AppNav edits
REPORT       status, branch, head SHA, what you ran, pair.json path
STANDING     orchestrate/dash/preferences.md
