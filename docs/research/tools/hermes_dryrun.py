#!/usr/bin/env python3
"""Hermes Kanban dry-run profile — interchange projection, not a scheduler.

Gate 1 (working note §8): intent → Kanban card ids + dependency edges.
Fail closed on message, mesh, auction, unbounded spawn, payment.
Does not write Kanban, spawn workers, or pick runtimes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BLOCK_RELATIONS = {
    "message",
    "delegation",
    "allocation",
}
BLOCK_KINDS = {
    "fanout",
    "reducer",
    "auction",
    "mesh",
    "swarm",
    "hybrid",
}


def project(doc: dict) -> tuple[dict | None, list[str]]:
    blocking: list[str] = []
    policies = doc.get("policies") or {}
    kinds = {str(k) for k in (policies.get("kinds") or [])}
    for k in kinds & BLOCK_KINDS:
        blocking.append(f"policies.kinds contains {k}")
    dynamic = policies.get("dynamic") or {}
    if dynamic.get("allowed") or (dynamic.get("maxChildren") or 0) > 0:
        blocking.append("unbounded or allowed spawn")
    graph = doc.get("intentGraph") or {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    for e in edges:
        rel = e.get("relation")
        if rel in BLOCK_RELATIONS:
            blocking.append(f"edge {e.get('id')} relation={rel}")
    if blocking:
        return None, blocking
    gid = doc.get("graphId") or "g"
    cards = []
    for n in nodes:
        ident = n.get("id")
        cards.append(
            {
                "id": f"{gid}:{ident}",
                "nodeId": ident,
                "kind": n.get("kind"),
            }
        )
    deps = []
    for e in edges:
        if e.get("relation") != "dependency":
            continue
        deps.append(
            {
                "id": e.get("id"),
                "parent": f"{gid}:{e.get('from')}",
                "child": f"{gid}:{e.get('to')}",
            }
        )
    return {"profile": "hermes-kanban-dryrun", "cards": cards, "deps": deps}, []


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: hermes_dryrun.py doc.json", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    doc = json.loads(path.read_text())
    plan, blocking = project(doc)
    if blocking:
        print("FAIL closed:", file=sys.stderr)
        for b in blocking:
            print(f"  {b}", file=sys.stderr)
        return 1
    json.dump(plan, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
