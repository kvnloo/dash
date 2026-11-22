"""Attach to the selected Hermes profile without starting a gateway or prompting an agent."""
import asyncio
import json
import os
import sys

import runpy
from pathlib import Path

bootstrap = runpy.run_path(str(Path(__file__).with_name("hermes-live.py")))["bootstrap"]


async def dispatch(request):
    import hermes_bootstrap  # noqa: F401
    from hermes_cli.gateway_client import GatewayClientError, connect_gateway
    from hermes_cli.gateway_runtime import attachable, discover_gateway_endpoint

    found = discover_gateway_endpoint(os.environ["HERMES_HOME"])
    if not attachable(found):
        return {"error": "gateway_unavailable"}
    verb = request["verb"]
    params = request["params"]
    async with connect_gateway(endpoint=found.endpoint) as gateway:
        snap = await gateway.rpc("session.resume", session_id=request["session"],
                                 omit_messages=True, defer_history=True)
        session = snap["session_id"]
        stored = snap["stored_session_id"]
        if not isinstance(stored, str) or not stored:
            return {"error": "session_unavailable"}
        if verb == "list":
            params["stored_session_id"] = stored
        try:
            result = await gateway.rpc(f"glide.council.{verb}", session_id=session, **params)
        except GatewayClientError as exc:
            if getattr(exc, "code", None) != -32601:
                raise
            reply = await gateway.rpc("command.dispatch", name="glide", session_id=session,
                                      arg=f"json council.{verb} {json.dumps(params)}")
            result = json.loads(reply["output"])
        if "error" in result:
            return {"error": "council_refused", "code": result.get("code")}
        if verb != "list" and result.get("stored_session_id") != stored:
            return {"error": "session_mismatch"}
        return result


def main():
    # Bootstrap before touching stdin; exec preserves the pipe for the native runtime.
    bootstrap(os.environ.get("DASH_HERMES_BIN", "hermes"))
    sys.path.insert(0, os.environ.get("DASH_HERMES_SOURCE") or
                    os.path.join(os.environ["HOME"], ".hermes", "hermes-agent"))
    try:
        return asyncio.run(asyncio.wait_for(dispatch(json.load(sys.stdin)), 15))
    except Exception as exc:
        return {"error": "council_unavailable", "code": getattr(exc, "code", None)}


if __name__ == "__main__":
    try:
        result = main()
    except Exception:
        result = {"error": "runtime_unavailable"}
    print(json.dumps(result), flush=True)
