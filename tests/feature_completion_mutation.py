#!/usr/bin/env python3
"""Each mutant re-opens a 2026-10-25 false-completion path and must fail the unchanged laws.

Scratch copies only. A valid reference verdict is mandatory before a mutant failure counts.
"""
from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bend_verifier import verifier_environment  # noqa: E402

ROOT = Path(__file__).resolve().parents[1] / "bend/feature_completion"
MUTATIONS = [
    ("stale-sha pass counts",
     "    case JPassOtherSha{}:\n      SOpen{}",
     "    case JPassOtherSha{}:\n      check_preview(preview, code_present, spec_linked)"),
    ("missing preview counts as done",
     "    case PNone{}:\n      SOpen{}",
     "    case PNone{}:\n      check_code(code_present, spec_linked)"),
    ("unit-tests-only counts as done",
     "    case JNone{}:\n      SOpen{}",
     "    case JNone{}:\n      check_preview(preview, code_present, spec_linked)"),
    ("failed journey counts as done",
     "    case JFail{}:\n      SOpen{}",
     "    case JFail{}:\n      check_preview(preview, code_present, spec_linked)"),
    ("missing code counts as done",
     "      check_spec(spec_linked)\n    case False{}:\n      SOpen{}",
     "      check_spec(spec_linked)\n    case False{}:\n      SDone{}"),
    ("unlinked spec counts as done",
     "    case False{}:\n      SOpen{}\n\ndef check_code",
     "    case False{}:\n      SDone{}\n\ndef check_code"),
    ("all-external-blocked scope stops",
     "    case True{}:\n      RPauseReport{}\n    case False{}:\n      RStopComplete{}",
     "    case True{}:\n      RStopComplete{}\n    case False{}:\n      RStopComplete{}"),
    ("budget exhaustion stops",
     "    case True{}:\n      RPauseReport{}\n    case False{}:\n      RContinue{}",
     "    case True{}:\n      RStopComplete{}\n    case False{}:\n      RContinue{}"),
    ("blocked without reason",
     "    case BNoReason{}:\n      evidence(spec_linked, code_present, journey, preview)",
     "    case BNoReason{}:\n      SBlockedOwner{}"),
    ("owner stop ignored",
     "    case True{}:\n      RStopOwner{}",
     "    case True{}:\n      check_scope(all_done_or_blocked, any_external_blocked, budget_exhausted)"),
]


def verify(bend, cwd, env):
    return subprocess.run([bend, "PROOF.bend", "--verdict"], cwd=cwd,
                          capture_output=True, text=True, env=env, timeout=1800)


def main():
    with verifier_environment(ROOT) as (bend, env), tempfile.TemporaryDirectory() as folder:
        scratch = Path(folder)
        for filename in ("MODEL.bend", "LAWS.bend", "PROOF.bend"):
            shutil.copy2(ROOT / filename, scratch / filename)
        reference = verify(bend, scratch, env)
        output = reference.stdout + reference.stderr
        if (reference.returncode or reference.stdout.strip() != "ALL PROOFS CHECK"
                or "SOME PROOFS FAIL" in output.splitlines()):
            raise AssertionError("reference proof failed: " + output[-2000:])
        print("feature completion: reference ALL PROOFS CHECK")
        source = (scratch / "MODEL.bend").read_text()
        for label, old, broken in MUTATIONS:
            if source.count(old) != 1:
                raise AssertionError(f"{label}: mutation anchor changed; review model diff")
            (scratch / "MODEL.bend").write_text(source.replace(old, broken))
            mutant = verify(bend, scratch, env)
            output = mutant.stdout + mutant.stderr
            # A compiler/toolchain crash is not evidence of a rejected law.
            if (mutant.returncode == 0 or "SOME PROOFS FAIL" not in output.splitlines()
                    or "ALL PROOFS CHECK" in output.splitlines()):
                raise AssertionError(f"{label}: no explicit failed-proof verdict: " + output[-2000:])
            print(f"feature completion: {label} mutation rejected")
        (scratch / "MODEL.bend").write_text(source)
    print("source_semantics_attested=false; runtime_observed=false; proof_is_permission=false")


if __name__ == "__main__":
    main()
