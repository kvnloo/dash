"""Observation-layer tests for scripts/feature_status.py (receipts -> evidence). No Bend needed."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import feature_status as fs  # noqa: E402

SHA, OLD = "a" * 40, "b" * 40
LEDGER = {
    "journeys": [{"id": "J-x", "description": "d"}],
    "features": [
        {"id": "DF-001", "priority": "P0", "title": "t", "requirement": "r", "journey": "J-x",
         "status_from_code": "implemented", "surface_refs": ["a.ts:1"]},
        {"id": "DF-002", "priority": "P1", "title": "t", "requirement": "r", "journey": "J-x",
         "status_from_code": "partial", "surface_refs": ["a.ts:1"]},
    ],
}


def journey(sha=SHA, result="pass", real=True, j="J-x", f="DF-001"):
    return {"kind": "journey", "feature": f, "journey": j, "sha": sha, "real_device": real,
            "device": "S22", "device_observed": True, "result": result}


def preview(sha=SHA, f="DF-001"):
    return {"kind": "preview", "feature": f, "sha": sha, "delivered": True}


def status(receipts, fid="DF-001"):
    rows = fs.evaluate(LEDGER, receipts, SHA)
    return next(r for r in rows if r["id"] == fid)["status"]


class FeatureStatus(unittest.TestCase):
    def test_done_needs_device_pass_and_preview_on_candidate(self):
        self.assertEqual(status([journey(), preview()]), "done")

    def test_stale_sha_is_not_done(self):
        self.assertEqual(status([journey(sha=OLD), preview()]), "open")
        self.assertEqual(status([journey(), preview(sha=OLD)]), "open")

    def test_unit_tests_or_emulator_or_other_journey_do_not_count(self):
        self.assertEqual(status([{"kind": "unit", "feature": "DF-001", "sha": SHA, "result": "pass"}, preview()]), "open")
        self.assertEqual(status([journey(real=False), preview()]), "open")
        self.assertEqual(status([journey(j="J-other"), preview()]), "open")

    def test_candidate_fail_dominates_pass(self):
        self.assertEqual(status([journey(), journey(result="fail"), preview()]), "open")

    def test_partial_code_is_not_done(self):
        self.assertEqual(status([journey(f="DF-002"), preview(f="DF-002")], "DF-002"), "open")

    def test_blocker_needs_reason(self):
        self.assertEqual(status([{"kind": "blocker", "feature": "DF-001", "by": "owner", "reason": " "}]), "open")
        self.assertEqual(status([{"kind": "blocker", "feature": "DF-001", "by": "external", "reason": "z0live repo"}]),
                         "blocked_external")

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "f.yaml"
            ledger.write_text(fs.load_ledger.__globals__["ROOT"].joinpath("spec/features.yaml").read_text())
            ev = Path(folder) / "ev"
            ev.mkdir()
            base = ["--ledger", str(ledger), "--evidence", str(ev), "--candidate", SHA, "--ids", "DF-005"]
            self.assertEqual(fs.main(base), 1)
            self.assertEqual(fs.main(base + ["--budget-exhausted"]), 1)
            self.assertEqual(fs.main(base + ["--owner-stop"]), 0)
            (ev / "r.json").write_text(json.dumps([
                {"kind": "journey", "feature": "DF-005", "journey": "J-send-receive-hermes", "sha": SHA,
                 "real_device": True, "device": "S22", "device_observed": True, "result": "pass"}, preview(f="DF-005")]))
            self.assertEqual(fs.main(base), 0)

    def test_empty_scope_never_stops(self):
        with tempfile.TemporaryDirectory() as folder:
            ledger = Path(folder) / "f.yaml"
            ledger.write_text("journeys: []\nfeatures:\n  - id: \"DF-001\"\n    priority: \"P2\"\n")
            ev = Path(folder) / "ev"
            ev.mkdir()
            self.assertEqual(fs.main(["--ledger", str(ledger), "--evidence", str(ev), "--candidate", SHA,
                                      "--scope", "P0"]), 1)

    def test_host_only_pass_is_not_device_evidence(self):
        host_only = dict(journey(), device_observed=False)
        self.assertEqual(status([host_only, preview()]), "open")
        self.assertEqual(status([dict(journey(), device_observed=None), preview()]), "open")

    def test_owner_blocker_needs_owner_ref(self):
        claim = {"kind": "blocker", "feature": "DF-001", "by": "owner", "reason": "owner wants it later"}
        self.assertEqual(status([claim]), "open")
        self.assertEqual(status([dict(claim, owner_ref="hermes-telegram 2026-10-25T17:22")]), "blocked_owner")

    def test_scope_settled_by_external_blockers_pauses(self):
        self.assertIs(fs.may_stop(True, True, False, False), fs.Run.PAUSE_REPORT)
        self.assertIs(fs.may_stop(True, False, False, False), fs.Run.STOP_COMPLETE)
        self.assertIs(fs.may_stop(True, True, False, True), fs.Run.STOP_OWNER)

    def test_may_stop_never_on_budget_alone(self):
        self.assertIs(fs.may_stop(False, False, True, False), fs.Run.PAUSE_REPORT)


if __name__ == "__main__":
    unittest.main()
