# Legacy bridge deletion audit

Audit date: 2026-10-19. Legacy source revision: `1a9577dd6b61b56471fe79172148bc481faa5478`.

The supported entrypoint is `bridge/index.ts`. The deleted files do not occur in its local dependency graph. This change removes 18 files and 2,037 lines of duplicate implementation and configuration. It preserves the canonical bridge and its tests.

| Deleted path | Evidence |
| --- | --- |
| `bridge/src/server.ts` | No repository import or launch command refers to it. Its old `runHarness` API differs from the canonical adapters. |
| `bridge/src/turn.ts` | No consumer imports `runTurn` or `TurnHandle`. The canonical `Turn` lives in `bridge/index.ts` and imports `src/turn-safety.ts`. |
| `bridge/index.ts.bak-from-one` | No script or import refers to this backup. The canonical entrypoint imports the maintained adapter module. |
| `server/` | Its 15 files form a separate package with internal imports. No external module imports them. Its own `start` and `dev` scripts launch `src/index.ts`, but the root package and CI never invoke that package. |

`bridge/package.json` runs `index.ts` for both `start` and `dev`. The root README and `docs/loop/ONBOARDING.md` also use `bridge/index.ts`. `.cursor/skills/dash-bridge/SKILL.md` identifies the same entrypoint and `bridge/src/harnesses.ts`. `.github/workflows/ci.yml` installs the app and bridge packages and tests `app/src`, `bridge/src`, and `shared`.

Two stale references need correction outside this audit's ownership:

- `app/src/screens/SettingsScreen.tsx` displayed `cd dash/server && bun run start` at audit time. The app owner was notified to replace it with `cd dash/bridge && bun run start` before integration.
- `docs/loop/GITHUB_BOTS.md` describes type checking for an obsolete `server` package. The checked-in CI workflow has no command that invokes it.

This audit covers repository consumers. It does not inventory manually configured launch commands outside the repository. An existing installation that starts `server/src/index.ts` must switch to the canonical bridge.

## Deletion equivalence

A build before deletion included no target file. Other workers then changed canonical source, so a direct comparison of sequential working-tree builds was unsuitable. The stronger check copied the current canonical build inputs into an isolated directory. It restored all 18 legacy files from the source revision, built once, removed those files, and built again.

Both builds had the same 12 local inputs and identical 72,814-byte output. The SHA-256 of both outputs was `4750fd22fb14571531d155af3b81f761ac18f64846f04fde30c123957c90efd1`. External packages stayed external. This proves the deletion does not change the canonical bundle for that source snapshot. It does not prove phone runtime behavior or ACP provider availability.

The following check repeats the comparison against the current canonical source. The output hash can change when canonical source changes.

```sh
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib, json, shutil, subprocess

root = Path.cwd()
base = '1a9577dd6b61b56471fe79172148bc481faa5478'
targets = ['server', 'bridge/src/server.ts', 'bridge/src/turn.ts',
           'bridge/index.ts.bak-from-one']
legacy = subprocess.check_output(
    ['git', 'ls-tree', '-r', '--name-only', base, '--', *targets],
    text=True,
).splitlines()
assert len(legacy) == 18

with TemporaryDirectory(prefix='dash-legacy-audit-') as directory:
    work = Path(directory)
    command = ['bun', 'build', 'bridge/index.ts', '--target=bun',
               '--packages=external', '--outfile=bundle.mjs',
               '--metafile=graph.json']
    initial = command[:-2] + [f'--outfile={work}/initial.mjs',
                             f'--metafile={work}/initial.json']
    subprocess.run(initial, cwd=root, check=True)
    graph = json.loads((work / 'initial.json').read_text())
    assert set(legacy).isdisjoint(graph['inputs'])
    for name in graph['inputs']:
        destination = work / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, destination)
    for name in legacy:
        destination = work / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(subprocess.check_output(
            ['git', 'show', f'{base}:{name}'], cwd=root))
    subprocess.run(command, cwd=work, check=True)
    before = (work / 'bundle.mjs').read_bytes()
    before_graph = json.loads((work / 'graph.json').read_text())
    for name in legacy:
        (work / name).unlink()
    subprocess.run(command, cwd=work, check=True)
    after = (work / 'bundle.mjs').read_bytes()
    after_graph = json.loads((work / 'graph.json').read_text())
    assert before == after
    assert set(before_graph['inputs']) == set(after_graph['inputs'])
    print(json.dumps({'identical_bundle': True, 'bytes': len(after),
                      'modules': len(after_graph['inputs']),
                      'sha256': hashlib.sha256(after).hexdigest()}))
PY
```

## Verification boundaries

`bun test shared bridge/src/turn-safety.test.ts` passed before and after deletion with 31 tests and 83 assertions. The same existing tests cover protocol parsing, replay, cancellation, timeouts, and the canonical helper imports. No artificial test of file absence was added.

`bun run typecheck` in `bridge/` passed before and after deletion. The documented comparison also ran successfully against the newer canonical snapshot. The initial broad bridge test run overlapped other workers' new failing security, Hermes, roster, and ACP tests. Those failures belong to the active implementation work and are not recorded as a passing baseline here. The parent worker owns the final broad suite, mutation checks, and runtime evidence. This audit changes no mutation target and starts no bridge, phone, or model process.
