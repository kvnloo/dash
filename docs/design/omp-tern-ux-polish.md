# Dash UX polish: source-backed contract

## Observed sources and boundaries
- Dash base: `05e3bb506c84361eb53c4800484f431dc492d8e0`, new isolated `feat/ux-polish-omp-tern-20261025` worktree.
- OMP installed metadata: `/home/kvn/.local/share/tern/omp/state.json:5-10`, version 18.12.6, unmanaged patched binary. This is not a source-equivalence claim.
- OMP source inspected read-only: `/mnt/zer0models/z0-wt/ro/oh-my-pi`, SHA `0e2411c0df59fce8c56dc03a5f1c9afffcb0d746`.
- Tern frontend inspected read-only: `/mnt/zer0models/worktrees/hermes-tern-main-qa`, SHA `ec32ea2176c43472e6f048b86498fd18712954f4`. It emits native Tern nodes; not proof of the installed host build. Searches under the requested workspace and z0-wt found OMP and integration adapters; the actual frontend checkout is in the sibling worktrees registry.

## Principles -> intended Dash seams
1. **Work indicators describe real work, not decorative liveness.** OMP `packages/tui/src/components/loader.ts:32-44,58-94` carries an intent label, elapsed origin, optional measured rate and a Stop only when interruption works. Tern `frontend/src/view/ui/live.tsx:15-36` has the same working-row semantics. Dash: distinguish queued, disconnected, waiting, and writing; retain its existing still orb instead of adding Fabric-wide animation loops. No fabricated percentages or throughput.
2. **Compact by default; disclose the detail; keep failures legible.** Tern `frontend/src/view/ui/fold.tsx:18-20` preserves user-controlled folds; `frontend/src/view/tools/shell.tsx:60-100` unfolds failures and gives an error without output in the header. OMP `packages/tui/src/chat/tool-execution.ts:308,852-858` owns explicit expanded state. Dash: a stable 3-line tool tail and descriptive command/path, instant disclosure to existing tree/inspector, visible failure preview and counts.
3. **State identity survives updates.** OMP `packages/coding-agent/src/modes/controllers/event-controller.ts:169-208` records stable streaming tool identities and handles completions outrunning starts. Dash: retain fold choice while streamed parts update, key by turn, no remount per token or detail-mode toggle.
4. **Optimistic echo is not admission.** Tern `frontend/src/turn/serverQueue.ts:21-28,41-49,88-109` distinguishes submitting, admitted and started. Dash already echoes through beginTurn before network send; preserve existing queue/steer and durable draft contracts rather than adding a fake sent tick.
5. **Failure and interruption are separate from success.** Tern `frontend/src/view/tools/shell.tsx:60-74,87-100` gives cancelled and failed outcomes different copy and does not collapse failure evidence. Dash: labeled inline failure/interruption rows with selectable details, no automatic retry and no success-colored interruption dot.
6. **Fast acknowledgement, bounded motion.** OMP spinner cadence is 80 ms, not an animation entrance (`packages/tui/src/components/loader.ts:11-19`). Dash's actual deadlines are its own `app/src/motion.ts:12-18` (press 60/70ms, state 100/150ms); do not copy terminal cadence as mobile easing. Fix web/keyboard press ownership with existing tokens and system reduced-motion; no mount fade/slide, no animated dimensions.
7. **Input focus belongs to the user.** Tern masked prompt chooses the exact field (`frontend/src/prompts/masked.tsx:82`); do not steal focus when data updates. Dash: explicit focus treatment, retain keyboard/draft after submit, disabled semantics without disabling typing.

## Acceptance boundaries
- Preserve Living Night tokens, current nav, handedness and existing rail Latest action.
- Avoid PromptRail.tsx, rail-turns.ts, ContextCard.tsx, attachment-* and annotate/*.
- Unit/typecheck plus rendered before/after at phone widths, normal/reduced motion and proof-mono. Fixture proof is labeled; never call it a real model turn or phone proof.
- No owner phone, physical monitor, service restart, APK install, merge or served-release promotion. Draft main PR goes to parent/turbo for integration and promotion.

## Implemented
- `app/src/lib/turn-feedback.ts`: queued/disconnected/waiting/writing precedence and mixed tool outcome counts.
- `app/src/components/ReplyBlocks.tsx`: 44px pressable fold, descriptive command/path, bounded 4096-character suffix wrapped into three lines; existing Tree/ToolInspector remain available. Inner tree stays mounted and AX-hidden while folded; no timer drives transcript rerenders.
- `app/src/components/MessageRow.tsx`: explicit failure/interruption notices, selectable explanation, truthful live-region progress.
- `app/src/components/Composer.tsx`: stable outline focus treatment (no layout resize), draft-preserving input hint, control-specific press scale.
- `app/src/components/PressScale.tsx`: web pointer/keyboard press lifecycle, explicit disabled semantics and reset. Shared motion tokens and ReduceMotion.System remain in use.
- `app/src/components/Tree.tsx`: remove automatic entry/exit fades; disclosure paints instantly.
- `app/src/debug/controller.ts` and `scripts/ux-polish-proof.mjs`: local-only outcome fixtures and replayable rendered acceptance.
- Storage test owns its AsyncStorage/AppState mocks; baseline full suite had a missing getItem mock.

## Deliberately preserved
Optimistic user echo, durable drafts, queue/steer receipts, existing Latest rail, nav, handedness, voice and bridge contracts. No added progress percentage, loop animation, mount entrance, native dependency, service restart, or release promotion.

Evidence and review live at `/mnt/zer0models/workspace/zer0/data/operations/dash-ux-polish/REPORT.md`. This branch is a review candidate, not phone-qualified production.
