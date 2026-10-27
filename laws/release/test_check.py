"""O15 check.py: parity with release.bend, and the evidence rules.

    python3 -m unittest laws/release/test_check.py -v

Parity runs Bend (`$BEND` or ~/.bend/bin/bend) on the decision function and
compares every case with the Python mirror; it is skipped where Bend is absent
(the proof runs report it as passed, never skipped). The evidence tests need
only Python.
"""
from __future__ import annotations

import importlib.util
import itertools
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


C = load("o15_check", HERE / "check.py")
W = load("o15_receipt", ROOT / "e2e/mbp-army/receipt.py")
BEND = os.environ.get("BEND", str(Path.home() / ".bend/bin/bend"))
ACT = {"install": "RInstall", "promote": "RPromote", "ota": "ROta", "merge": "RMerge"}


def cases():
    feats = [(), (0,), (1,), (2, 0), (1, 3), (0, 1), (1, 1, 1), (2, 1, 0)]
    recs = [None] + [C.Rec(sha=str(s), failed=f, feats=fs, skips=k, army=a)
                     for s, f, fs, k, a in itertools.product((0, 1), (0, 1, 2), feats, (0, 1), (False, True))]
    for action, build, r in itertools.product(ACT, (0, 1), recs):
        yield action, build, r


def bend_expr(action: str, build: int, r) -> str:
    rec = "R.RNone{}" if r is None else (
        f"R.RFound{{{r.sha}n, {r.failed}n, [{', '.join(f'{x}n' for x in r.feats)}], {r.skips}n, {'True' if r.army else 'False'}{{}}}}")
    return f"R.gate(R.{ACT[action]}{{}}, {build}n, {rec})"


@unittest.skipUnless(Path(BEND).exists() or shutil.which("bend"), "bend not installed")
class Parity(unittest.TestCase):
    def run_bend(self, rows):
        with tempfile.TemporaryDirectory() as td:
            shutil.copy(HERE / "release.bend", Path(td) / "release.bend")
            src = "import Base\nimport ./release.bend as R\n\ndef main() -> List<&2, Bool>:\n  [" + ",\n   ".join(rows) + "]\n"
            (Path(td) / "parity.bend").write_text(src)
            p = subprocess.run([BEND if Path(BEND).exists() else "bend", "parity.bend"], cwd=td, capture_output=True, text=True, timeout=600)
            line = next((ln for ln in p.stdout.splitlines() if ln.startswith("[")), "")
            self.assertTrue(line, p.stdout + p.stderr)
            return [x.strip() for x in line.strip("[]").split(",")]

    def test_parity_with_bend_book(self):
        cs = list(cases())
        got = self.run_bend([bend_expr(a, b, r) for a, b, r in cs])
        want = ["True{}" if C.gate(a, str(b), r) else "False{}" for a, b, r in cs]
        self.assertEqual(len(got), len(want))
        bad = [(cs[i], got[i]) for i in range(len(cs)) if got[i] != want[i]]
        self.assertEqual(bad, [])
        self.assertIn("True{}", got)  # the domain contains allowed releases

    def test_parity_catches_a_sabotaged_gate(self):
        cs = [c for c in cases() if c[2] is None][:4]
        got = self.run_bend([bend_expr(a, b, r) for a, b, r in cs])
        sabotaged = ["True{}" for _ in cs]  # a gate that lets everything through
        self.assertNotEqual(got, sabotaged)


def report(statuses: dict[str, str], skip_reason: str = "") -> dict:
    specs = []
    for title, st in statuses.items():
        ann = [{"type": "skip", "description": skip_reason}] if st == "skipped" and skip_reason else []
        specs.append({"title": title, "tests": [{"status": st, "annotations": ann}]})
    return {"suites": [{"title": "army.spec.ts", "specs": specs, "suites": []}], "stats": {}}


ALL = sorted({t for f in C.load_inventory(ROOT) for t in f["tests"]})
SHA = "a" * 40


