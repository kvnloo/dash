# Standing orders

Paste this file into every Dash nano-service spawn and resume.

1. One writer per worktree. Path map is `docs/orchestration.md`.
2. Integration checkout (`/home/kvn/workspace/dash` on `integrate/device-layer`) is the only process that runs Metro 8097 and `dash-pair` on `100.78.215.21:4747`.
3. Feature worktrees never start a second bridge or Metro.
4. Do not `POST /pair/claim` from a worker unless the brief names a disposable session.
5. MagicDNS `mbp` is wrong on this laptop. Use `100.78.215.21`.
6. `shared/protocol.ts` lands first if the wire changes. Keep `hosts?` and old `hello` working.
7. `bridge/index.ts` is wiring. Put logic in `pair-decode.ts`, `src/roster.ts`, later `src/hermes-session.ts`.
8. Skip formatters, `tsc`, and Metro in feature worktrees. Integration owner runs them once.
9. Verify with `bun scripts/verify-dash/control-dash.ts` and `.cursor/skills/verify-dash`. Evidence stays in `artifacts/verify-dash/`.
10. Hermes mesh is the agent fabric. Do not replace the phone bridge. Grok Bot / Muse join as Hermes peers, not Dash WS clients.
11. No force-push to `main`. No merge to `main` from a worker. Stack onto `integrate/device-layer`.
12. Workers never rebase. Coordinator fast-forwards clean commits.
13. Subagents use `subagent_type: "poteto-agent"` unless a pstack skill names another type.
14. Models come from `~/.cursor/rules/pstack-models.mdc`.
15. Nav pixel work stays on `svc/nav` and does not block pairing.
