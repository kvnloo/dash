"""Device-free tests for the native journey harness: spec linkage, owner guard, frame stats, receipts.

  python3 -I -m unittest discover -s e2e/device -p 'test_*.py'
"""
import inspect
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE), str(ROOT / "spec"), str(ROOT / "scripts")]

import journeys  # noqa: E402
import run_journeys  # noqa: E402
from device import frame_summary, midrun_guard, owner_guard, parse_framestats  # noqa: E402
from framework import JOURNEYS, Ctx, Journey, feature_results, write_receipts  # noqa: E402
import feature_status  # noqa: E402

LEDGER = run_journeys.load_ledger()
FEATURES = {f["id"]: f for f in LEDGER["features"]}
SPEC_JOURNEYS = {j["id"] for j in LEDGER["journeys"]}


class Linkage(unittest.TestCase):
    def test_every_p0_feature_has_a_journey_function(self):
        missing = [f["id"] for f in LEDGER["features"] if f["priority"] == "P0" and f["journey"] not in JOURNEYS]
        self.assertEqual(missing, [])

    def test_every_p1_feature_has_a_journey_function(self):
        missing = [f["id"] for f in LEDGER["features"] if f["priority"] == "P1" and f["journey"] not in JOURNEYS]
        self.assertEqual(missing, [])

    def test_every_journey_references_existing_features_of_that_journey(self):
        for jid, j in JOURNEYS.items():
            with self.subTest(journey=jid):
                self.assertIn(jid, SPEC_JOURNEYS)
                self.assertTrue(j.features)
                for fid in j.features:
                    self.assertIn(fid, FEATURES)
                    self.assertEqual(FEATURES[fid]["journey"], jid)

    def test_journeys_declare_exactly_the_spec_features(self):
        errors, stats = run_journeys.linkage(LEDGER)
        self.assertEqual(errors, [])
        self.assertEqual(stats["P0"]["with_journey"], stats["P0"]["total"])

    def test_feature_tags_in_journey_bodies_are_declared_and_cover_every_feature(self):
        for jid, j in JOURNEYS.items():
            src = inspect.getsource(j.fn)
            if jid in ("J-send-receive-hermes", "J-send-receive-omp"):
                src += inspect.getsource(journeys._send_three)
            body = src.split('"""', 2)[-1]
            tags = set(re.findall(r'"(DF-\d{3})"', body))
            with self.subTest(journey=jid):
                if jid != "J-send-receive-omp":  # shares _send_three, whose Hermes-only tags it never reaches
                    self.assertLessEqual(tags, set(j.features))
                if tags or len(j.features) > 1:
                    self.assertEqual(set(j.features) - tags, set(), "a declared feature has no tagged check")

    def test_linkage_detects_a_journey_not_in_the_spec(self):
        JOURNEYS["J-not-in-spec"] = Journey("J-not-in-spec", lambda ctx: None, ("DF-001",))
        try:
            errors, _ = run_journeys.linkage(LEDGER)
        finally:
            del JOURNEYS["J-not-in-spec"]
        self.assertTrue(any("J-not-in-spec" in e for e in errors))

    def test_linkage_detects_an_unmapped_p0(self):
        saved = JOURNEYS.pop("J-composer-draft-restore")
        try:
            errors, _ = run_journeys.linkage(LEDGER)
        finally:
            JOURNEYS["J-composer-draft-restore"] = saved
        self.assertTrue(any("DF-024" in e for e in errors))

    def test_dry_run_cli_validates_without_a_device(self):
        r = subprocess.run([sys.executable, "-I", str(HERE / "run_journeys.py"), "--dry-run", "--all", "--json"],
                           capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stderr)
        report = json.loads(r.stdout)
        self.assertTrue(report["valid"])
        self.assertEqual(len(report["plan"]), len(SPEC_JOURNEYS))

    def test_in_flight_chat_feature_journeys_exist(self):
        for jid in ("J-chat-list-all-harnesses", "J-chat-search-fast", "J-chat-open-history"):
            self.assertIn(jid, JOURNEYS)
        src = inspect.getsource(journeys.j_chat_list_all_harnesses)
        for h in ("Codex", "Claude Code", "Grok", "OMP"):
            self.assertIn(h, journeys.ARCHIVE_HARNESSES)
        self.assertIn("SCROLL_ROWS_MIN", src)
        self.assertEqual(journeys.SCROLL_ROWS_MIN, 1000)
        self.assertEqual(journeys.SEARCH_RESULT_S_MAX, 1.0)


