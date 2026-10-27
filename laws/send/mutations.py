#!/usr/bin/env python3
"""Dash send laws: are they load-bearing? Apply one broken variant of send.bend
at a time (in a scratch copy) and require two things:

  1. `bend PROOF.bend` prints SOME PROOFS FAIL, and
  2. a concrete instance of the named law (the witness) is True on the
     reference model and False on the mutant: the law is really false there,
     not just a proof term that stopped fitting.

The reference send.bend is never edited in place. A mutant that does not check
as a model on its own counts as N/A, never as rejected. Mutants tagged
"pre-#457" are the real code before PR #457 fixed the RC3 send bugs.

    python3 laws/send/mutations.py [--verdict] [--out laws/send/mutations.json]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BEND = os.environ.get("BEND", str(Path.home() / ".bend/bin/bend"))

LONG_CHATS = "    case GChats{}:\n      GStep{GShown{}, GNothing{}}\n    case GSearch{}:\n      match fb:"
CHAT_KNOWN = "    case AChat{}:\n      match known:\n        case False{}:\n          a_reject()"
CHAT_ATT = ("                  match att:\n                    case False{}:\n                      a_reject()\n"
            "                    case True{}:\n                      AStarted{}")
CHAT_CWD = ("              match cwd:\n                case False{}:\n                  a_reject()\n"
            "                case True{}:\n                  match att:")


def step(s: str, fb: str, m: str, g: str) -> str:
    return f"S.g_eff(S.g_step(S.{s}{{}}, {fb}{{}}, S.{m}{{}}, {g}))"


def admit(k: str, me: str, route: str, dup: str, speech: str, known: str, avail: str, cwd: str, att: str) -> str:
    args = ", ".join(f"{b}{{}}" for b in (me, route, dup, speech, known, avail, cwd, att))
    return f"S.a_admit(S.{k}{{}}, {args})"


NOT = "Bool.not"
FEEDBACK = "S.GPick{S.GFeedback{}}"
REFUSE_ANY = f"S.a_accounted({admit('AChat', 'False', 'True', 'False', 'True', 'True', 'True', 'True', 'True')})"

# (law, mutation, old text, new text, witness: a Bool instance of the law that is
#  True on the reference, counterexample in the code's words)
MUTATIONS = [
    # S1-S4: a long-press never sends
    ("S1 longpress_only_opens_menu", "pre-#457 Chats long-press: feedback on sends, off deletes",
     LONG_CHATS,
     "    case GChats{}:\n      match fb:\n        case True{}:\n          GStep{m, GSend{}}\n"
     "        case False{}:\n          GStep{m, GRemove{}}\n    case GSearch{}:\n      match fb:",
     f"{NOT}(S.g_is_send({step('GChats', 'True', 'GClosed', 'S.GLongPress{}')}))",
     "Chats list, feedback on: long-press a row -> onFeedback sends a message"),
    ("S1 longpress_only_opens_menu", "pre-#457 search long-press calls onFeedbackRow (sends)",
     "        case True{}:\n          GStep{GShown{}, GNothing{}}",
     "        case True{}:\n          GStep{m, GSend{}}",
     f"{NOT}(S.g_is_send({step('GSearch', 'True', 'GClosed', 'S.GLongPress{}')}))",
     "search results, feedback on: long-press a result -> onFeedbackRow sends"),
    ("S1 longpress_only_opens_menu", "long-press opens the menu and also opens the chat",
     LONG_CHATS, LONG_CHATS.replace("GStep{GShown{}, GNothing{}}", "GStep{GShown{}, GNavigate{}}"),
     f"is_nothing({step('GChats', 'True', 'GClosed', 'S.GLongPress{}')})",
     "Chats list: long-press a row -> it navigates as well as opening the menu"),
    ("S2 send_needs_feedback_pick", "menu 'open' runs the feedback handler",
     "    case GOpen{}:\n      GNavigate{}", "    case GOpen{}:\n      GSend{}",
     f"{NOT}(S.g_is_send({step('GChats', 'True', 'GShown', 'S.GPick{S.GOpen{}}')}))",
     "long-press, pick Open -> a message is sent"),
    ("S2 send_needs_feedback_pick", "dismissing the menu runs the feedback handler",
     "    case GDismiss{}:\n      GStep{GClosed{}, GNothing{}}", "    case GDismiss{}:\n      GStep{GClosed{}, GSend{}}",
     f"{NOT}(S.g_is_send({step('GChats', 'True', 'GShown', 'S.GDismiss{}')}))",
     "long-press, dismiss the sheet -> a message is sent"),
    ("S3 feedback_off_never_sends", "Chats menu offers feedback while feedback is off",
     "        case GFeedback{}:\n          fb", "        case GFeedback{}:\n          True{}",
     f"{NOT}(S.g_any([S.GLongPress{{}}, {FEEDBACK}], S.GChats{{}}, False{{}}, S.GClosed{{}}))",
     "feedback off: long-press a chat row, pick feedback -> sends"),
    ("S3 feedback_off_never_sends", "a pick with no menu shown still runs the choice",
     "    case GClosed{}:\n      GStep{GClosed{}, GNothing{}}\n    case GShown{}:",
     "    case GClosed{}:\n      GStep{GClosed{}, g_if(g_offers(s, fb, c), g_run(c, s))}\n    case GShown{}:",
     f"{NOT}(S.g_any([{FEEDBACK}], S.GSearch{{}}, False{{}}, S.GClosed{{}}))",
     "feedback off, search: a stale 'feedback' select with no sheet open -> sends"),
    ("S4 feedback_pick_sends", "feedback pick does nothing (vacuous)",
     "    case GFeedback{}:\n      GSend{}", "    case GFeedback{}:\n      GNothing{}",
     f"S.g_is_send({step('GChats', 'True', 'GShown', FEEDBACK)})",
     "feedback on: long-press, pick feedback -> nothing (the feature is dead)"),
    # S5-S8: a chat on this host is sendable
    ("S5 own_install_is_self", "pre-#457 selfMachines without AgentsView's install id",
     "Bool.or(Nat.is_eq(machine, host), Bool.or(x_install(machine, inst), x_mem(machine, extra)))",
     "Bool.or(Nat.is_eq(machine, host), x_mem(machine, extra))",
     "S.x_self(7n, 1n, Some{7n}, [])",
     "AgentsView stamps local sessions with its install id -> listed as 'Other machine', view only"),
    ("S6 chatable_is_self", "chatable ignores the host (other machines' chats sendable)",
     "  Bool.and(catalog, x_self(machine, host, inst, extra))", "  catalog",
     f"{NOT}(S.x_chatable(True{{}}, 7n, 1n, None{{}}, []))",
     "a Claude Code chat from another machine is marked chatable on this host"),
    ("S7 archived_chat_routes", "pre-#457 bridge refuses av: profiles",
     "    case XAvProfile{k, s}:\n      x_self_archive(k, s, h, sid)", "    case XAvProfile{k, s}:\n      False{}",
     "S.x_row_routes(3n, 9n)",
     "open a chatable Claude Code chat, send -> bridge: 'Profile routing unavailable on this bridge.'"),
    ("S8 av_profile_own_session", "av: profile admitted for any session",
     "      Bool.and(Nat.is_eq(k, h), Nat.is_eq(s, q))", "      Nat.is_eq(k, h)",
     f"{NOT}(S.x_profile_ok(S.XAvProfile{{3n, 9n}}, 3n, False{{}}, Some{{8n}}))",
     "profileId av:claude:9 with sessionId 8 -> admitted, the turn resumes the wrong session"),
    ("S8 av_profile_own_harness", "av: profile admitted for any harness",
     "      Bool.and(Nat.is_eq(k, h), Nat.is_eq(s, q))", "      Nat.is_eq(s, q)",
     f"{NOT}(S.x_profile_ok(S.XAvProfile{{3n, 9n}}, 4n, False{{}}, Some{{9n}}))",
     "profileId av:claude:9 sent with harness codex -> admitted"),
    ("S8 av_profile_needs_session", "av: profile admitted without a session id",
     "  match sid:\n    case None{}:\n      False{}", "  match sid:\n    case None{}:\n      True{}",
     f"{NOT}(S.x_profile_ok(S.XAvProfile{{3n, 9n}}, 3n, False{{}}, None{{}}))",
     "profileId av:claude:9 with no sessionId -> admitted as a new chat"),
    # S9-S12: no turn is refused in silence
    ("S9 no_silent_refusal", "pre-#457 rejectTurn without the turn.rejected log line",
     "  ARefused{True{}, True{}}", "  ARefused{False{}, True{}}", REFUSE_ANY,
     "phone sends to a host id that is not this bridge -> refused, nothing in the bridge log"),
    ("S9 no_silent_refusal", "rejectTurn sends error but no done",
     "  ARefused{True{}, True{}}", "  ARefused{True{}, False{}}", REFUSE_ANY,
     "refused turn -> the phone gets an error but no done: the turn spins forever"),
    ("S9 no_silent_refusal", "unknown harness: bare return",
     CHAT_KNOWN, CHAT_KNOWN.replace("a_reject()", "ASilent{}"),
     f"S.a_accounted({admit('AChat', 'True', 'True', 'False', 'True', 'False', 'True', 'True', 'True')})",
     "chat for a harness this bridge does not know -> no log, no answer"),
    ("S9 no_silent_refusal", "remote host: bare return",
     "  match me:\n    case False{}:\n      a_reject()", "  match me:\n    case False{}:\n      ASilent{}", REFUSE_ANY,
     "chat for another host -> no log, no answer"),
    ("S10 dup_only_for_live_turn", "routing refusal dressed up as a duplicate",
     "      match route:\n        case False{}:\n          a_reject()", "      match route:\n        case False{}:\n          ADup{}",
     f"{NOT}(S.a_is_dup({admit('AChat', 'True', 'False', 'False', 'True', 'True', 'True', 'True', 'True')}))",
     "a profile the bridge refuses is dropped as if it were a resend"),
    ("S11 start_only_through_every_gate", "duplicate id starts a second turn",
     "          match dup:\n            case True{}:\n              ADup{}",
     "          match dup:\n            case True{}:\n              AStarted{}",
     f"{NOT}(S.a_is_start({admit('AChat', 'True', 'True', 'True', 'True', 'True', 'True', 'True', 'True')}))",
     "the phone resends a live turn id -> a second agent process starts"),
    ("S11 start_only_through_every_gate", "chat skips the cwd check",
     CHAT_CWD, CHAT_CWD.replace("a_reject()", "AStarted{}"),
     f"{NOT}(S.a_is_start({admit('AChat', 'True', 'True', 'False', 'True', 'True', 'True', 'False', 'True')}))",
     "chat with a cwd that is not a directory -> the agent starts anyway"),
    ("S11 start_only_through_every_gate", "voice skips the speech check",
     "    case AVoice{}:\n      match speech:\n        case False{}:\n          a_reject()",
     "    case AVoice{}:\n      match speech:\n        case False{}:\n          AStarted{}",
     f"{NOT}(S.a_is_start({admit('AVoice', 'True', 'True', 'False', 'False', 'True', 'True', 'True', 'True')}))",
     "voice turn with no speech-to-text set up -> starts anyway"),
    ("S12 all_gates_start", "chat never starts (vacuous)",
     CHAT_ATT, CHAT_ATT.replace("AStarted{}", "a_reject()"),
     f"S.a_is_start({admit('AChat', 'True', 'True', 'False', 'True', 'True', 'True', 'True', 'True')})",
     "a valid new chat turn -> refused"),
]

WITNESS = """import Base
import ./send.bend as S

