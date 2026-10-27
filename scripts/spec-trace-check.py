#!/usr/bin/env python3
"""Fail-closed, offline structural trace checker; not native UI acceptance."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUSES = {'implemented-verified', 'implemented-unverified', 'partial', 'missing', 'regressed', 'superseded'}
GAPS = {'partial', 'missing', 'regressed'}

def load(root: Path, name: str):
    return json.loads((root / name).read_text())

def validate(root: Path) -> dict:
    requirements = load(root, 'spec/requirements.json')['requirements']
    features = load(root, 'spec/features.json')['features']
    surface = load(root, 'spec/surface.json')
    coverage = load(root, 'spec/surface-coverage.json')
    issues = {x['number']: x for x in load(root, 'spec/issues.json')['issues']}
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    reqs = {r['id']: r for r in requirements}
    specs = {s['id']: s for s in features}
    require(len(reqs) == len(requirements), 'duplicate requirement id')
    require(len(specs) == len(features), 'duplicate spec id')
    aliases = [a for r in requirements for a in r.get('aliases', [])]
    require(len(set(aliases)) == len(aliases) and not set(aliases) & reqs.keys(), 'ambiguous alias')
    seen = set()
    for r in requirements:
        require(r['status'] in STATUSES, f"{r['id']}: invalid status")
        require(bool(r['quote'] and r['sources'] and r['acceptance']), f"{r['id']}: missing owner evidence or acceptance")
        for target in r.get('superseded_by', []):
            require(target in reqs or target in aliases, f"{r['id']}: unknown supersession {target}")
        if r['status'] == 'superseded':
            require(bool(r.get('superseded_by')), f"{r['id']}: superseded without successor")
    for s in features:
        sid = s['id']
        require(s['status'] in STATUSES and s['status'] != 'superseded', f'{sid}: invalid spec status')
        require(bool(re.fullmatch(r'DASH-[A-Z]+-[A-Z0-9]+', sid)), f'{sid}: malformed stable id')
        require(bool(s['acceptance']) and all(isinstance(a, str) and a.strip() for a in s['acceptance']), f'{sid}: untestable empty acceptance')
        for rid in s['requirements']:
            require(rid in reqs, f'{sid}: unknown requirement {rid}')
            if rid in reqs:
                require(reqs[rid]['status'] != 'superseded', f'{sid}: superseded requirement used as coverage {rid}')
                seen.add(rid)
        if s['status'].startswith('implemented'):
            require(bool(s['implementation']), f'{sid}: implemented without code')
        if s['status'] == 'implemented-verified':
            require(bool(s['tests']), f'{sid}: verified without test evidence')
        if s['status'] in GAPS:
            require(any(isinstance(n, int) and n in issues and issues[n]['state'] == 'OPEN' for n in s['issues']), f'{sid}: gap without open issue')
        for kind in ('implementation', 'tests'):
            for ref in s[kind]:
                path = ref['path']
                p = root / path
                require(not Path(path).is_absolute() and '..' not in Path(path).parts, f'{sid}: unsafe path {path}')
                if not p.is_file():
                    errors.append(f'{sid}: absent {kind} file {path}')
                    continue
                require(p.resolve().is_relative_to(root.resolve()), f'{sid}: reference escapes root')
                lines = p.read_text().splitlines()
                line = ref.get('line')
                require(type(line) is int and 1 <= line <= len(lines), f'{sid}: invalid line {path}:{line}')
                if type(line) is int and 1 <= line <= len(lines):
                    require(lines[line-1].strip() == ref['anchor'], f'{sid}: anchor drift {path}:{line}')
                if ref.get('sha256'):
                    require(hashlib.sha256(p.read_bytes()).hexdigest() == ref['sha256'], f'{sid}: content drift {path}')
                if kind == 'tests':
                    require(bool(ref.get('scope')), f'{sid}: test missing scope')
    for rid, r in reqs.items():
        if r['status'] != 'superseded':
            require(rid in seen, f'{rid}: active owner requirement uncovered')
            linked = [s for s in features if rid in s['requirements']]
            require(set(r.get('spec_items', [])) == {s['id'] for s in linked}, f'{rid}: inverse trace mismatch')
            require(all(s['status'] == r['status'] for s in linked), f'{rid}: status disagreement')
    surface_ids = {s['feature_id'] for s in surface}
    dispositions = {s['surface_id']: s for s in coverage['entries']}
    require(len(surface_ids) == len(surface), 'duplicate input surface id')
    require(len(dispositions) == len(coverage['entries']), 'duplicate surface disposition')
    require(surface_ids == dispositions.keys(), 'surface classification is not total/exact')
    for source, item in dispositions.items():
        if item['disposition'] == 'specified':
            require(bool(item['spec_items']), f'{source}: empty surface mapping')
            for sid in item['spec_items']:
                require(sid in specs, f'{source}: unknown mapped spec {sid}')
        else:
            require(item['disposition'] == 'unspecified' and bool(item.get('reason')), f'{source}: missing explicit unspecified reason')
    for s in features:
        require(set(s['surface_ids']) <= surface_ids, f"{s['id']}: unknown surface reference")
    source_index = load(root, 'spec/source-ledger-index.json')
    require(len(source_index['repo_units']) == 8985, 'repo input census mismatch')
    admitted = {x['id'] for x in source_index['repo_units'] if x['disposition'] == 'admitted-owner-rule'}
    require(admitted == {r for r in reqs if r.startswith('R-')}, 'admitted repo rules do not match canonical requirements')
    return {'status': 'FAIL' if errors else 'PASS', 'scope': 'Structural source trace only; not behavior/device verification',
            'requirements': len(requirements), 'active_requirements': sum(r['status'] != 'superseded' for r in requirements),
            'features': len(features), 'status_counts': dict(Counter(s['status'] for s in features)),
            'by_area': {a: dict(Counter(s['status'] for s in features if s['area'] == a)) for a in sorted({s['area'] for s in features})},
            'surface_entries': len(surface), 'specified_surface_entries': sum(x['disposition'] == 'specified' for x in coverage['entries']),
            'errors': errors}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=ROOT)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    try:
        report = validate(args.root)
    except (OSError, ValueError, KeyError, TypeError) as e:
        report = {'status': 'FAIL', 'errors': [str(e)]}
    text = json.dumps(report, indent=2) + '\n'
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
    print(text, end='')
    return 0 if report['status'] == 'PASS' else 1

if __name__ == '__main__':
    raise SystemExit(main())
