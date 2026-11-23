# Dash branch and PR consolidation (DA-052)

Audit of every remote branch and every open PR of kvnloo/dash against `origin/staging` 597c0dd568d3, taken 2026-11-23T07:58Z. Nothing was closed or deleted by this audit; this file is the evidence list for whoever does it.

Files: [PR-AUDIT.tsv](PR-AUDIT.tsv), [BRANCH-AUDIT.tsv](BRANCH-AUDIT.tsv), [STILL-UNIQUE.md](STILL-UNIQUE.md) (every unapplied commit, one line each), [DELETE-WAVES.txt](DELETE-WAVES.txt) (full SHAs for leased deletes), [ARCHIVE-PARENTS.txt](ARCHIVE-PARENTS.txt), scripts in [tools/](tools/).

## Summary

| | close / delete | keep | still unique (Kevin decides) | total |
|---|---|---|---|---|
| Open PRs | 6 | 2 | 14 | 22 |
| Remote branches | 352 | 25 | 186 | 563 |

Branch verdicts: MERGED-EQUIVALENT 265, SUPERSEDED-BY 87, STILL-UNIQUE 186, KEEP 25.

Remote branch count:

- now: 563
- after waves 1 and 2 (provably safe): 211
- after wave 3 (archive the 186 STILL-UNIQUE tips into one ref, then delete them): 26, which meets the goal of under 50

Waves 1 and 2 alone cannot reach 50: most of what is left is `reaped/*` worktree snapshots and lane composites with real unmerged content. Wave 3 keeps every one of those commits reachable from a single `archive/` ref, so it loses nothing. It still needs Kevin's OK.

## Method

```
git fetch origin '+refs/heads/*:refs/remotes/origin/*'
curl -s 'https://api.github.com/repos/kvnloo/dash/pulls?state=open&per_page=100'   # + state=all for PR history
python3 tools/audit.py  <repo> <out> allprs.json open-prs.json   # ancestry, ahead/behind, git cherry, merge-tree
python3 tools/audit2.py <repo> <out>   # per unapplied commit: replay onto staging (adds/conflict/present)
python3 tools/audit3.py <repo> <out>   # containment: which other branches hold this tip
python3 tools/audit4.py <repo> <out>   # files touched that staging deleted
python3 tools/classify.py ... && python3 tools/make_md.py ...
```

Verdict rules, in order:

1. KEEP: `staging`, `main`, `release/*`, `archive/*`; the head of an open PR that is not being closed; the base of an open PR that is not being closed (GitHub closes a PR when its base is deleted).
2. MERGED-EQUIVALENT: the tip is an ancestor of staging; or `git cherry origin/staging <tip>` shows only `-`; or `git merge-tree --write-tree origin/staging <tip>` returns staging's own tree; or every unapplied commit replays onto staging (`merge-tree --merge-base=<c>^`) with no change.
3. SUPERSEDED-BY <x>: <x> is a staging commit with the same subject, a staging commit that deleted every file the branch changes, a named PR's replacement, or another surviving branch whose history already contains this tip (deleting the duplicate loses nothing).
4. STILL-UNIQUE: anything else. Commits are listed in STILL-UNIQUE.md.