FACTS = ("120.0 0\nboot-a\nmLastUserActivityTime=1000\n"
         "topResumedActivity=ActivityRecord{a u0 com.agent/.Main}\nmCallState=0\nmMode=MODE_NORMAL\n")
LEDGER_OK = {"com.agent": {"boot_id": "boot-a", "opened_uptime_ms": 2000}}


class OwnerGuard(unittest.TestCase):
    """Same cases as .files-mbp tests/test_fleet_adb.py restore_guest, per display."""

    def test_physical_requires_agent_opened_foreground_after_last_touch(self):
        self.assertEqual(owner_guard(FACTS, LEDGER_OK, "physical"), "ok")
        self.assertEqual(owner_guard(FACTS, {}, "physical"), "owner_busy")
        self.assertEqual(owner_guard(FACTS.replace("=1000\n", "=3000\n"), LEDGER_OK, "physical"), "owner_busy")

    def test_recent_touch_is_busy_on_both_displays(self):
        recent = FACTS.replace("=1000\n", "=119000\n")
        self.assertEqual(owner_guard(recent, LEDGER_OK, "physical"), "owner_busy")
        self.assertEqual(owner_guard(recent, {}, "virtual"), "owner_busy")

    def test_virtual_leaves_the_owner_foreground_alone(self):
        self.assertEqual(owner_guard(FACTS, {}, "virtual"), "ok")

    def test_calls_and_missing_evidence_fail_closed(self):
        self.assertEqual(owner_guard(FACTS.replace("mCallState=0", "mCallState=2"), LEDGER_OK, "physical"), "in_call")
        self.assertEqual(owner_guard(FACTS.replace("MODE_NORMAL", "MODE_IN_COMMUNICATION"), {}, "virtual"), "in_call")
        self.assertEqual(owner_guard("unknown", LEDGER_OK, "physical"), "owner_evidence_unavailable")
        self.assertEqual(owner_guard(FACTS.replace("mLastUserActivityTime=1000\n", ""), {}, "virtual"), "owner_evidence_unavailable")

    def test_midrun_guard(self):
        dash = FACTS.replace("com.agent", "app.dash.mobile")
        self.assertEqual(midrun_guard(dash, "physical"), "ok")
        self.assertEqual(midrun_guard(FACTS, "physical"), "owner_busy")
        self.assertEqual(midrun_guard(FACTS, "virtual"), "ok")
        self.assertEqual(midrun_guard(dash.replace("mCallState=0", "mCallState=1"), "virtual"), "in_call")


FRAMESTATS = """Stats since: 1ns
Janky frames: 1 (33.33%)
---PROFILEDATA---
Flags,IntendedVsync,Vsync,OldestInputEvent,NewestInputEvent,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,
0,1000000000,1000000000,0,0,0,0,0,0,0,0,0,0,1008000000,
0,1016000000,1016000000,0,0,0,0,0,0,0,0,0,0,1056000000,
1,1032000000,1032000000,0,0,0,0,0,0,0,0,0,0,1300000000,
0,1048000000,1048000000,0,0,0,0,0,0,0,0,0,0,1060000000,
---PROFILEDATA---
"""


