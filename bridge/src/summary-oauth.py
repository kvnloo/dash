"""One exact-model, tool-free Codex request using Hermes's existing OAuth client.

No agent/session, fallback chain, transcript storage or credential output. The
parent owns the wall deadline and kills this process on abort (including setup).
"""
import contextlib
import json
import logging
import os
from pathlib import Path
import subprocess
import sys


class SummaryError(Exception):
    pass


def complete(request, resolve=None):
    model = request.get("model", "")
    prompt = request.get("prompt", "")
    if not isinstance(model, str) or not model.startswith("openai-codex/") or not model[13:]:
        raise SummaryError("transport_unavailable")
    if not isinstance(prompt, str) or not prompt or len(prompt) > 16000:
        raise SummaryError("invalid_response")
    bare = model[13:]
    if resolve is None:
        from agent.auxiliary_client import resolve_provider_client
        resolve = resolve_provider_client
    client, resolved = resolve("openai-codex", model=bare, raw_codex=True)
    if client is None:
        raise SummaryError("credential_unavailable")
    try:
        from urllib.parse import urlparse
        endpoint = urlparse(str(client.base_url))
        if resolved != bare or endpoint.scheme != "https" or endpoint.hostname != "chatgpt.com" or endpoint.path.rstrip("/") != "/backend-api/codex" or endpoint.port not in (None, 443):
            raise SummaryError("transport_unavailable")
        # Codex rejects max_output_tokens/temperature. Bound output locally and
        # via the parent wall timer; never ask for or replay reasoning summaries.
        stream = client.with_options(max_retries=0, timeout=12).responses.create(
            model=bare, instructions="Return only a short plain-text summary. No tools.",
            input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
            tools=[], tool_choice="none", store=False, stream=True,
            reasoning={"effort": "low"},
        )
        pieces = []
        completed = False
        with stream:
            for event in stream:
                if event.type == "response.output_item.done":
                    item = event.item
                    if item.type == "message":
                        pieces.extend(part.text for part in item.content if part.type == "output_text")
                        if sum(map(len, pieces)) > 4096:
                            raise SummaryError("invalid_response")
                    elif item.type != "reasoning":
                        raise SummaryError("invalid_response")
                elif event.type == "response.completed":
                    if event.response.model != bare:
                        raise SummaryError("model_mismatch")
                    completed = True
                elif event.type in ("error", "response.failed", "response.incomplete"):
                    raise SummaryError("provider_unavailable")
        text = "\n".join(pieces).strip()
        if not completed or not text:
            raise SummaryError("invalid_response")
        return {"ok": True, "model": model, "text": text}
    finally:
        client.close()


def main():
    try:
        if "--native" not in sys.argv:
            runtime = json.loads(subprocess.check_output(
                [os.environ.get("DASH_HERMES_BIN", "hermes"), "--print-runtime-command"],
                text=True, stderr=subprocess.DEVNULL, timeout=5,
            ))
            if not isinstance(runtime, list) or not runtime or not isinstance(runtime[0], str):
                raise SummaryError("transport_unavailable")
            os.execv(runtime[0], [runtime[0], "-I", str(Path(__file__).resolve()), "--native"])
        # Match the existing Dash native Hermes helpers; use this process's
        # HERMES_HOME, never scan sibling profiles or launch a general agent.
        sys.path.insert(0, os.environ.get("DASH_HERMES_SOURCE", "/workspace/hermes-home/hermes-agent"))
        logging.disable(logging.CRITICAL)
        with contextlib.redirect_stdout(sys.stderr):
            import hermes_bootstrap  # noqa: F401
            request = json.loads(sys.stdin.read(20000))
            result = complete(request)
    except SummaryError as exc:
        result = {"ok": False, "code": str(exc)}
    except (ImportError, FileNotFoundError, subprocess.SubprocessError):
        result = {"ok": False, "code": "transport_unavailable"}
    except Exception:
        result = {"ok": False, "code": "provider_unavailable"}
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
