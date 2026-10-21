#!/usr/bin/env python3
"""Round 3 data prep: keep R2 pages as *-r2.html, relabel the frozen cohort, compute facts.

Counters, quotas and timestamps are not refreshed; only the allowlisted labels from
export_trace.public_labels are re-derived from the delegation logs (read-only).
    python3 -P tools/prepare_r3.py      # writes data/trace-r3.json and data/facts-r3.json
"""
import collections
import datetime as dt
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('export_trace', ROOT / 'tools/export_trace.py')
assert spec is not None and spec.loader is not None
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
NOW = dt.datetime(2026, 10, 21, 0, 53)  # frozen cohort "now" (data generated)


def keep_r2():
    for slug in ('index', 'a-trace', 'b-lanes', 'c-stats', 'd-pocket'):
        src, dst = ROOT / f'out/{slug}.html', ROOT / f'out/{slug}-r2.html'
        if src.exists() and not dst.exists():
            dst.write_bytes(src.read_bytes())


def relabel(data):
    manifests = {}
    for p in Path(exporter.LIVE).glob('*/manifest.json'):
        m = json.loads(p.read_text())
        manifests[dt.datetime.strptime(m['started'], '%Y-%m-%d %H:%M:%S').isoformat()] = (p.parent, m)
    for run in data['runs']:
        folder, manifest = manifests[run['dispatched']]
        members = [t for t in data['tasks'] if t['id'] in run['tasks']]
        for task in members:
            index = ord(task['id'][-1]) - ord('A')
            text = (folder / f'task-{index}.log').read_text(errors='replace')
            goal = next((s[6:] for s in text.splitlines() if s.startswith('goal: ')), '')
            if not goal:
                goal = next(t.get('goal', '') for t in manifest['tasks'] if t['index'] == index)
            task.update(exporter.public_labels(goal))
        label = collections.Counter(t['label'] for t in members).most_common(1)[0][0]
        lead = next(t for t in members if t['label'] == label)
        run.update({k: lead[k] for k in ('project', 'short_goal', 'label')})
    data['privacy'] = 'Allowlisted project/outcome labels; no raw goals, paths, prompts, arguments or outputs.'
    data['heuristics']['labels'] = 'Ordered goal-keyword allowlist (export_trace.LABEL_RULES); majority label per dispatch batch.'


def facts(data):
    T = data['tasks']
    p = lambda s: dt.datetime.fromisoformat(s)
    inter = [t for t in T if t['status'] == 'interrupted']
    win = [t for t in inter if p('2026-10-20T18:30') <= p(t['start']) <= p('2026-10-20T21:30')]
    stall_by = collections.Counter()
    for t in T:
        stall_by[t['label']] += sum(s['e'] - s['s'] for s in t['stalls'])
    resumed = {t['resume_of'] for t in T if t['resume_of']}
    by_label = collections.defaultdict(lambda: collections.Counter())
    for t in T:
        c = by_label[t['label']]
        c['workers'] += 1; c[t['status']] += 1; c['errors'] += t['errors']; c['calls'] += t['tool_calls']
        c['stall_s'] += sum(s['e'] - s['s'] for s in t['stalls']); c['wall_s'] += t['dur_s']
    tools_err = collections.Counter()
    tools_n = collections.Counter()
    for t in T:
        for ev in t['events']:
            tools_n[data['tool_names'][ev[1]]] += 1
            if ev[4] == 0:
                tools_err[data['tool_names'][ev[1]]] += 1
    needs = collections.Counter(k for t in T for k in t['needs_owner'])
    recent = [t for t in T if p(t['end']) >= NOW - dt.timedelta(hours=3) or t['status'] == 'running']
    cuts = collections.Counter(t['end'][:16] for t in inter)
    instants = sorted(((k, n) for k, n in cuts.items()), key=lambda kv: -kv[1])
    out = {
        'interrupt_instants': instants,
        'workers': len(T), 'runs': len(data['runs']),
        'status': dict(collections.Counter(t['status'] for t in T)),
        'interrupted': len(inter),
        'interrupted_18_21': {'n': len(win), 'labels': dict(collections.Counter(t['label'] for t in win)),
                              'projects': dict(collections.Counter(t['project'] for t in win))},
        'interrupted_resumed': len(resumed), 'interrupted_never_resumed': len(inter) - len(resumed & {t['id'] for t in inter}),
        'stall_total_s': sum(stall_by.values()), 'stall_top': stall_by.most_common(5),
        'tool_calls': sum(t['tool_calls'] for t in T), 'errors': sum(t['errors'] for t in T),
        'tool_errors_top': [(k, tools_err[k], tools_n[k]) for k, _ in tools_err.most_common(5)],
        'needs_owner': dict(needs), 'needs_owner_workers': sum(1 for t in T if t['needs_owner']),
        'by_label': {k: dict(v) for k, v in sorted(by_label.items(), key=lambda kv: -kv[1]['workers'])},
        'running': [t['label'] for t in T if t['status'] == 'running'],
        'recent_3h': len(recent),
        'lanes': data['lanes'],
    }
    return out


def main():
    keep_r2()
    data = json.loads((ROOT / 'data/trace-20261020.json').read_text())
    relabel(data)
    (ROOT / 'data/trace-r3.json').write_text(json.dumps(data, separators=(',', ':')))
    f = facts(data)
    (ROOT / 'data/facts-r3.json').write_text(json.dumps(f, indent=1))
    print(json.dumps({k: v for k, v in f.items() if k != 'by_label'}, indent=1))
    for k, v in f['by_label'].items():
        print(f"{k:28} {v}")


if __name__ == '__main__':
    main()
