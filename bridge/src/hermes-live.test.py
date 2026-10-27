"""No gateway connection or model calls. Native-view tests opt in with DASH_HERMES_SOURCE."""
import asyncio
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch

helper = runpy.run_path(str(Path(__file__).with_name("hermes-live.py")))


class FakeClient:
    def __init__(self):
        self.events = asyncio.Queue()
        self.calls = []

    async def rpc(self, method, **params):
        self.calls.append((method, params))
        return {"admission_id": "own"}


class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_submit_loses_finite(self):
        client = FakeClient()
        attended = helper["AttendedClient"](client)
        self.assertIs(attended.events, client.events)
        receipt = await attended.rpc("prompt.submit", session_id="s", input_id="i", text="private\ntext", finite=True)
        self.assertEqual(receipt, {"admission_id": "own"})
        self.assertEqual(client.calls, [("prompt.submit", {"session_id": "s", "input_id": "i", "text": "private\ntext"})])
        await attended.rpc("prompt.receipt", session_id="s", admission_id="own", include_result=True)
        self.assertEqual(client.calls[-1], ("prompt.receipt", {"session_id": "s", "admission_id": "own", "include_result": True}))


class BootstrapTests(unittest.TestCase):
    def test_runtime_probe_preserves_helper_arguments_without_text(self):
        argv = ["hermes-live.py", "--hermes-bin", "/custom/hermes", "--session-id", "s"]
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, "argv", argv), patch("subprocess.check_output", return_value='["/runtime/python", "-I", "-c", "launcher"]') as probe, patch("os.execv") as execute:
            helper["bootstrap"]("/custom/hermes")
            self.assertEqual(os.environ.get("HERMES_DISABLE_LAZY_INSTALLS"), "1")
        self.assertEqual(probe.call_args.args[0], ["/custom/hermes", "--print-runtime-command"])
        self.assertEqual(execute.call_args.args, ("/runtime/python", ["/runtime/python", "-I", str(Path(__file__).with_name("hermes-live.py").resolve()), "--native", *argv[1:]]))

    def test_native_process_does_not_bootstrap_again(self):
        with patch.object(sys, "argv", ["hermes-live.py", "--native"]), patch("subprocess.check_output") as probe:
            helper["bootstrap"]("/custom/hermes")
        probe.assert_not_called()


