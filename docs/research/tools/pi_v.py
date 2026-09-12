#!/usr/bin/env python3
"""Static π_v leg: port cardinalities vs wiring. Not MPST, not λ_A, not Hermes.

Fail closed on dangling ports, missing ports, and fan-in without policies.fanIn.
Does not infer session types. Does not spawn a scheduler.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def check(doc: dict) -> tuple[list[str], list[dict[str, object]]]:
    issues: list[str] = []
    graph = doc.get("intentGraph") or {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    by_id = {}
    ports: dict[str, dict[str, str]] = {}
    for n in nodes:
        ident = n.get("id")
        if not isinstance(ident, str):
            issues.append("node missing id")
            continue
        by_id[ident] = n
        ports[ident] = {}
        for p in n.get("ports") or []:
            pid, d = p.get("id"), p.get("direction")
            if not isinstance(pid, str) or d not in {"in", "out"}:
                issues.append(f"{ident}: bad port")
                continue
            ports[ident][pid] = d
    used: dict[str, set[str]] = defaultdict(set)
    incoming_dep: Counter[str] = Counter()
    for e in edges:
        eid = e.get("id")
        src, dst = e.get("from"), e.get("to")
        fp, tp = e.get("fromPort"), e.get("toPort")
        if src not in by_id or dst not in by_id:
            issues.append(f"{eid}: unknown endpoint")
            continue
        if fp not in ports[src] or ports[src][fp] != "out":
            issues.append(f"{eid}: fromPort {fp!r} is not an out port of {src}")
        if tp not in ports[dst] or ports[dst][tp] != "in":
            issues.append(f"{eid}: toPort {tp!r} is not an in port of {dst}")
        used[src].add(str(fp))
        used[dst].add(str(tp))
        if e.get("relation") == "dependency":
            incoming_dep[str(dst)] += 1
    fan_in = (doc.get("policies") or {}).get("fanIn")
    if any(c >= 2 for c in incoming_dep.values()) and fan_in not in {
        "all",
        "any",
        "quorum",
        "reducer",
    }:
        issues.append("implicit fan-in: declare policies.fanIn")
    rows = []
    for ident, n in by_id.items():
        pmap = ports[ident]
        rows.append(
            {
                "id": ident,
                "kind": n.get("kind"),
                "P": len(pmap),
                "in": sum(1 for d in pmap.values() if d == "in"),
                "out": sum(1 for d in pmap.values() if d == "out"),
                "wired": len(used[ident]),
            }
        )
    return issues, rows


def main() -> int:
    paths = [Path(p) for p in sys.argv[1:]]
    if not paths:
        root = Path("/tmp/research/aodl/examples/valid")
        paths = sorted(root.glob("*.json")) if root.is_dir() else []
    if not paths:
        print("no fixtures", file=sys.stderr)
        return 2
    worst = 0
    for path in paths:
        doc = json.loads(path.read_text())
        issues, rows = check(doc)
        print(f"== {path.name} nodes={len(rows)} issues={len(issues)}")
        for r in rows:
            print(f"  {r['id']:16} kind={r['kind']:10} |P|={r['P']} in={r['in']} out={r['out']} wired={r['wired']}")
        for i in issues:
            print(f"  FAIL {i}")
        if issues:
            worst = 1
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