Choice made here: GitHub's draft flag alone is not read as Kevin's "do not merge". Only PR titles that say so (#626, #638) are KEEP. Drafts whose content is already in staging are on the close list.

## PR close list

- #659 fix(bridge): list every chat and deliver every follow-up off groot (#493, #498): MERGED-EQUIVALENT. tip is an ancestor of staging. Head `fix/p1-493-missing-chats` b0ca65e3320c.
- #356 integ: travel RC + turbo voice (#353/#350/#324 + #318/#325/#343) for NousCon: MERGED-EQUIVALENT. tip is an ancestor of staging (GitHub draft flag set). Head `integ/travel-turbo-20261027` 46cd5986c80c.
- #210 [chatgpt:dash-120] Row-specific long-press action submenus: SUPERSEDED-BY 612582ac+d44713f8+a1c7db93. #120 submenu feature is in staging (612582ac has the same subject as 2c35b61c; d44713f8, a1c7db93 wire it); only 3 Jest-mock test commits remain, and AGENTS.md no longer counts unit tests as the suite. Head `chatgpt/dash-120` 389b2bea5e53.
- #108 Voice: live conversation mode with the hero AgentOrb (z0live state): MERGED-EQUIVALENT. tip is an ancestor of staging (GitHub draft flag set). Head `feat/voice-orb-live` 86b74d2d6ad6.
- #80 fix(bridge): send Dash replies into gateway-hosted live Hermes sessions: MERGED-EQUIVALENT. tip is an ancestor of staging (GitHub draft flag set). Head `fix/hermes-gateway-live-send` 77c95cdbf506.
- #67 feat: Dash owner approval gate for bounded upstream actions: MERGED-EQUIVALENT. tip is an ancestor of staging (GitHub draft flag set). Head `feat/approvals-gate` 9827614107cb.

## PRs to keep open

- #638 fix(hosts): one level per kind, host > harness > profile > chat (carries the compose union; do not merge yet): title marks it 'do not merge yet'; staging took a different host tree (#685, d54f065a).
- #626 z0live overlay orb over any app (slices 0-3) [draft, do not merge]: Kevin's title marks it '[draft, do not merge]'.

## PRs that need Kevin's decision (STILL-UNIQUE)

- #646 fix(dex): close only the owning chat route after window fade (base `lane/compose-613-642-643-645-harness-20261106`, +64/-327, last 2026-11-06): stacked on lane/compose-613-642-643-645-harness; close-race fix is not in staging.
- #645 fix(chat): preserve upward transcript wheel across DeX layout updates (base `lane/compose-613-20261105`, +47/-327, last 2026-11-06): stacked on lane/compose-613-20261105; staging took desk mode via the #613 port (74893287, #751) but not these wheel fixes.
- #617 fix(roster): deduplicate fleet phone guests in Hosts (SUS100-DASH-RELEASE-04) (base `integrate/turbo-lane-20261028`, +2/-491, last 2026-11-02): 1 of 2 commits not in staging.
- #612 fix(chat): linkify source paths and preview positioned files (COV-G10) (base `integrate/coverage-20261028`, +9/-683, last 2026-11-02): linkify landed separately (#419, 4f9c4826) but this RC3 army coverage port + COV-G10 file preview are not in staging.
- #384 spec: Dash feature ledger (121 features, 51 journeys) (base `main`, +5/-1736, last 2026-11-15): the ledger itself is in staging (c8416b40, same subject as a478f90b); 4 follow-up commits from 11-15 (spec/preview fixes) are not.
- #188 feat(chat): source-backed OMP and Tern UX polish (base `main`, +2/-1741, last 2026-11-13): 2 of 2 commits not in staging.
- #118 fix(chat): tool/thinking information density (command identity, flat call rows, one summary) (base `main`, +3/-1792, last 2026-10-22): 3 of 3 commits not in staging.
- #113 feat(trace): intent, receipt and artifact review (parent-gated) (base `integrate/dash-20261020`, +4/-1805, last 2026-10-21): 4 of 4 commits not in staging.
- #16 fix: hang timeout, LAN pair bind, mutation operator pins (base `main`, +6/-2053, last 2026-10-27): 3 of 6 commits not in staging.

### Dependabot #650-#654

None of these bumps has landed. Every one of them targets `main`, while staging's workflows (`.github/workflows/*.yml` at the audited SHA) still pin the old versions:

- #654 chore(deps): bump actions/stale from 9 to 11: staging uses actions/stale@v9; bump to v11 not applied; PR targets main, not staging.
- #653 chore(deps): bump actions/upload-artifact from 4 to 7: staging uses actions/upload-artifact@v4 (4x); bump to v7 not applied; PR targets main, not staging.
- #652 chore(deps): bump actions/labeler from 5 to 7: staging uses actions/labeler@v5; bump to v7 not applied; PR targets main, not staging.
- #651 chore(deps): bump ossf/scorecard-action from 2.4.2 to 2.5.0: staging uses ossf/scorecard-action@v2.4.2; bump to 2.5.0 not applied; PR targets main, not staging.
- #650 chore(deps): bump actions/cache from 4 to 6: staging uses actions/cache@v4 (3x); bump to v6 not applied; PR targets main, not staging.

Suggested: take the bumps on staging in one `chore(ci)` PR, then close #650-#654. Closing them without that change only makes dependabot reopen them. upload-artifact v7 and cache v6 are major versions; check the runner and Node requirements before merging.

## Branch delete list

Before each delete, check that the branch still points at the audited SHA, e.g. `git push --force-with-lease=refs/heads/<b>:<sha> origin :refs/heads/<b>` with SHAs from DELETE-WAVES.txt. Close a PR before deleting its head.

### Wave 1: MERGED-EQUIVALENT (265)

- `boat/dash-army-wf/device-army-validation` a788cc509fda ancestor of staging
- `boat/dash-artifact/da-067` e8015230e249 ancestor of staging
- `boat/dash-badge-voice/da-062` 9c82712b0abc ancestor of staging
- `boat/dash-badge-voice/da-063` 3a91abc8497a ancestor of staging
- `boat/dash-bedtime-protos/da-047` b044bc4e9f01 ancestor of staging
- `boat/dash-bedtime-protos/da-053` 1d8d5a433b43 ancestor of staging
- `boat/dash-bots-page/da-073` 6dc53152290b ancestor of staging
- `boat/dash-channels/da-026` de1589ffeab0 ancestor of staging
- `boat/dash-channels/da-070` 352ed5d2e90d ancestor of staging
- `boat/dash-chat-fix/da-020` 8cdffcd9adf5 ancestor of staging
- `boat/dash-chatlist/da-061` 1fd704c1e74e ancestor of staging
- `boat/dash-chatlist/da-064` 45a8a0fbbb3b ancestor of staging
- `boat/dash-chatview/da-035` f9619609faf6 ancestor of staging
- `boat/dash-chatview/da-036` 3048e679dadb ancestor of staging
- `boat/dash-composer/da-014` 695682f3955b ancestor of staging
- `boat/dash-composer/da-038` 5c619172e0ee ancestor of staging
- `boat/dash-composer/da-042` beddbb6913dd ancestor of staging
- `boat/dash-council-handoff/da-079` 1a8de21b9022 ancestor of staging
- `boat/dash-council/da-075` 81531d32a590 ancestor of staging
- `boat/dash-deadcode/da-052` e01fc1932136 ancestor of staging
- `boat/dash-design-tokens/da-084` f0344ab4a127 ancestor of staging
- `boat/dash-device-army/da-028` d0120e215897 ancestor of staging
- `boat/dash-dex-rebase/da-095` 612bd5691e25 ancestor of staging
- `boat/dash-dex-rebase2/da-095` 302f4b89fc30 ancestor of staging
- `boat/dash-dex-themed/da-094` 688defaa34b7 ancestor of staging
- `boat/dash-dex-themed/da-095` f8ca06c05636 ancestor of staging
- `boat/dash-dex/da-009` c2dde64df335 ancestor of staging
- `boat/dash-ephemeral/da-032` c918717dac10 ancestor of staging
- `boat/dash-ephemeral/da-066` b122939359a6 ancestor of staging
- `boat/dash-fastlane/da-024` 7f87f017371a ancestor of staging
- `boat/dash-gallery/da-076` c5b7cf3193b4 ancestor of staging
- `boat/dash-gallery/da-078` a6a6d7a62e55 ancestor of staging
- `boat/dash-gl-audit/audit` 49e4841f0e6e ancestor of staging
- `boat/dash-green/voice-approvals` c92f18908f3b ancestor of staging
- `boat/dash-hosts-chats/da-041` 48937a77f2c6 ancestor of staging
- `boat/dash-hosts-chats/da-045` 12dc5dbd6a6f ancestor of staging
- `boat/dash-hosts-chats/da-046` 9ffbb9417e0f ancestor of staging
- `boat/dash-int/ci-green` 5798b254eeb7 ancestor of staging
- `boat/dash-int/staging-next` 5d6d5c598400 ancestor of staging
- `boat/dash-int2/staging-next` e2a4bfef7837 ancestor of staging
- `boat/dash-int3-fix/staging-next` 9a16fba74355 ancestor of staging
- `boat/dash-int3/staging-next` f07d11ca6ac9 ancestor of staging
- `boat/dash-int4/staging-next` e7a9b12b3566 ancestor of staging
- `boat/dash-int5/staging-next` c5da9dd2e669 ancestor of staging
- `boat/dash-int6/staging-next` 33ec48d8a772 ancestor of staging
- `boat/dash-int7/staging-next` c6884c914e81 ancestor of staging
- `boat/dash-lane-timeline/timeline` b1688ed7e3fe ancestor of staging
- `boat/dash-laws-spec/da-071` 7934f7c45694 ancestor of staging
- `boat/dash-learn/da-010` 383c99c9c190 ancestor of staging
- `boat/dash-logwatch/da-027` 5201acfdda1d ancestor of staging
- `boat/dash-logwatch/da-074` 79c13e16601d ancestor of staging
- `boat/dash-mem-orch/da-044` 31aad580f1f4 ancestor of staging
- `boat/dash-mem-orch/da-069` 24b2110e95fb ancestor of staging
- `boat/dash-mem-orch/da-069-wip` 451c9cf91aad git cherry: all 1 patches already in staging ('-'); merge-tree into staging is a no-op
- `boat/dash-nowtesting/da-004` 8bb92555eb33 ancestor of staging
- `boat/dash-nowtesting/da-051` 98a3a9ed9ef7 ancestor of staging
- `boat/dash-onboard/da-050` c3be8cdc8b4d ancestor of staging
- `boat/dash-rebase/da-064` 5a3ee3d2d5dd ancestor of staging
- `boat/dash-rebase2a/da-003` 81cb30242826 ancestor of staging
- `boat/dash-rebase2a/da-014` bf57fe359b2f ancestor of staging
- `boat/dash-rebase2a/da-035` 7749b227333b ancestor of staging
- `boat/dash-rebase2a/da-074` 81b5abdf48c9 ancestor of staging
- `boat/dash-rebase2b/da-004` a2ff0b028ef3 ancestor of staging
- `boat/dash-rebase2b/da-008` 852dba96d643 ancestor of staging
- `boat/dash-rebase2b/da-051` 8c11067f6386 ancestor of staging
- `boat/dash-rebase2b/da-068` e3b5cddfd0ff ancestor of staging
- `boat/dash-restart/da-022` d9540bb99ae0 ancestor of staging
- `boat/dash-roadmap-links/da-092` 94bd98587356 ancestor of staging
- `boat/dash-secret-hygiene/da-083` 90a2d95da182 ancestor of staging
- `boat/dash-spawn-harness/da-085` 3c150b568ce4 ancestor of staging
- `boat/dash-spen-inputfx/da-057` a659412c828c ancestor of staging
- `boat/dash-spen-inputfx/da-065` 2afb96c8b275 ancestor of staging
- `boat/dash-t3code/da-082` 29f77a5f1dd8 ancestor of staging
- `boat/dash-theme-orb/da-030` d99e7f834685 ancestor of staging
- `boat/dash-theme-orb/da-049` 9c6350499ff5 ancestor of staging
- `boat/dash-theme/da-080` 30ed2b342239 ancestor of staging
- `boat/dash-trace/da-043` 9358b218eb3c ancestor of staging
- `boat/dash-turbo-modes/da-003` 10ca7af06f30 ancestor of staging
- `boat/dash-turbo-modes/da-018` 2e2fdeb86d21 ancestor of staging
- `boat/dash-turbo-run/da-002` 981b4236476c ancestor of staging
- `boat/dash-turbo-voice/da-001` 4fbecc8a7ca1 ancestor of staging
- `boat/dash-ui-control/da-008` ee14884fd5ea ancestor of staging
- `boat/dash-ui-control/da-068` d3330e74188c ancestor of staging
- `boat/dash-voice-captions/da-056` 29e2294e6536 ancestor of staging
- `boat/dash-voice-captions/da-058` e2b3cf31ec94 ancestor of staging
- `boat/dash/actionable-notifications` 1b76a7aabdf7 ancestor of staging
- `boat/dash/blockers-pin` dab792a2407f ancestor of staging
- `boat/dash/bulk-approve` a6b0dbaecdbd ancestor of staging
- `boat/dash/code-highlighting` cb9b564692d9 ancestor of staging
- `boat/dash/composer-last-exchange` 20b0dacf7741 ancestor of staging
- `boat/dash/gear-overlap` 7fb96426573c ancestor of staging
- `boat/dash/p3-into-staging` 6a43ba23bcb2 ancestor of staging
- `boat/dash/perf-orchestra-bench` c6099869fa1d ancestor of staging
- `boat/dash/pill-order` ff11d2de59a3 ancestor of staging
- `boat/dash/secret-entry` ad3233f7ad32 ancestor of staging
- `boat/dash/triage-actions` 3d982f9da7c9 ancestor of staging
- `chatgpt/dash-bug-s22-001-r2` 31bb621080b6 ancestor of staging
- `chatgpt/dash-h-074-r2` 69cbe0355fce ancestor of staging
- `chatgpt/dash-h-120-r2` 904a5cff2fc4 ancestor of staging
- `chatgpt/dash-h-149-r2` 452449d87079 ancestor of staging
- `chatgpt/turbo-01-army-identity-env` c3003bf855c7 ancestor of staging
- `chatgpt/turbo-02-voice-bootstrap-ids` b38d0f4f20e9 ancestor of staging
- `chatgpt/turbo-03-stt-worker` 9e49b04e0691 ancestor of staging
- `chatgpt/turbo-04-stt-recovery` e6bda57ff712 ancestor of staging
- `chatgpt/turbo-05-mic-permission-first` 7aae2cde7555 ancestor of staging
- `chatgpt/turbo-06-annotation-voice-quiet` 8a6242486e8e ancestor of staging
- `chatgpt/turbo-07-voice-status` bd5efecb1034 ancestor of staging
- `chatgpt/turbo-08-voice-army-harness` 22f790cada1a ancestor of staging
- `chatgpt/turbo-10-webrtc-build-guard` b1d9f53eba5a ancestor of staging
- `chatgpt/turbo-14-reload-guards` 6860886a5e00 ancestor of staging
- `chatgpt/turbo-15-bridge-drain` 4c34348da310 ancestor of staging
- `chatgpt/turbo-16-acp-stall-timeout` 0c1bf22b1b91 ancestor of staging
- `chatgpt/turbo-17-ink-launch-diagnostics` c6345232b2f9 ancestor of staging
- `chatgpt/turbo-19-annotation-note` 80ca00e6dfd6 ancestor of staging
- `chatgpt/turbo-20-device-self-check` 2ed291815696 ancestor of staging
- `chatgpt/turbo-21-live-voice-resilience` 2ce1e47f7700 ancestor of staging
- `chatgpt/turbo-22-annotation-voice-target` 042c9eb42b81 ancestor of staging
- `chatgpt/turbo-23-annotation-fullscreen` 5a23d00eb2f6 ancestor of staging
- `chatgpt/turbo-24-annotation-receipt` a63a071cb2af ancestor of staging
- `chatgpt/turbo-25-voice-orb-overlay` 59ef48e7e7c6 ancestor of staging
- `chatgpt/turbo-26-main-bar-mic` 759a4b3eefce ancestor of staging
- `chatgpt/turbo-27-live-health-check` 8cb5a2df9f4b ancestor of staging
- `chatgpt/turbo-28-ci-android-export` 59fcf34365b5 ancestor of staging
- `chatgpt/turbo-29-annotation-entry` 6b968f7d513e ancestor of staging
- `chatgpt/turbo-30-palm-rejection` 78be0a5d2b94 ancestor of staging
- `chatgpt/turbo-30-palm-rejection-v2` 3da8aceafd99 ancestor of staging
- `feat/agent-notices` 5c2e03f8060a ancestor of staging
- `feat/approvals-gate` 9827614107cb head of PR #67: tip is an ancestor of staging (GitHub draft flag set)
- `feat/ephemeral-ui-cards-20261105` c57aac877c30 ancestor of staging
- `feat/flow-inbox-current-20261029` 13d83aa58d46 ancestor of staging
- `feat/turbo-studio` 769c877eac3c ancestor of staging
- `feat/voice-orb-live` 86b74d2d6ad6 head of PR #108: tip is an ancestor of staging (GitHub draft flag set)
- `fix/focus-channel-default-sound` c38609d2bde5 ancestor of staging
- `fix/hermes-gateway-live-send` 77c95cdbf506 head of PR #80: tip is an ancestor of staging (GitHub draft flag set)
- `fix/hide-status-bar-20261025` 05e3bb506c84 ancestor of staging
- `fix/history-fill-visit-20261029` cdb9334b7bb2 ancestor of staging
- `fix/history-fulltext-visit-20261029` 9565d97faaf2 ancestor of staging
- `fix/p0-talk-20261028` 20d812692814 ancestor of staging
- `fix/p1-493-missing-chats` b0ca65e3320c head of PR #659: tip is an ancestor of staging
- `fix/remote-steer-intent-20261029` bd40fd94061f ancestor of staging
- `fix/restored-session-identity-20261029` 8ff23fa617c8 ancestor of staging
- `fix/resumable-not-ended-20261028` d9bb25f83465 ancestor of staging
- `fix/roster-reconnect-generation-20261029` 86144bd7cda1 ancestor of staging
- `fix/share-safename-regex-android15` eaa5c6dcb141 ancestor of staging
- `fix/triage-running-north-star-20261028` 87d2aa3a09d9 ancestor of staging
- `fix/turbo-live-20261028` 27769d9abcae ancestor of staging
- `fix/workers-strip-20261028` 008685496bf1 ancestor of staging
- `hermes/claude-model-label` 1b6455c9ba6d ancestor of staging
- `hermes/cutout-pill` 844b9efa18c2 ancestor of staging
- `hermes/hosts-1-phones-rename` cf337119ee40 ancestor of staging
- `hermes/hosts-2-stats` 1d59c9370bf3 ancestor of staging
- `hermes/issue-505` 2245a2f7e9d9 ancestor of staging
- `hermes/issue-506` f699d5521ce0 ancestor of staging
- `hermes/issue-514` a97f5c76cdbe ancestor of staging
- `hermes/issue-516` 89802351eddb ancestor of staging
- `hermes/native-fp-local-modules` ceb967b503d7 ancestor of staging
- `hermes/remote-claude-live-history` c89ce630b293 ancestor of staging
- `hermes/wire-474-476-481` 4ccb558d363a ancestor of staging
- `hermes/wire-484-488` 475172d31373 ancestor of staging
- `incomplete/nightly-20261105` f1e4632a23ce ancestor of staging
- `incomplete/preview-20261105` 84d5f5f72057 git cherry: all 1 patches already in staging ('-'); merging back now conflicts with later staging edits
- `integ/rc3-20261027` a2bb68de067c ancestor of staging
- `integ/sus100-trio-1103` 9bf54bebfcb7 ancestor of staging
- `integ/travel-turbo-20261027` 46cd5986c80c head of PR #356: tip is an ancestor of staging (GitHub draft flag set)
- `integ/turbo-c30fix-20261103` 871d835ca4e0 ancestor of staging
- `integrate/dash-v2` 2fb3df011905 ancestor of staging
- `integrate/native-turbo` e29dd36fbe8b ancestor of staging
- `land/compose-wave-635-637-20261107` 404fc8e3a2a1 ancestor of staging
- `lane/compose-635-20261104-1530` 8fa1c55e48a9 ancestor of staging
- `lane/compose-wave-635-636-637-no630-20261105` 0ae86005a9da ancestor of staging
- `lane/compose-wave-635-636-no637-20261105` ffc458913932 only merge commits ahead; git cherry lists no unapplied patch; merge-tree into staging is a no-op
- `lane/fix-reply-selection-army-20261104` 2e2d3786c0e4 ancestor of staging
- `law/o15-dash-release` a7465d7de237 ancestor of staging
- `qualify/lane-20261025-w1` 799717317290 git cherry: all 1 patches already in staging ('-'); merging back now conflicts with later staging edits
- `reaped/army-0787bd22-20261029-20261113-6accd2` ae93158b2c5e merge-tree into staging leaves staging's tree unchanged
- `reaped/army-67d7a9cd-20261029-20261113-e9686c` bf4395548710 merge-tree into staging leaves staging's tree unchanged
- `reaped/army-83fcf7b6-20261029-20261113-0781c1` c6bd44e68011 merge-tree into staging leaves staging's tree unchanged
- `reaped/army-87d2aa3a-20261029-20261113-f35322` 156999bb9c2b merge-tree into staging leaves staging's tree unchanged
- `reaped/army-97d8e8d1-20261029-20261113-bdcdf0` c1cfddc508d5 merge-tree into staging leaves staging's tree unchanged
- `reaped/army-a91dbb91-20261029-20261113-b75ab1` d5c8e0be9f7b merge-tree into staging leaves staging's tree unchanged
- `reaped/army-core-candidate-20261029-20261113-72efec` d0704ca998bb merge-tree into staging leaves staging's tree unchanged
- `reaped/army-d120a432-20261029-20261113-17fb3e` 55f82757bbbc merge-tree into staging leaves staging's tree unchanged
- `reaped/army-e287c960-20261028-20261113-7ee40a` 3fc7f7d6a478 merge-tree into staging leaves staging's tree unchanged
- `reaped/bridge/runtime-alignment-20261022-20261113-65b7a5` 68013b18b36b merge-tree into staging leaves staging's tree unchanged
- `reaped/chatgpt/dash-20261025-boundary-tool-tree-20261113-c0e684` 45a859a69ccd merge-tree into staging leaves staging's tree unchanged
- `reaped/chatgpt/dash-20261025-delivery-queue-policy-20261113-be8ff4` 1a6fa6433edd merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-0411-20261113-c2937d` 99d345057969 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-fix-223-20261113-a651b3` 6d0b308755c0 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-fix-231-20261113-f98a56` ceee00d655fd merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-fix207-20261113-5e8897` eed90f90d06e merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-fix79-20261113-c86734` 6869869e7d00 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-fix81-20261113-fc8e0d` 5e6b69a18e95 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-tick-20261113-a2016c` 507d13eca88c merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-turbo-bae07a2-20261113-ee7f9e` 596266527cc3 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-turbo01-20261113-4d1eff` ce16c3dfc8d3 merge-tree into staging leaves staging's tree unchanged
- `reaped/dash-lane-w3-20261113-c2f382` 17ed62d85541 merge-tree into staging leaves staging's tree unchanged
- `reaped/feat/chat-window-20261022-20261113-791ce5` befa5d0b5c0f merge-tree into staging leaves staging's tree unchanged
- `reaped/feat/dash-channels-20261113-441f9a` bfe14fe09d89 each of 1 unapplied commits replays onto staging with no change
- `reaped/feat/dash-native-notifications-share-20261113-5ee40c` 08425ed049c6 each of 1 unapplied commits replays onto staging with no change
- `reaped/feat/hermes-sessions-20261113-91b455` d875df6fc2db merge-tree into staging leaves staging's tree unchanged
- `reaped/feat/phone-overnight-20261113-c61327` bd6f8f69e793 merge-tree into staging leaves staging's tree unchanged
- `reaped/feat/zeros-ui-20261113-147217` 4f4752932b35 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix-h108-local-20261113-868185` 8269e7efbc72 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/all-harness-chat-list-20261113-473c86` 2593a9244638 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/army-main-mic-wayland-20261113-8a9392` d50ec8921569 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/bridge-acp-error-detail-20261025-20261113-73d610` 95bd4b248e60 each of 1 unapplied commits replays onto staging with no change
- `reaped/fix/bridge-voice-bootstrap-20261025-20261113-1085ca` e0477515481e merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/focus-channel-default-sound-20261113-a130f9` 1bfbf4d3ae95 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/interaction-repair-20261022-20261113-e7ee06` f9320217d2ca merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/native-identity-onboarding-20261113-aab304` f97c8989e42f merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/native-middle-empty-20261022-20261113-42cdd2` 5fef8f907264 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/omp-context-paste-20261025-20261113-a454fe` ed14b2784cd2 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/sessions-db-test-timeout-20261113-279045` 0269896f38f5 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/test-asyncstorage-getitem-20261025-20261113-e38b54` 2c0d50132190 merge-tree into staging leaves staging's tree unchanged
- `reaped/fix/trace-needs-ok-label-20261113-890200` ba17222e45cc merge-tree into staging leaves staging's tree unchanged
- `reaped/hermes/lane-fix-suggestions-239-20261113-e0e580` 3d2dfce5b786 merge-tree into staging leaves staging's tree unchanged
- `reaped/integ-v2-20261113-0778ab` fe07cdbad969 merge-tree into staging leaves staging's tree unchanged
- `reaped/integ/rc3-20261027-20261113-e2dcaf` 4406dae9488e merge-tree into staging leaves staging's tree unchanged
- `reaped/integ/sus100-trio-1103-20261113-45ba1c` 8ea08c3e2e66 merge-tree into staging leaves staging's tree unchanged
- `reaped/integ/turbo-c30fix-20261103-20261113-8ea173` b9c32e3b8f5e merge-tree into staging leaves staging's tree unchanged
- `reaped/integrate/native-acceptance-20261022-20261113-b3be29` 6222fb8b5820 merge-tree into staging leaves staging's tree unchanged
- `reaped/integrate/native-turbo-20261113-eb8e11` 20ecde336364 merge-tree into staging leaves staging's tree unchanged
- `reaped/integrate/omp-ui-20261022-20261113-670b09` 51019f268c7b merge-tree into staging leaves staging's tree unchanged
- `reaped/integrate/ripple-native-20261113-5c23a6` a2c4dab1ac8d merge-tree into staging leaves staging's tree unchanged
- `reaped/k1055-compose-scrub-20261113-42cefb` b08b6e5a311b merge-tree into staging leaves staging's tree unchanged
- `reaped/k1055-rc3-scrub-20261113-be7844` c17f9c67c112 merge-tree into staging leaves staging's tree unchanged
- `reaped/lane/compose-635-20261104-1530-20261113-e9dda8` 42c7fce66a09 merge-tree into staging leaves staging's tree unchanged
- `reaped/lane/compose-635-rsel-20261104-20261113-75b76c` 92b1034062fc merge-tree into staging leaves staging's tree unchanged
- `reaped/omp/bridge-rollout-20261022-20261113-6c86ee` 779c5a207f1f merge-tree into staging leaves staging's tree unchanged
- `reaped/omp/d10-chat-rows-20261113-e218d9` 8b87775761e9 merge-tree into staging leaves staging's tree unchanged
- `reaped/omp/d51-moodie-faces-20261113-357dc8` 0bb2784037f3 merge-tree into staging leaves staging's tree unchanged
- `reaped/qualify/turbo-20261025-context-20261113-2e58f0` 8ce4942c1792 merge-tree into staging leaves staging's tree unchanged
- `reaped/qualify/turbo-20261025-memory-context-latest-lane-20261113-dc2a06` 38f6597d60e4 merge-tree into staging leaves staging's tree unchanged
- `reaped/roadmap-resume-20261113-2b1961` dabb56177683 merge-tree into staging leaves staging's tree unchanged
- `reaped/roll/ready-20261021-20261113-df8058` 8b64aa939744 merge-tree into staging leaves staging's tree unchanged
- `reaped/sol/annotate-20261021-20261113-7fb0e0` a634f89b6743 merge-tree into staging leaves staging's tree unchanged
- `reaped/sol/chip-complete-20261021-20261113-a8a6c2` 5b077caefde8 merge-tree into staging leaves staging's tree unchanged
- `reaped/sol/context-view-20261021-20261113-3a4211` dcd2ceb4efc7 merge-tree into staging leaves staging's tree unchanged
- `reaped/sol/orchestra-meaning-20261021-20261113-2823bd` 125953461f55 merge-tree into staging leaves staging's tree unchanged
- `reaped/sol/tool-detail-rollout-20261021-20261113-4f0a43` faa54cb2a1c4 merge-tree into staging leaves staging's tree unchanged
- `reaped/spec/formal-specs-20261025-20261113-aa8551` f1eb1dcb0c6a merge-tree into staging leaves staging's tree unchanged
- `reaped/tool-detail-before-20261113-8dfb4e` aec964543457 merge-tree into staging leaves staging's tree unchanged
- `reaped/turbo-cand/apponly-5838ea2-20261113-4001e6` 4e40395d2800 merge-tree into staging leaves staging's tree unchanged
- `reaped/turbo/cand-vnt2-20261025-20261113-10e91a` 8a933d618262 merge-tree into staging leaves staging's tree unchanged
- `reaped/wave-chatgpt-lane-w5-slice-20261113-e548df` 14476aab6d62 merge-tree into staging leaves staging's tree unchanged
- `reaped/worker/dash-acp-20261113-882a26` 25bf065f1d89 merge-tree into staging leaves staging's tree unchanged
- `review/dash-20261020-pre-gateway-live` 1a4ee2a023ae ancestor of staging
- `sol/dash-thinking-tools-20261021` 0c93fde7ba3f ancestor of staging
- `sus100/sus100-dash-release-01` d1378f38ac8d ancestor of staging
- `sus100/sus100-dash-release-02` 0375fa78f707 ancestor of staging
- `sus100/sus100-dash-release-06` 86106c2952f8 ancestor of staging
- `turbo/candidate-e0175a5-app` 259108696d27 ancestor of staging
- `turbo/merge-chats-notices-20261026` 04cbbad784d4 ancestor of staging
- `turbo/preview` 6414866f1f73 ancestor of staging
- `wip/feat/native-continuous-voice-20261105` ecff5c5ba37b git cherry: all 2 patches already in staging ('-'); merging back now conflicts with later staging edits
- `wip/fix-h108-local-20261105` bcdc1dc8b9bd ancestor of staging
- `wip/fix/active-session-filter-20261029-20261105` 064b197d3e2c each of 1 unapplied commits replays onto staging with no change
- `wip/fix/app-identity-token-deadline-20261105` c060a95291e4 git cherry: all 1 patches already in staging ('-'); merging back would only re-add 26 lines staging has since removed
- `wip/fix/genui-mobile-loading-20261105` 2deab10444bc git cherry: all 1 patches already in staging ('-'); merging back now conflicts with later staging edits
- `wip/fix/keyboard-attach-20261105` 587e9c2a9635 git cherry: all 1 patches already in staging ('-'); merging back now conflicts with later staging edits
- `wip/fix/omp-session-detection-20261105` 7151baad4062 git cherry: all 1 patches already in staging ('-'); merging back now conflicts with later staging edits
- `wip/integ-local-20261105` 33684e4692e0 git cherry: all 1 patches already in staging ('-'); merge-tree into staging is a no-op
- `wip/integ-v2-20261105` 909a45ef9571 git cherry: all 1 patches already in staging ('-'); merge-tree into staging is a no-op
- `wip/lane/gate-222-20261105` 9bc92a7b9246 only merge commits ahead; git cherry lists no unapplied patch; merge-tree into staging is a no-op
- `wip/salvage/20261027/dash-turbo-cand-vnt2-20261105` c78149d2c421 only merge commits ahead; git cherry lists no unapplied patch; merge-tree into staging is a no-op

### Wave 2: SUPERSEDED-BY (87)

- `ayo/R23` 3b2d43749311 reaped/ayo/R23-20261115-a7b875: tip 3b2d43749311 is in the history of reaped/ayo/R23-20261115-a7b875, which stays (or is archived)
- `bridge/context-metadata-20261022` e5d37273fbab reaped/bridge/context-metadata-20261022-20261113-ca2fee: tip e5d37273fbab is in the history of reaped/bridge/context-metadata-20261022-20261113-ca2fee, which stays (or is archived)
- `chatgpt/bug-army-closedvisit-1106` 34af134ce4b7 integ/rc3-roadmap-resume-20261027: tip 34af134ce4b7 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `chatgpt/bug-army-cwd-1105c` 06492b55cff8 reaped/dash-lane-pr641-1105-20261113-522f5d: tip 06492b55cff8 is in the history of reaped/dash-lane-pr641-1105-20261113-522f5d, which stays (or is archived)
- `chatgpt/bug-army-flake-1105d` 81514cd9d2f0 chatgpt/fix2-613-close-race: tip 81514cd9d2f0 is in the history of chatgpt/fix2-613-close-race, which stays (or is archived)
- `chatgpt/bug-army-sqlite-1105c` 44849d903ab1 fix/army-main-mic-wayland: tip 44849d903ab1 is in the history of fix/army-main-mic-wayland, which stays (or is archived)
- `chatgpt/cov-05` cfcf3aa25e4b integrate/coverage-20261028: tip cfcf3aa25e4b is in the history of integrate/coverage-20261028, which stays (or is archived)
- `chatgpt/cov-07` 6a5a016fa28e integrate/coverage-20261028: tip 6a5a016fa28e is in the history of integrate/coverage-20261028, which stays (or is archived)
- `chatgpt/cov-08` 0bc8d389fe2e integrate/coverage-20261028: tip 0bc8d389fe2e is in the history of integrate/coverage-20261028, which stays (or is archived)
- `chatgpt/cov-09` 8b820c3d4e0a integrate/coverage-20261028: tip 8b820c3d4e0a is in the history of integrate/coverage-20261028, which stays (or is archived)
- `chatgpt/cov-12` a09eaa0a5e65 integrate/coverage-20261028: tip a09eaa0a5e65 is in the history of integrate/coverage-20261028, which stays (or is archived)
- `chatgpt/dash-120` 389b2bea5e53 612582ac+d44713f8+a1c7db93: head of PR #210: #120 submenu feature is in staging (612582ac has the same subject as 2c35b61c; d44713f8, a1c7db93 wire it); only 3 Jest-mock test commits remain, and AGENTS.md no longer counts unit tests as the suite
- `chatgpt/dash-20261027-flow-trace-dump-pairs` 517da93342af integ/rc3-roadmap-resume-20261027: tip 517da93342af is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `chatgpt/dash-20261027-transcript-workers-r2` 9598386fca61 chatgpt/fix-613-wheel: tip 9598386fca61 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `chatgpt/dash-29-self-dev-feedback-r2` 1b6f584b6016 chatgpt/fix-613-wheel: tip 1b6f584b6016 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `chatgpt/dash-fix-641-turbo` bf7e4b3e30a7 chatgpt/fix2-613-close-race: tip bf7e4b3e30a7 is in the history of chatgpt/fix2-613-close-race, which stays (or is archived)
- `chatgpt/dash-h-108-r2` 5d3c43766f21 chatgpt/fix-613-wheel: tip 5d3c43766f21 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `chatgpt/dash3-bug-army-dexdesk-1106` 0f6287d8cb47 integ/rc3-roadmap-resume-20261027: tip 0f6287d8cb47 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `chatgpt/dash3-bug-army-winparam-1106` eb1ab830d19f integ/rc3-roadmap-resume-20261027: tip eb1ab830d19f is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `chatgpt/turbo-09-audio-route` 9de608423e24 chatgpt/fix-613-wheel: tip 9de608423e24 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `chatgpt/turbo-18-dash-stylus-native` 3faa5d47c0f5 chatgpt/fix-613-wheel: tip 3faa5d47c0f5 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `chore/dead-code-20261107` 8c666d964444 reaped/chore/dead-code-20261107-20261113-ffc57d: tip 8c666d964444 is in the history of reaped/chore/dead-code-20261107-20261113-ffc57d, which stays (or is archived)
- `dash3/bug-s22-failover-1106` 9be2239013bd integ/rc3-roadmap-resume-20261027: tip 9be2239013bd is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `feat/dex-desk-20261028` ab1b4b245ccb chatgpt/fix-613-wheel: tip ab1b4b245ccb is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `feat/spen-voice-20261025` f167589de808 reaped/feat/spen-voice-20261025-20261113-5aa8d8: tip f167589de808 is in the history of reaped/feat/spen-voice-20261025-20261113-5aa8d8, which stays (or is archived)
- `fix/army-wheel-reset-1106` 9b5e350b33b1 integ/rc3-roadmap-resume-20261027: tip 9b5e350b33b1 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `fix/bridge-gui-source-20261102` 1e577218da34 reaped/fix/bridge-gui-source-20261102-20261113-293f31: tip 1e577218da34 is in the history of reaped/fix/bridge-gui-source-20261102-20261113-293f31, which stays (or is archived)
- `fix/hosts-tree-hierarchy-20261105` fe03bfbbed48 reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699: tip fe03bfbbed48 is in the history of reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699, which stays (or is archived)
- `hermes/COV-G01-chat-row-menu` 827e2dc58ae9 integrate/coverage-20261028: tip 827e2dc58ae9 is in the history of integrate/coverage-20261028, which stays (or is archived)
- `hermes/COV-G02-themed-dialogs` 85cf098c7123 integrate/coverage-20261028: tip 85cf098c7123 is in the history of integrate/coverage-20261028, which stays (or is archived)
- `hermes/COV-G03-acp-stop` 67a59cc1ac93 integrate/coverage-20261028: tip 67a59cc1ac93 is in the history of integrate/coverage-20261028, which stays (or is archived)
- `hermes/COV-G04-delivery-outbox` 45c729e3ec92 integrate/coverage-20261028: tip 45c729e3ec92 is in the history of integrate/coverage-20261028, which stays (or is archived)
- `hermes/COV-G11-hermes-history` 7b401f7c852c integrate/coverage-20261028: tip 7b401f7c852c is in the history of integrate/coverage-20261028, which stays (or is archived)
- `integrate/chatgpt-lane-20261025` 2bb9edfc9034 reaped/dash-lane-pr641-1105-20261113-522f5d: tip 2bb9edfc9034 is in the history of reaped/dash-lane-pr641-1105-20261113-522f5d, which stays (or is archived)
- `lane/compose-584-593-on-be28f464-20261105` 86ba2fda5b23 chatgpt/fix-613-wheel: tip 86ba2fda5b23 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `lane/compose-613-642-643-644fix-645-20261106` 364682576e64 reaped/dash-lane-u642-644b-20261113-3b83b7: tip 364682576e64 is in the history of reaped/dash-lane-u642-644b-20261113-3b83b7, which stays (or is archived)
- `lane/compose-613-642-643-645-20261106` c3a5e637056a chatgpt/fix2-613-close-race: tip c3a5e637056a is in the history of chatgpt/fix2-613-close-race, which stays (or is archived)
- `lane/compose-613-645-644fix2-20261106` 67f95c930de3 reaped/dash-lane-u10-20261113-17cdf6: tip 67f95c930de3 is in the history of reaped/dash-lane-u10-20261113-17cdf6, which stays (or is archived)
- `lane/compose-613-645-644fix2-harness-20261106` 3839819a8955 reaped/dash-lane-u7-harness-20261113-c91736: tip 3839819a8955 is in the history of reaped/dash-lane-u7-harness-20261113-c91736, which stays (or is archived)
- `lane/compose-613-645-644fix3-20261106` 3f8fda3d2657 reaped/dash-lane-u10-20261113-17cdf6: tip 3f8fda3d2657 is in the history of reaped/dash-lane-u10-20261113-17cdf6, which stays (or is archived)
- `lane/compose-613-645-644fix3-harness-20261106` 53e4f63264e7 reaped/dash-lane-u10-20261113-17cdf6: tip 53e4f63264e7 is in the history of reaped/dash-lane-u10-20261113-17cdf6, which stays (or is archived)
- `lane/compose-617-on-86ba2fda-20261105` 17e9f6b17fbf reaped/dash-lane-compose-617-20261105-20261113-b7ded1: tip 17e9f6b17fbf is in the history of reaped/dash-lane-compose-617-20261105-20261113-b7ded1, which stays (or is archived)
- `lane/compose-630-on-36de7279-20261105` 04122b3e63de chatgpt/fix-613-wheel: tip 04122b3e63de is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `lane/compose-637-on-04122b3e-20261105` da2e19f060e5 chatgpt/fix-613-wheel: tip da2e19f060e5 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `lane/compose-642-643-20261106` 98b44d6ff291 chatgpt/fix2-613-close-race: tip 98b44d6ff291 is in the history of chatgpt/fix2-613-close-race, which stays (or is archived)
- `lane/compose-642-643-644-on-9ff03f81-20261106` 45dd0d78d85c reaped/dash-lane-u644-20261113-7f35d9: tip 45dd0d78d85c is in the history of reaped/dash-lane-u644-20261113-7f35d9, which stays (or is archived)
- `lane/compose-642-643-644fix-on-9ff03f81-20261106` 736a036fcd94 reaped/dash-lane-u642-644b-20261113-3b83b7: tip 736a036fcd94 is in the history of reaped/dash-lane-u642-644b-20261113-3b83b7, which stays (or is archived)
- `lane/compose-644-on-9ff03f81-20261106` 7019354e8c31 integ/rc3-roadmap-resume-20261027: tip 7019354e8c31 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `lane/compose-644fix4-on-53e4f632-20261106` 06951543aec7 reaped/dash-lane-u11-644fix4-20261113-87f62e: tip 06951543aec7 is in the history of reaped/dash-lane-u11-644fix4-20261113-87f62e, which stays (or is archived)
- `lane/compose-644fix5-on-06951543-20261106` 7ea51827ec20 reaped/dash-lane-u12-644fix5-20261113-b7ab67: tip 7ea51827ec20 is in the history of reaped/dash-lane-u12-644fix5-20261113-b7ab67, which stays (or is archived)
- `lane/compose-646-on-7019354e-20261106` 52a64e113852 integ/rc3-roadmap-resume-20261027: tip 52a64e113852 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `lane/compose-702bf79c` 7c11aa5aeb5c integ/rc3-roadmap-resume-20261027: tip 7c11aa5aeb5c is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `lane/compose-75763627` 75763627de01 reaped/lane/native-c09-c18-20261113-b6d5cf: tip 75763627de01 is in the history of reaped/lane/native-c09-c18-20261113-b6d5cf, which stays (or is archived)
- `lane/compose-f52595bc` f52595bca832 integ/rc3-roadmap-resume-20261027: tip f52595bca832 is in the history of integ/rc3-roadmap-resume-20261027, which stays (or is archived)
- `lane/compose-wave-630-636-637-20261104` 9e5f2299e80b reaped/dash-lane-630-afill-20261113-636b18: tip 9e5f2299e80b is in the history of reaped/dash-lane-630-afill-20261113-636b18, which stays (or is archived)
- `lane/compose-wave-635-636fix3-20261105` 878ba6a23ff0 reaped/dash-lane-compose-636fix3-20261113-ebc4d8: tip 878ba6a23ff0 is in the history of reaped/dash-lane-compose-636fix3-20261113-ebc4d8, which stays (or is archived)
- `lane/compose-wave-635-636fix4-20261105` fd1a9290fa4f backup/eui-cards-unsquashed-20261105: tip fd1a9290fa4f is in the history of backup/eui-cards-unsquashed-20261105, which stays (or is archived)
- `lane/compose-wave-635-636fix5-20261105` 36de72794112 chatgpt/fix-613-wheel: tip 36de72794112 is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `lane/wire-634-20261105` be28f4644d4c chatgpt/fix-613-wheel: tip be28f4644d4c is in the history of chatgpt/fix-613-wheel, which stays (or is archived)
- `notice/elemental-ui` e2442f2c8afe reaped/notice/elemental-ui-20261113-79ac5e: tip e2442f2c8afe is in the history of reaped/notice/elemental-ui-20261113-79ac5e, which stays (or is archived)
- `qualify/turbo-20261025-bridge-usage` 39f40abf1336 reaped/qualify/turbo-20261025-bridge-usage-20261113-16119c: tip 39f40abf1336 is in the history of reaped/qualify/turbo-20261025-bridge-usage-20261113-16119c, which stays (or is archived)
- `qualify/turbo-20261025-bridge-voice-contract` 294fc82fef89 reaped/qualify/turbo-20261025-bridge-voice-contract-20261113-76065b: tip 294fc82fef89 is in the history of reaped/qualify/turbo-20261025-bridge-voice-contract-20261113-76065b, which stays (or is archived)
- `test/army-coverage-20261028` dab113aa7191 chatgpt/cov-10: tip dab113aa7191 is in the history of chatgpt/cov-10, which stays (or is archived)
- `turbo/candidate-52a64e11` 6281b3a8b227 reaped/dash-lane-integ-52a64e11-20261113-47bb79: tip 6281b3a8b227 is in the history of reaped/dash-lane-integ-52a64e11-20261113-47bb79, which stays (or is archived)
- `turbo/candidate-5c88c670` 5c88c6707d6d integ/rc3-roadmap-resume-20261027: identical tip 5c88c6707d6d is kept as integ/rc3-roadmap-resume-20261027
- `turbo/dash-live-20261025` 4bc128ed0fbe fix/share-pattern-syntax: tip 4bc128ed0fbe is in the history of fix/share-pattern-syntax, which stays (or is archived)
- `wip/density-dial-20261105` dcd68365614b reaped/density-dial-20261113-cfcb53: tip dcd68365614b is in the history of reaped/density-dial-20261113-cfcb53, which stays (or is archived)
- `wip/e2e/mbp-army-20261025-20261105` 0beacde9fb14 reaped/ayo/R23-20261115-a7b875: tip 0beacde9fb14 is in the history of reaped/ayo/R23-20261115-a7b875, which stays (or is archived)
- `wip/explore/glass-wallpaper-20261105` cba49a25db98 reaped/explore/glass-wallpaper-20261113-87d77a: tip cba49a25db98 is in the history of reaped/explore/glass-wallpaper-20261113-87d77a, which stays (or is archived)
- `wip/feat/agent-surface-20261022-20261105` 9b8e1de82134 reaped/feat/agent-surface-20261022-20261113-10a492: tip 9b8e1de82134 is in the history of reaped/feat/agent-surface-20261022-20261113-10a492, which stays (or is archived)
- `wip/feat/dash-native-notifications-share-20261105` 1d1176547796 3a3b85b7: all 1 unapplied commits have a same-subject commit in staging
- `wip/fix/army-roster-304-20261105` de4437af5193 reaped/fix/army-roster-304-20261113-6a6146: tip de4437af5193 is in the history of reaped/fix/army-roster-304-20261113-6a6146, which stays (or is archived)
- `wip/fix/bridge-acp-error-detail-20261025-20261105` 289cf0e38762 183edb10: all 1 unapplied commits have a same-subject commit in staging
- `wip/fix/core-history-refresh-20261029-20261105` ec9f8482b055 reaped/fix/core-history-refresh-20261029-20261113-719e66: tip ec9f8482b055 is in the history of reaped/fix/core-history-refresh-20261029-20261113-719e66, which stays (or is archived)
- `wip/fix/heavy-test-timeouts-2bedab2-20261105` 1378be0db0be reaped/fix/heavy-test-timeouts-2bedab2-20261113-4d2acc: tip 1378be0db0be is in the history of reaped/fix/heavy-test-timeouts-2bedab2-20261113-4d2acc, which stays (or is archived)
- `wip/fix/hosts-tree-hierarchy-20261105-20261105` b3e506fae530 reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699: tip b3e506fae530 is in the history of reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699, which stays (or is archived)
- `wip/fix/summary-transport-20261105` 34420f97fd19 reaped/fix/summary-transport-20261113-657a58: tip 34420f97fd19 is in the history of reaped/fix/summary-transport-20261113-657a58, which stays (or is archived)
- `wip/fix/voice-controls-20261022-20261105` e293a2f0895e reaped/fix/voice-controls-20261022-20261113-205f32: tip e293a2f0895e is in the history of reaped/fix/voice-controls-20261022-20261113-205f32, which stays (or is archived)
- `wip/notice/elemental-ui-20261105` e2442f2c8afe reaped/notice/elemental-ui-20261113-79ac5e: tip e2442f2c8afe is in the history of reaped/notice/elemental-ui-20261113-79ac5e, which stays (or is archived)
- `wip/omp/d41-page-controls-20261105` 4692e4e94bc2 reaped/omp/d41-page-controls-20261113-ad36dd: tip 4692e4e94bc2 is in the history of reaped/omp/d41-page-controls-20261113-ad36dd, which stays (or is archived)
- `wip/omp/fix-botface-ui-thread-20261105` eb114e4a8479 reaped/fix/voice-controls-20261022-20261113-205f32: tip eb114e4a8479 is in the history of reaped/fix/voice-controls-20261022-20261113-205f32, which stays (or is archived)
- `wip/program/composer-20261022-20261105` 8a7790048c93 reaped/program/composer-20261022-20261113-0fdee4: tip 8a7790048c93 is in the history of reaped/program/composer-20261022-20261113-0fdee4, which stays (or is archived)
- `wip/sol/agent-popup-20261021-20261105` f217dbefac76 reaped/sol/agent-popup-20261021-20261113-0e9e72: tip f217dbefac76 is in the history of reaped/sol/agent-popup-20261021-20261113-0e9e72, which stays (or is archived)
- `wip/sol/attached-dock-20261021-20261105` 8b6beee49ecf reaped/sol/attached-dock-20261021-20261113-ae9420: tip 8b6beee49ecf is in the history of reaped/sol/attached-dock-20261021-20261113-ae9420, which stays (or is archived)
- `wip/sol/bot-faces-20261021-20261105` 67977815e10f reaped/sol/bot-faces-20261021-20261113-9d1709: tip 67977815e10f is in the history of reaped/sol/bot-faces-20261021-20261113-9d1709, which stays (or is archived)
- `wip/sol/mic-dictation-20261021-20261105` ea22554f68de reaped/sol/mic-dictation-20261021-20261113-846425: tip ea22554f68de is in the history of reaped/sol/mic-dictation-20261021-20261113-846425, which stays (or is archived)
- `wip/turbo/candidate-78a2fdb-20261105` 3d67cedba9fa 7c232856: every file it changes was deleted in staging (feat(release): O15 tester army is the test suite and the release gate)

## STILL-UNIQUE branches needing a human decision (186)

Each has commits whose patches are not in staging; the commits are listed one line each in STILL-UNIQUE.md. Counts are `unapplied commits that change staging / unapplied commits`.

By prefix: reaped/* 168, wip/* 6, fix/* 3, chatgpt/* 2, lane/* 2, backup/* 1, hermes/* 1, incomplete/* 1, integ/* 1, qualify/* 1.

- `backup/eui-cards-unsquashed-20261105` 41c225fe822a 2026-11-05 +10/-350 (8/8): fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- `chatgpt/turbo-12-subagent-strip-green` 4bca6e3ed159 2026-10-28 +2/-739 (2/2): fix(hermes): hide delegated children from chats and completed workers from mounted Orch...
- `chatgpt/turbo-13-live-chip-army` cff9aa17554a 2026-10-28 +10/-735 (6/8): feat(turbo): web-only Metro identity and reload seams
- `fix/army-main-mic-wayland` 9be0618de29d 2026-11-05 +3/-397 (2/2): test(army): wait for SQLite writer lock and report stderr
- `fix/bridge-hermes-list-refresh` d0f4161216ad 2026-10-26 +2/-1428 (2/2): test(bridge): pin nonblocking native Hermes profile refresh
- `fix/share-pattern-syntax` c792ba34c7c6 2026-11-02 +10/-1426 (9/9): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `hermes/hosts-3-utilization` d7ccc9f39fc0 2026-10-28 +1/-785 (1/1): feat(hosts): persist sampled utilization and show 24h coverage
- `incomplete/cursor/aodl-ui-surface-e30f` ed74bd67aeaf 2026-09-13 +17/-2072 (15/15): docs: continuous R-phase insights (AgentFlow dual, three calculi)
- `integ/turbo-c30-c13-20261103` 4e00e8273ab5 2026-11-03 +1/-417 (0/0): merge chatgpt/turbo-30-palm-rejection (PR #605) onto served eaa5c6dc
- `lane/compose-dash4r-0604` 9e0928b6b234 2026-11-04 +9/-384 (5/5): fix(feedback): preserve named conversation title on first steer
- `lane/compose-dash4r-0610` 4e8e371e844d 2026-11-04 +12/-348 (5/5): fix(feedback): preserve named conversation title on first steer
- `qualify/turbo-20261025-memory-context-lane` 596beb43a7e8 2026-10-25 +1/-1601 (0/0): integrate(turbo): compose qualified lane with memory-context union
- `reaped/army-core-20261029-20261113-e77b95` 2db2280cd802 2026-11-13 +1/-482 (1/1): worktree-reap snapshot of <path>
- `reaped/ayo/R23-20261115-a7b875` 6dcd40722b96 2026-11-15 +6/-1741 (5/6): test(e2e): add isolated MBP Playwright army and framework benchmarks
- `reaped/baseline-20261113-a1e5b8` 1a48d98bc99a 2026-11-13 +1/-1881 (1/1): worktree-reap snapshot of <path>
- `reaped/bridge/context-metadata-20261022-20261113-ca2fee` 0fecda59aa86 2026-11-13 +3/-1849 (1/2): feat(bridge): additive read-only provider and parent lineage in the exact-session conte...
- `reaped/chatgpt/dash-120-20261113-36f94d` 5f9bbb9ddb3d 2026-11-13 +7/-1741 (2/3): test(composer): render row options and exercise exclusive hold/tap gesture callbacks (#...
- `reaped/chore/dead-code-20261107-20261113-ffc57d` e32575c8d588 2026-11-13 +3/-317 (3/3): chore: delete dead code (verified) — deps+files, lock pending regen
- `reaped/composer-before-20261021-20261113-b9d5e0` ffb4bfddbc57 2026-11-13 +1/-1969 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-e2e-test-20261113-87b86a` d64c81cf7cbf 2026-11-13 +6/-1426 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-613-20261113-c31d4a` e67cda47d7f6 2026-11-13 +42/-327 (31/33): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-630-afill-20261113-636b18` 44b53f9f6076 2026-11-13 +15/-329 (10/10): fix(feedback): preserve named conversation title on first steer
- `reaped/dash-lane-630-locfix-20261113-6089e6` 245196033a0e 2026-11-13 +11/-397 (10/11): fix(feedback): preserve named conversation title on first steer
- `reaped/dash-lane-630-on-36de-20261113-50e1c7` 033df24ea955 2026-11-13 +19/-350 (16/16): fix(feedback): preserve named conversation title on first steer
- `reaped/dash-lane-636fix5-20261113-ee0939` 2ead041e1e0e 2026-11-13 +8/-350 (6/6): fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- `reaped/dash-lane-641-20261113-c3f2ae` 468478fd34a9 2026-11-13 +8/-350 (6/6): fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- `reaped/dash-lane-642-20261113-6bd2c8` 0725126c6569 2026-11-13 +37/-327 (30/30): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-643-20261113-ec6244` 14c2812dfef9 2026-11-13 +36/-327 (29/29): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-644fix5-20261113-40241a` 3a5918c14ed9 2026-11-13 +46/-327 (38/39): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-648-20261113-ab49f0` fb086a93bc9e 2026-11-13 +92/-327 (73/75): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-649-20261113-22caa0` e98b6790e862 2026-11-13 +102/-327 (81/83): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-702bf79c-20261113-9b9d1d` bd000deedc5e 2026-11-13 +3/-1144 (1/2): feat(flow): parse trace dumps into per-turn stage-pair samples
- `reaped/dash-lane-apk-52a64e11-20261113-a9d817` 0245ddbcab7c 2026-11-13 +81/-327 (63/66): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-apk-6acff6dd-20261113-3c883c` c10c2d53d8ef 2026-11-13 +82/-327 (64/67): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-apkcheck-20261113-7acece` 49250f562fb6 2026-11-13 +88/-327 (69/72): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-base-2bedab2-20261113-429a93` 29eb8e403148 2026-11-13 +5/-1426 (4/4): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/dash-lane-base-bae07a2-20261113-5fe484` aaa8dd7e0968 2026-11-13 +1/-1479 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-c634-20261113-77fd13` 11ccdc4136f2 2026-11-13 +4/-391 (2/2): feat(bridge): derive status-only subagents from transcript tool events
- `reaped/dash-lane-cand10-20261113-98fac6` d0423d4b8384 2026-11-13 +1/-1549 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand12-20261113-2a53c1` 8917b97b9255 2026-11-13 +17/-1473 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand13-20261113-a64820` 50ba7656518d 2026-11-13 +1/-1483 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand14-20261113-31f764` 437c7f8e49e9 2026-11-13 +1/-1479 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand5-20261113-5dd365` b9fa6650af47 2026-11-13 +26/-1571 (4/4): test: cover live OMP hydration and prevent cross-cwd history fallback (#26)
- `reaped/dash-lane-cand6-20261113-9a6f13` 6de9c6f0bfe6 2026-11-13 +1/-1613 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand7-20261113-3ff038` d813cbf8d5bc 2026-11-13 +12/-1589 (4/4): test: cover live OMP hydration and prevent cross-cwd history fallback (#26)
- `reaped/dash-lane-cand8-20261113-877f85` 0c2b03886fba 2026-11-13 +1/-1578 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-cand9-20261113-f97f2a` 3ea254914921 2026-11-13 +1/-1562 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-ciapt-1105-20261113-87bba6` d4585ebce8a1 2026-11-13 +33/-327 (25/26): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-compose-1105-20261113-4e1c01` f1489d659d28 2026-11-13 +13/-329 (9/9): fix(feedback): preserve named conversation title on first steer
- `reaped/dash-lane-compose-20261113-84b91b` 895bd18a02b6 2026-11-13 +1/-1362 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-compose-584-593-20261105-20261113-a540bb` 8080c591f95a 2026-11-13 +31/-327 (24/24): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-compose-617-20261105-20261113-b7ded1` 5ea010bf73c5 2026-11-13 +34/-327 (25/25): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-compose-636fix3-20261113-ebc4d8` adfc69c74db1 2026-11-13 +4/-350 (1/2): fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- `reaped/dash-lane-compose-636fix4-20261113-75b30e` 0ef3b8e0f7f6 2026-11-13 +7/-350 (4/5): fix(main): keep attached dock mounted behind chat to preserve transcript scroll
- `reaped/dash-lane-compose-702bf-20261113-47b779` 99c572b3742f 2026-11-13 +5/-397 (1/2): feat(flow): parse trace dumps into per-turn stage-pair samples
- `reaped/dash-lane-compose-c029acf-630dd6e-20261113-6d9c6b` 32d2d323f7df 2026-11-13 +2/-1235 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-compose-no630-1105-20261113-dd1652` 899ebe9465b5 2026-11-13 +1/-327 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-compose-no630-20261113-e6c15a` 88e2e8a1b654 2026-11-13 +2/-350 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-dexcycle-20261113-0b1830` 6ee7d90defec 2026-11-13 +87/-327 (68/71): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-e2e-army-20261113-d64e3b` e7748665876a 2026-11-13 +5/-1741 (4/5): test(e2e): add isolated MBP Playwright army and framework benchmarks
- `reaped/dash-lane-fix-5df7325-20261113-392b72` 4dc44f8ab6cd 2026-11-13 +1/-1324 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-fix2c30-1103-20261113-5c7be1` 1ddcb3449209 2026-11-13 +1/-413 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-fix630-1105-20261113-d11454` bcbe4202771a 2026-11-13 +9/-397 (8/9): fix(feedback): preserve named conversation title on first steer
- `reaped/dash-lane-gates-5bef946-20261113-26a4d9` a227231dc0b4 2026-11-13 +1/-1308 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-integ-52a64e11-20261113-47bb79` 40d9705466bb 2026-11-13 +86/-327 (65/67): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-p645-20261113-0a777f` 83ea57248e75 2026-11-13 +48/-327 (37/39): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-pr351-20261113-c0e004` 920669eeb680 2026-11-13 +1/-1317 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-pr641-1105-20261113-522f5d` 59d6bb1c760a 2026-11-13 +9/-1144 (7/7): feat(flow): parse trace dumps into per-turn stage-pair samples
- `reaped/dash-lane-sttwarm-20261113-47a41a` d37751928793 2026-11-13 +87/-327 (69/71): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-turbo01b-20261113-d1bc3e` 0dd309009dec 2026-11-13 +1/-1498 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-lane-turbocomp-20261113-609c2b` 48e0bb1ab848 2026-11-13 +2/-1426 (2/2): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/dash-lane-u10-20261113-17cdf6` 2fed2f0d7fdf 2026-11-13 +74/-327 (56/59): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u11-644fix4-20261113-87f62e` cd78c7eb2148 2026-11-13 +76/-327 (58/60): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u12-644fix5-20261113-b7ab67` d1cdf49a5fda 2026-11-13 +78/-327 (59/61): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u13-644-20261113-03a92d` 8b70e75d71e2 2026-11-13 +47/-327 (39/39): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u14-646-20261113-7069b3` 0f66e010f63b 2026-11-13 +81/-327 (64/66): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u4-no644-20261113-fb0920` c00ee679bbec 2026-11-13 +59/-327 (45/47): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u6-644fix2-20261113-abfc42` eb8ea18420b7 2026-11-13 +70/-327 (55/57): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u642-644b-20261113-3b83b7` 8e334e23025d 2026-11-13 +69/-327 (54/56): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u644-20261113-7f35d9` 88a0f9694129 2026-11-13 +47/-327 (37/37): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u7-harness-20261113-c91736` 2b3a0ad6dfdf 2026-11-13 +71/-327 (56/58): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u8-harness-20261113-3c76af` 6525e142e63e 2026-11-13 +60/-327 (46/48): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-u9-644fix3-20261113-f7477a` 11e575755947 2026-11-13 +72/-327 (56/58): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-lane-wheel-20261113-6bcb80` 1ced78f8722a 2026-11-13 +94/-327 (74/76): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/dash-orch-leak-20261113-2563a4` fc32daba60fc 2026-11-13 +1/-1385 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-orch-leak-dev-20261113-80f4bb` c7a16d01202c 2026-11-13 +1/-1385 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-rc3-e2e-2c948dc-20261113-8dae7a` c30b069284f5 2026-11-13 +1/-978 (1/1): worktree-reap snapshot of <path>
- `reaped/dash-turbo-qualify-latest-gates-20261025T1135-20261113-37719d` f67e73e130cf 2026-11-13 +1/-1549 (1/1): worktree-reap snapshot of <path>
- `reaped/density-dial-20261113-cfcb53` 7b588f007adc 2026-11-13 +4/-1805 (2/2): wip(density): preserve interrupted two-axis controls and Zero tuck
- `reaped/e2e/mbp-army-20261025-20261113-87d629` 7158e4a27c19 2026-11-13 +4/-1741 (3/4): test(e2e): add isolated MBP Playwright army and framework benchmarks
- `reaped/explore/glass-wallpaper-20261113-87d77a` 139052ef6fc4 2026-11-13 +2/-1426 (2/2): feat(glass): opt-in Dash Glass variant over the Android wallpaper (spike)
- `reaped/feat/agent-surface-20261022-20261113-10a492` c62f72ea4ac4 2026-11-13 +2/-1792 (1/2): feat: add scoped same-chat agent surface with render receipts
- `reaped/feat/ephemeral-ui-cards-20261105-20261113-0c5f55` 1c7c2f701f65 2026-11-13 +1/-316 (1/1): worktree-reap snapshot of <path>
- `reaped/feat/libfx-live-surface-20261113-2fd894` 374093526236 2026-11-13 +1/-1985 (1/1): worktree-reap snapshot of <path>
- `reaped/feat/spen-voice-20261025-20261113-5aa8d8` 32a5b2803ce1 2026-11-13 +25/-1741 (25/25): feat(stylus): observe side-button edges; preserve normal selection and attach circled r...
- `reaped/feat/trace-native-20261113-23ad92` 63aad780af0e 2026-11-13 +1/-1918 (1/1): worktree-reap snapshot of <path>
- `reaped/feat/ux-polish-omp-tern-20261025-20261113-6cf426` f9af2ec893b5 2026-11-13 +2/-1741 (1/2): feat(chat): apply source-backed OMP and Tern UX polish
- `reaped/feat/voice-orb-live-20261113-173b84` 264f80408121 2026-11-13 +1/-1848 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/army-roster-304-20261113-6a6146` acc7bf7dee3e 2026-11-13 +7/-1741 (5/7): test(e2e): add isolated MBP Playwright army and framework benchmarks
- `reaped/fix/automatic-stylus-20261113-a02085` e403b0acc2c2 2026-11-13 +1/-1798 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/bridge-gui-source-20261102-20261113-293f31` 37cadcd488f0 2026-11-13 +2/-956 (1/2): fix(bridge): add gui to HERMES_CHAT_SOURCES so dashboard sessions pass visible() and kn...
- `reaped/fix/cache-directory-persistence-20261113-339ee5` 2aec330e3e5d 2026-11-13 +1/-1545 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/cache-directory-stable-20261113-be984a` 3b4bc3abcb12 2026-11-13 +1/-1736 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/chat-information-density-20261022-20261113-c3222c` 820f8a9d9b21 2026-11-13 +4/-1792 (3/4): fix(tool-format): keep command identity for ACP plain-text terminal calls
- `reaped/fix/composer-voice-navigation-20261021-20261113-c03b2d` 6045b9f849ec 2026-11-13 +1/-1962 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/core-history-refresh-20261029-20261113-719e66` 381daf384261 2026-11-13 +2/-481 (1/2): fix: preserve phone turns and native ACP continuation
- `reaped/fix/dex-gradle-deps-20261113-79991e` f8c72f85c406 2026-11-13 +82/-327 (64/67): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/fix/endpoint-ownership-20261029-20261113-66d630` 0b6b06f9c6c2 2026-11-13 +1/-480 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/heavy-test-timeouts-2bedab2-20261113-4d2acc` 11c6105ebf25 2026-11-13 +7/-1426 (5/6): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/fix/hello-admission-watchdog-20261029-20261113-74cfe0` b40604764e26 2026-11-13 +1/-482 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/hide-status-bar-20261025-20261113-9bcc0d` 3f4970a912df 2026-11-13 +1/-1741 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/hosts-tree-hierarchy-20261105-20261113-e45699` f19f7109b32f 2026-11-13 +10/-397 (6/7): feat(flow): parse trace dumps into per-turn stage-pair samples
- `reaped/fix/hosts-tree-hierarchy-main-20261105-20261113-fecfd9` 00ce21576565 2026-11-13 +7/-326 (5/6): fix(hosts): one level per kind: host > harness > profile > chat
- `reaped/fix/legacy-recovery-20261029-20261113-32068a` 15925797a986 2026-11-13 +1/-478 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/memory-leak-20261025-20261113-f9fe24` f277a40a1134 2026-11-13 +1/-1740 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/orb-smooth-20261113-f4f5ac` 9ee92837e6f5 2026-11-13 +1/-1799 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/subagent-indicator-20261025-20261113-d8469e` 061bcaa3b84f 2026-11-13 +3/-1741 (1/2): test(chat): isolate native draft mocks and qualify restored workers
- `reaped/fix/summary-transport-20261113-657a58` 62a9cf9de23a 2026-11-13 +2/-1805 (2/2): fix: route smol summaries through bounded Hermes Codex OAuth
- `reaped/fix/terminal-retention-w05-20261029-20261113-f0a46f` f5447c62faa4 2026-11-13 +1/-482 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/triage-running-north-star-20261028-20261113-1a9c83` edd77c0632f5 2026-11-13 +1/-465 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/voice-controls-20261022-20261113-205f32` 8664b4f9955a 2026-11-13 +3/-1746 (2/3): perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- `reaped/fix/worklet-easing-20261113-4875e5` c434a2696014 2026-11-13 +1/-1852 (1/1): worktree-reap snapshot of <path>
- `reaped/fix/workspace-navigation-recovery-20261113-3b003d` d574bc32bb7d 2026-11-13 +1/-1793 (1/1): worktree-reap snapshot of <path>
- `reaped/history-ownership-20261029-20261113-22a1b5` 160d21b23814 2026-11-13 +1/-480 (1/1): worktree-reap snapshot of <path>
- `reaped/integ/turbo-c30-c13-20261103-20261113-8c00dd` 5c5bcbf60a44 2026-11-13 +2/-417 (1/1): worktree-reap snapshot of <path>
- `reaped/integrate/botface-fabric-hotfix-20261022-20261113-edd944` fb257d8648e5 2026-11-13 +3/-1746 (2/3): perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- `reaped/integrate/dash-20261020-work-20261113-4075e3` b550abd0d618 2026-11-13 +1/-1881 (1/1): worktree-reap snapshot of <path>
- `reaped/integrate/lab-press-ownership-20261021-20261113-490310` 0bdd8aa30327 2026-11-13 +1/-1856 (1/1): worktree-reap snapshot of <path>
- `reaped/integrate/motion-speed-pass2-rollout-20261021-20261113-056183` e100dde4bb5c 2026-11-13 +1/-1853 (1/1): worktree-reap snapshot of <path>
- `reaped/lab-polish-before-20261113-b029bb` 03143b3e4cdb 2026-11-13 +1/-1871 (1/1): worktree-reap snapshot of <path>
- `reaped/lane-w4-1927-20261113-b92c0f` f614fca0e2a5 2026-11-13 +1/-1109 (1/1): worktree-reap snapshot of <path>
- `reaped/lane-w5-2130-20261113-59973f` 6b6c19b3a2cd 2026-11-13 +1/-1030 (1/1): worktree-reap snapshot of <path>
- `reaped/lane/compose-637-on-04122b3e-20261105-20261113-1605c0` 35d2e34536ff 2026-11-13 +20/-327 (16/16): fix(feedback): preserve named conversation title on first steer
- `reaped/lane/compose-642-643-20261106-20261113-f2217c` 8dca70d05be0 2026-11-13 +42/-327 (33/33): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/lane/compose-w2-1800-20261113-089e92` c750f01a0123 2026-11-13 +1/-1335 (1/1): worktree-reap snapshot of <path>
- `reaped/lane/compose-wave-630-636-637-20261104-20261113-97ccf7` b4e5cd465962 2026-11-13 +11/-329 (8/8): fix(feedback): preserve named conversation title on first steer
- `reaped/lane/fix-208-live-correlation-20261113-b8f467` aae4fabdad76 2026-11-13 +1/-1331 (1/1): worktree-reap snapshot of <path>
- `reaped/lane/fix-send-anchors-20261105-20261113-f50e3f` aee9075415fd 2026-11-13 +32/-327 (24/25): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/lane/gate-222b-20261113-473542` 5abd8e68a460 2026-11-13 +1/-1325 (1/1): worktree-reap snapshot of <path>
- `reaped/lane/native-c09-c18-20261113-b6d5cf` 4ea79d4e75b8 2026-11-13 +12/-397 (7/7): TURBO-C09: route live WebRTC output to Android loudspeaker
- `reaped/lane/pr634-test-20261113-237001` 0d5f86cdda2c 2026-11-13 +2/-397 (2/2): feat(bridge): derive status-only subagents from transcript tool events
- `reaped/lane/wire-634-20261105-20261113-7668b2` fd1f1d227bc5 2026-11-13 +24/-327 (19/19): fix(feedback): preserve named conversation title on first steer
- `reaped/native-consumer-ownership-20261029-20261113-718542` a06a512a6a74 2026-11-13 +1/-478 (1/1): worktree-reap snapshot of <path>
- `reaped/notice/elemental-ui-20261113-79ac5e` 39f6d02a75ff 2026-11-13 +6/-397 (2/3): feat(flow): parse trace dumps into per-turn stage-pair samples
- `reaped/omp/d41-page-controls-20261113-ad36dd` e58a41313697 2026-11-13 +5/-1792 (4/5): test(d41): capture WIP registry replacement ownership regression
- `reaped/omp/fix-botface-ui-thread-20261113-f5c1ad` b550a7a7d6db 2026-11-13 +2/-1746 (1/2): perf(faces): animate Moodie eyes with a view transform, not SVG animatedProps
- `reaped/program/composer-20261022-20261113-0fdee4` 1deb6c539277 2026-11-13 +5/-1793 (4/5): feat(input): port attached dock and agent controls onto full-width composer
- `reaped/program/trace-20261022-20261113-2b3676` 7f6843cb07a9 2026-11-13 +9/-1793 (8/9): feat(trace): add private intent evidence feed and artifact review cards
- `reaped/proto/agent-trace-20261020-20261113-b289b6` 552a202b8ee2 2026-11-13 +5/-1971 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/lane-20261025-w1-20261113-5d41e4` 62246fbedecc 2026-11-13 +12/-1717 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/lane-20261025-w2-20261113-1f3d28` 257a02edd8f6 2026-11-13 +1/-1713 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/turbo-20261025-bridge-usage-20261113-16119c` 9f02c48a314c 2026-11-13 +3/-1839 (1/2): feat(bridge): compose read-only usage metadata without compaction
- `reaped/qualify/turbo-20261025-bridge-voice-contract-20261113-76065b` cb80835ecf01 2026-11-13 +4/-1839 (2/3): feat(bridge): compose read-only usage metadata without compaction
- `reaped/qualify/turbo-20261025-memory-20261113-e34b3f` 24e06cbce370 2026-11-13 +1/-1740 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/turbo-20261025-memory-context-20261113-1a6cb6` 07044d40312a 2026-11-13 +1/-1730 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/turbo-20261025-memory-context-fixture-20261113-024a60` b35c5c3e067a 2026-11-13 +1/-1729 (1/1): worktree-reap snapshot of <path>
- `reaped/qualify/turbo-20261025-memory-context-lane-20261113-d0ec32` be61273360c6 2026-11-13 +2/-1601 (1/1): worktree-reap snapshot of <path>
- `reaped/rc3-roadmap-resume-apk-20261113-a84706` d015c1d10950 2026-11-13 +1/-954 (1/1): worktree-reap snapshot of <path>
- `reaped/release/dash-main-squash-20261027-20261113-930765` dac7173e7210 2026-11-13 +2/-2071 (1/2): Dash: turbo line to main (squash of integ/travel-turbo-20261027 @ 46cd598)
- `reaped/roster-actionability-20261029-20261113-5962dd` d74f374e0d7d 2026-11-13 +1/-480 (1/1): worktree-reap snapshot of <path>
- `reaped/sol/agent-popup-20261021-20261113-0e9e72` 23c1bc863343 2026-11-13 +2/-1805 (2/2): feat(input): add agent controls and authenticated recent-model evidence
- `reaped/sol/attached-dock-20261021-20261113-ae9420` 00cf7f03ef9f 2026-11-13 +4/-1805 (4/4): fix(input): preserve system dictation and prevent external voice handoff
- `reaped/sol/bot-faces-20261021-20261113-9d1709` 710b68b0ff7c 2026-11-13 +3/-1805 (2/2): wip(bots): preserve interrupted deterministic face implementation
- `reaped/sol/dash-steer-rollout-20261021-20261113-6a0114` 76ee5313a6ac 2026-11-13 +1/-1878 (1/1): worktree-reap snapshot of <path>
- `reaped/sol/merge-queued-20261021-20261113-627cb3` ad2ece71ecf0 2026-11-13 +1/-1868 (1/1): worktree-reap snapshot of <path>
- `reaped/sol/mic-dictation-20261021-20261113-846425` ea52214d0566 2026-11-13 +2/-1805 (2/2): fix(input): preserve system dictation and prevent external voice handoff
- `reaped/sol/model-roles-20261021-20261113-bf499f` 0d5bdd14e4c6 2026-11-13 +1/-1913 (1/1): worktree-reap snapshot of <path>
- `reaped/sol/trace-intent-20261021-20261113-4b1018` 01bb48adfa80 2026-11-13 +5/-1805 (5/5): feat(trace): add private intent evidence feed and artifact review cards
- `reaped/turbo/cand-turbo02-20261025-20261113-779b3e` 8fcd08d322c0 2026-11-13 +1/-1465 (1/1): worktree-reap snapshot of <path>
- `reaped/turbo/candidate-2a7d17b-app-20261113-7bf620` 713eb25861c8 2026-11-13 +10/-1426 (9/9): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/turbo/candidate-72672e4-app-20261113-119b19` d172664f4516 2026-11-13 +1/-1461 (1/1): worktree-reap snapshot of <path>
- `reaped/turbo/candidate-78a2fdb-20261113-7d8362` 70e1bbd7cbb0 2026-11-13 +4/-1263 (3/3): test(integ): retarget connection-pill a11y source assertion to the turbo banner
- `reaped/turbo/candidate-78a2fdb-app-20261113-6b944b` 8433991f5c2e 2026-11-13 +1/-1462 (1/1): worktree-reap snapshot of <path>
- `reaped/turbo/candidate-d711b34-app-20261113-1401ab` 8ebd81e28328 2026-11-13 +3/-1426 (3/3): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/turbo/candidate-e0175a5-app-20261113-afe6b5` 22f31174414d 2026-11-13 +1/-1460 (1/1): worktree-reap snapshot of <path>
- `reaped/turbo/dash-live-20261021-20261113-a3e1a9` 306deef66f6c 2026-11-13 +2/-1805 (1/1): worktree-reap snapshot of <path>
- `reaped/turbo/dash-live-20261025-20261113-41dcf2` c5e41ce24993 2026-11-13 +10/-1426 (9/9): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/turbo/fix-tests-f21db40-20261113-51a302` 21be4a658987 2026-11-13 +5/-1426 (4/4): turbo: app slice of lane d8af0e7 (e0175a5..d8af0e7: #392 fullscreen cutout pill, #448 s...
- `reaped/worker/dash-pages-20261113-89975d` 033a5cfc4c63 2026-11-13 +1/-2032 (1/1): worktree-reap snapshot of <path>
- `reaped/wt/compose-1230-20261113-000f21` 2276d246adcf 2026-11-13 +1/-1144 (1/1): worktree-reap snapshot of <path>
- `wip/salvage/20261027/dash-lane-compose-c029acf-630dd6e-20261105` 72672e4f768b 2026-10-25 +1/-1235 (0/0): Merge remote-tracking branch 'origin/integrate/chatgpt-lane-20261025' into HEAD
- `wip/salvage/20261027/dash-specs-20261105` 97921a4edf66 2026-10-27 +1/-1741 (1/1): salvage: abandoned work from <path> (spec/formal-specs-202610...
- `wip/stt-bisect-allbridge-1105` a8b77dab0bd6 2026-11-05 +1/-325 (1/1): bisect: 0ae86005 with all bridge/shared files reverted to d9762906 (STT probe)
- `wip/stt-bisect-client-1105` 6232b8134b3a 2026-11-05 +1/-325 (1/1): bisect: 0ae86005 with client reverted to d9762906 (STT probe)
- `wip/stt-bisect-index-1105` 69b29399e93b 2026-11-05 +1/-325 (1/1): bisect: 0ae86005 with index reverted to d9762906 (STT probe)
- `wip/stt-bisect-parse-1105` 08176cc216d9 2026-11-05 +1/-325 (1/1): bisect: 0ae86005 without parseClientMessage model hunks (STT probe)

## Wave 3: archive, then delete

`boat/dash-consolidate/archive-unique` (f7002333dba5) is one commit whose parents are the 186 STILL-UNIQUE tips listed in ARCHIVE-PARENTS.txt. Its tree holds only that list. Pushing it as `archive/dash-unique-20261123` keeps every one of those commits reachable after the branches are deleted:

```
git push origin boat/dash-consolidate/archive-unique:refs/heads/archive/dash-unique-20261123
git merge-base --is-ancestor <sha> origin/archive/dash-unique-20261123   # per wave-3 line, then leased delete
```

Branches marked SUPERSEDED-BY a STILL-UNIQUE branch are in wave 2. Their tips are inside that branch, and also inside the archive ref once it exists.
