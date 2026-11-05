# Dash as a system

How this repo sits in the network, why development feels slow, and how
rolling `preview`/`nightly` is supposed to fix the PR pile. Workers still
never merge `main` or `dev`.

## Product

Dash is a **phone control surface** (Expo) over a **laptop bridge** (Bun,
Tailscale `:4747`). The phone is not the agent fabric. Hermes gateway/peer
and `hermes-mesh-keel` are a different universe until `svc/hermes-session`
exists. Do not replace `dash-pair`.

Linear parent: [PER-1431](https://linear.app/0ism/issue/PER-1431) (phone fully
functional; this home tests; Cursor implements). GitHub remains the merge
authority for `kvnloo/dash`.

## Network (related repositories)

| Repo | Role vs Dash |
|---|---|
| `kvnloo/dash` | Phone UI + bridge + `shared/protocol.ts` |
| `kvnloo/aodl` | Harness catalog + `visual.json` (fail closed). Orchestra/orbs/avatars vendor this. |
| `kvnloo/frontier-kb` | Origin writes for research. Dash may export `inbox/cursor/` copies only. |
| `kvnloo/verified-oss-loop` | Contribution protocol this tree onboarded. |
| `kvnloo/oss-factory` (private) | HITL / factory. Linear HITL is not GitHub merge. |
| `kvnloo/hermes-mesh-keel` (private) | Hermes fabric. Not a replacement for the phone bridge. |
| `kvnloo/kerdoios` | Hermes compute allotment plugin. |
| `kvnloo/openavatar` | Identity cards. Do not mix into Dash UI. |
| `kvnloo/herdr`, `oh-my-pi` | Agent runtimes Dash spawns; they are not this repo. |

Landing page is a **new repo** (Linear PER-1342), not this tree.

## Why it feels slow

GitHub Actions on docs PRs is already ~30s. The bottleneck is **landing**,
not the unit job:

1. **Every worker PR targeted `main`.** Ten open PRs, four `CONFLICTING`,
   each rerunning CI. OMP cannot fast-forward a nightly that does not exist.
2. **`overnight/critical-path-20260910` already contains the stack.**
   `#16` is 19 commits ahead of `main` and includes the `fm/dash-19`…`#29`
   commits plus `#34` turn-safety, `#35` atlas v1, `#36` dash-debug, `#22`
   Maestro nav. Sibling PRs `#23` `#24` `#25` `#30` `#31` `#32` `#33` are
   slices of that same history aimed at `main`. Merging them separately
   duplicates work and fights overnight.
3. **Linear mirrors GitHub 1:1** (PER-1433…PER-1457). Agents remint claimed
   issues. `claimed` leases exist but workers still opened parallel PRs.
4. **`integrate/device-layer` is two commits behind `main`.** The integration
   owner branch is stale; Metro on the laptop (PER-1432) was serving a dirty
   tree instead of overnight.
5. **Dead app deps** (`playwright`, unused Expo modules) still haste-map in
   Metro. That is local bundle time, not Actions wall-clock. CI now sets
   `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` so install does not pull Chromium.
6. **Internal "Scan repo / Scan paper" cloud agents** (dozens, same dash
   `repoUrl`) are not Dash workers. They do not open PRs and they steal
   attention from the five agents that actually commit.

## Channel map (after onboard)

```text
worker_base = nightly
feature_target = preview
overnight_target = nightly
```

OMP should fast-forward **`nightly`**, not rebase worker branches onto `main`.
Coordinator rule (`orchestrate/dash/preferences.md`): fast-forward clean
commits; do not rebase `fm/*` onto each other.

Do **not** merge `#23` `#30` `#31` `#32` into `main` while overnight already
has those commits. Leave them until a human closes them as superseded by the
nightly consolidation.

`#37` (atlas continuation) and `#38` (C(RAID) notes) are **not** fully in
overnight and should ride the nightly consolidation.

## Agents that actually write Dash

| Agent | Branch / PR | Notes |
|---|---|---|
| this run (`Ai app ui patterns`) | `cursor/ai-ui-pattern-atlas-8df6` #37 | Also onboard + nightly FF |
| AODL C(RAID) | `cursor/aodl-craid-research-e30f` #38 | Docs; keep on nightly, promote origin to `aodl` (PER-1461) |
| pair naming | `cursor/clarify-pair-naming-9e6d` | Idle; #14 already on `main` |
| community loop / github hygiene | `cursor/community-dev-loop-e939`, `cursor/github-hygiene-4ed3` | Idle; this onboard supersedes |

Claimed GitHub issues **do not steal**: #8, #9, #11, #12, #19–#21, #26–#29.
Unclaimed P0 still open: #3 reconnect. #4 is on overnight via #34.

## Verify

Pyramid unchanged: unit → TDD → `bun scripts/mutate.ts` ≥ 80 → verify-dash →
Maestro. Integration owner still owns Metro 8097 and `dash-pair`.
