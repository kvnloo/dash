# Dash send path: the decisions that decide whether a message leaves the phone
# and whether the bridge starts, refuses or drops a turn.
#
# Each def below mirrors one real code path (file and function named above it).
# The laws in LAWS.bend are theorems about these defs; PROOF.bend proves them;
# mutations.py breaks one def at a time and requires a proof to fail.
# laws/send/anchors.py pins the source lines each def mirrors, so a change to
# the real code fails CI until someone re-reads this model.
#
# Constructor names are global in Bend: G = chat-row gestures, X = chat index,
# A = bridge admission.

import Base

# ---------------------------------------------------------------------------
# G. Chat-row gestures
#    app/src/screens/panes/ChatsPane.tsx   (Chats list: longPress, onMenu)
#    app/src/screens/MainScreen.tsx        (search results: onRowMenu, onRowMenuSelect)
#    app/src/lib/chat-row-actions.ts       (chatRowMenu, runChatRowMenu)
# ---------------------------------------------------------------------------

type GSurface is Data:
  GChats{}
  GSearch{}

# Menu ids: "open", "feedback", "delete".
type GChoice is Data:
  GOpen{}
  GFeedback{}
  GDelete{}

type GGesture is Data:
  GTap{}
  GLongPress{}
  GPick{c: GChoice}
  GDismiss{}

# The row menu (BottomActionSheet open = menuFor / rowMenu !== null).
type GMenu is Data:
  GClosed{}
  GShown{}

# What a gesture does outside the menu. GSend is any path that sends a message
# (in-app feedback creates a "Dash feedback" chat and sends to the agent).
type GEffect is Data:
  GNothing{}
  GNavigate{}
  GSend{}
  GRemove{}

type GOut is Data:
  GStep{menu: GMenu, eff: GEffect}

def g_is_send(e: GEffect) -> Bool:
  match e:
    case GSend{}:
      True{}
    case _:
      False{}

def g_eff(o: GOut) -> GEffect:
  match o:
    case GStep{menu, eff}:
      eff

def g_menu(o: GOut) -> GMenu:
  match o:
    case GStep{menu, eff}:
      menu

# Which ids the sheet lists. The sheet emits only listed ids.
#   chatRowMenu: open, feedback only when feedbackOn, delete.
#   MainScreen rowMenuOptions: open, feedback (no delete).
def g_offers(s: GSurface, fb: Bool, c: GChoice) -> Bool:
  match s:
    case GChats{}:
      match c:
        case GOpen{}:
          True{}
        case GFeedback{}:
          fb
        case GDelete{}:
          True{}
    case GSearch{}:
      match c:
        case GOpen{}:
          True{}
        case GFeedback{}:
          True{}
        case GDelete{}:
          False{}

# runChatRowMenu (Chats) and onRowMenuSelect (search): one explicit choice.
#   open -> open(id) / onRow(model); feedback -> onFeedback / onFeedbackRow (sends);
#   delete -> remove(id) on Chats; search has no delete branch: nothing.
def g_run(c: GChoice, s: GSurface) -> GEffect:
  match c:
    case GOpen{}:
      GNavigate{}
    case GFeedback{}:
      GSend{}
    case GDelete{}:
      match s:
        case GChats{}:
          GRemove{}
        case GSearch{}:
          GNothing{}

def g_if(ok: Bool, e: GEffect) -> GEffect:
  match ok:
    case True{}:
      e
    case False{}:
      GNothing{}

# Long-press. Chats: longPress = haptic.select(); setMenuFor(id).
# Search: onLongPress={feedbackOn ? onRowMenu : undefined}.
def g_long(s: GSurface, fb: Bool, m: GMenu) -> GOut:
  match s:
    case GChats{}:
      GStep{GShown{}, GNothing{}}
    case GSearch{}:
      match fb:
        case True{}:
          GStep{GShown{}, GNothing{}}
        case False{}:
          GStep{m, GNothing{}}

# A pick closes the menu first (setMenuFor(null) / setRowMenu(null)), then runs
# the choice. With no menu shown there is nothing to pick.
def g_pick(+s: GSurface, fb: Bool, m: GMenu, +c: GChoice) -> GOut:
  match m:
    case GClosed{}:
      GStep{GClosed{}, GNothing{}}
    case GShown{}:
      GStep{GClosed{}, g_if(g_offers(s, fb, c), g_run(c, s))}

# One gesture on a chat row. Tap: pressRow -> open (Chats) / onRow (search).
# Dismiss: closeMenu / closeRowMenu.
def g_step(s: GSurface, fb: Bool, m: GMenu, g: GGesture) -> GOut:
  match g:
    case GTap{}:
      GStep{m, GNavigate{}}
    case GLongPress{}:
      g_long(s, fb, m)
    case GPick{c}:
      g_pick(s, fb, m, c)
    case GDismiss{}:
      GStep{GClosed{}, GNothing{}}

# Did any gesture in the sequence send? (the list shrinks first, for termination)
def g_any(gs: List<&2, GGesture>, +s: GSurface, +fb: Bool, m: GMenu) -> Bool:
  match gs:
    case Nil{}:
      False{}
    case g <> t:
      +o = g_step(s, fb, m, g)
      Bool.or(g_is_send(g_eff(o)), g_any(t, s, fb, g_menu(o)))