@unittest.skipUnless(os.environ.get("DASH_HERMES_SOURCE"), "Hermes source not supplied on this host")
class NativeViewTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        sys.path.insert(0, os.environ["DASH_HERMES_SOURCE"])
        import hermes_bootstrap  # noqa: F401
        from hermes_cli.gateway_chat_view import GatewayChatView
        from hermes_cli.stream_json import StreamJsonEmitter
        self.View, self.Emitter = GatewayChatView, StreamJsonEmitter

    async def test_deliver_imports_native_seams_and_resumes_only_existing_gateway(self):
        from contextlib import asynccontextmanager
        from types import SimpleNamespace
        from hermes_cli import gateway_client, gateway_runtime

        class Client(FakeClient):
            async def rpc(client, method, **params):
                client.calls.append((method, params))
                if method == "session.resume":
                    return {"stored_session_id": "s"}
                if method == "prompt.submit":
                    client.events.put_nowait({"params": {"session_id": "s", "type": "message.complete", "admission_id": "own", "payload": {"outcome": "completed", "text": "pong"}}})
                    return {"admission_id": "own"}
                return {"result": {"final_response": "pong"}}
        client = Client()
        endpoint = object()

        @asynccontextmanager
        async def connect(*, endpoint):
            self.assertIs(endpoint, found.endpoint)
            yield client

        found = SimpleNamespace(endpoint=endpoint)
        with patch.dict(os.environ, {"HERMES_HOME": "/fixture"}), patch.object(gateway_runtime, "discover_gateway_endpoint", return_value=found) as discover, patch.object(gateway_runtime, "attachable", return_value=True), patch.object(gateway_client, "connect_gateway", connect), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            self.assertEqual(await asyncio.wait_for(helper["deliver"]("s", "private input", self.Emitter()), 2), 0)
        discover.assert_called_once_with("/fixture")
        self.assertEqual(client.calls[0], ("session.resume", {"session_id": "s", "omit_messages": True, "defer_history": True}))
        params = client.calls[1][1]
        self.assertEqual(params["text"], "private input")
        self.assertNotIn("finite", params)
        self.assertNotIn("unattended", params)

    async def run_view(self, events, *, pending=None, prompts=None, recovery=None):
        class Client(FakeClient):
            async def rpc(client, method, **params):
                client.calls.append((method, params))
                if method == "prompt.submit":
                    for kind, admission, payload in events:
                        client.events.put_nowait({"params": {"session_id": "s", "type": kind, "admission_id": admission, "payload": payload}})
                    # Exercise the pre-receipt event buffer as well as normal rendering.
                    await asyncio.sleep(0)
                    return {"admission_id": "own"}
                if method == "session.resume":
                    return recovery
                return {"status": "terminal", "outcome": "completed", "result": {"final_response": "pong"}}
        client = Client()
        stdout = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            view = self.View(helper["AttendedClient"](client), {"stored_session_id": "s", "pending": pending or [], "prompts": prompts or []}, emitter=self.Emitter())
            code = await asyncio.wait_for(view.run("private input", oneshot=True), 2)
        records = [json.loads(line) for line in stdout.getvalue().splitlines()]
        submits = [params for method, params in client.calls if method == "prompt.submit"]
        for params in submits:
            self.assertNotIn("finite", params)
            self.assertNotIn("unattended", params)
            self.assertNotIn("clarify_batch", params)
            self.assertEqual(params["text"], "private input")
        self.assertEqual(len([r for r in records if r["type"] == "result"]), 1)
        return code, records, client.calls

    async def test_native_oneshot_filters_foreign_admissions(self):
        code, records, calls = await self.run_view([
            ("message.delta", "foreign", {"text": "do not leak"}),
            ("message.complete", "foreign", {"outcome": "completed", "text": "do not leak"}),
            ("message.delta", "own", {"text": "pong"}),
            ("message.complete", "own", {"outcome": "completed", "text": "pong"}),
        ])
        self.assertEqual(code, 0)
        self.assertEqual([r["text"] for r in records if r["type"] == "text"], ["pong"])
        self.assertEqual(records[-1]["text"], "pong")
        self.assertEqual(len([m for m, _ in calls if m == "prompt.submit"]), 1)

    async def test_native_clarify_and_approval_detach_without_cancelling(self):
        for kind in ("clarify", "approval"):
            code, records, calls = await self.run_view([
                (kind + ".request", "foreign", {"prompt_id": "p", "kind": kind, "question": "Choose"}),
            ])
            self.assertEqual(code, 3)
            self.assertEqual(records[-1]["exit_code"], 3)
            self.assertIn("Input required; detached without cancelling", records[-1]["error"])
            self.assertEqual([m for m, _ in calls], ["prompt.submit"])

    async def test_native_unknown_turn_refuses_before_submit(self):
        code, records, calls = await self.run_view([], pending=[{"admission_id": "lost", "status": "unknown"}])
        self.assertEqual(code, 3)
        self.assertIn("nothing was submitted", records[-1]["error"])
        self.assertEqual(calls, [])

    async def test_native_replay_gap_recovers_own_result(self):
        code, records, calls = await self.run_view([
            ("message.delta", "own", {"text": "po"}),
            ("session.replay_gap", None, {}),
        ], recovery={"stored_session_id": "s", "pending": [], "prompts": []})
        self.assertEqual(code, 0)
        self.assertEqual(records[-1]["text"], "pong")
        self.assertTrue(records[-1]["replay_gap"])
        self.assertIn("session.resume", [m for m, _ in calls])


if __name__ == "__main__":
    unittest.main()
