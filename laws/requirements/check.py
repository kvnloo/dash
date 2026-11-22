"""Resolve owner spec links and run the Bend traceability decision on those facts."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BOOK = Path(__file__).resolve().parent
# Independently pin the IDs supplied in the owner ledger snapshot, so deleting
# a row from the map cannot make the check vacuously green.
IMPORTED = {"DA-071"}
ARMY = "e2e/mbp-army"


def army_tests(suites):
    for suite in suites:
        for spec in suite.get("specs", []):
            if any(test["expectedStatus"] == "passed" for test in spec["tests"]):
                yield spec["file"], spec["title"]
        yield from army_tests(suite.get("suites", []))


def links(rows, tracked, army, law_tests):
    ids = [row["id"] for row in rows]
    if len(set(ids)) != len(ids) or not IMPORTED.issubset(ids):
        raise ValueError(f"duplicate or missing owner requirements (required: {sorted(IMPORTED)})")
    spec_ids = set()
    for row in rows:
        rid = row["id"]
        if not re.fullmatch(r"DA-[0-9]+", rid) or not row["ask"].strip():
            raise ValueError(f"{rid}: invalid owner requirement")
        spec = row.get("spec", {})
        sid = spec.get("id")
        if sid in spec_ids:
            raise ValueError(f"{rid}: duplicate spec item {sid}")
        spec_ids.add(sid)
        code = spec.get("code", [])
        tests = spec.get("tests", [])
        valid_spec = bool(sid and spec.get("statement", "").strip())
        valid_code = isinstance(code, list) and bool(code) and all(path in tracked for path in code)

        def resolves(ref):
            if ref["kind"] == "law":
                return rid == "DA-071" and ref["name"] in law_tests
            if ref["kind"] == "army":
                return army.count((ref["file"], ref["name"])) == 1
            return False

        valid_tests = isinstance(tests, list) and bool(tests) and all(map(resolves, tests))
        yield rid, (valid_spec, valid_code, valid_tests)


def decisions(facts):
    def bend_bool(value):
        return "True{}" if value else "False{}"

    checks = [
        "bit(M.traceable(" + ", ".join(map(bend_bool, values)) + "))"
        for _, values in facts
    ]
    with tempfile.TemporaryDirectory(prefix="dash-owner-laws-") as folder:
        cwd = Path(folder)
        shutil.copyfile(BOOK / "MODEL.bend", cwd / "MODEL.bend")
        (cwd / "check.bend").write_text(
            'import Base\nimport ./MODEL.bend as M\n\n'
            'def bit(b: Bool) -> String:\n  match b:\n'
            '    case True{}:\n      "1"\n    case False{}:\n      "0"\n\n'
            'def main() -> IO(Unit):\n  IO.print(' + " ++ ".join(checks) + ')\n'
        )
        result = subprocess.run([os.environ["BEND"], "check.bend"], cwd=cwd,
                                check=True, capture_output=True, text=True, timeout=120)
    bits = result.stdout.strip()
    if len(bits) != len(facts) or set(bits) - {"0", "1"}:
        raise ValueError(f"invalid Bend verdict: {bits!r}")
    return [rid for (rid, _), bit in zip(facts, bits) if bit == "0"]


def main():
    from test_check import TraceabilityTests

    rows = json.loads((ROOT / "spec/owner-requirements.json").read_text())["requirements"]
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT, text=True).split("\0")
    tracked = {path for path in tracked if (ROOT / path).is_file()}
    report = subprocess.check_output(
        ["node", "node_modules/playwright/cli.js", "test", "-c",
         f"{ARMY}/playwright.config.ts", "--list", "--reporter=json"], cwd=ROOT, text=True)
    discovered = list(army_tests(json.loads(report)["suites"]))
    law_tests = unittest.defaultTestLoader.getTestCaseNames(TraceabilityTests)
    facts = list(links(rows, tracked, discovered, law_tests))
    rejected = decisions(facts)
    for rid, values in facts:
        if rid in rejected:
            missing = ", ".join(label for label, ok in zip(("spec", "code", "test"), values) if not ok)
            print(f"{rid}: traceability law failed ({missing or 'unexpected Bend rejection'})")
    if rejected:
        return 1
    print(f"owner requirements: {len(facts)} traceable; {len(discovered)} runnable army test declarations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
