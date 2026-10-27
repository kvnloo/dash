#!/usr/bin/env python3
"""Seed archived (finished) Codex, Claude Code, Grok and OMP sessions into the ISOLATED device bridge HOME.

Runs on the stack host against the stack's own state dir, never a real HOME:

  ssh "$DASH_E2E_STACK_HOST" python3 - --home ~/dash-e2e-stack/device-state --per-harness 300 < seed_archive.py

Each harness gets N sessions titled "DASHE2E <Harness> archive NNNN <title token>". Session NNNN's
transcript has `turns` user/assistant pairs: turn 0 carries the oldest-turn token, a middle turn the
body token, and the last is "turn <turns-1>". Tokens: dashe2e<code><NNNN><t|b|o>, code cx/cl/gk/om.
Layouts follow what the bridge reads (bridge/src/context-totals.ts, roster.ts): Codex rollout JSONL
under $CODEX_HOME/sessions/Y/M/D, Claude JSONL under .claude/projects/<slug>, OMP JSONL under
.omp/agent/sessions/<slug>. The Grok layout (.grok/sessions) is assumed; the bridge enumerates none of
these archives at cfc08de, which is exactly what J-chat-list-all-harnesses is meant to catch.
Idempotent: a .seeded-archive marker with the parameters skips a repeat.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

HARNESSES = (("codex", "cx", "Codex"), ("claude", "cl", "Claude Code"), ("grok", "gk", "Grok"), ("omp", "om", "OMP"))


def token(code: str, i: int, kind: str) -> str:
    return f"dashe2e{code}{i:04d}{kind}"


def turns(code: str, i: int, n: int, label: str) -> list[tuple[str, str]]:
    out = []
    for t in range(n):
        if t == 0:
            user = f"DASHE2E {label} archive {i:04d} {token(code, i, 't')} oldest turn {token(code, i, 'o')}"
        elif t == n // 2:
            user = f"middle turn {t} mentions {token(code, i, 'b')}"
        else:
            user = f"turn {t}"
        out.append((user, f"reply to turn {t}"))
    return out


def iso(ts: datetime) -> str:
    return ts.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))


def seed(home: Path, per: int, deep: int, base: datetime) -> int:
    cwd = str(home / "work")
    slug = "-" + cwd.strip("/").replace("/", "-")
    count = 0
    for harness, code, label in HARNESSES:
        for i in range(per):
            sid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"dashe2e/{harness}/{i}"))
            start = base - timedelta(hours=per - i, minutes=7 * HARNESSES.index((harness, code, label)))
            n = 120 if i < deep else 6
            convo = turns(code, i, n, label)
            rows: list[dict] = []
            if harness == "codex":
                rows.append({"timestamp": iso(start), "type": "session_meta", "payload": {"id": sid, "cwd": cwd, "timestamp": iso(start)}})
                for t, (u, a) in enumerate(convo):
                    at = iso(start + timedelta(seconds=20 * t))
                    rows.append({"timestamp": at, "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": u}]}})
                    rows.append({"timestamp": at, "type": "response_item", "payload": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": a}]}})
                path = home / ".codex/sessions" / start.strftime("%Y/%m/%d") / f"rollout-{start.strftime('%Y-%m-%dT%H-%M-%S')}-{sid}.jsonl"
            elif harness == "claude":
                for t, (u, a) in enumerate(convo):
                    at = iso(start + timedelta(seconds=20 * t))
                    rows.append({"type": "user", "sessionId": sid, "cwd": cwd, "timestamp": at, "uuid": str(uuid.uuid4()), "message": {"role": "user", "content": u}})
                    rows.append({"type": "assistant", "sessionId": sid, "cwd": cwd, "timestamp": at, "uuid": str(uuid.uuid4()), "message": {"role": "assistant", "content": [{"type": "text", "text": a}]}})
                path = home / ".claude/projects" / slug / f"{sid}.jsonl"
            elif harness == "omp":
                rows.append({"type": "session", "id": sid, "cwd": cwd, "timestamp": iso(start)})
                for t, (u, a) in enumerate(convo):
                    at = iso(start + timedelta(seconds=20 * t))
                    rows.append({"type": "message", "timestamp": at, "message": {"role": "user", "content": [{"type": "text", "text": u}]}})
                    rows.append({"type": "message", "timestamp": at, "message": {"role": "assistant", "content": [{"type": "text", "text": a}]}})
                path = home / ".omp/agent/sessions" / slug / f"{start.strftime('%Y-%m-%dT%H-%M-%S')}_{sid}.jsonl"
            else:
                for t, (u, a) in enumerate(convo):
                    at = iso(start + timedelta(seconds=20 * t))
                    rows.append({"session_id": sid, "cwd": cwd, "timestamp": at, "role": "user", "content": u})
                    rows.append({"session_id": sid, "cwd": cwd, "timestamp": at, "role": "assistant", "content": a})
                path = home / ".grok/sessions" / f"{sid}.jsonl"
            write_jsonl(path, rows)
            ts = start.timestamp()
            os.utime(path, (ts, ts))
            count += 1
    return count


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--home", required=True, help="the isolated bridge HOME (device-state), never a real HOME")
    ap.add_argument("--per-harness", type=int, default=300)
    ap.add_argument("--deep", type=int, default=10, help="sessions per harness with 120 turns (history paging)")
    args = ap.parse_args(argv)
    home = Path(os.path.expanduser(args.home)).resolve()
    if home == Path.home().resolve() or not (home / "bridge.log").exists() and not (home / ".dash").exists():
        print(f"refusing: {home} is not an isolated device-state dir", file=sys.stderr)
        return 2
    marker = home / ".seeded-archive"
    params = {"per": args.per_harness, "deep": args.deep}
    if marker.exists() and json.loads(marker.read_text() or "{}") == params:
        print(json.dumps({"seeded": 0, "already": True, **params}))
        return 0
    n = seed(home, args.per_harness, args.deep, datetime.now(timezone.utc).replace(microsecond=0))
    marker.write_text(json.dumps(params))
    print(json.dumps({"seeded": n, **params}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