# ---------------------------------------------------------------------------
# X. Chat index -> phone -> bridge routing, for archived (AgentsView) chats
#    bridge/src/chat-index/agentsview-src.ts  (selfMachines, machineHost, avChatRow)
#    bridge/index.ts                          (selfMachines config, agentsviewMachineId)
#    bridge/src/chat-index/worker.ts          (toSummary: @self -> self id)
#    app/src/lib/live-sessions.ts             (adoptSummary: profileId = agentId)
#    app/src/net/bridge.ts                    (sendChat / targetForTurn)
#    bridge/src/agentsview-sessions.ts        (isSelfArchiveProfile)
# Names (machines, harness ids, session ids) are Nat: equal names, equal Nats.
# ---------------------------------------------------------------------------

def x_mem(+n: Nat, xs: List<&2, Nat>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(Nat.is_eq(n, h), x_mem(n, t))

# agentsviewMachineId(): the install id, or undefined when unreadable.
def x_install(n: Nat, inst: Maybe<&2, Nat>) -> Bool:
  match inst:
    case None{}:
      False{}
    case Some{i}:
      Nat.is_eq(n, i)

# selfMachines: [HOST_NAME, agentsviewMachineId(), ...DASH_CHAT_SELF_MACHINES]
# (plus "local", "" and the short hostname, folded into `extra` here).
def x_self(+machine: Nat, host: Nat, inst: Maybe<&2, Nat>, extra: List<&2, Nat>) -> Bool:
  Bool.or(Nat.is_eq(machine, host), Bool.or(x_install(machine, inst), x_mem(machine, extra)))

# avChatRow: routed = host_id !== SELF_HOST && REMOTE_HARNESSES.includes(agent)
#   && self.routable.has(machine). `routable` is DASH_REMOTE_HOSTS (selfMachines'
#   third argument): the other computers this bridge carries Claude Code and
#   Codex turns to over SSH (bridge/src/remote-hosts.ts). rh: the agent is one of
#   REMOTE_HARNESSES.
def x_routed(self: Bool, rh: Bool, machine: Nat, routable: List<&2, Nat>) -> Bool:
  Bool.and(Bool.not(self), Bool.and(rh, x_mem(machine, routable)))

# avChatRow: chatable = isCatalogHarness(agent) && (host_id === SELF_HOST || routed).
def x_chat_or_routed(+self: Bool, catalog: Bool, rh: Bool, machine: Nat, routable: List<&2, Nat>) -> Bool:
  Bool.and(catalog, Bool.or(self, x_routed(self, rh, machine, routable)))

def x_chatable(catalog: Bool, +machine: Nat, host: Nat, inst: Maybe<&2, Nat>, extra: List<&2, Nat>, rh: Bool, routable: List<&2, Nat>) -> Bool:
  x_chat_or_routed(x_self(machine, host, inst, extra), catalog, rh, machine, routable)

# The profileId the phone sends for a chat (Conversation.profileId).
#   AvProfile{k, s}  `av:<k>:<s>`: adoptSummary sets profileId = agentId,
#                    and avChatRow sets agent_id = `av:<agent>:<sessionId>`.
type XProfile is Data:
  XNoProfile{}
  XDefault{}
  XHarnessP{h: Nat}
  XAvProfile{k: Nat, s: Nat}
  XHermesDefault{}
  XOther{}

# The bridge's profile gate (bridge/index.ts, case "chat" and "voice_begin",
# the branch after hermes-session and omp-live routing):
#   !profileId || profileId === DASH_PROFILE_ID || profileId === `harness:${harness}`
#   || isSelfArchiveProfile(profileId, harness, sessionId)
#   || (harness === "hermes" && profileId === "hermes:default")
# hermes: whether harness is "hermes". sid: the message's sessionId.
def x_self_archive(k: Nat, s: Nat, h: Nat, sid: Maybe<&2, Nat>) -> Bool:
  match sid:
    case None{}:
      False{}
    case Some{q}:
      Bool.and(Nat.is_eq(k, h), Nat.is_eq(s, q))

def x_profile_ok(p: XProfile, h: Nat, hermes: Bool, sid: Maybe<&2, Nat>) -> Bool:
  match p:
    case XNoProfile{}:
      True{}
    case XDefault{}:
      True{}
    case XHarnessP{ph}:
      Nat.is_eq(ph, h)
    case XAvProfile{k, s}:
      x_self_archive(k, s, h, sid)
    case XHermesDefault{}:
      hermes
    case XOther{}:
      False{}

# The message an archived chat row becomes on the phone, checked by the bridge:
# harness = kind, sessionId = session_id, profileId = av:<kind>:<session_id>.
# Archived rows are never hermes (OWNER_FILTER: agent <> 'hermes') and their
# profileId never starts with "omp:", so they reach the profile gate.
def x_row_routes(+kind: Nat, +sid: Nat) -> Bool:
  x_profile_ok(XAvProfile{kind, sid}, kind, False{}, Some{sid})

# ---------------------------------------------------------------------------
# A. Bridge admission of one turn: bridge/index.ts message(), case "chat"
#    and case "voice_begin", and rejectTurn().
# ---------------------------------------------------------------------------

type AKind is Data:
  AChat{}
  AVoice{}

# What the bridge did with the turn.
#   AStarted  a Turn was created and started (or the utterance registered)
#   ADup      the id is already a live turn (turns.has / utterances.has): the
#             existing turn keeps streaming, nothing new starts
#   ARefused  rejectTurn ran: logged says log("turn.rejected"), answered says
#             the phone got error + done
#   ASilent   the handler returned with no log line and no answer
type AOut is Data:
  AStarted{}
  ADup{}
  ARefused{logged: Bool, answered: Bool}
  ASilent{}

# rejectTurn(ws, id, message): log("turn.rejected") then error + done.
def a_reject() -> AOut:
  ARefused{True{}, True{}}

# Inputs, in the order the handler checks them:
#   me     isSelfHost(message.hostId)
#   route  hermes target / omp live session / profile gate (x_profile_ok)
#   dup    turns.has(id) (chat) or turns.has(id) || utterances.has(id) (voice)
#   speech speechAvailable().ok (voice only)
#   known  HARNESSES.find(harness)
#   avail  harnessList()...available
#   cwd    isDirectory(cwd)
#   att    attachments.claim did not throw (chat only)
def a_tail(k: AKind, speech: Bool, known: Bool, avail: Bool, cwd: Bool, att: Bool) -> AOut:
  match k:
    case AChat{}:
      match known:
        case False{}:
          a_reject()
        case True{}:
          match avail:
            case False{}:
              a_reject()
            case True{}:
              match cwd:
                case False{}:
                  a_reject()
                case True{}:
                  match att:
                    case False{}:
                      a_reject()
                    case True{}:
                      AStarted{}
    case AVoice{}:
      match speech:
        case False{}:
          a_reject()
        case True{}:
          match known:
            case False{}:
              a_reject()
            case True{}:
              match avail:
                case False{}:
                  a_reject()
                case True{}:
                  match cwd:
                    case False{}:
                      a_reject()
                    case True{}:
                      AStarted{}

def a_admit(k: AKind, me: Bool, route: Bool, dup: Bool, speech: Bool, known: Bool, avail: Bool, cwd: Bool, att: Bool) -> AOut:
  match me:
    case False{}:
      a_reject()
    case True{}:
      match route:
        case False{}:
          a_reject()
        case True{}:
          match dup:
            case True{}:
              ADup{}
            case False{}:
              a_tail(k, speech, known, avail, cwd, att)

# Accounted for: started, a duplicate of a live turn, or refused with a log
# line AND an answer to the phone.
def a_accounted(o: AOut) -> Bool:
  match o:
    case AStarted{}:
      True{}
    case ADup{}:
      True{}
    case ARefused{logged, answered}:
      Bool.and(logged, answered)
    case ASilent{}:
      False{}

def a_is_dup(o: AOut) -> Bool:
  match o:
    case ADup{}:
      True{}
    case _:
      False{}

def a_is_start(o: AOut) -> Bool:
  match o:
    case AStarted{}:
      True{}
    case _:
      False{}

# A chat recorded on another computer: bridge/index.ts case "chat", the
# `if (remote)` branch, and bridge/src/remote-hosts.ts remoteTurnProblem.
# remote = SELF.matches(hostId) ? undefined : remoteHostFor(hostId): the host id
# is one of DASH_REMOTE_HOSTS. That branch replaces a_admit's me, route, avail,
# cwd and attachment gates (the other computer's own adapter checks the session
# and directory there); a_admit models every other chat and voice turn.
#   ok     remoteTurnProblem(...) is undefined: harness is a REMOTE_HARNESS, the
#          profile is av:<harness>:<session> for the message's own session, the
#          session id is well formed, cwd is absolute, no attachments
#   known  HARNESSES.find(harness)
#   dup    turns.has(id)
def a_remote(ok: Bool, known: Bool, dup: Bool) -> AOut:
  match ok:
    case False{}:
      a_reject()
    case True{}:
      match known:
        case False{}:
          a_reject()
        case True{}:
          match dup:
            case True{}:
              ADup{}
            case False{}:
              AStarted{}

# Every gate a started remote chat must have passed.
def a_remote_gates(ok: Bool, known: Bool, dup: Bool) -> Bool:
  Bool.and(ok, Bool.and(known, Bool.not(dup)))

# Every gate a started turn must have passed.
def a_gates(k: AKind, me: Bool, route: Bool, dup: Bool, speech: Bool, known: Bool, avail: Bool, cwd: Bool, att: Bool) -> Bool:
  match k:
    case AChat{}:
      Bool.and(me, Bool.and(route, Bool.and(Bool.not(dup), Bool.and(known, Bool.and(avail, Bool.and(cwd, att))))))
    case AVoice{}:
      Bool.and(me, Bool.and(route, Bool.and(Bool.not(dup), Bool.and(speech, Bool.and(known, Bool.and(avail, cwd))))))
