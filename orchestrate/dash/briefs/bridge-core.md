GOAL         WebSocket, token, harness spawn, attach replay, and STT stay the single session process.
SCOPE        bridge/index.ts WS/spawn/token/STT only. Worktree `.worktrees/bridge-core` branch `svc/bridge-core`. Must not touch pairing audio, Bots pane, AppNav.
CONTEXT      docs/orchestration.md, shared/protocol.ts
ACCEPTANCE   Phone reconnects with attach; hello still parses on old clients
VERIFY       bun scripts/verify-dash/control-dash.ts doctor; dash-pair logs ws.open
TIMEBOX      60m
FORBIDDEN    no second listener on 4747, no pairing decoder rewrite
REPORT       status, branch, head SHA, what you ran
STANDING     orchestrate/dash/preferences.md
