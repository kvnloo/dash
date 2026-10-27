#!/usr/bin/env python3
"""Compact the agent-trace export into the snapshot the native Trace screen bundles.

    python3 scripts/trace-snapshot.py [TRACE_JSON] [INTERPRETATIONS_JSON]

Defaults read the round-3 prototype data (proto/agent-trace-20261020). Output:
app/src/trace/snapshot.json (schema dash.trace.snapshot/v1). Only allowlisted
labels, counts and times are kept; no goals, paths, prompts or arguments.

Later, the bridge can serve the same shape (see app/src/trace/source.ts).
"""
import collections
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROTO = Path('/mnt/zer0models/workspace/zer0/products/dash/.worktrees/agent-trace/docs/design/agent-trace/data')
TRACE = Path(sys.argv[1]) if len(sys.argv) > 1 else PROTO / 'trace-r3.json'
INTERP = Path(sys.argv[2]) if len(sys.argv) > 2 else PROTO / 'interpretations-r3.json'
OUT = ROOT / 'app/src/trace/snapshot.json'
BUCKET_S = 300  # density bucket: tool calls per 5 min
KEEP_H = 12     # finished work older than this drops away, as in the prototype


def main():
    data = json.loads(TRACE.read_text())
    interp = json.loads(INTERP.read_text())
    p = dt.datetime.fromisoformat
    now = p(data['generated'][:19])
    keep_from = now - dt.timedelta(hours=KEEP_H)
    tasks = [t for t in data['tasks'] if t['status'] == 'running' or p(t['end']) >= keep_from]
    t0 = min(p(t['start']) for t in tasks).replace(minute=0, second=0)
    sec = lambda iso: int((p(iso[:19]) - t0).total_seconds())
    now_s = int((now - t0).total_seconds())
    resumed = {t['resume_of'] for t in data['tasks'] if t['resume_of']}

    def group(t):
        if t['status'] == 'running':
            return 'live'
        return 'recent' if p(t['end']) >= now - dt.timedelta(hours=3) else 'earlier'

    rows = collections.OrderedDict()
    for t in sorted(tasks, key=lambda t: t['start']):
        s, e = sec(t['start']), now_s if t['status'] == 'running' else sec(t['end'])
        dens = [0] * max(1, (e - s) // BUCKET_S + 1)
        fails = set()
        for ev in t['events']:
            dens[min(len(dens) - 1, int(ev[0]) // BUCKET_S)] += 1
            if ev[4] == 0:
                fails.add(s + int(ev[0]) // 60 * 60)
        w = {
            'id': t['id'], 'model': t['model'], 'status': t['status'], 's': s, 'e': e,
            'calls': t['tool_calls'], 'errors': t['errors'], 'asks': t['needs_owner'],
            'resumed': t['id'] in resumed, 'isResume': bool(t['is_resume']),
            'density': dens, 'fails': sorted(fails),
            'stalls': [[s + st['s'], s + st['e']] for st in t['stalls']],
        }
        row = rows.setdefault(t['label'], {'key': t['label'], 'project': t['project'], 'goal': t['short_goal'], 'workers': []})
        row['workers'].append(w)
    rank = {'live': 0, 'recent': 1, 'earlier': 2}
    out_rows = []
    for row in rows.values():
        ws = row['workers']
        row['group'] = min((group(next(t for t in tasks if t['id'] == w['id'])) for w in ws), key=lambda g: rank[g])
        out_rows.append(row)
    out_rows.sort(key=lambda r: (rank[r['group']], -max(w['e'] for w in r['workers'])))

    va = interp['views']['a']
    labels = interp['outcomes']
    T = tasks
    snap = {
        'schema': 'dash.trace.snapshot/v1',
        'source': f'{TRACE.name} + {INTERP.name}',
        'privacy': data['privacy'],
        't0': t0.isoformat(), 'now': now_s, 'bucketS': BUCKET_S,
        'read': va['read'],
        'actions': [{**a, 'outcomeLabel': labels[a['outcome']]} for a in va['actions']],
        'stats': {
            'workers': len(T), 'live': sum(t['status'] == 'running' for t in T),
            'cut': sum(t['status'] == 'interrupted' for t in T),
            'resumed': sum(t['id'] in resumed for t in T if t['status'] == 'interrupted'),
            'asks': sum(1 for t in T if t['needs_owner']),
            'calls': sum(t['tool_calls'] for t in T), 'errors': sum(t['errors'] for t in T),
            'claudeUsed': data['lanes']['claude']['weekly_used_pct'],
            'claudeResetH': data['lanes']['claude']['hours_to_reset'],
            'codexUsed': data['lanes']['codex']['weekly_used_pct'],
        },
        'owner': sorted({sec(o['t']) // 60 * 60 for o in data['owner_turns'] if p(o['t'][:19]) >= t0}),
        'rows': out_rows,
    }
    OUT.write_text(json.dumps(snap, separators=(',', ':')) + '\n')
    print(f"{OUT.relative_to(ROOT)}: {len(out_rows)} rows, {len(T)} workers, {OUT.stat().st_size} bytes")


if __name__ == '__main__':
    main()
