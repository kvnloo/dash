# Verify

Tests are necessary, not sufficient. Generation and verification are separate.

Dash's pyramid lives in `.cursor/skills/verify-dash` and `AGENTS.md`. This kit
file is a pointer. Do not install Stryker.

## Pyramid

1. **Unit** — `bun test app/src bridge/src shared` on the touched surface.
2. **TDD** — red command, then green command (`.cursor/skills/tdd/SKILL.md`).
3. **Mutation** — `bun scripts/mutate.ts` on `golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, `bridge/src/roster.ts`. Score must stay ≥ 80. A surviving mutant is a missing assertion.
4. **Runtime** — `.cursor/skills/verify-dash` against live `dash-pair` (`bun scripts/verify-dash/control-dash.ts`). Never start a second `dash-pair` or Metro on 8097.
5. **Device** — Maestro in `.maestro/` for pixels the unit suite cannot see.

## Receipt

Bind every result to `head_revision`. Tests from another SHA are not evidence. Fill `.github/PULL_REQUEST_TEMPLATE.md`.

The implementer does not self-approve. Independent review is a different person or a frozen evaluator. Workers never merge `main` or `dev`.

## Fail closed

- Unknown mutation tool → `n/a`, not `80`. Dash has a mutator: use it.
- Runtime you did not exercise → list it under `limitations`.
- Secrets, tokens, `.env` → stop.
