# Dash send path: the proofs of LAWS.bend (hand-written; no generator).

import Base
import ./send.bend as S
import ./LAWS.bend as Laws

# Proof kit (same lemmas as laws/release and the ops plane)
# --------------------------------------------------------

def and_l(+a: Bool, -b: Bool, w: Laws.T(Bool.and(a, b))) -> Laws.T(a):
  match a:
    case True{}:
      Unit{}
    case False{}:
      Empty.absurd(Laws.T(False{}), w)

def and_r(a: Bool, -b: Bool, w: Laws.T(Bool.and(a, b))) -> Laws.T(b):
  match a:
    case True{}:
      w
    case False{}:
      Empty.absurd(Laws.T(b), w)

def and_i(a: Bool, -b: Bool, ta: Laws.T(a), tb: Laws.T(b)) -> Laws.T(Bool.and(a, b)):
  match a:
    case True{}:
      tb
    case False{}:
      Empty.absurd(Laws.T(Bool.and(False{}, b)), ta)

def or_l(a: Bool, -b: Bool, ta: Laws.T(a)) -> Laws.T(Bool.or(a, b)):
  match a:
    case True{}:
      Unit{}
    case False{}:
      Empty.absurd(Laws.T(Bool.or(False{}, b)), ta)

def or_r(a: Bool, -b: Bool, tb: Laws.T(b)) -> Laws.T(Bool.or(a, b)):
  match a:
    case True{}:
      Unit{}
    case False{}:
      tb

def eq_sound(a: Nat, b: Nat, w: Laws.T(Nat.is_eq(a, b))) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      Empty.absurd({0n == 1n+q : Nat}, w)
    case 1n+p 0n:
      Empty.absurd({1n+p == 0n : Nat}, w)
    case 1n+p 1n+q:
      %eq_sound(p, q, w) : {1n+p == 1n+_ : Nat}
      {==}

def eq_refl(n: Nat) -> Laws.T(Nat.is_eq(n, n)):
  match n:
    case 0n:
      Unit{}
    case 1n+p:
      eq_refl(p)

# S1
def Laws.longpress_only_opens_menu(s, fb, m):
  match s:
    case S.GChats{}:
      {==}
    case S.GSearch{}:
      match fb:
        case True{}:
          {==}
        case False{}:
          {==}

# S2
def long_no_send(s: S.GSurface, fb: Bool, -m: S.GMenu, w: Laws.T(S.g_is_send(S.g_eff(S.g_long(s, fb, m))))) -> Empty:
  match s:
    case S.GChats{}:
      w
    case S.GSearch{}:
      match fb:
        case True{}:
          w
        case False{}:
          w

def if_send(ok: Bool, -e: S.GEffect, w: Laws.T(S.g_is_send(S.g_if(ok, e)))) -> Laws.T(S.g_is_send(e)):
  match ok:
    case True{}:
      w
    case False{}:
      Empty.absurd(Laws.T(S.g_is_send(e)), w)

def run_send(c: S.GChoice, s: S.GSurface, w: Laws.T(S.g_is_send(S.g_run(c, s)))) -> {c == S.GFeedback{} : S.GChoice}:
  match c:
    case S.GOpen{}:
      Empty.absurd({S.GOpen{} == S.GFeedback{} : S.GChoice}, w)
    case S.GFeedback{}:
      {==}
    case S.GDelete{}:
      match s:
        case S.GChats{}:
          Empty.absurd({S.GDelete{} == S.GFeedback{} : S.GChoice}, w)
        case S.GSearch{}:
          Empty.absurd({S.GDelete{} == S.GFeedback{} : S.GChoice}, w)

def pick_send(+s: S.GSurface, fb: Bool, m: S.GMenu, +c: S.GChoice, w: Laws.T(S.g_is_send(S.g_eff(S.g_pick(s, fb, m, c))))) -> {c == S.GFeedback{} : S.GChoice}:
  match m:
    case S.GClosed{}:
      Empty.absurd({c == S.GFeedback{} : S.GChoice}, w)
    case S.GShown{}:
      run_send(c, s, if_send(S.g_offers(s, fb, c), S.g_run(c, s), w))

def Laws.send_needs_feedback_pick(s, fb, m, g, w):
  match g:
    case S.GTap{}:
      Empty.absurd({S.GTap{} == S.GPick{S.GFeedback{}} : S.GGesture}, w)
    case S.GLongPress{}:
      Empty.absurd({S.GLongPress{} == S.GPick{S.GFeedback{}} : S.GGesture}, long_no_send(s, fb, m, w))
    case S.GPick{c}:
      %pick_send(s, fb, m, c, w) : {S.GPick{c} == S.GPick{_} : S.GGesture}
      {==}
    case S.GDismiss{}:
      Empty.absurd({S.GDismiss{} == S.GPick{S.GFeedback{}} : S.GGesture}, w)

