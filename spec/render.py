#!/usr/bin/env python3
"""Render spec/SPEC.md from spec/features.yaml. Run after editing the ledger."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check import load_yaml  # noqa: E402

AREA_TITLES = {
    "chat-roster": "Chat roster, sessions and search", "reliability": "Delivery and reliability",
    "composer": "Composer", "chat-window": "Chat window and transcript", "indicators": "Indicators and identity",
    "generated-ui": "Generated UI and Ripple", "study-mode": "Study mode", "voice": "Voice (z0live)",
    "annotation": "Annotation, S Pen and artifacts", "turbo-preview": "Turbo and live preview",
    "process": "Process, verification and Bend laws", "performance": "Performance and motion",
    "orchestra": "Orchestra and trace", "approvals": "Approvals", "settings": "Settings",
    "pairing": "Pairing", "notifications-share": "Notifications and share", "navigation": "Navigation and shell",
    "design-rules": "Design rules", "architecture": "Architecture", "other": "Other",
}
MARK = {"implemented": "implemented", "partial": "**partial**", "missing": "**MISSING**"}


def refs(items: list[str]) -> str:
    return ", ".join(f"`{r}`" for r in items) if items else "none"


def render(doc: dict) -> str:
    feats = doc["features"]
    status = Counter(f["status_from_code"] for f in feats)
    prio = Counter(f["priority"] for f in feats)
    journeys = {j["id"]: j["description"] for j in doc["journeys"]}
    out = [
        "# Dash specification",
        "",
        f"Generated from `spec/features.yaml` (baseline `{doc['baseline']}`, {doc.get('generated', '')}). "
        "Do not edit by hand: change the ledger and run `python3 spec/render.py`, then `python3 spec/check.py`.",
        "",
        "Status is read from the code at the baseline. A requirement is proved only by its device journey "
        "(exact-SHA receipt, virtual-monitor E2E or S22/S25 native run), never by a unit test or a report.",
        "",
        "## Summary",
        "",
        f"- Features: {len(feats)}",
        f"- Status from code: implemented {status['implemented']}, partial {status['partial']}, missing {status['missing']}",
        f"- Priority: P0 {prio['P0']}, P1 {prio['P1']}, P2 {prio['P2']}",
        f"- Device journeys: {len(journeys)}",
        "",
        "Ledger laws (enforced by `spec/check.py`): every feature has a defined journey; `missing` means no "
        "surface_refs (gap locations go in gap_refs); every non-missing feature cites code that exists at the "
        "baseline; an ask the owner repeated (`recurring`) is P0.",
        "",
        "## P0 features",
        "",
        "| Id | Feature | Status | Journey |",
        "|---|---|---|---|",
    ]
    for f in feats:
        if f["priority"] == "P0":
            out.append(f"| {f['id']} | {f['title']} | {MARK[f['status_from_code']]} | `{f['journey']}` |")
    out += ["", "## Features by area", ""]
    for area, title in AREA_TITLES.items():
        group = [f for f in feats if f["area"] == area]
        if not group:
            continue
        out += [f"### {title}", ""]
        for f in group:
            out.append(f"#### {f['id']} {f['title']}")
            out.append("")
            out.append(f"{MARK[f['status_from_code']]} · {f['priority']}{' · recurring' if f['recurring'] else ''}"
                       f" · journey `{f['journey']}` · claimed {f.get('claimed_status', 'unknown')}")
            out.append("")
            out.append(f"**Acceptance.** {f['requirement']}")
            out.append("")
            if f["owner_quotes"]:
                out.append(f"> {f['owner_quotes'][0]}")
                out.append("")
            out.append(f"Code: {refs(f['surface_refs'])}")
            if f.get("gap_refs"):
                out.append(f"Gap located at: {refs(f['gap_refs'])}")
            if f.get("note"):
                out.append("")
                out.append(f"Note: {f['note']}")
            out.append(f"Sources: {', '.join(f['sources'])}")
            out.append("")
    out += ["## Claims that the code does not support", "",
            "Agent reports and issue states that disagree with the code at the baseline.", "",
            "| Id | Feature | Claimed | From code |", "|---|---|---|---|"]
    for f in feats:
        claimed, actual = f.get("claimed_status", "unknown"), f["status_from_code"]
        over = claimed == "implemented" and actual != "implemented"
        under = claimed in ("missing", "regressed") and actual == "implemented"
        if over or under:
            out.append(f"| {f['id']} | {f['title']} | {claimed} | {actual} |")
    out += ["", "## Surface without a requirement", "",
            "Code paths that no owner requirement covers. Keep, justify with an owner ask, or remove.", "",
            "| Code | Surface | Note |", "|---|---|---|"]
    for item in doc.get("unrequired_surface", []):
        out.append(f"| `{item['ref']}` | {item['surface']} | {item['note']} |")
    out += ["", "## Requirement without surface", "",
            "Owner requirements with no implementing code in this repo at the baseline.", "",
            "| Id | Priority | Feature | Gap located at |", "|---|---|---|---|"]
    for f in feats:
        if f["status_from_code"] == "missing":
            out.append(f"| {f['id']} | {f['priority']} | {f['title']} | {refs(f.get('gap_refs', []))} |")
    out += ["", "## Device journeys", "", "| Journey | Proves | Features |", "|---|---|---|"]
    for jid, desc in journeys.items():
        users = ", ".join(f["id"] for f in feats if f["journey"] == jid)
        out.append(f"| `{jid}` | {desc} | {users} |")
    return "\n".join(out) + "\n"


def main() -> int:
    doc = load_yaml((HERE / "features.yaml").read_text(encoding="utf-8"))
    (HERE / "SPEC.md").write_text(render(doc), encoding="utf-8")
    print(f"wrote {HERE / 'SPEC.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
