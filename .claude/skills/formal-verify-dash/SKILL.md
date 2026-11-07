---
name: formal-verify-dash
description: Prove Dash's send-path invariants with Bend laws (laws/send S1-S15; laws/release O15) and mutation-test the proofs. Use before merging any change to chat-row gestures (ChatsPane, MainScreen, chat-row-actions), the chat index's host/chatable marking, the phone's send target, the bridge's chat/voice_begin turn admission and rejectTurn, or remote resume (`DASH_REMOTE_HOSTS`, `bridge/src/remote-hosts.ts`); when a bug shows a promise the code makes for every case (a gesture that must never send, a chat that must be sendable, a refusal that must be logged); or when the formal laws CI check is red.
---

# Formal verification for Dash (Bend laws)

Tests check the cases someone wrote down. A Bend law is checked for every case
in its model: every gesture sequence, every menu state, and every combination of
gates. Prose rules in markdown are not enough. If a promise matters, write it as
a law, prove it, and show that the proof catches the bug.

This skill is the formal companion to `verify-dash`, the tester army. The tester
army proves behavior by driving the real app. This skill proves invariants for
all cases of a model that is pinned to the real code. Neither replaces the other.

**A failing proof, a surviving mutant or a moved anchor blocks the merge.** The
`formal laws (Bend proofs + mutants)` job in `.github/workflows/laws.yml` runs on
every PR. Never weaken a law, delete a mutant, or edit an anchor just to get a
PASS.

## Law families in this repo