# S3: Chats with feedback off never offers "feedback", in any menu state;
# search with feedback off never opens its menu, so it stays closed.
def chats_step(m: S.GMenu, x: S.GGesture, -xs: List<&2, S.GGesture>, w: Laws.T(Bool.or(S.g_is_send(S.g_eff(S.g_step(S.GChats{}, False{}, m, x))), S.g_any(xs, S.GChats{}, False{}, S.g_menu(S.g_step(S.GChats{}, False{}, m, x))))), rec: @m2: S.GMenu -> Laws.T(S.g_any(xs, S.GChats{}, False{}, m2)) -> Empty) -> Empty:
  match m:
    case S.GClosed{}:
      match x:
        case S.GTap{}:
          rec(S.GClosed{}, w)
        case S.GLongPress{}:
          rec(S.GShown{}, w)
        case S.GPick{ch}:
          rec(S.GClosed{}, w)
        case S.GDismiss{}:
          rec(S.GClosed{}, w)
    case S.GShown{}:
      match x:
        case S.GTap{}:
          rec(S.GShown{}, w)
        case S.GLongPress{}:
          rec(S.GShown{}, w)
        case S.GPick{ch}:
          match ch:
            case S.GOpen{}:
              rec(S.GClosed{}, w)
            case S.GFeedback{}:
              rec(S.GClosed{}, w)
            case S.GDelete{}:
              rec(S.GClosed{}, w)
        case S.GDismiss{}:
          rec(S.GClosed{}, w)

def chats_off(gs: List<&2, S.GGesture>, m: S.GMenu, w: Laws.T(S.g_any(gs, S.GChats{}, False{}, m))) -> Empty:
  match gs:
    case Nil{}:
      w
    case x <> xs:
      chats_step(m, x, xs, w, m2 => w2 => chats_off(xs, m2, w2))

def search_off(gs: List<&2, S.GGesture>, w: Laws.T(S.g_any(gs, S.GSearch{}, False{}, S.GClosed{}))) -> Empty:
  match gs:
    case Nil{}:
      w
    case x <> xs:
      match x:
        case S.GTap{}:
          search_off(xs, w)
        case S.GLongPress{}:
          search_off(xs, w)
        case S.GPick{ch}:
          search_off(xs, w)
        case S.GDismiss{}:
          search_off(xs, w)

def Laws.feedback_off_never_sends(s, gs, w):
  match s:
    case S.GChats{}:
      chats_off(gs, S.GClosed{}, w)
    case S.GSearch{}:
      search_off(gs, w)

# S4
def Laws.feedback_pick_sends(s):
  match s:
    case S.GChats{}:
      Unit{}
    case S.GSearch{}:
      Unit{}

# S5
def own_self(+i: Nat, host: Nat, -extra: List<&2, Nat>) -> Laws.T(S.x_self(i, host, Some{i}, extra)):
  or_r(Nat.is_eq(i, host), Bool.or(Nat.is_eq(i, i), S.x_mem(i, extra)), or_l(Nat.is_eq(i, i), S.x_mem(i, extra), eq_refl(i)))

def Laws.own_install_is_self(i, host, extra):
  own_self(i, host, extra)

# S6
# chatable = catalog && (self || (!self && rh && mem)); on self the answer is
# the left branch, off self the `!self` conjunct is True and drops away.
def routed_cases(+s: Bool, -rh: Bool, -mem: Bool, w: Laws.T(Bool.or(s, Bool.and(Bool.not(s), Bool.and(rh, mem))))) -> Laws.T(Bool.or(s, Bool.and(rh, mem))):
  match s:
    case True{}:
      Unit{}
    case False{}:
      w

def Laws.chatable_is_self_or_routed(catalog, machine, host, inst, extra, rh, routable, w):
  routed_cases(S.x_self(machine, host, inst, extra), rh, S.x_mem(machine, routable), and_r(catalog, Bool.or(S.x_self(machine, host, inst, extra), S.x_routed(S.x_self(machine, host, inst, extra), rh, machine, routable)), w))

# S7
def routes(+kind: Nat, +sid: Nat) -> Laws.T(S.x_row_routes(kind, sid)):
  and_i(Nat.is_eq(kind, kind), Nat.is_eq(sid, sid), eq_refl(kind), eq_refl(sid))

def Laws.archived_chat_routes(kind, sid):
  routes(kind, sid)

# S8
def av_harness(+k: Nat, -s: Nat, +h: Nat, -q: Nat, w: Laws.T(Bool.and(Nat.is_eq(k, h), Nat.is_eq(s, q)))) -> {k == h : Nat}:
  eq_sound(k, h, and_l(Nat.is_eq(k, h), Nat.is_eq(s, q), w))

def av_session(k: Nat, +s: Nat, h: Nat, +q: Nat, w: Laws.T(Bool.and(Nat.is_eq(k, h), Nat.is_eq(s, q)))) -> {s == q : Nat}:
  eq_sound(s, q, and_r(Nat.is_eq(k, h), Nat.is_eq(s, q), w))

