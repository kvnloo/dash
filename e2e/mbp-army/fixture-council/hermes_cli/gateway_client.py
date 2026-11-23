"""Pinned-core fixture: the real Dash bridge and Python adapter speak to this RPC boundary."""
from contextlib import asynccontextmanager
import json
from pathlib import Path


class GatewayClientError(ValueError):
    def __init__(self, code):
        self.code = code


class Gateway:
    def __init__(self, home):
        self.home = Path(home)
        self.record = self.home / "army-council.json"

    async def rpc(self, method, **params):
        if method == "session.resume":
            assert params["session_id"] == "army-fixture-session"
            return {"session_id": "army-attached", "stored_session_id": "army-root"}
        assert params["session_id"] == "army-attached"
        if method.startswith("glide.council."):
            raise GatewayClientError(-32601)
        assert method == "command.dispatch" and params["name"] == "glide"
        command, verb, body = params["arg"].split(" ", 2)
        assert command == "json"
        args = json.loads(body)
        with (self.home / "army-council-rpc.jsonl").open("a") as log:
            log.write(json.dumps({"verb": verb, **args}) + "\n")
        state = json.loads(self.record.read_text())
        if verb == "council.list":
            assert args == {"stored_session_id": "army-root"}
            out = {"councils": [{**state, "brief": state["run"]["brief"]}]}
        elif verb == "council.load":
            assert args["council_id"] == state["council_id"]
            out = state
        else:
            assert verb == "council.position" and args["client"] == "dash"
            assert args["council_id"] == state["council_id"]
            if args["base_revision"] != state["revision"]:
                out = {"error": "the council moved on", "code": 4090}
            else:
                state.update(updated_by="dash", revision=state["revision"] + 1, position=args["position"])
                staging = self.record.with_suffix(".tmp")
                staging.write_text(json.dumps(state))
                staging.replace(self.record)
                out = state
        return {"output": json.dumps(out)}


@asynccontextmanager
async def connect_gateway(*, endpoint):
    yield Gateway(endpoint)