| dir | laws | what they prove | owner |
| --- | --- | --- | --- |
| `laws/send/` | S1-S15 | send path: long-press never sends; this host's chats (and routed remote chats) are sendable; no silent refusal, local or remote | this skill |
| `laws/release/` | O15 L1-L7 | Dash builds, installs, promotes or merges only with a green tester-army receipt for that exact sha | build gate (PR #456): `check.py` is the gate every release path calls |

`laws.yml` proves and mutation-tests every `laws/*/` that has a `PROOF.bend` and
a `mutations.py`. That includes O15. Run O15 by hand with the
commands in `laws/release/README.md`. Its gate is
`python3 laws/release/check.py --action <install|promote|merge> --sha <sha>`.
Do not duplicate O15 in `laws/send/`.

## The send laws (laws/send)

| law | property, in one sentence | harm if broken |
| --- | --- | --- |
| S1 `longpress_only_opens_menu` | A long-press on a chat row, on either list and in any menu state, only opens the menu. | A long-press sends a message, deletes a chat or navigates (RC3: it sent "Selected chat ..."). |
| S2 `send_needs_feedback_pick` | The only row gesture that sends is picking "feedback" in the menu. | Open or dismiss sends a message. |
| S3 `feedback_off_never_sends` | With in-app feedback off, no gesture sequence on any row sends. | The feedback setting is ignored. |
| S4 `feedback_pick_sends` | When feedback is on, picking "feedback" sends (this keeps S1-S3 from being vacuous). | The feedback feature is dead. |
| S5 `own_install_is_self` | A session that this computer's AgentsView recorded belongs to this host. | Local Claude Code chats show as "Other machine" and are view only (RC3). |
| S6 `chatable_is_self_or_routed` | The index marks a chat chatable only when it belongs to this host, or is a Claude Code or Codex chat on a computer this bridge routes to (`DASH_REMOTE_HOSTS`). | The phone sends to chats on machines the bridge cannot reach, or to harnesses that cannot resume there. |
| S7 `archived_chat_routes` | Every archived chat (`av:<kind>:<session>`) passes the bridge's profile gate. | "Profile routing unavailable" for chats that the index lists as sendable (RC3). |
| S8 `av_profile_own_*`, `av_profile_needs_session` | The bridge admits an `av:` profile only for its own harness and session id. | A turn resumes the wrong session or harness. |
| S9 `no_silent_refusal` | Every chat or voice turn starts, is a duplicate of a live turn, or is refused with a `turn.rejected` log line and an error + done answer. | "The phone can't send" leaves no trace on the host (RC3), or the turn spins forever. |
| S10 `dup_only_for_live_turn` | A turn is dropped as a duplicate only when its id is already live. | Refusals hide behind the duplicate path. |
| S11 `start_only_through_every_gate` | A turn starts only after the host, route, duplicate, speech (voice), harness, availability, cwd and attachment (chat) gates all pass. | An agent starts on a bad cwd, on a duplicate id, or without speech set up. |
| S12 `all_gates_start` | A new turn that passes every gate starts (non-vacuity). | The bridge refuses everything. |
| S13 `no_silent_remote_refusal` | A chat for another computer starts, is a duplicate of a live turn, or is refused with a `turn.rejected` log line and an error + done answer. | Remote resume fails with no trace on the bridge. |
| S14 `remote_start_only_through_gates` | A remote chat starts only after `remoteTurnProblem` is clear, the harness is known and the id is not already live. | An SSH-carried agent starts for a bad session, cwd or profile, or twice. |
| S15 `remote_gates_start` | A new remote chat that passes every gate starts (non-vacuity). | Remote resume is refused for everything. |

### Coverage record

Each model def in `laws/send/send.bend` names the code that it mirrors. In
`laws/send/anchors.py`, each mirrored line is an anchor with an expected count.

| code | model def | laws |
| --- | --- | --- |
| `app/src/screens/panes/ChatsPane.tsx` `longPress`, `closeMenu`, `onMenu` | `g_long`, `g_step`, `g_pick` | S1-S4 |
| `app/src/screens/MainScreen.tsx` `onRowMenu`, `onRowMenuSelect`, `rowMenuOptions`, `onLongPress={feedbackOn ? onRowMenu : undefined}` | `g_long`, `g_pick`, `g_offers` | S1-S4 |
| `app/src/lib/chat-row-actions.ts` `chatRowMenu`, `runChatRowMenu` | `g_offers`, `g_run` | S2-S4 |
| `bridge/index.ts` chat-index `selfMachines`; `bridge/src/agentsview-sessions.ts` `agentsviewMachineId` | `x_self`, `x_install` | S5 |
| `bridge/src/chat-index/agentsview-src.ts` `machineHost`, `avChatRow` (`routed`, `chatable`); `bridge/src/remote-hosts.ts` `REMOTE_HARNESSES` | `x_self`, `x_routed`, `x_chatable`, `x_row_routes` | S5-S7 |
| `bridge/src/chat-index/sidecar.ts` `toSummary`; `app/src/lib/live-sessions.ts` `adoptSummary`; `app/src/net/bridge.ts` `targetForTurn` | `x_row_routes` | S7 |
| `bridge/src/agentsview-sessions.ts` `isSelfArchiveProfile`; `bridge/index.ts` profile gate in `case "chat"` and `case "voice_begin"` | `x_self_archive`, `x_profile_ok` | S7-S8 |
| `bridge/index.ts` `rejectTurn`, `case "chat"`, `case "voice_begin"` | `a_reject`, `a_admit`, `a_tail` | S9-S12 |
| `bridge/index.ts` `case "chat"` `if (remote)` branch; `bridge/src/remote-hosts.ts` `remoteTurnProblem` | `a_remote`, `a_remote_gates` | S13-S15 |

`anchors.py` also scans `case "chat"` and `case "voice_begin"` in
`bridge/index.ts`. Every `return` there must be `return rejectTurn(...)` or the
duplicate-id line.

**Sync commit: `7fa808a`** (the rc3 integration line with remote resume and the
owner's chat fixes). The model was confirmed against the code at this commit. It
builds on `0e145ec` (PR #457, `fix/rc3-send-longpress`, the code that fixed the
three RC3 send bugs). On a base that predates #457, `anchors.py` fails on
purpose: that code breaks S1, S5, S7 and S9. On a base that predates remote
resume, the S6 and S13-S15 anchors fail on purpose. Move the sync commit forward only after you re-read
every model def whose code changed and run `run.sh` green on the new commit.

## Does my change touch the verified code?

```bash
git diff --name-only <base>... -- app/src/screens/panes/ChatsPane.tsx app/src/screens/MainScreen.tsx \
  app/src/lib/chat-row-actions.ts app/src/lib/live-sessions.ts app/src/net/bridge.ts bridge/index.ts \
  bridge/src/agentsview-sessions.ts bridge/src/remote-hosts.ts bridge/src/chat-index/agentsview-src.ts bridge/src/chat-index/sidecar.ts laws/
```

If the output is empty, the laws still hold and CI reruns them anyway. If the
change touches these paths, run the check before you push.

## Run it

Locally, for a quick loop. You need Bend 2.0.34 at `~/.bend/bin/bend` and, for
`--verdict`, Lean `leanprover/lean4:v4.34.0` through elan. `laws.yml` pins both.

```bash
laws/send/run.sh        # anchors, then PROOF.bend --verdict, then 31 mutants; writes laws/send/mutations.json
```

On the heavy build host, which is the canonical place: Bend is fast there and the
heavy slot serializes heavy work. Build trees go on that host's models volume,
never in `~/tmp`, which sits on its root disk. Set `DASH_LAWS_ROOT` to a directory
on that volume. The private z0-hosts entry for the heavy build host names the volume
and its ssh alias (`$HEAVY_HOST` below).

```bash
D="$DASH_LAWS_ROOT/dash-laws-$(git rev-parse --short HEAD)"
rsync -aR --exclude node_modules laws app/src bridge/index.ts bridge/src "$HEAVY_HOST:$D/"
ssh "$HEAVY_HOST" "cd $D && laws/send/run.sh --heavy"   # takes flock -w 7200 ~/tmp/heavy-slot.lock first
```

Green looks like this:

```
anchors: 34 + 2 handler scans, all in place
ALL PROOFS CHECK
reference passes: True; mutations rejected: 31/31
```

## Read a failure

- **`MOVED` or `SILENT` from anchors.** The code changed under the model. Open the
  model def that the line names and read it against the new code.
  - The new code keeps the property, for example after a rename or a refactor:
    update the anchor text, rerun, and move the sync commit.
  - The new code changes the behavior: update the model def to mirror it, then
    run the proofs. If a proof now fails, you have found a real bug. A new bare
    `return` in a turn handler always breaks S9: use `rejectTurn` instead.
- **`SOME PROOFS FAIL`.** Bend names the def and shows the expected and observed
  terms. Decide whether this is a bug in the code or an error in the model:
  1. Compare the failing model def with the code at its anchor. A def that does
     not say what the code does is a modeling error, so fix `send.bend`.
  2. Run the matching witness from `mutations.py` against your `send.bend`. It is
     a concrete instance of the law. If it prints `False{}`, the law really is
     false: that is a finding, and you report it as steps in the code's words,
     like the `counterexample` lines.
  3. A law that is true but whose proof no longer fits is a proof gap. Fix
     `PROOF.bend` and leave `LAWS.bend` alone.
- **`SURVIVED` mutant.** A law no longer bites on that bug. Strengthen the law or
  the proof. Never delete the mutant.

## Add or update a law

Add a law when a bug or a review shows a promise that the code makes for every
case. Examples: a gesture that must never send, a chat that must be reachable, a
refusal that must leave a trace, a gate that every path must pass. Update a law
only when the intended behavior changes, and say so in the PR.

1. Model: in `laws/send/send.bend` (or a new `laws/<area>/<area>.bend`), add the
   smallest def that mirrors the real code path. Put a comment above it that
   names the file and function. Give constructors a unique prefix, because Bend
   constructor names are global.
2. Law: state it in `LAWS.bend` with a one-line comment that gives the property
   and the harm.
3. Proof: write it in `PROOF.bend` (`def Laws.<law>(...)`). Pitfalls in Bend
   2.0.34: match parameters in binder order, and pass to a helper def before you
   match a field after a parameter. Mark a parameter that you use twice with
   `+`. `match` cannot take a computed value.
4. Mutants: in `mutations.py`, add one entry per way the code could break the
   law, with a witness (a Bool instance of the law) and a counterexample in the
   code's words. Tag mutants that replay a real old bug with the PR that fixed it.
5. Anchors: in `anchors.py`, add the exact code line that each new def mirrors,
   with its expected count.
6. Run `laws/send/run.sh --heavy` on the heavy build host. Commit `mutations.json` from a green
   run, and add the law to the tables above.

A new family under `laws/<area>/` needs `<area>.bend`, `LAWS.bend`, `PROOF.bend`
and `mutations.py`, plus `anchors.py` if it models app or bridge code. `laws.yml`
picks it up without changes.

## Scope: what a PASS does not cover

- The model is written by hand. `anchors.py` checks that the mirrored lines still
  exist and that the turn handlers have no bare `return`. It does not prove that
  TypeScript computes the same function as the model.
- Names (machines, harness ids, session ids) are Nat equality classes. The
  hostname lowercasing and short-name folding in `machineHost` sit outside the
  model, as does the `"local"` alias.
- The menu sheet is assumed to emit only the ids it lists. `isSelfHost(self.id)`
  is assumed true for the id that `toSummary` hands out.
- Remote resume is two booleans and a list: `rh` (the harness resumes over ACP on
  the other computer), the `routable` machine names, and `ok` (all of
  `remoteTurnProblem` in one boolean). The dispatch between the local and the
  remote branch of `case "chat"` (`remoteHostFor`) and the SSH transport are
  outside the model; the other computer's own adapter checks the session and the
  directory.
- Hermes-session and OMP-live routing are one `route` boolean. Only the `av:`
  profile path is modeled in detail. Hermes chat sendability is covered only by
  S9: when such a chat is refused, the bridge logs and answers.
- The model has no timing, no concurrency and no socket state. A send that the
  bridge accepts can still fail later inside the harness. The tester army covers
  that.
