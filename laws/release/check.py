#!/usr/bin/env python3
"""O15 dash-release gate: may this exact Dash commit be installed, promoted,
sent over a channel/OTA, or merged?

    python3 laws/release/check.py --action install|promote|ota|merge [--sha SHA] [--root .]
                                  [--receipts DIR] [--fetch]

Exit 0 = ALLOW, 1 = DENY (the reason is printed), 2 = usage error.

`release_allows` / `gate` below mirror laws/release/release.bend line for line
(parity: laws/release/test_check.py). Everything else turns evidence into the
inputs of that function:

  receipt   <store>/<sha>/receipt.json, written by the army runner
            (e2e/mbp-army/receipt.py) after a real Playwright run
  report    <store>/<sha>/results.json, the run's Playwright JSON report; its
            sha256 must equal the receipt's report_sha256
  inventory e2e/mbp-army/features.json in the checkout being released
  runner    sha256 digest of e2e/mbp-army in the checkout being released; it
            must equal the digest the receipt recorded. A harness that is not
            this army (or an edited army) never produces a counted receipt.

Store lookup order: --receipts, $DASH_ARMY_RECEIPTS, <root>/.native-build-inputs/army-receipts
(fleet build snapshots), ~/.local/state/dash/army-receipts. With --fetch and no
local receipt, the CI army artifact `army-receipt-<sha>` is downloaded with gh.
Stdlib only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = "dash-army-receipt/1"
RUNNER_NAME = "dash-tester-army"
RUNNER_DIR = "e2e/mbp-army"
INVENTORY = "e2e/mbp-army/features.json"
ACTIONS = ("install", "promote", "ota", "merge")
REPO = os.environ.get("DASH_REPO", "kvnloo/dash")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


# ------------------------------------------------------------------ the decision (mirrors release.bend)

@dataclass(frozen=True)
class Rec:
    """RFound{sha, failed, feats, skips, army}; None stands for RNone{}."""
    sha: str
    failed: int
    feats: tuple[int, ...]
    skips: int
    army: bool


def all_pos(fs: tuple[int, ...]) -> bool:
    if not fs:
        return True
    return fs[0] > 0 and all_pos(fs[1:])


def cov_complete(fs: tuple[int, ...], skips: int) -> bool:
    if not fs:
        return False
    return skips == 0 and (fs[0] > 0 and all_pos(fs[1:]))


def r_ok(build: str, sha: str, failed: int, fs: tuple[int, ...], skips: int, army: bool) -> bool:
    return build == sha and (failed == 0 and (cov_complete(fs, skips) and army))


def release_allows(build: str, r: Rec | None) -> bool:
    if r is None:
        return False
    return r_ok(build, r.sha, r.failed, r.feats, r.skips, r.army)


def gate(action: str, build: str, r: Rec | None) -> bool:
    if action not in ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    return release_allows(build, r)


# ------------------------------------------------------------------ evidence

def runner_digest(root: Path) -> str:
    """sha256 over (relative path, sha256(content)) of every army runner file."""
    base = root / RUNNER_DIR
    h = hashlib.sha256()
    for p in sorted(base.rglob("*")):
        rel = p.relative_to(base).as_posix()
        if not p.is_file() or "__pycache__" in rel.split("/") or rel.endswith(".pyc") or "node_modules" in rel.split("/"):
            continue
        h.update(rel.encode() + b"\0" + hashlib.sha256(p.read_bytes()).hexdigest().encode() + b"\n")
    return h.hexdigest()


def load_inventory(root: Path) -> list[dict]:
    data = json.loads((root / INVENTORY).read_text())
    feats = data.get("features")
    if not isinstance(feats, list):
        raise ValueError("features.json: 'features' must be a list")
    return feats


def _specs(suite: dict):
    for spec in suite.get("specs", []):
        yield spec
    for child in suite.get("suites", []):
        yield from _specs(child)


def summarize(report: dict, inventory: list[dict]) -> dict:
    """Recompute the run's outcome from the Playwright JSON report itself."""
    outcomes: dict[str, list[str]] = {}
    failed = skipped = unexplained = 0
    for suite in report.get("suites", []):
        for spec in _specs(suite):
            title = spec.get("title", "")
            for t in spec.get("tests", []):
                st = t.get("status")  # expected | unexpected | flaky | skipped
                outcomes.setdefault(title, []).append(st)
                if st == "skipped":
                    skipped += 1
                    reasons = [a for a in t.get("annotations", []) if a.get("type") in ("skip", "fixme") and (a.get("description") or "").strip()]
                    if not reasons:
                        unexplained += 1
                elif st != "expected":
                    failed += 1
    if not outcomes:
        failed += 1  # an empty or truncated report is never a pass
    feats = {}
    for f in inventory:
        feats[f["id"]] = sum(1 for title in f.get("tests", []) for st in outcomes.get(title, []) if st == "expected")
    return {"failed": failed, "skipped": skipped, "skips_unexplained": unexplained,
            "features": feats, "tests": sum(len(v) for v in outcomes.values())}