class Frames(unittest.TestCase):
    def test_parse_skips_flagged_frames(self):
        self.assertEqual(parse_framestats(FRAMESTATS), [8.0, 40.0, 12.0])

    def test_summary_against_refresh_budget(self):
        s = frame_summary([8.0, 40.0, 12.0], 120.0)
        self.assertEqual(s["frames"], 3)
        self.assertEqual(s["jank_pct"], 66.7)
        self.assertEqual(s["max_ms"], 40.0)
        self.assertEqual(frame_summary([], 60)["frames"], 0)


class Receipts(unittest.TestCase):
    J = Journey("J-composer-draft-restore", lambda ctx: None, ("DF-024",))

    def write(self, tmp, checks, **kw):
        args = dict(journey=self.J, features=["DF-024"], sha="abcdef1234567", dev_serial="RFCTA1RZAQY", real_device=True,
                    display="virtual", started_at="2026-10-25T00:00:00Z", checks=checks, metrics={}, evidence=["a.png"],
                    missing=[], error=None, skip=None)
        args.update(kw)
        write_receipts(Path(tmp), **args)
        return feature_status.load_receipts(tmp)

    def test_pass_receipt_counts_for_feature_status(self):
        with tempfile.TemporaryDirectory() as tmp:
            rs = self.write(tmp, [{"check": "draft", "ok": True, "detail": "", "feature": None, "shot": "a.png"}])
            r = rs[0]
            for k in ("feature_id", "journey_id", "candidate_sha", "device_serial", "display", "started_at", "result",
                      "evidence", "failure_reason"):
                self.assertIn(k, r)
            self.assertEqual(feature_status.classify_journey(rs, "J-composer-draft-restore", "abcdef1234567"),
                             feature_status.Journey.PASS_CANDIDATE)

    def test_failed_check_fails_with_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            rs = self.write(tmp, [{"check": "draft", "ok": False, "detail": "lost", "feature": None, "shot": ""}])
            self.assertEqual(rs[0]["result"], "fail")
            self.assertIn("lost", rs[0]["failure_reason"])
            self.assertEqual(feature_status.classify_journey(rs, "J-composer-draft-restore", "abcdef1234567"),
                             feature_status.Journey.FAIL)

    def test_partial_and_skipped_runs_never_count(self):
        ok = [{"check": "draft", "ok": True, "detail": "", "feature": None, "shot": ""}]
        for kw in ({"missing": ["archive_seed"]}, {"skip": "owner guard: owner_busy"}):
            with tempfile.TemporaryDirectory() as tmp, self.subTest(**{k: str(v) for k, v in kw.items()}):
                rs = self.write(tmp, ok, **kw)
                self.assertEqual(feature_status.classify_journey(rs, "J-composer-draft-restore", "abcdef1234567"),
                                 feature_status.Journey.NONE)

    def test_crash_turns_pass_into_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            rs = self.write(tmp, [{"check": "draft", "ok": True, "detail": "", "feature": None, "shot": ""}], error="RuntimeError: x")
            self.assertEqual(rs[0]["result"], "fail")

    def test_feature_results_need_a_check_per_feature_when_tagged(self):
        checks = [{"check": "open", "ok": True, "detail": "", "feature": None, "shot": ""},
                  {"check": "a", "ok": True, "detail": "", "feature": "DF-001", "shot": ""},
                  {"check": "b", "ok": False, "detail": "x", "feature": "DF-003", "shot": ""}]
        res = feature_results(checks, ["DF-001", "DF-003", "DF-009"])
        self.assertEqual(res["DF-001"][0], "pass")
        self.assertEqual(res["DF-003"][0], "fail")
        self.assertEqual(res["DF-009"], ("fail", "no check for this feature ran"))
        self.assertEqual(feature_results([], ["DF-001"])["DF-001"], ("fail", "no checks ran"))

    def test_check_rejects_a_foreign_feature_tag(self):
        class Dev:
            def shot(self, name):
                return name
        ctx = Ctx(Dev(), "abcdef1", self.J, None)
        with self.assertRaises(ValueError):
            ctx.check("x", True, "", "DF-001")


if __name__ == "__main__":
    unittest.main()
