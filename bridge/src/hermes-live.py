#!/usr/bin/env python3
"""Follow one Dash admission with Hermes's viewer, without making the TURN finite.

GatewayChatView's `finite` also controls its one-admission viewer lifecycle. Keep
that lifecycle intact and remove only the wire-level admission flag. No agent,
follow loop, replay recovery, or control response is implemented here.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys


class AttendedClient:
    """The view is one-shot. The gateway admission belongs to a long-lived chat."""

    def __init__(self, client):
        self.client = client
        self.events = client.events

    async def rpc(self, method, **params):
        if method == "prompt.submit":
            params.pop("finite", None)
        return await self.client.rpc(method, **params)


def bootstrap(hermes_bin):
    # A viewer must not install dependencies or complete a pending source update.
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    if "--native" in sys.argv:
        return
    runtime = json.loads(subprocess.check_output(
        [hermes_bin, "--print-runtime-command"],
        text=True, stderr=subprocess.DEVNULL, timeout=10))
    os.execv(runtime[0], [runtime[0], "-I", str(Path(__file__).resolve()), "--native", *sys.argv[1:]])


async def deliver(session_id, text, emitter):
    from hermes_cli.gateway_chat_view import GatewayChatView
    from hermes_cli.gateway_client import GatewayClientError, connect_gateway
    from hermes_cli.gateway_runtime import attachable, discover_gateway_endpoint

    found = discover_gateway_endpoint(os.environ["HERMES_HOME"])
    if not attachable(found):
        raise GatewayClientError("Gateway unavailable; nothing was submitted. No gateway was started.")
    async with connect_gateway(endpoint=found.endpoint) as client:
        snapshot = await client.rpc("session.resume", session_id=session_id,
                                    omit_messages=True, defer_history=True)
        emitter.bind_session(snapshot["stored_session_id"])
        view = GatewayChatView(AttendedClient(client), snapshot, emitter=emitter)
        # Deliberately do not set unattended or clarify_batch. Existing viewers
        # can answer per-question controls while this viewer detaches with exit 3.
        return await view.run(text, oneshot=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--hermes-bin", default=os.environ.get("DASH_HERMES_BIN", "hermes"))
    parser.add_argument("--native", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    emitter = None
    try:
        bootstrap(args.hermes_bin)
        sys.path.insert(0, os.environ.get("DASH_HERMES_SOURCE", "/workspace/hermes-home/hermes-agent"))
        import hermes_bootstrap  # noqa: F401
        from hermes_cli.gateway_client import GatewayClientError
        from hermes_cli.stream_json import StreamJsonEmitter
        from websockets.exceptions import WebSocketException
        emitter = StreamJsonEmitter(session_id=args.session_id)
        text = sys.stdin.read()
        if not text.strip():
            return emitter.emit_result({"failed": True, "error": "Empty Dash message; nothing was submitted."}, exit_code=2)
        try:
            return asyncio.run(deliver(args.session_id, text, emitter))
        except (GatewayClientError, OSError, TimeoutError, WebSocketException) as exc:
            message = str(exc) if isinstance(exc, GatewayClientError) else "Gateway connection/read failed; check the session before resending."
            return emitter.emit_result({"failed": True, "error": message}, exit_code=1)
    except KeyboardInterrupt:
        if emitter is not None:
            return emitter.emit_result({"interrupted": True}, exit_code=130)
        return 130
    except Exception:
        # Runtime discovery/import failures must also close Dash's JSONL protocol.
        # Do not expose local configuration or credentials in a raw traceback.
        message = "Hermes runtime unavailable; nothing was submitted."
        if emitter is not None:
            return emitter.emit_result({"failed": True, "error": "Hermes client failed; accepted work may continue. Check the session before resending."}, exit_code=1)
        print(json.dumps({"type": "result", "exit_code": 1, "session_id": args.session_id,
                          "text": "", "error": message}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
