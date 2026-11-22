"""Traceability gate regressions, not application behavior tests."""

from copy import deepcopy
import unittest

from check import army_tests, decisions, links


class TraceabilityTests(unittest.TestCase):
    row = {
        "id": "DA-071", "ask": "Trace every owner requirement",
        "spec": {
            "id": "traceability", "statement": "Reject unresolved links.",
            "code": ["app.ts"],
            "tests": [{"kind": "army", "file": "fixture.spec.ts", "name": "can open chat"}],
        },
    }

    def verify(self, mutate=lambda row: None, *, status="passed"):
        row = deepcopy(self.row)
        mutate(row)
        suites = [{"suites": [{"specs": [{
            "file": "fixture.spec.ts", "title": "can open chat",
            "tests": [{"expectedStatus": status}],
        }]}]}]
        return decisions(list(links([row], {"app.ts"}, list(army_tests(suites)), [])))

    def test_live_links_pass(self):
        self.assertEqual(self.verify(), [])

    def test_missing_test_fails(self):
        self.assertEqual(self.verify(lambda row: row["spec"].pop("tests")), ["DA-071"])

    def test_stale_army_test_fails(self):
        def rename(row):
            row["spec"]["tests"][0]["name"] = "removed journey"
        self.assertEqual(self.verify(rename), ["DA-071"])

    def test_skipped_army_test_fails(self):
        self.assertEqual(self.verify(status="skipped"), ["DA-071"])

    def test_missing_code_fails(self):
        self.assertEqual(self.verify(lambda row: row["spec"].pop("code")), ["DA-071"])

    def test_missing_spec_fails(self):
        self.assertEqual(self.verify(lambda row: row.pop("spec")), ["DA-071"])

    def test_deleted_imported_id_fails(self):
        with self.assertRaisesRegex(ValueError, "DA-071"):
            list(links([], set(), [], []))
