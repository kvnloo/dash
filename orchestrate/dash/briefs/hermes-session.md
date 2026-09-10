GOAL         harness hermes goes through Hermes gateway/peer instead of hermes chat -q, without replacing Dash pairing or WS.
SCOPE        new bridge/src/hermes-session.ts plus index wiring and roster profile agents. Worktree `.worktrees/hermes-session` branch `svc/hermes-session`.
CONTEXT      docs/orchestration.md missing-piece section. Hermes gateway :9900. Peer groot http://100.64.0.2:8642.
ACCEPTANCE   A Dash hermes turn can hit gateway or peer API; pairing HTTP unchanged; AppNav untouched
VERIFY       Doctor still green. A hermes turn log shows gateway/peer, not only `hermes chat -q`.
TIMEBOX      90m
FORBIDDEN    no pairing HTTP rewrite, no AppNav, no Linear/Keel on the phone socket
REPORT       status, branch, head SHA, what you ran
STANDING     orchestrate/dash/preferences.md
