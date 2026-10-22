"""Native /compress control, never a model prompt or a steer instruction.

Attach only to an existing gateway. Wait for idle, then use Hermes's generation/
revision-fenced mutation path (the same path as the classic CLI's /compress).
Never retry a mutation after an ambiguous outcome. Output is an allowlisted receipt.
"""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys


async def compact(request):
    sys.path.insert(0, os.environ.get('DASH_HERMES_SOURCE', '/workspace/hermes-home/hermes-agent'))
    import hermes_bootstrap  # noqa: F401
    from hermes_cli.gateway_client import connect_gateway
    from hermes_cli.gateway_runtime import attachable, discover_gateway_endpoint
    from hermes_cli.gateway_mutations import PreparedMutations, slash_mutation
    found = discover_gateway_endpoint(os.environ['HERMES_HOME'])
    if not attachable(found):
        return {'ok': False, 'code': 'gateway_unavailable'}
    async with connect_gateway(endpoint=found.endpoint) as client:
        for _ in range(60):
            snap = await client.rpc('session.resume', session_id=request['session_id'], omit_messages=True, defer_history=True)
            if not snap.get('running'):
                break
            await asyncio.sleep(2)
        else:
            return {'ok': False, 'code': 'session_busy'}
        operation, payload = slash_mutation('/compress', '')
        result = await PreparedMutations().apply(client, snap['session_id'], operation, payload)
        status = result.get('status', '')
        committed = result.get('operation') == 'compress' and isinstance(result.get('revision'), int)
        return {'ok': committed or status == 'noop', 'code': 'committed' if committed else 'noop' if status == 'noop' else 'not_confirmed'}


def main():
    if '--native' not in sys.argv:
        runtime = json.loads(subprocess.check_output([os.environ.get('DASH_HERMES_BIN', 'hermes'), '--print-runtime-command'], text=True, stderr=subprocess.DEVNULL, timeout=10))
        os.execv(runtime[0], [runtime[0], '-I', str(Path(__file__).resolve()), '--native'])
    try:
        request = json.loads(sys.stdin.read(4096))
        result = asyncio.run(asyncio.wait_for(compact(request), 240))
    except Exception as exc:
        code = str(exc)
        result = {'ok': False, 'code': code if code in {'session_busy', 'revision_conflict', 'stale_generation', 'nothing_to_compress', 'permission_denied'} else 'outcome_unknown'}
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
