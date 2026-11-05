#!/usr/bin/env python3
"""O15 dash-release: are the laws load-bearing? Apply one broken variant of
release.bend at a time (in a scratch copy), run `bend PROOF.bend`, and require
SOME PROOFS FAIL. The reference release.bend is never edited in place.

Each mutation is the bug a law exists to catch, written the way it would show
up in a release gate. Mutants preserve expression types: a mutant only counts
as rejected when a proof fails, never when the file fails to parse.

    python3 laws/release/mutations.py [--verdict] [--out mutations.json]
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

R_OK = ("  Bool.and(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), "
        "Bool.and(cov_complete(fs, skips), army)))")
COV = "      Bool.and(Nat.is_eq(skips, 0n), Bool.and(Nat.is_gt(h, 0n), all_pos(t)))"
ALLPOS = "      Bool.and(Nat.is_gt(h, 0n), all_pos(t))"

# (law, description, old text, new text)
MUTATIONS = [
    ("L1 o15_no_receipt_denies", "no receipt allows release",
     "    case RNone{}:\n      False{}", "    case RNone{}:\n      True{}"),
    ("L2 o15_red_denies", "red army allowed (failed count ignored)",
     R_OK, "  Bool.and(Nat.is_eq(build, sha), Bool.and(True{}, Bool.and(cov_complete(fs, skips), army)))"),
    ("L2 o15_red_denies", "one failing test tolerated",
     R_OK, "  Bool.and(Nat.is_eq(build, sha), Bool.and(Nat.is_le(failed, 1n), Bool.and(cov_complete(fs, skips), army)))"),
    ("L3 o15_other_sha_denies", "receipt for any commit counts",
     R_OK, "  Bool.and(True{}, Bool.and(Nat.is_eq(failed, 0n), Bool.and(cov_complete(fs, skips), army)))"),
    ("L3 o15_other_sha_denies", "receipt for an older commit counts",
     R_OK, "  Bool.and(Nat.is_ge(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(cov_complete(fs, skips), army)))"),
    ("L4 o15_incomplete_denies", "coverage not required",
     R_OK, "  Bool.and(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(True{}, army)))"),
    ("L4a o15_empty_inventory_incomplete", "empty feature inventory counts as complete",
     "    case Nil{}:\n      False{}\n    case h <> t:\n      Bool.and(Nat.is_eq(skips",
     "    case Nil{}:\n      True{}\n    case h <> t:\n      Bool.and(Nat.is_eq(skips"),
    ("L4b o15_unexplained_skip_incomplete", "skips without a reason ignored",
     COV, "      Bool.and(True{}, Bool.and(Nat.is_gt(h, 0n), all_pos(t)))"),
    ("L4b o15_unexplained_skip_incomplete", "one unexplained skip tolerated",
     COV, "      Bool.and(Nat.is_le(skips, 1n), Bool.and(Nat.is_gt(h, 0n), all_pos(t)))"),
    ("L4c o15_uncovered_feature_incomplete", "first feature need not pass",
     COV, "      Bool.and(Nat.is_eq(skips, 0n), Bool.and(Nat.is_ge(h, 0n), all_pos(t)))"),
    ("L4c o15_uncovered_feature_incomplete", "only the first feature is checked",
     COV, "      Bool.and(Nat.is_eq(skips, 0n), Bool.and(Nat.is_gt(h, 0n), True{}))"),
    ("L4c o15_uncovered_feature_incomplete", "later features need not pass",
     ALLPOS, "      Bool.and(Nat.is_ge(h, 0n), all_pos(t))"),
    ("L4c o15_uncovered_feature_incomplete", "inventory scan stops after the second feature",
     ALLPOS, "      Bool.and(Nat.is_gt(h, 0n), True{})"),
    ("L5 o15_adhoc_denies", "ad-hoc harness results count",
     R_OK, "  Bool.and(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(cov_complete(fs, skips), True{})))"),
    ("L6 o15_one_gate", "phone install bypasses the gate",
     "    case RInstall{}:\n      release_allows(build, r)", "    case RInstall{}:\n      True{}"),
    ("L6 o15_one_gate", "promotion bypasses the gate",
     "    case RPromote{}:\n      release_allows(build, r)", "    case RPromote{}:\n      True{}"),
    ("L6 o15_one_gate", "channel/OTA bypasses the gate",
     "    case ROta{}:\n      release_allows(build, r)", "    case ROta{}:\n      True{}"),
    ("L6 o15_one_gate", "merge bypasses the gate",
     "    case RMerge{}:\n      release_allows(build, r)", "    case RMerge{}:\n      True{}"),
    ("L7 o15_green_allows", "gate denies everything (vacuous)",
     "    case RFound{sha, failed, feats, skips, army}:\n      r_ok(build, sha, failed, feats, skips, army)",
     "    case RFound{sha, failed, feats, skips, army}:\n      False{}"),
    ("L7 o15_green_allows", "install path denies everything",
     "    case RInstall{}:\n      release_allows(build, r)", "    case RInstall{}:\n      False{}"),
]

PARSE_MARKERS = ("Parse error", "PARSE ERROR", "Unexpected token", "expected : a filled definition")


def check(proj: Path, verdict: bool) -> tuple[bool, str]:
    env = dict(os.environ)
    env["PATH"] = "/usr/bin:" + env.get("PATH", "") + ":" + str(Path.home() / ".elan/bin")
    cmd = [BEND, "PROOF.bend"] + (["--verdict"] if verdict else [])
    p = subprocess.run(cmd, cwd=proj, capture_output=True, text=True, env=env, timeout=600)
    out = (p.stdout + p.stderr).strip()
    return ("ALL PROOFS CHECK" in out and "SOME PROOFS FAIL" not in out), out


def first_location(out: str) -> str:
    for line in out.splitlines():
        if line.startswith("Location:"):
            return line.split(":", 1)[1].strip()
    lines = out.splitlines()
    return lines[1] if len(lines) > 1 else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verdict", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()
    rows = []
    with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as td:
        work = Path(td)
        for f in ("release.bend", "LAWS.bend", "PROOF.bend"):
            shutil.copy(HERE / f, work / f)
        ok, out = check(work, args.verdict)
        rows.append({"law": "-", "mutation": "reference (unmodified)", "proofs_check": ok,
                     "where": "" if ok else first_location(out)})
        ref = (HERE / "release.bend").read_text()
        for law, desc, old, new in MUTATIONS:
            if ref.count(old) != 1:
                rows.append({"law": law, "mutation": desc, "proofs_check": None,
                             "where": f"MUTATION DID NOT APPLY (matches: {ref.count(old)})"})
                continue
            (work / "release.bend").write_text(ref.replace(old, new))
            ok, out = check(work, args.verdict)
            parse = any(m in out for m in PARSE_MARKERS)
            rows.append({"law": law, "mutation": desc,
                         "proofs_check": None if parse else ok,
                         "where": "MUTANT DID NOT PARSE" if parse else ("" if ok else first_location(out))})
    ref_ok = rows[0]["proofs_check"] is True
    caught = sum(1 for r in rows[1:] if r["proofs_check"] is False)
    for r in rows:
        status = {True: "PASS", False: "FAIL", None: "N/A"}[r["proofs_check"]]
        print(f"{status:4}  {r['law']:40} {r['mutation']}  {r['where']}")
    print(f"reference passes: {ref_ok}; mutations rejected: {caught}/{len(MUTATIONS)}")
    if args.out:
        Path(args.out).write_text(json.dumps({"verdict_mode": args.verdict, "rows": rows,
                                              "rejected": caught, "total": len(MUTATIONS),
                                              "reference_restored": True}, indent=2) + "\n")
    return 0 if ref_ok and caught == len(MUTATIONS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
