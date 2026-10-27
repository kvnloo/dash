#!/usr/bin/env python3
"""Dash send laws: does the real code still read the way send.bend models it?

send.bend is a hand model. Each anchor below is a line of real code that one
model def mirrors. If an anchor is gone, or appears a different number of
times, the code moved under the model: re-read the named def against the code,
update send.bend (and the laws or proofs only if the intended behavior
changed), run the proofs and mutants, then update the anchor and the sync
commit in .claude/skills/formal-verify-dash/SKILL.md.

The bridge turn handlers also get a structural check (S9): inside
`case "chat"` and `case "voice_begin"` of bridge/index.ts, every `return` must
be `return rejectTurn(...)` or the duplicate-id line. A new bare `return` is a
turn refused in silence.

    python3 laws/send/anchors.py [--root <repo>]
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

CHATS = "app/src/screens/panes/ChatsPane.tsx"
MAIN = "app/src/screens/MainScreen.tsx"
ROW = "app/src/lib/chat-row-actions.ts"
BRIDGE = "bridge/index.ts"
AVSRC = "bridge/src/chat-index/agentsview-src.ts"
AVS = "bridge/src/agentsview-sessions.ts"
SIDECAR = "bridge/src/chat-index/sidecar.ts"
LIVE = "app/src/lib/live-sessions.ts"
NET = "app/src/net/bridge.ts"

# (laws, model def, file, exact text, expected count)
ANCHORS = [
    ("S1-S3", "g_long (Chats)", CHATS, "const longPress = useCallback((id: string) => { haptic.select(); setMenuFor(id); }, []);", 1),
    ("S1-S3", "g_step GDismiss", CHATS, "const closeMenu = useCallback(() => setMenuFor(null), []);", 1),
    ("S2-S4", "g_pick (Chats)", CHATS, "setMenuFor(null);\n    if (id) runChatRowMenu(choice, id, { open: (rowId) => open(rowId), feedback: onFeedback, remove });", 1),
    ("S3", "g_offers (Chats)", ROW, '...(feedbackOn ? [{ id: "feedback",', 1),
    ("S2-S4", "g_run", ROW, 'case "open": handlers.open(id); return true;', 1),
    ("S2-S4", "g_run", ROW, 'case "feedback": handlers.feedback(id); return true;', 1),
    ("S2-S4", "g_run", ROW, 'case "delete": handlers.remove(id); return true;', 1),
    ("S2-S4", "g_run", ROW, "default: return false;", 1),
    ("S1-S3", "g_long (search)", MAIN, "onLongPress={feedbackOn ? onRowMenu : undefined}", 1),
    ("S1-S3", "g_long (search)", MAIN, "const onRowMenu = useCallback((model: SearchRowModel) => { haptic.select(); setRowMenu(model); }, []);", 1),
    ("S2-S4", "g_pick / g_run (search)", MAIN, 'setRowMenu(null);\n    if (!model) return;\n    if (choice === "open") onRow(model);\n    else if (choice === "feedback") onFeedbackRow(model);\n  }', 1),
    ("S3", "g_offers (search)", MAIN, '{ id: "feedback", label: "Send feedback about this",', 1),
    ("S5", "x_self", BRIDGE, "selfMachines: [HOST_NAME, ...[agentsviewMachineId()].filter(", 1),
    ("S5", "x_install", AVS, 'const id = readFileSync(join(dirname(path), "telemetry-install-id"), "utf8").trim();', 1),
    ("S5-S6", "x_self", AVSRC, 'if (self.has(raw.toLowerCase()) || self.has(short)) return { host_id: SELF_HOST, host_name: "" };', 1),
    ("S6", "x_chatable", AVSRC, "chatable: isCatalogHarness(row.agent) && host.host_id === SELF_HOST ? 1 : 0", 1),
    ("S7", "x_row_routes", AVSRC, "agent_id: `${AGENTSVIEW_PREFIX}${row.agent}:${sessionId}`", 1),
    ("S7", "x_row_routes", SIDECAR, "const mine = row.host_id === SELF_HOST;", 1),
    ("S7", "x_row_routes", LIVE, "...(summary.agentId ? { profileId: summary.agentId } : {})", 1),
    ("S7", "x_row_routes", NET, "return { hostId: conversation?.targetHostId, profileId: conversation?.profileId };", 1),
    ("S7-S8", "x_self_archive", AVS, "return Boolean(profileId && sessionId && profileId === `${AGENTSVIEW_PREFIX}${harness}:${sessionId}`);", 1),
    ("S7-S8", "x_profile_ok", BRIDGE, "&& !isSelfArchiveProfile(message.profileId, message.harness, message.sessionId) && !(message.harness === \"hermes\" && message.profileId === \"hermes:default\")) return rejectTurn(ws, message.id, \"Profile routing unavailable on this bridge.\");", 2),
    ("S9", "a_reject", BRIDGE, 'log("turn.rejected", { id, reason: message });\n  sendTo(ws, { type: "error", id, seq: 1, message });\n  sendTo(ws, { type: "done", id, seq: 2, exitCode: 1 });', 1),
    ("S9-S11", "a_admit dup (chat)", BRIDGE, "if (turns.has(message.id)) return;", 1),
    ("S9-S11", "a_admit dup (voice)", BRIDGE, "if (turns.has(message.id) || utterances.has(message.id)) return;", 1),
    ("S9-S11", "a_admit me", BRIDGE, "if (!(await isSelfHost(message.hostId))) return rejectTurn(ws, message.id,", 2),
    ("S11", "a_tail cwd", BRIDGE, "if (!isDirectory(cwd)) return rejectTurn(ws, message.id,", 2),
    ("S11", "a_tail speech", BRIDGE, 'return rejectTurn(ws, message.id, ready.reason ?? "Speech isn\'t set up on this computer.");', 1),
]

ALLOWED_RETURNS = ("return rejectTurn(", "if (turns.has(message.id)) return;",
                   "if (turns.has(message.id) || utterances.has(message.id)) return;")


def handler_blocks(src: str) -> dict[str, str]:
    """The text of `case "chat"` and `case "voice_begin"`, each up to the next case of the switch."""
    out = {}
    for name, end in (("chat", 'case "voice_begin": {'), ("voice_begin", 'case "voice_chunk": {')):
        start = src.find(f'case "{name}": {{')
        stop = src.find(end, start + 1)
        if start >= 0 and stop > start:
            out[name] = src[start:stop]
    return out


def silent_returns(block: str) -> list[str]:
    bad = []
    for line in block.splitlines():
        for m in re.finditer(r"\breturn\b", line):
            text = line.strip()
            if text.startswith("return rejectTurn(") or any(a in text for a in ALLOWED_RETURNS):
                continue
            # `catch (error) { return rejectTurn(...) }`
            if line[m.start():].startswith("return rejectTurn("):
                continue
            bad.append(text)
    return bad


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    root = Path(ap.parse_args().root)
    failures = []
    cache: dict[str, str] = {}
    for laws, model, path, text, want in ANCHORS:
        src = cache.setdefault(path, (root / path).read_text() if (root / path).exists() else "")
        got = src.count(text)
        status = "ok" if got == want else "MOVED"
        print(f"{status:5} {laws:7} {model:24} {path}  (found {got}, want {want})")
        if got != want:
            failures.append(f"{laws} {model}: {path} no longer contains (x{want}): {text.splitlines()[0][:100]}")
    blocks = handler_blocks(cache.get(BRIDGE) or (root / BRIDGE).read_text())
    for name in ("chat", "voice_begin"):
        if name not in blocks:
            failures.append(f"S9 a_admit: case \"{name}\" not found in {BRIDGE}")
            continue
        bad = silent_returns(blocks[name])
        print(f"{'ok' if not bad else 'SILENT':5} S9      a_admit {name:16} every return is rejectTurn or the duplicate line")
        failures += [f"S9 no_silent_refusal: bare return in case \"{name}\": {b}" for b in bad]
    if failures:
        print("\nThe code moved under laws/send/send.bend. Re-read the named model defs against it:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"anchors: {len(ANCHORS)} + 2 handler scans, all in place")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
