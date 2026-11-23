#!/usr/bin/env python3
"""Now testing: what a turbo promotion asks the owner to test, stamped into build-info.json.

  python3 scripts/turbo/now_testing.py --repo WORKTREE --sha SHA --base BASE --built-at-ms MS [--note TEXT]

Prints the app/src/lib/build-info.json body for the promoted commit:

  {"sha": SHA, "builtAtMs": MS, "testing": {"feature": ..., "screen": "dash://<route>", "steps": ...}}

The app bakes that file into the bundle; the "Now testing" card (app/src/components/NowTestingCard.tsx)
shows the feature and its button opens the screen. Sources, first match wins:

  feature  1. `Dash-Feature: DF-NNN` trailer on SHA (title, screen and steps from spec/features.yaml
              through scripts/preview_handoff.py)
           2. `Now-Testing: <text>` trailer on SHA
           3. --note (the turbo-promote note)
           4. the subject of SHA
  screen   1. the Dash-Feature ledger screen   2. `Dash-Screen: dash://<route>` trailer
           3. inferred from the files changed in BASE..SHA (only when they point at one screen)
  steps    1. the Dash-Feature ledger steps    2. `Now-Steps: <text>` trailer

Routes are those of app/src/lib/app-route-link.ts. A screen that is not one of them is dropped.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ROUTES = ("lab", "trace", "orchestra", "settings", "bots", "hosts", "chats")
# Changed path -> screen. The first matching rule names a file's screen; files that match no rule
# (shared logic, scripts, docs) do not vote.
SCREEN_RULES: tuple[tuple[str, str], ...] = (
    (r"^app/src/screens/SettingsScreen\.tsx$|^app/src/components/(NotificationSettings|InformationDensityPicker|ModelsPanel)\.tsx$", "settings"),
    (r"^app/src/screens/TraceScreen\.tsx$|^app/src/components/trace/|^app/src/trace/", "trace"),
    (r"^app/src/screens/LabScreen\.tsx$|^app/src/components/BotFaceLab\.tsx$", "lab"),
    (r"^app/src/screens/panes/(HostsPane|BotsPane)\.tsx$|^app/src/components/(Host|Bot)[A-Za-z]*\.tsx$", "hosts"),
    (r"^app/src/screens/panes/OrchestraPane\.tsx$|^app/src/screens/OrchestraDetailScreen\.tsx$|^app/src/components/(IntentionalOrchestra|OrchestraGraph|AodlCatalogNetwork)\.tsx$", "orchestra"),
    (r"^app/src/screens/panes/ChatsPane\.tsx$|^app/src/screens/ChatScreen\.tsx$|^app/src/components/(Chat|Composer|Message|AttachedComposer|PromptRail|Markdown|CodeBlock|ToolCard|Tool)[A-Za-z]*\.tsx$", "chats"),
)
_SHA = re.compile(r"^[0-9a-f]{7,64}$")
_LINK = re.compile(r"^dash://([a-z]+)/?$")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def trailers(repo: Path, sha: str) -> dict[str, str]:
    """Commit trailers of SHA (last value wins), keys lowercased."""
    out = git(repo, "log", "-1", "--format=%(trailers:only,unfold)", sha)
    found: dict[str, str] = {}
    for line in out.splitlines():
        key, sep, value = line.partition(":")
        if sep and value.strip():
            found[key.strip().lower()] = value.strip()
    return found


def screen_link(raw: str | None) -> str | None:
    match = _LINK.match((raw or "").strip().lower())
    return f"dash://{match.group(1)}" if match and match.group(1) in ROUTES else None


def infer_screen(changed: list[str]) -> str | None:
    votes: set[str] = set()
    for path in changed:
        for pattern, route in SCREEN_RULES:
            if re.search(pattern, path):
                votes.add(route)
                break
    return f"dash://{votes.pop()}" if len(votes) == 1 else None


def ledger_card(fid: str, sha: str) -> dict | None:
    sys.path.insert(0, str(ROOT / "scripts"))
    try:
        import preview_handoff  # noqa: E402
        return preview_handoff.brief(preview_handoff.load_ledger(ROOT / "spec" / "features.yaml"), fid, sha)
    except (ImportError, KeyError, OSError, ValueError):
        return None


def clip(text: str, n: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def now_testing(repo: Path, sha: str, base: str | None, note: str) -> dict | None:
    marks = trailers(repo, sha)
    feature = screen = steps = None
    fid = marks.get("dash-feature", "").upper()
    card = ledger_card(fid, sha) if re.fullmatch(r"DF-\d+", fid) else None
    if card:
        feature, screen, steps = f"{card['feature']} {card['title']}", screen_link(card["screen"]), card["steps"]
    feature = feature or marks.get("now-testing") or note.strip() or git(repo, "log", "-1", "--format=%s", sha).strip()
    screen = screen or screen_link(marks.get("dash-screen"))
    if screen is None and base:
        changed = git(repo, "diff", "--name-only", base, sha).split()
        screen = infer_screen(changed)
    steps = steps or marks.get("now-steps")
    if not feature:
        return None
    out = {"feature": clip(feature, 120)}
    if screen:
        out["screen"] = screen
    if steps:
        out["steps"] = clip(steps, 200)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", required=True, type=Path)
    ap.add_argument("--sha", required=True)
    ap.add_argument("--base")
    ap.add_argument("--built-at-ms", required=True, type=int)
    ap.add_argument("--note", default="")
    args = ap.parse_args()
    sha = git(args.repo, "rev-parse", args.sha).strip()
    base = git(args.repo, "rev-parse", args.base).strip() if args.base and args.base != "-" else None
    if not _SHA.match(sha):
        print(f"not a commit: {args.sha}", file=sys.stderr)
        return 2
    info: dict = {"sha": sha, "builtAtMs": args.built_at_ms}
    testing = now_testing(args.repo, sha, base, args.note)
    if testing:
        info["testing"] = testing
    print(json.dumps(info, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
