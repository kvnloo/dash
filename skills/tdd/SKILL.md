# TDD

Fail, then pass. The red command is part of the evidence receipt.

Dash-owned copy: `.cursor/skills/tdd/SKILL.md`. Prefer that file. Unit command:

```bash
bun test app/src bridge/src shared
```

## Do

1. Name the intended behavior vs the current behavior in one sentence each.
2. Write or extend a test that fails for the right reason.
3. Record that command and the failure as `tests.red`.
4. Change production code until the same command passes. Record `tests.green`.
5. Optional sabotage: break one assertion, rerun, expect fail. That is `tests.sabotage`.
6. Do not delete the red proof to make the log look clean.
7. If you touched a mutate target, run `bun scripts/mutate.ts --file <path>` (not Stryker).

## Do not

- Start with the fix and add a test that could only pass.
- Call a linter a test.
- Skip red because the bug is "obvious".
- Invent a mutation score for a tool this repo does not run.
