"""Tests for spec/check.py. Run: python3 -m unittest discover -s spec -p 'test_*.py'"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import check

HERE = Path(__file__).resolve().parent
SCHEMA = json.loads((HERE / "schema.json").read_text(encoding="utf-8"))


def feature(**over):
    base = {
        "id": "DF-001", "title": "Load every chat", "area": "chat-roster",
        "requirement": "Dash lists every chat from every harness on every host.",
        "owner_quotes": ["Dash must load EVERY chat"], "sources": ["brief"],
        "surface_refs": ["app/a.ts:2"], "status_from_code": "partial", "journey": "J-chat-list",
        "priority": "P0", "recurring": True,
    }
    base.update(over)
    return base


def doc(*features):
    return {"version": 1, "baseline": "abcdef0",
            "journeys": [{"id": "J-chat-list", "description": "Open Chats and see every session once."}],
            "features": list(features) or [feature()]}


class RepoCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        run = lambda *a: subprocess.run(["git", "-C", str(self.repo), *a], check=True, capture_output=True)
        run("init", "-q")
        (self.repo / "app").mkdir()
        (self.repo / "app" / "a.ts").write_text("one\ntwo\nthree\n")
        run("add", ".")
        run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
        (self.repo / "app" / "untracked.ts").write_text("x\n")

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self, d):
        return check.check(d, SCHEMA, self.repo)

    def test_valid_document_passes(self):
        self.assertEqual(self.errors(doc()), [])

    def test_ref_must_exist_at_head(self):
        self.assertTrue(any("does not exist" in e for e in self.errors(doc(feature(surface_refs=["app/untracked.ts:1"])))))

    def test_ref_line_must_be_in_file(self):
        self.assertTrue(any("past end" in e for e in self.errors(doc(feature(surface_refs=["app/a.ts:4"])))))

    def test_duplicate_ids_fail(self):
        errs = self.errors(doc(feature(), feature()))
        self.assertTrue(any("duplicate feature id DF-001" in e for e in errs))

    def test_ids_must_be_contiguous(self):
        self.assertTrue(any("contiguous" in e for e in self.errors(doc(feature(id="DF-002")))))

    def test_schema_rejects_bad_status_and_extra_keys(self):
        errs = self.errors(doc(feature(status_from_code="done", extra=1)))
        self.assertTrue(any("not in" in e for e in errs))
        self.assertTrue(any("unexpected key extra" in e for e in errs))

    def test_schema_caps_quotes_at_three(self):
        self.assertTrue(any("more than 3" in e for e in self.errors(doc(feature(owner_quotes=["aaa"] * 4)))))

    def test_unknown_journey_fails(self):
        self.assertTrue(any("not defined" in e for e in self.errors(doc(feature(journey="J-nope")))))

    def test_missing_status_law(self):
        self.assertTrue(any("status missing" in e for e in self.errors(doc(feature(status_from_code="missing")))))
        ok = feature(status_from_code="missing", surface_refs=[], gap_refs=["app/a.ts:1"])
        self.assertEqual(self.errors(doc(ok)), [])
        self.assertTrue(any("needs surface_refs" in e for e in self.errors(doc(feature(surface_refs=[])))))

    def test_recurring_is_p0(self):
        self.assertTrue(any("P0" in e for e in self.errors(doc(feature(priority="P1")))))

    def test_main_exit_codes(self):
        good = self.repo / "good.yaml"
        good.write_text(check.dump_yaml(doc(feature(sources=["H-001"]))) + "\n")
        rp = self.repo / "replay.yaml"
        rp.write_text(check.dump_yaml(replay("H-001")) + "\n")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check.main(["--features", str(good), "--replay", str(rp), "--repo", str(self.repo)]), 0)
        rp.write_text(check.dump_yaml(replay("H-001", "H-002")) + "\n")
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(check.main(["--features", str(good), "--replay", str(rp), "--repo", str(self.repo)]), 1)
        self.assertIn("H-002", err.getvalue())
        bad = self.repo / "bad.yaml"
        bad.write_text(check.dump_yaml(doc(feature(), feature())) + "\n")
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(check.main(["--features", str(bad), "--repo", str(self.repo)]), 1)
        self.assertIn("duplicate feature id", err.getvalue())


class YamlCase(unittest.TestCase):
    def test_round_trip(self):
        d = doc(feature(owner_quotes=['quote: with "colon" and emoji 😢'], surface_refs=[]))
        self.assertEqual(check.load_yaml(check.dump_yaml(d)), d)

    def test_rejects_non_json_scalar(self):
        with self.assertRaises(check.YamlError):
            check.load_yaml("a: plain words\n")

    def test_rejects_duplicate_keys(self):
        with self.assertRaises(check.YamlError):
            check.load_yaml('a: 1\na: 2\n')

    def test_real_ledger_parses_and_matches_schema(self):
        real = check.load_yaml((HERE / "features.yaml").read_text(encoding="utf-8"))
        self.assertEqual(check.validate(real, SCHEMA, SCHEMA), [])
        self.assertEqual(copy.deepcopy(real), check.load_yaml(check.dump_yaml(real)))



def replay(*ids, excused=()):
    return {"corpora": [{"id": "owner", "prefix": "H",
                         "turns": [{"id": i, "date": "2026-10-25", "refs": ["hermes:1"]} for i in ids]}],
            "not_requirements": [{"id": i, "reason": "not about Dash"} for i in excused]}


class ReplayLaw(unittest.TestCase):
    def test_every_turn_cited_and_every_citation_replayed(self):
        d = doc(feature(sources=["H-001, H-002", "dash#50"]))
        self.assertEqual(check.check_replay(d, replay("H-001", "H-002")), [])

    def test_uncited_owner_turn_is_an_error(self):
        errs = check.check_replay(doc(feature(sources=["H-001"])), replay("H-001", "H-003"))
        self.assertTrue(any("H-003" in e and "cited by no feature" in e for e in errs), errs)
        self.assertEqual(check.check_replay(doc(feature(sources=["H-001"])), replay("H-001", "H-003", excused=["H-003"])), [])

    def test_invented_citation_is_an_error(self):
        errs = check.check_replay(doc(feature(sources=["H-001 H-009"])), replay("H-001"))
        self.assertTrue(any("H-009" in e and "not a replayed turn" in e for e in errs), errs)

    def test_excuse_needs_reason_and_turn_needs_provenance(self):
        r = replay("H-001")
        r["not_requirements"] = [{"id": "H-001", "reason": " "}]
        self.assertTrue(check.check_replay(doc(feature(sources=["H-001"])), r))
        r = replay("H-001")
        r["corpora"][0]["turns"][0]["refs"] = []
        self.assertTrue(check.check_replay(doc(feature(sources=["H-001"])), r))

    def test_real_ledger_and_replay_cover_each_other(self):
        real = check.load_yaml((HERE / "features.yaml").read_text(encoding="utf-8"))
        rep = check.load_yaml((HERE / "replay.yaml").read_text(encoding="utf-8"))
        self.assertEqual(check.check_replay(real, rep), [])


if __name__ == "__main__":
    unittest.main()
