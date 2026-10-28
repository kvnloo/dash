#!/usr/bin/env python3
"""Write the O15 tester-army receipt for one finished army run.

    python3 e2e/mbp-army/receipt.py <results.json> <run_dir> [--store DIR]

Called by the army runners (scripts/army.sh, e2e/mbp-army/run.py) right after
Playwright exits; never by hand. The receipt names the exact commit, the
runner digest, the run directory and the sha256 of the Playwright report, and
is written next to a copy of that report under <store>/<sha>/. The verdict
fields are computed by laws/release/check.py, the same code the gates run.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("o15_check", ROOT / "laws/release/check.py")
check = importlib.util.module_from_spec(spec)
sys.modules.setdefault("o15_check", check)
spec.loader.exec_module(check)


def git(*a: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True).stdout.strip()


def build_receipt(report_path: Path, run_dir: Path, sha: str, dirty: bool, started: str | None = None) -> dict:
    raw = Path(report_path).read_bytes()
    report = json.loads(raw)
    inventory = check.load_inventory(ROOT)
    s = check.summarize(report, inventory)
    feats = tuple(s["features"][f["id"]] for f in inventory)
    complete = check.cov_complete(feats, s["skips_unexplained"])
    return {
        "schema": check.SCHEMA,
        "sha": sha,
        "dirty": dirty,
        "all_pass": s["failed"] == 0,
        "coverage": "complete" if complete else "incomplete",
        "counts": {"tests": s["tests"], "failed": s["failed"], "skipped": s["skipped"],
                   "skipped_without_reason": s["skips_unexplained"]},
        "features": s["features"],
        "runner": {"name": check.RUNNER_NAME, "path": check.RUNNER_DIR, "digest": check.runner_digest(ROOT)},
        "run_dir": str(Path(run_dir).resolve()),
        "report": "results.json",
        "report_sha256": hashlib.sha256(raw).hexdigest(),
        "ci": {k: os.environ[k] for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_WORKFLOW") if k in os.environ},
        "started_at": started,
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }


def write(receipt: dict, report_path: Path, dirs: list[Path]) -> None:
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(report_path, d / "results.json")
        (d / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("run_dir")
    ap.add_argument("--store", default=None)
    ap.add_argument("--started", default=None)
    a = ap.parse_args()
    sha = git("rev-parse", "HEAD")
    dirty = bool(git("status", "--porcelain", "--untracked-files=no"))
    receipt = build_receipt(Path(a.report), Path(a.run_dir), sha, dirty, a.started)
    store = a.store or os.environ.get("DASH_ARMY_RECEIPTS") or str(
        Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "dash" / "army-receipts")
    dirs = [Path(a.run_dir) / "receipt", Path(store) / sha]
    write(receipt, Path(a.report), dirs)
    print(json.dumps({k: receipt[k] for k in ("sha", "dirty", "all_pass", "coverage", "counts")}))
    print("receipt:", " ".join(str(d / "receipt.json") for d in dirs))
    return 0 if receipt["all_pass"] and receipt["coverage"] == "complete" and not dirty else 1


if __name__ == "__main__":
    sys.exit(main())
