"""Enrich the frozen R1 cohort without refreshing counters, quotas or timestamps."""
import collections
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('export_trace', ROOT / 'tools/export_trace.py')
assert spec is not None and spec.loader is not None
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

def main():
    for src in (ROOT / 'out').glob('*.html'):
        if '-r1' not in src.stem:
            target = src.with_name(src.stem + '-r1.html')
            if not target.exists():
                target.write_bytes(src.read_bytes())
    data = json.loads((ROOT / 'data/trace-20261020.json').read_text())
    manifests = {}
    for p in Path(exporter.LIVE).glob('*/manifest.json'):
        m = json.loads(p.read_text())
        start = dt.datetime.strptime(m['started'], '%Y-%m-%d %H:%M:%S').isoformat()
        manifests[start] = (p.parent, m)
    for run in data['runs']:
        folder, manifest = manifests[run['dispatched']]
        for task in (t for t in data['tasks'] if t['id'] in run['tasks']):
            index = ord(task['id'][-1]) - ord('A')
            path = folder / f'task-{index}.log'
            text = path.read_text(errors='replace')
            goal = next((s[6:] for s in text.splitlines() if s.startswith('goal: ')), '')
            if not goal:
                goal = next(t.get('goal', '') for t in manifest['tasks'] if t['index'] == index)
            task.update(exporter.public_labels(goal, text))
        members = [t for t in data['tasks'] if t['id'] in run['tasks']]
        label = collections.Counter(t['label'] for t in members).most_common(1)[0][0]
        lead = next(t for t in members if t['label'] == label)
        run.update({k: lead[k] for k in ('project', 'short_goal', 'label')})
    data['privacy'] = 'Allowlisted project/outcome labels; no raw goals, paths, prompts, arguments or outputs.'
    data['heuristics']['labels'] = 'Allowlisted repository/worktree and goal keyword classification; majority label per dispatch batch. Not a private session title.'
    (ROOT / 'data/trace-r2.json').write_text(json.dumps(data, separators=(',', ':')))
    print('Frozen cohort:', len(data['runs']), 'runs;', len(data['tasks']), 'workers')
    print(collections.Counter(t['project'] for t in data['tasks']))

if __name__ == '__main__':
    main()
