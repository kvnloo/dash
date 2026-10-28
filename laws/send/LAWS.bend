# Dash send path: the laws. PROOF.bend proves them; `bend PROOF.bend --verdict`
# checks. Do not weaken a law to get a PASS: a failing law is a finding.
#
# Scope: theorems about send.bend, which mirrors the code paths named in it.
# laws/send/anchors.py checks that those code paths still read as modeled.

import Base
import ./send.bend as S

# Boolean reflection: T(b) is Unit when b holds, Empty when it does not.
def T(b: Bool) -> Data:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

# ---------------------------------------------------------------------------
# S1-S4. A long-press never sends (the RC3 bug: long-press on a chat row
# created a "Dash feedback" chat and SENT a message).
# ---------------------------------------------------------------------------

# S1. A long-press on a chat row, on either list, in any menu state, has no
# effect but opening the menu: it never sends, deletes or navigates.
law longpress_only_opens_menu:
  for s: S.GSurface
  for fb: Bool
  for m: S.GMenu
  {S.g_eff(S.g_step(s, fb, m, S.GLongPress{})) == S.GNothing{} : S.GEffect}

# S2. The only gesture that sends is picking "feedback" in the row menu.
law send_needs_feedback_pick:
  for s: S.GSurface
  for fb: Bool
  for m: S.GMenu
  for g: S.GGesture
  for w: T(S.g_is_send(S.g_eff(S.g_step(s, fb, m, g))))
  {g == S.GPick{S.GFeedback{}} : S.GGesture}

# S3. With in-app feedback off, no sequence of gestures on any chat row sends.
law feedback_off_never_sends:
  for s: S.GSurface
  for gs: List<&2, S.GGesture>
  for w: T(S.g_any(gs, s, False{}, S.GClosed{}))
  Empty

# S4. Not vacuous: picking "feedback" from an open menu (feedback on) sends.
law feedback_pick_sends:
  for s: S.GSurface
  T(S.g_is_send(S.g_eff(S.g_step(s, True{}, S.GShown{}, S.GPick{S.GFeedback{}}))))

# ---------------------------------------------------------------------------
# S5-S8. A chat on this host is sendable (the RC3 bugs: AgentsView's install id
# was not a self machine, so local chats were view-only; and the bridge
# refused `av:` profiles).
# ---------------------------------------------------------------------------

# S5. A session this computer's AgentsView recorded is this host's.
law own_install_is_self:
  for i: Nat
  for host: Nat
  for extra: List<&2, Nat>
  T(S.x_self(i, host, Some{i}, extra))

# S6. The index marks a chat chatable only when it is this host's, or when it
# is a Claude Code or Codex chat recorded on a computer this bridge is
# configured to carry turns to (DASH_REMOTE_HOSTS). Every other machine's
# chats stay view only.
law chatable_is_self_or_routed:
  for catalog: Bool
  for machine: Nat
  for host: Nat
  for inst: Maybe<&2, Nat>
  for extra: List<&2, Nat>
  for rh: Bool
  for routable: List<&2, Nat>
  for w: T(S.x_chatable(catalog, machine, host, inst, extra, rh, routable))
  T(Bool.or(S.x_self(machine, host, inst, extra), Bool.and(rh, S.x_mem(machine, routable))))

# S7. Every archived chat the phone sends to (profile av:<kind>:<session>)
# passes the bridge's profile gate.
law archived_chat_routes:
  for kind: Nat
  for sid: Nat
  T(S.x_row_routes(kind, sid))

# S8. The bridge admits an av: profile only for its own harness and session.
law av_profile_own_harness:
  for k: Nat
  for s: Nat
  for h: Nat
  for hermes: Bool
  for q: Nat
  for w: T(S.x_profile_ok(S.XAvProfile{k, s}, h, hermes, Some{q}))
  {k == h : Nat}

law av_profile_own_session:
  for k: Nat
  for s: Nat
  for h: Nat
  for hermes: Bool
  for q: Nat
  for w: T(S.x_profile_ok(S.XAvProfile{k, s}, h, hermes, Some{q}))
  {s == q : Nat}

law av_profile_needs_session:
  for k: Nat
  for s: Nat
  for h: Nat
  for hermes: Bool
  for w: T(S.x_profile_ok(S.XAvProfile{k, s}, h, hermes, None{}))
  Empty

# ---------------------------------------------------------------------------
# S9-S12. No turn is refused in silence (the RC3 bug: a refused turn left no
# trace on the host, so "the phone can't send" was undiagnosable).
# ---------------------------------------------------------------------------

# S9. Every chat or voice turn the bridge receives is started, is a duplicate
# of a live turn, or is refused with a turn.rejected log line AND an
# error + done answer to the phone.
law no_silent_refusal:
  for k: S.AKind
  for me: Bool
  for route: Bool
  for dup: Bool
  for speech: Bool
  for known: Bool
  for avail: Bool
  for cwd: Bool
  for att: Bool
  T(S.a_accounted(S.a_admit(k, me, route, dup, speech, known, avail, cwd, att)))

# S10. "Duplicate" is never an excuse: only an id that is already live is one.
law dup_only_for_live_turn:
  for k: S.AKind
  for me: Bool
  for route: Bool
  for dup: Bool
  for speech: Bool
  for known: Bool
  for avail: Bool
  for cwd: Bool
  for att: Bool
  for w: T(S.a_is_dup(S.a_admit(k, me, route, dup, speech, known, avail, cwd, att)))
  {dup == True{} : Bool}

# S11. A turn starts only after every gate passed.
law start_only_through_every_gate:
  for k: S.AKind
  for me: Bool
  for route: Bool
  for dup: Bool
  for speech: Bool
  for known: Bool
  for avail: Bool
  for cwd: Bool
  for att: Bool
  for w: T(S.a_is_start(S.a_admit(k, me, route, dup, speech, known, avail, cwd, att)))
  T(S.a_gates(k, me, route, dup, speech, known, avail, cwd, att))

# S12. Not vacuous: a new turn that passes every gate starts.
law all_gates_start:
  for k: S.AKind
  T(S.a_is_start(S.a_admit(k, True{}, True{}, False{}, True{}, True{}, True{}, True{}, True{})))

# ---------------------------------------------------------------------------
# S13-S15. A chat resumed on another computer (remote resume) is held to the
# same standard as a local one: it is never refused in silence, and it starts
# only after the route, harness and duplicate gates.
# ---------------------------------------------------------------------------

# S13. A chat for another computer is started, a duplicate of a live turn, or
# refused with a turn.rejected log line AND an error + done answer.
law no_silent_remote_refusal:
  for ok: Bool
  for known: Bool
  for dup: Bool
  T(S.a_accounted(S.a_remote(ok, known, dup)))

# S14. A chat for another computer starts only after remoteTurnProblem is
# clear, the harness is known and the id is not already live.
law remote_start_only_through_gates:
  for ok: Bool
  for known: Bool
  for dup: Bool
  for w: T(S.a_is_start(S.a_remote(ok, known, dup)))
  T(S.a_remote_gates(ok, known, dup))

# S15. Not vacuous: a new remote chat that passes every gate starts.
law remote_gates_start:
  T(S.a_is_start(S.a_remote(True{}, True{}, False{})))