class Evidence(unittest.TestCase):
    def setUp(self):
        self.td = Path(tempfile.mkdtemp())
        self.store = self.td / "store"

    def tearDown(self):
        shutil.rmtree(self.td)

    def make(self, statuses, sha=SHA, dirty=False, skip_reason="", edit=None):
        rp = self.td / "results.json"
        rp.write_text(json.dumps(report(statuses, skip_reason)))
        rec = W.build_receipt(rp, self.td / "run", sha, dirty)
        if edit:
            edit(rec)
        W.write(rec, rp, [self.store / sha])
        return rec

    def verdict(self, action="install", sha=SHA):
        ev = C.collect(sha, ROOT, str(self.store))
        return C.gate(action, sha, ev.rec), ev.notes

    def test_green_complete_receipt_allows_every_action(self):
        self.make({t: "expected" for t in ALL})
        for a in C.ACTIONS:
            self.assertEqual(self.verdict(a)[0], True, a)

    def test_no_receipt_denies(self):
        ok, notes = self.verdict()
        self.assertFalse(ok)
        self.assertIn("no tester-army receipt", notes[-1])

    def test_red_denies(self):
        st = {t: "expected" for t in ALL}
        st[ALL[0]] = "unexpected"
        self.make(st)
        self.assertFalse(self.verdict()[0])

    def test_flaky_counts_as_red(self):
        st = {t: "expected" for t in ALL}
        st[ALL[-1]] = "flaky"
        self.make(st)
        self.assertFalse(self.verdict()[0])

    def test_other_sha_denies(self):
        self.make({t: "expected" for t in ALL}, sha="b" * 40)
        shutil.copytree(self.store / ("b" * 40), self.store / SHA)  # receipt for b filed under a
        self.assertFalse(self.verdict()[0])

    def test_missing_feature_denies(self):
        self.make({t: "expected" for t in ALL if "approvals" not in t})
        ok, notes = self.verdict()
        self.assertFalse(ok)
        self.assertTrue(any("approvals" in n for n in notes), notes)

    def test_unexplained_skip_denies_and_explained_skip_does_not_cover(self):
        st = {t: "expected" for t in ALL}
        st[ALL[0]] = "skipped"
        self.make(st)
        self.assertFalse(self.verdict()[0])
        self.make(st, skip_reason="flaky on CI")
        ok, _ = self.verdict()
        # an explained skip is allowed, but only if its feature is still covered elsewhere
        feats = {f["id"]: f["tests"] for f in C.load_inventory(ROOT)}
        covered = all(any(t != ALL[0] for t in ts) for ts in feats.values() if ALL[0] in ts)
        self.assertEqual(ok, covered)

    def test_empty_report_denies(self):
        self.make({})
        self.assertFalse(self.verdict()[0])

    def test_adhoc_runner_denies(self):
        self.make({t: "expected" for t in ALL}, edit=lambda r: r["runner"].update(name="native-journeys"))
        self.assertFalse(self.verdict()[0])

    def test_edited_army_digest_denies(self):
        self.make({t: "expected" for t in ALL}, edit=lambda r: r["runner"].update(digest="0" * 64))
        self.assertFalse(self.verdict()[0])

    def test_dirty_tree_receipt_denies(self):
        self.make({t: "expected" for t in ALL}, dirty=True)
        self.assertFalse(self.verdict()[0])

    def test_hand_edited_report_denies(self):
        st = {t: "expected" for t in ALL}
        st[ALL[0]] = "unexpected"
        self.make(st)
        (self.store / SHA / "results.json").write_text(json.dumps(report({t: "expected" for t in ALL})))
        ok, notes = self.verdict()
        self.assertFalse(ok)
        self.assertTrue(any("hash" in n for n in notes), notes)

    def test_hand_written_claims_deny(self):
        st = {t: "expected" for t in ALL}
        st[ALL[0]] = "unexpected"
        self.make(st, edit=lambda r: r.update(all_pass=True))
        self.assertFalse(self.verdict()[0])

    def test_short_sha_denied_by_cli(self):
        self.assertEqual(C.main(["--action", "install", "--sha", "abc1234", "--receipts", str(self.store)]), 1)


if __name__ == "__main__":
    unittest.main()