def candidate_stores(root: Path, explicit: str | None) -> list[Path]:
    out = []
    if explicit:
        out.append(Path(explicit))
    if os.environ.get("DASH_ARMY_RECEIPTS"):
        out.append(Path(os.environ["DASH_ARMY_RECEIPTS"]))
    out.append(root / ".native-build-inputs" / "army-receipts")
    out.append(Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "dash" / "army-receipts")
    return out


def fetch_ci_receipt(sha: str, dest: Path) -> str:
    """Download the CI army artifact for this exact commit. Returns a note."""
    name = f"army-receipt-{sha}"
    try:
        runs = subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts?name={name}&per_page=5",
                               "--jq", ".artifacts[] | select(.expired == false) | .workflow_run.id"],
                              capture_output=True, text=True, timeout=60)
        ids = [x for x in runs.stdout.split() if x.strip()]
        if not ids:
            return f"no CI artifact {name}"
        dest.mkdir(parents=True, exist_ok=True)
        p = subprocess.run(["gh", "run", "download", ids[0], "-R", REPO, "-n", name, "-D", str(dest)],
                           capture_output=True, text=True, timeout=300)
        return "fetched from CI" if p.returncode == 0 else f"gh run download failed: {p.stderr.strip()[:200]}"
    except (OSError, subprocess.SubprocessError) as e:
        return f"fetch failed: {e}"


@dataclass
class Evidence:
    rec: Rec | None
    notes: list[str] = field(default_factory=list)
    where: str = ""


def collect(sha: str, root: Path, receipts: str | None = None, fetch: bool = False) -> Evidence:
    stores = candidate_stores(root, receipts)
    rdir = next((s / sha for s in stores if (s / sha / "receipt.json").is_file()), None)
    notes = []
    if rdir is None and fetch:
        dest = stores[-1] / sha
        notes.append(fetch_ci_receipt(sha, dest))
        if (dest / "receipt.json").is_file():
            rdir = dest
    if rdir is None:
        return Evidence(None, notes + [f"no tester-army receipt for {sha} (looked in: {', '.join(str(s) for s in stores)})"])
    try:
        receipt = json.loads((rdir / "receipt.json").read_text())
    except (OSError, ValueError) as e:
        return Evidence(Rec(sha="", failed=1, feats=(), skips=0, army=False), notes + [f"unreadable receipt: {e}"], str(rdir))
    army = True
    if receipt.get("schema") != SCHEMA:
        army = False
        notes.append(f"receipt schema {receipt.get('schema')!r} is not {SCHEMA}")
    runner = receipt.get("runner") or {}
    if runner.get("name") != RUNNER_NAME or runner.get("path") != RUNNER_DIR:
        army = False
        notes.append(f"receipt not produced by the army runner ({runner.get('name')!r}); ad-hoc harness results never count")
    want_digest = runner_digest(root)
    if runner.get("digest") != want_digest:
        army = False
        notes.append("army runner digest differs from this checkout's e2e/mbp-army (edited or different harness)")
    if receipt.get("dirty") is not False:
        army = False
        notes.append("receipt was produced from a dirty tree")
    report_path = rdir / str(receipt.get("report") or "results.json")
    try:
        raw = report_path.read_bytes()
        report = json.loads(raw)
    except (OSError, ValueError) as e:
        return Evidence(Rec(sha=str(receipt.get("sha", "")), failed=1, feats=(), skips=0, army=False),
                        notes + [f"Playwright report missing or unreadable: {e}"], str(rdir))
    if hashlib.sha256(raw).hexdigest() != receipt.get("report_sha256"):
        army = False
        notes.append("report hash does not match the receipt (hand-edited receipt or report)")
    inventory = load_inventory(root)
    s = summarize(report, inventory)
    feats = tuple(s["features"][f["id"]] for f in inventory)
    complete = cov_complete(feats, s["skips_unexplained"])
    if receipt.get("all_pass") is not (s["failed"] == 0) or receipt.get("coverage") != ("complete" if complete else "incomplete"):
        army = False
        notes.append("receipt claims (all_pass/coverage) disagree with its own report")
    if s["failed"]:
        notes.append(f"army red: {s['failed']} test(s) did not pass")
    if s["skips_unexplained"]:
        notes.append(f"{s['skips_unexplained']} test(s) skipped without a reason")
    missing = [f["id"] for f, n in zip(inventory, feats) if n == 0]
    if missing:
        notes.append("features with no passing test: " + ", ".join(missing))
    if not inventory:
        notes.append("feature inventory is empty")
    return Evidence(Rec(sha=str(receipt.get("sha", "")), failed=s["failed"], feats=feats,
                        skips=s["skips_unexplained"], army=army), notes, str(rdir))