def is_nothing(e: S.GEffect) -> Bool:
  match e:
    case S.GNothing{}:
      True{}
    case _:
      False{}

def main() -> Bool:
  %s
"""


def env() -> dict[str, str]:
    e = dict(os.environ)
    e["PATH"] = e.get("PATH", "") + ":" + str(Path.home() / ".elan/bin")
    e.setdefault("BEND_NO_TELEMETRY", "1")
    return e


def bend(proj: Path, *args: str) -> str:
    p = subprocess.run([BEND, *args], cwd=proj, capture_output=True, text=True, env=env(), timeout=600)
    return (p.stdout + p.stderr).strip()


def checks(out: str) -> bool:
    return "ALL PROOFS CHECK" in out and "SOME PROOFS FAIL" not in out


def witness(proj: Path, expr: str) -> bool | None:
    (proj / "witness.bend").write_text(WITNESS % expr)
    out = bend(proj, "witness.bend").splitlines()
    last = out[-1].strip() if out else ""
    return {"True{}": True, "False{}": False}.get(last)


def first_location(out: str) -> str:
    for line in out.splitlines():
        if line.startswith("Location:"):
            return line.split(":", 1)[1].strip()
    lines = out.splitlines()
    return lines[1] if len(lines) > 1 else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verdict", action="store_true", help="recheck PROOF.bend with the proven kernel (needs Lean)")
    ap.add_argument("--out")
    args = ap.parse_args()
    proof_args = ["PROOF.bend"] + (["--verdict"] if args.verdict else [])
    rows = []
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as td:
        work = Path(td)
        for f in ("send.bend", "LAWS.bend", "PROOF.bend"):
            shutil.copy(HERE / f, work / f)
        out = bend(work, *proof_args)
        ref_ok = checks(out)
        ref_witness = {law + desc: witness(work, w) for law, desc, _o, _n, w, _c in MUTATIONS}
        rows.append({"law": "-", "mutation": "reference (unmodified)", "rejected": None,
                     "proofs_check": ref_ok, "witnesses_hold": all(v is True for v in ref_witness.values()),
                     "where": "" if ref_ok else first_location(out)})
        ref = (HERE / "send.bend").read_text()
        for law, desc, old, new, wexpr, cx in MUTATIONS:
            row = {"law": law, "mutation": desc, "counterexample": cx, "rejected": False}
            rows.append(row)
            if ref.count(old) != 1:
                row["where"] = f"MUTATION DID NOT APPLY (matches: {ref.count(old)})"
                continue
            (work / "send.bend").write_text(ref.replace(old, new))
            model = bend(work, "send.bend", "--check-only")
            if not checks(model):
                row["where"] = "MUTANT IS NOT A WELL-FORMED MODEL: " + first_location(model)
                continue
            out = bend(work, *proof_args)
            row["proofs_check"] = checks(out)
            row["where"] = "" if row["proofs_check"] else first_location(out)
            row["law_false_here"] = ref_witness[law + desc] is True and witness(work, wexpr) is False
            row["rejected"] = not row["proofs_check"] and row["law_false_here"]
    ref_row = rows[0]
    caught = sum(1 for r in rows[1:] if r["rejected"])
    for r in rows:
        if r is ref_row:
            print(f"{'PASS' if r['proofs_check'] and r['witnesses_hold'] else 'FAIL':8}  reference (unmodified): "
                  f"proofs check={r['proofs_check']}, every witness holds={r['witnesses_hold']}")
            continue
        print(f"{'REJECTED' if r['rejected'] else 'SURVIVED':8}  {r['law']:34} {r['mutation']}")
        print(f"{'':10}proof fails at: {r.get('where') or '-'}; law false here: {r.get('law_false_here')}")
        print(f"{'':10}counterexample: {r['counterexample']}")
    ok = bool(ref_row["proofs_check"] and ref_row["witnesses_hold"])
    print(f"reference passes: {ok}; mutations rejected: {caught}/{len(MUTATIONS)}")
    if args.out:
        Path(args.out).write_text(json.dumps({"verdict_mode": args.verdict, "rows": rows,
                                              "rejected": caught, "total": len(MUTATIONS)}, indent=2) + "\n")
    return 0 if ok and caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
