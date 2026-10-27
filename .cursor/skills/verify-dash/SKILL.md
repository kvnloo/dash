---
name: verify-dash
description: Redirect. Dash is tested only with the e2e tester army; follow .claude/skills/verify-dash/SKILL.md. Use whenever a Dash change needs proof.
---

# Verify Dash (moved)

Read and follow `.claude/skills/verify-dash/SKILL.md`. Its feature map is `.claude/skills/verify-dash/features/`.

Dash testing means the e2e tester army (`e2e/mbp-army`) and nothing else. The older recipe that lived here drove the live bridge, Metro and the owner's phone, and treated unit tests as proof. It is retired. Do not use `scripts/verify-dash/control-dash.ts`, `bun run verify` or the `features/` files in this directory as evidence.
