#!/usr/bin/env python3
"""Preview hand-off: when a worktree merges into the preview, tell the owner exactly what to test
and take him to that screen. This is the hook the Turbo orchestrator calls after a preview merge.

  python3 scripts/preview_handoff.py --sha SHA --features DF-035,DF-024 [--json]
  python3 scripts/preview_handoff.py --sha SHA --features DF-035 --open --serial <adb serial> \
      [--display-id N] --out .acceptance-receipts/preview
  python3 scripts/preview_handoff.py --sha SHA --features DF-035 --delivered-via "telegram:<msg id>" --out DIR

For each feature it prints a compact brief (the AODL test card): the feature, the owner's ask, the
expected behaviour, the screen and the steps to reach the exact state, and the journey that proves it.
`--open` sends the screen's deep link to the phone (`am start -d dash://<screen>`).

A preview receipt (kind "preview", read by scripts/feature_status.py) is written to --out only when the
brief was delivered: the deep link opened on the device without an error, or --delivered-via names the
channel message that carried the brief. Otherwise the receipt says delivered false, so a merge that
nobody showed to the owner never counts. The ledger is data; nothing in it is executed.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "app.dash.mobile"

# Journey -> (screen deep link, steps from that screen to the state the journey tests).
# Deep links are the routes in app/src/lib/app-route-link.ts. Every ledger journey must have an entry.
SCREENS: dict[str, tuple[str, str]] = {
    "J-chat-list-all-harnesses": ("dash://chats", "scroll the whole list; look for every harness and host"),
    "J-chat-search-fast": ("dash://chats", "type a query in search; results appear as you type"),
    "J-chat-open-history": ("dash://chats", "open a live Hermes row, then a live OMP row"),
    "J-send-receive-hermes": ("dash://chats", "open a running Hermes chat and send three messages"),
    "J-send-receive-omp": ("dash://chats", "open a running OMP chat and send three messages"),
    "J-send-failure-retry": ("dash://chats", "open a chat, send while the bridge is down, then tap Retry"),
    "J-steer-queue-merge": ("dash://chats", "open a running chat; steer once, queue three, merge"),
    "J-composer-draft-restore": ("dash://chats", "open a chat, type half a sentence, force-stop Dash, relaunch"),
    "J-composer-paste-image": ("dash://chats", "open a chat, long-press the composer and paste an image"),
    "J-composer-attach": ("dash://chats", "open a chat, attach an image and a text file with the paperclip"),
    "J-composer-suggestions": ("dash://chats", "type / and @ on Main, then inside a chat"),
    "J-composer-single-button": ("dash://chats", "open a chat; watch the one button while idle, drafting and running"),
    "J-chat-window-open-close": ("dash://chats", "tap a chat row, then close it with the X"),
    "J-chat-identity-badge": ("dash://chats", "open a chat and tap the identity badge"),
    "J-context-card": ("dash://chats", "open a chat and tap the context gauge"),
    "J-thinking-tools-details": ("dash://chats", "open a chat with a tool-heavy turn; expand its details"),
    "J-subagent-indicator": ("dash://chats", "open a chat whose turn delegates workers"),
    "J-prompt-rail": ("dash://chats", "open a long chat and scrub the prompt rail"),
    "J-markdown-code": ("dash://chats", "open a chat with a markdown/code reply"),
    "J-genui-render": ("dash://chats", "open a chat and ask for a mermaid diagram and a genui widget"),
    "J-live-surface": ("dash://chats", "open a Hermes chat and switch to the Live surface"),
    "J-voice-live-call": ("dash://chats", "open an attached Hermes chat and tap Live on the mic"),
    "J-voice-dictation": ("dash://chats", "open a chat, hide the keyboard and dictate"),
    "J-voice-mic-pill": ("dash://chats", "open a chat; hold the mic and slide up/down"),
    "J-annotation-spen": ("dash://chats", "open a chat and enter annotation from Options"),
    "J-annotation-agent-pointer": ("dash://chats", "open a chat and ask the agent where a feature is"),
    "J-text-select-reply": ("dash://chats", "open a chat, select part of a reply and reply to it"),
    "J-pairing-fresh": ("dash://settings", "Forget this bridge, then pair again once"),
    "J-reconnect-reboot": ("dash://chats", "lock and unlock the phone (or reboot the host); watch the chat reconnect"),
    "J-approvals-batch": ("dash://orchestra", "open the approvals queue; bulk-approve, review one, write one"),
    "J-orchestra-views": ("dash://orchestra", "switch views and tap a node"),
    "J-trace-live": ("dash://trace", "trigger a backend event and open its detail"),
    "J-settings-density": ("dash://settings", "change information density and layout density"),
    "J-settings-handedness": ("dash://settings", "toggle Left/Right handedness"),
    "J-fullscreen-launch": ("dash://orchestra", "relaunch Dash and check the status bar stays hidden"),
    "J-notifications-share": ("dash://chats", "background Dash, tap a reply notification; share a file into Dash"),
    "J-turbo-preview-brief": ("dash://orchestra", "this brief itself: it opened the screen to test"),
    "J-turbo-chatgpt-fanout": ("dash://orchestra", "trigger Turbo and watch the created/completed counts"),
    "J-dogfood-loop": ("dash://orchestra", "turn on dogfood mode, capture a bug, confirm Fixed?"),
    "J-watch-agent": ("dash://chats", "use Dash; check a watcher reports the error first"),
    "J-design-conformance": ("dash://orchestra", "swipe through Bots, Chats and Orchestra, then Settings"),
    "J-perf-profile": ("dash://chats", "scroll fast through a long list and a long chat"),
    "J-study-mode": ("dash://chats", "open study mode and give it a prompt"),
    "J-bots-tree": ("dash://bots", "collapse and expand hosts; open a row"),
    "J-roadmap-inline": ("dash://chats", "open a chat and ask for the Dash roadmap"),
    "J-process-audit": ("dash://orchestra", "nothing on the phone: this one is the spec and the laws"),
    "J-privacy-forget": ("dash://settings", "Forget this bridge, then check nothing local survived"),
    "J-model-roles": ("dash://settings", "open Models; change the model for this session from the composer"),
    "J-z0live-service": ("dash://chats", "start z0live from Dash, then from Lawnchair"),
    "J-human-capability-loop": ("dash://orchestra", "relaunch Dash with an approved goal"),
    "J-mesh-discovery": ("dash://bots", "check the second host and its sessions are listed"),
}

_SHA = re.compile(r"^[0-9a-f]{7,40}$")


def load_ledger(path: Path) -> dict:
    sys.path.insert(0, str(ROOT / "spec"))
    from check import load_yaml  # noqa: E402  (dependency-free YAML subset reader)
    return load_yaml(path.read_text())


def _short(text: str, n: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def brief(ledger: dict, fid: str, sha: str) -> dict:
    by_id = {f["id"]: f for f in ledger["features"]}
    if fid not in by_id:
        raise KeyError(f"unknown feature {fid}")
    f = by_id[fid]
    jid = f["journey"]
    if jid not in SCREENS:
        raise KeyError(f"{fid}: journey {jid} has no screen in preview_handoff.SCREENS")
    link, steps = SCREENS[jid]
    quotes = f.get("owner_quotes") or []
    card = {
        "feature": fid, "title": f["title"], "sha": sha[:12], "priority": f.get("priority"),
        "ask": _short(quotes[0], 160) if quotes else None,
        "expect": _short(f["requirement"], 220), "screen": link, "steps": steps, "journey": jid,
    }
    lines = [f"TEST {fid} [{card['priority']}] {card['title']}  @ {card['sha']}"]
    if card["ask"]:
        lines.append(f'  ask:    "{card["ask"]}"')
    lines += [f"  expect: {card['expect']}", f"  go:     {link} -> {steps}", f"  proof:  {jid}"]
    card["text"] = "\n".join(lines)
    return card


def open_screen(serial: str, link: str, display_id: int | None) -> tuple[bool, str]:
    cmd = ["adb", "-s", serial, "shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", link]
    if display_id is not None:
        cmd += ["--display", str(display_id)]
    cmd.append(PACKAGE)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"{type(e).__name__}: {e}"
    out = (r.stdout + r.stderr).strip()
    ok = r.returncode == 0 and not re.search(r"(?i)^error|exception|unable to resolve", out, re.M)
    return ok, out[-400:]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ledger", default=str(ROOT / "spec/features.yaml"))
    ap.add_argument("--sha", required=True, help="the preview sha the owner will test")
    ap.add_argument("--features", required=True, help="comma-separated DF ids merged into the preview")
    ap.add_argument("--open", action="store_true", help="open the first feature's screen on the device")
    ap.add_argument("--serial", help="adb serial of the owner's phone (required with --open)")
    ap.add_argument("--display-id", type=int, help="open on this display (virtual display runs)")
    ap.add_argument("--delivered-via", help="channel reference of the message that carried the brief")
    ap.add_argument("--out", help="write preview receipts under this directory")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    sha = args.sha.strip().lower()
    if not _SHA.match(sha):
        print("--sha must be a hex git sha", file=sys.stderr)
        return 2
    if args.open and not args.serial:
        print("--open needs --serial", file=sys.stderr)
        return 2
    ids = [i.strip() for i in args.features.split(",") if i.strip()]
    ledger = load_ledger(Path(args.ledger))
    try:
        cards = [brief(ledger, fid, sha) for fid in ids]
    except KeyError as e:
        print(str(e).strip("'\""), file=sys.stderr)
        return 2
    opened, detail = None, None
    if args.open and cards:
        opened, detail = open_screen(args.serial, cards[0]["screen"], args.display_id)
    via = (args.delivered_via or "").strip() or None
    receipts = []
    for i, c in enumerate(cards):
        # Only the opened screen (the first card) counts as shown by --open; the others need a channel ref.
        delivered = bool(via) or (i == 0 and opened is True)
        receipts.append({"kind": "preview", "feature": c["feature"], "sha": sha, "delivered": delivered,
                         "via": via or ("device:" + args.serial if i == 0 and opened else None),
                         "screen": c["screen"], "brief": c["text"],
                         "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    if args.out:
        out = Path(args.out) / sha[:12]
        out.mkdir(parents=True, exist_ok=True)
        for r in receipts:
            (out / f"{r['feature']}.json").write_text(json.dumps(r, indent=1) + "\n")
    if args.json:
        print(json.dumps({"sha": sha, "cards": cards, "opened": opened, "open_detail": detail,
                          "receipts": receipts}, indent=1))
    else:
        print("\n\n".join(c["text"] for c in cards))
        if opened is not None:
            print(f"\nopened {cards[0]['screen']} on {args.serial}: {'ok' if opened else 'FAILED ' + str(detail)}")
    return 0 if all(r["delivered"] for r in receipts) or not (args.open or via) else 1


if __name__ == "__main__":
    sys.exit(main())
