---
name: tdd
description: "Fail-then-pass for Dash. Use when the user asks for TDD, a failing test, a regression test, or mutation testing — or when a bug has a cheap bun:test target."
---

# Dash TDD

Verification is the product. In an AI-native repo, an untested edit is how the nav dots drift to the top of the bar.

Do not force a test when it would be expensive, flaky, or mock-heavy. Prefer no new test over a bad test.

## Pyramid

| Layer | Command | When |
|-------|---------|------|
| Unit | `bun test app/src bridge/src shared` | Pure modules, parsers, physics, source contracts |
| Mutation | `bun scripts/mutate.ts` | After unit tests on a contract file. Proves the suite would catch an accidental edit |
| Runtime | `bun scripts/verify-dash/control-dash.ts doctor\|pair\|roster\|test` | Live `dash-pair`. Never a second Metro on 8097 |
| Device | Maestro in `.maestro/` | Phone pixels (IME covering "Message Dash", pill on the selected tab) |

## Workflow

1. **Name the behavior.** Intended vs current. Smallest observable gap.
2. **Pick the cheapest check.** Unit or source contract first. `golden-nav.test.ts` style: pin numbers, then inspect `AppNav.tsx` for the wiring. Do not stand up Expo to prove `NAV_CHROME_HEIGHT === 60`.
3. **Write the failing test.** Encode intended behavior, not the current implementation. Run it. It must fail for the right reason.
4. **Fix the smallest production change.**
5. **Green.** Re-run that test, then the nearby file, then `bun test app/src bridge/src shared`.
6. **Mutate if you touched a target.** `bun scripts/mutate.ts --file <path>` for `golden-nav.ts`, `bridge-pull.ts`, `motion.ts`, `shared/protocol.ts`, `bridge/src/roster.ts`. The mutator flips `export const` numbers and bools — the class of accidental UI edit (`NAV_CHROME_HEIGHT = 80`, dots 4→5). Score must stay ≥ 80. A surviving mutant is a missing pin; add `expect(CONST).toBe(...)`, do not weaken the suite.

## Isolation

Feature work lives in `.worktrees/` (`docs/orchestration.md`). Do not edit the integration checkout unless you are the integration owner. Tests, skills, `.github/**` are open.

```bash
git fetch origin
git worktree add .worktrees/issue-<n> -b issue/<n>-slug origin/main
```

## UI contracts

Accidental UI mutations hide in StyleSheet objects. Pin the geometry **and** the wiring:

- Numbers: `NAV_CHROME_HEIGHT === 60`, pager 144×50, squircle 16, dots 4×4, three `NAV_SLOT_WIDTH` slots.
- Native: `tabs` sit at `NAV_PAGER_PAD` with `NAV_PILL_HEIGHT`; each `tab` is `alignItems/justifyContent: center`.
- Transforms and opacity only. No `width`/`height` animation. No `GOLD_GLOW` on native AppNav.

If the only proof is a phone screenshot, say so and use Maestro. Do not fake a unit test with mocks of Reanimated.

## Guardrails

- Do not change tests to match a wrong implementation.
- Do not weaken assertions unless the intended behavior changed.
- PR evidence: red command, green command, what you did not verify (device, Tailscale, a harness).
- Runtime proofs: `.cursor/skills/verify-dash`. Never `POST /pair/claim`. Never `pkill` Metro.

## Final response

- Red: the failing test or executable check, and why it failed.
- Green: the passing command after the fix.
- Mutation score if you touched a mutate target.
- Not verified: device / live bridge / a harness you did not run.
