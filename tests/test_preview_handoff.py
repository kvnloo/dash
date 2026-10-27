#!/usr/bin/env python3
"""Preview hand-off: every journey has a screen, every screen is a real app route, and a preview
receipt is delivered only when the brief reached the owner (device opened or a channel ref)."""
from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import feature_status as fs  # noqa: E402
import preview_handoff as ph  # noqa: E402

SHA = "abcdef1234567890abcdef1234567890abcdef12"
LEDGER = ph.load_ledger(ROOT / "spec/features.yaml")


def run(argv):
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = ph.main(argv)
    return code, buf.getvalue()


class PreviewHandoff(unittest.TestCase):
    def test_every_ledger_journey_has_a_screen(self):
        journeys = {j["id"] for j in LEDGER["journeys"]}
        self.assertEqual(journeys - set(ph.SCREENS), set())
        self.assertEqual(set(ph.SCREENS) - journeys, set())

    def test_every_screen_is_an_app_route(self):
        ts = (ROOT / "app/src/lib/app-route-link.ts").read_text()
        routes = set(re.findall(r"(\w+): \"[A-Z]\w+\"", ts.split("const ROUTES", 1)[1].split("\n", 1)[0]))
        for jid, (link, steps) in ph.SCREENS.items():
            with self.subTest(jid):
                self.assertRegex(link, r"^dash://[a-z]+$")
                self.assertIn(link.removeprefix("dash://"), routes)
                self.assertTrue(steps.strip())

    def test_brief_names_feature_ask_expectation_screen_and_proof(self):
        card = ph.brief(LEDGER, "DF-035", SHA)
        self.assertEqual(card["screen"], "dash://chats")
        for part in ("TEST DF-035", "expect:", "go:     dash://chats", "proof:  J-chat-open-history", SHA[:12]):
            self.assertIn(part, card["text"])

    def test_not_delivered_without_device_or_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _ = run(["--sha", SHA, "--features", "DF-035", "--out", tmp])
            self.assertEqual(code, 0)
            rs = fs.load_receipts(tmp)
            self.assertIs(rs[0]["delivered"], False)
            self.assertIs(fs.classify_preview(rs, SHA), fs.Preview.NONE)

    def test_channel_ref_delivers_and_counts_for_that_sha_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, _ = run(["--sha", SHA, "--features", "DF-035,DF-024", "--delivered-via", "telegram:1", "--out", tmp])
            self.assertEqual(code, 0)
            rs = fs.load_receipts(tmp)
            self.assertEqual(len(rs), 2)
            self.assertIs(fs.classify_preview([r for r in rs if r["feature"] == "DF-024"], SHA), fs.Preview.DELIVERED)
            self.assertIs(fs.classify_preview(rs, "0123456789abc"), fs.Preview.NONE)

    def test_open_delivers_only_the_opened_screen(self):
        calls = []
        real = ph.open_screen
        ph.open_screen = lambda serial, link, display: (calls.append((serial, link, display)) or (True, "Status: ok"))
        try:
            with tempfile.TemporaryDirectory() as tmp:
                code, out = run(["--sha", SHA, "--features", "DF-110,DF-035", "--open", "--serial", "S", "--display-id", "7",
                                 "--out", tmp, "--json"])
                rs = {r["feature"]: r for r in fs.load_receipts(tmp)}
        finally:
            ph.open_screen = real
        self.assertEqual(calls, [("S", "dash://bots", 7)])
        self.assertIs(rs["DF-110"]["delivered"], True)
        self.assertIs(rs["DF-035"]["delivered"], False)
        self.assertEqual(code, 1)
        self.assertTrue(json.loads(out)["opened"])

    def test_failed_open_is_not_delivered(self):
        real = ph.open_screen
        ph.open_screen = lambda serial, link, display: (False, "Error: Activity not started")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                code, _ = run(["--sha", SHA, "--features", "DF-110", "--open", "--serial", "S", "--out", tmp])
                self.assertIs(fs.load_receipts(tmp)[0]["delivered"], False)
        finally:
            ph.open_screen = real
        self.assertEqual(code, 1)

    def test_bad_input_is_refused(self):
        self.assertEqual(run(["--sha", "not-a-sha", "--features", "DF-035"])[0], 2)
        self.assertEqual(run(["--sha", SHA, "--features", "DF-999"])[0], 2)
        self.assertEqual(run(["--sha", SHA, "--features", "DF-035", "--open"])[0], 2)


if __name__ == "__main__":
    unittest.main()