def Laws.av_profile_own_harness(k, s, h, hermes, q, w):
  av_harness(k, s, h, q, w)

def Laws.av_profile_own_session(k, s, h, hermes, q, w):
  av_session(k, s, h, q, w)

def Laws.av_profile_needs_session(k, s, h, hermes, w):
  w

# S9
def tail_accounted(k: S.AKind, speech: Bool, known: Bool, avail: Bool, cwd: Bool, att: Bool) -> Laws.T(S.a_accounted(S.a_tail(k, speech, known, avail, cwd, att))):
  match k:
    case S.AChat{}:
      match known:
        case False{}:
          Unit{}
        case True{}:
          match avail:
            case False{}:
              Unit{}
            case True{}:
              match cwd:
                case False{}:
                  Unit{}
                case True{}:
                  match att:
                    case False{}:
                      Unit{}
                    case True{}:
                      Unit{}
    case S.AVoice{}:
      match speech:
        case False{}:
          Unit{}
        case True{}:
          match known:
            case False{}:
              Unit{}
            case True{}:
              match avail:
                case False{}:
                  Unit{}
                case True{}:
                  match cwd:
                    case False{}:
                      Unit{}
                    case True{}:
                      Unit{}

def Laws.no_silent_refusal(k, me, route, dup, speech, known, avail, cwd, att):
  match me:
    case False{}:
      Unit{}
    case True{}:
      match route:
        case False{}:
          Unit{}
        case True{}:
          match dup:
            case True{}:
              Unit{}
            case False{}:
              tail_accounted(k, speech, known, avail, cwd, att)

# S10
def tail_not_dup(k: S.AKind, speech: Bool, known: Bool, avail: Bool, cwd: Bool, att: Bool, w: Laws.T(S.a_is_dup(S.a_tail(k, speech, known, avail, cwd, att)))) -> Empty:
  match k:
    case S.AChat{}:
      match known:
        case False{}:
          w
        case True{}:
          match avail:
            case False{}:
              w
            case True{}:
              match cwd:
                case False{}:
                  w
                case True{}:
                  match att:
                    case False{}:
                      w
                    case True{}:
                      w
    case S.AVoice{}:
      match speech:
        case False{}:
          w
        case True{}:
          match known:
            case False{}:
              w
            case True{}:
              match avail:
                case False{}:
                  w
                case True{}:
                  match cwd:
                    case False{}:
                      w
                    case True{}:
                      w

def Laws.dup_only_for_live_turn(k, me, route, dup, speech, known, avail, cwd, att, w):
  match me:
    case False{}:
      Empty.absurd({dup == True{} : Bool}, w)
    case True{}:
      match route:
        case False{}:
          Empty.absurd({dup == True{} : Bool}, w)
        case True{}:
          match dup:
            case True{}:
              {==}
            case False{}:
              Empty.absurd({False{} == True{} : Bool}, tail_not_dup(k, speech, known, avail, cwd, att, w))

# S11
def Laws.start_only_through_every_gate(k, me, route, dup, speech, known, avail, cwd, att, w):
  match k:
    case S.AChat{}:
      match me:
        case False{}:
          w
        case True{}:
          match route:
            case False{}:
              w
            case True{}:
              match dup:
                case True{}:
                  w
                case False{}:
                  match known:
                    case False{}:
                      w
                    case True{}:
                      match avail:
                        case False{}:
                          w
                        case True{}:
                          match cwd:
                            case False{}:
                              w
                            case True{}:
                              match att:
                                case False{}:
                                  w
                                case True{}:
                                  Unit{}
    case S.AVoice{}:
      match me:
        case False{}:
          w
        case True{}:
          match route:
            case False{}:
              w
            case True{}:
              match dup:
                case True{}:
                  w
                case False{}:
                  match speech:
                    case False{}:
                      w
                    case True{}:
                      match known:
                        case False{}:
                          w
                        case True{}:
                          match avail:
                            case False{}:
                              w
                            case True{}:
                              match cwd:
                                case False{}:
                                  w
                                case True{}:
                                  Unit{}

# S12
def Laws.all_gates_start(k):
  match k:
    case S.AChat{}:
      Unit{}
    case S.AVoice{}:
      Unit{}

# S13
def Laws.no_silent_remote_refusal(ok, known, dup):
  match ok:
    case False{}:
      Unit{}
    case True{}:
      match known:
        case False{}:
          Unit{}
        case True{}:
          match dup:
            case True{}:
              Unit{}
            case False{}:
              Unit{}

# S14
def Laws.remote_start_only_through_gates(ok, known, dup, w):
  match ok:
    case False{}:
      w
    case True{}:
      match known:
        case False{}:
          w
        case True{}:
          match dup:
            case True{}:
              w
            case False{}:
              Unit{}

# S15
def Laws.remote_gates_start():
  Unit{}