def head_sha(root: Path) -> tuple[str, bool, str]:
    """(sha, clean, note) of what is being released. A git checkout is its HEAD and must
    be clean; a fleet source snapshot (no commits) names its revision explicitly."""
    claimed = next((os.environ[e].strip() for e in ("DASH_RELEASE_SHA", "DASH_PROOF_REVISION") if os.environ.get(e, "").strip()), "")
    rev = root / ".native-build-inputs" / "source-revision.txt"
    if not claimed and rev.is_file():
        claimed = rev.read_text().strip()
    p = subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "-q", "HEAD"], capture_output=True, text=True)
    sha = p.stdout.strip() if p.returncode == 0 else ""
    if not sha:
        return claimed, True, ""
    dirty = subprocess.run(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
                           capture_output=True, text=True).stdout.strip()
    if dirty:
        return sha, False, "checkout has uncommitted tracked changes: it is not the receipted commit"
    if claimed and claimed.lower() != sha:
        return sha, False, f"claimed revision {claimed[:12]} is not the checkout HEAD {sha[:12]}"
    return sha, True, ""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="O15 dash-release gate")
    ap.add_argument("--action", required=True, choices=ACTIONS)
    ap.add_argument("--sha", help="40-hex commit being released (default: the checkout's HEAD)")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--receipts")
    ap.add_argument("--fetch", action="store_true", help="download the CI army receipt when none is local")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    clean, note = True, ""
    sha = a.sha
    if not sha:
        sha, clean, note = head_sha(root)
    sha = sha.strip().lower()
    if not SHA_RE.match(sha):
        print(f"O15 DENY {a.action}: build commit {sha!r} is not a full 40-hex sha", file=sys.stderr)
        return 1
    ev = collect(sha, root, a.receipts, a.fetch)
    if not clean:
        ev.notes.append(note)
    ok = clean and gate(a.action, sha, ev.rec)
    verdict = "ALLOW" if ok else "DENY"
    line = (f"O15 {verdict} {a.action} of Dash {sha[:12]}: "
            + ("tester-army receipt is green, complete and for this exact commit" if ok else
               "; ".join(ev.notes) or "receipt does not satisfy release_allows")
            + ". Law: laws/release (O15). Run the army: bun run test")
    if a.json:
        print(json.dumps({"verdict": verdict, "action": a.action, "sha": sha, "receipt_dir": ev.where,
                          "notes": ev.notes, "rec": None if ev.rec is None else ev.rec.__dict__}, default=list))
    print(line, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
