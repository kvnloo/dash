#!/usr/bin/env python3
"""Exhaustive Bend/Python parity for feature completion:
4 * 2 * 2 * 4 * 2 = 128 decide cases + 2 * 2 * 2 * 2 = 16 may_stop cases.

Executes the real MODEL.decide / MODEL.may_stop through Bend. No device, git or receipt effects.
"""
from __future__ import annotations

import itertools
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bend_verifier import verifier_environment  # noqa: E402
from feature_status import Blocker, Journey, Preview, decide_status, may_stop, run_code, status_code  # noqa: E402

DOMAIN = ROOT / "bend/feature_completion"


def b(value):
    return "True{}" if value else "False{}"


def main():
    exprs, expected = [], []
    for blocked, spec, code, journey, preview in itertools.product(
            Blocker, (False, True), (False, True), Journey, Preview):
        exprs.append(f"Nat.show(M.status_code(M.decide(M.{blocked.value}{{}}, {b(spec)}, {b(code)}, "
                     f"M.{journey.value}{{}}, M.{preview.value}{{}})))")
        expected.append(str(status_code(decide_status(blocked, spec, code, journey, preview))))
    for settled, external, budget, owner in itertools.product((False, True), repeat=4):
        exprs.append(f"Nat.show(M.run_code(M.may_stop({b(settled)}, {b(external)}, {b(budget)}, {b(owner)})))")
        expected.append(str(run_code(may_stop(settled, external, budget, owner))))
    with verifier_environment(DOMAIN) as (bend, env), tempfile.TemporaryDirectory() as folder:
        working = Path(folder)
        shutil.copy2(DOMAIN / "MODEL.bend", working / "MODEL.bend")
        (working / "cases.bend").write_text(
            "import Base\nimport ./MODEL.bend as M\n\n"
            + "def main() -> IO(Unit):\n  IO.print(\n    "
            + " ++\n    ".join(exprs) + ")\n")
        result = subprocess.run([bend, "cases.bend"], cwd=working, env=env,
                                capture_output=True, text=True, timeout=600)
    if result.returncode:
        raise RuntimeError("Bend parity execution failed: " + (result.stderr + result.stdout)[-2000:])
    actual, want = result.stdout.strip(), "".join(expected)
    if actual != want:
        raise AssertionError(f"Bend/Python feature completion parity mismatch for {len(exprs)} cases:\n"
                             f"actual:   {actual[:900]}\nexpected: {want[:900]}")
    print(f"feature completion: {len(exprs)} exhaustive Bend/Python cases match")


if __name__ == "__main__":
    main()
