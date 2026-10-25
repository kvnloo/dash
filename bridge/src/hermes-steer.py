#!/usr/bin/env python3
"""Generation-fenced steer, adapted from z0live 133c623 / z0bridge bef9fd8.
Read-only discovery; never starts a gateway, runs a model, or submits a FIFO turn.
Only sanitized receipts go to stdout. Text travels on stdin, credentials stay local.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys


def emit(value):
    print(json.dumps(value), flush=True)


def bootstrap():
    if "--native" in sys.argv:
        return
    runtime = json.loads(subprocess.check_output(
        [os.environ.get("DASH_HERMES_BIN", "hermes"), "--print-runtime-command"],
        text=True, stderr=subprocess.DEVNULL, timeout=10))
    os.execv(runtime[0], [runtime[0], "-I", str(Path(__file__).resolve()), "--native"])


async def deliver(request):
    sys.path.insert(0, os.environ.get("DASH_HERMES_SOURCE", "/workspace/hermes-home/hermes-agent"))
    import hermes_bootstrap  # noqa: F401
    from hermes_cli.gateway_client import connect_gateway
    from hermes_cli.gateway_runtime import attachable, discover_gateway_endpoint

    found = discover_gateway_endpoint(os.environ["HERMES_HOME"])
    if not attachable(found):
        return {"ok": False, "code": "gateway_unavailable"}
    async with connect_gateway(endpoint=found.endpoint) as client:
        snap = await client.rpc("session.resume", session_id=request["session_id"],
                                omit_messages=True, defer_history=True)
        if not (snap.get("authority_epoch") and snap.get("subscription_id")
                and type(snap.get("execution_generation")) is int):
            return {"ok": False, "code": "unsupported_control"}
        if not snap.get("running"):
            return {"ok": False, "code": "no_running_turn"}
        receipt = await client.rpc("session.steer", session_id=snap["session_id"],
                                   text=request["text"], execution_generation=snap["execution_generation"])
        if receipt.get("status") != "queued":
            return {"ok": False, "code": "steer_refused"}
        return {"ok": True, "code": "steered"}


def main():
    try:
        bootstrap()
        request = json.loads(sys.stdin.read(512 * 1024))
        result = asyncio.run(asyncio.wait_for(deliver(request), 25))
    except Exception as exc:
        reason = str(exc)
        code = reason if reason in {"stale_generation", "unsupported_control", "not_found", "execution_not_ready"} else "outcome_unknown"
        result = {"ok": False, "code": code}
    emit(result)


if __name__ == "__main__":
    main()
