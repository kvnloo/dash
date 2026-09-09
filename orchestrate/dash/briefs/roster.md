GOAL         Tailnet hosts and live OMP tabs show on the Bots pane and hello.hosts.
SCOPE        bridge/src/roster.ts, app/src/lib/roster.ts, BotsPane, hello.hosts. Worktree `.worktrees/roster` branch `svc/roster`.
CONTEXT      .cursor/skills/verify-dash/features/roster.md
ACCEPTANCE   control-dash roster exits 0; bun test src/roster.test.ts passes
VERIFY       bun scripts/verify-dash/control-dash.ts roster && bun scripts/verify-dash/control-dash.ts test
TIMEBOX      45m
FORBIDDEN    no pairing, no AppNav pixels
REPORT       status, branch, head SHA, roster.json path
STANDING     orchestrate/dash/preferences.md
