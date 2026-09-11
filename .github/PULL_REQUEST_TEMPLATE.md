## Summary

<!-- What this PR does, in one paragraph. -->

## Checklist

- [ ] **Ownership respected**: Changes follow `AGENTS.md` ownership boundaries (`app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js` owned by UI session; `bridge/**` and `shared/protocol.ts` owned by bridge session)
- [ ] **Searched issues/PRs**: no duplicate in-flight work; did not remint a claimed issue
- [ ] **Claimed issue**: work started after a bounded claim, not from the issue title alone
- [ ] **Fail-then-pass**: bug fixes include the red command and the green command
- [ ] **No secrets**: no tokens, API keys, `.env`, or pairing files
- [ ] **Mode** (select one):
  - [ ] **Unattended** — donated compute (cloud agent)
  - [ ] **Copilot** — human-supervised
- [ ] **Workers never merge `main`/`dev`**: this PR does not grant worker merge of production. Day-pass → `preview`. Overnight → `nightly`.

## Evidence

```yaml
issue:
base_revision:
head_revision:
tests:
  red:
  green:
  sabotage:
mutation: bun scripts/mutate.ts
runtime_evidence: []
limitations: []
ai_assistance:
```

Tests from another head are not evidence. Mutation is `bun scripts/mutate.ts` (score ≥ 80) or `n/a` — do not invent a Stryker score. Receipt CI on `preview`/`nightly` fails the PR if these keys are empty or `head_revision` is not this PR's SHA.

## Related

<!-- Fixes #123 -->
