#!/usr/bin/env python3
"""Feature completion status; exhaustively parity-checked against bend/feature_completion/MODEL.bend.

Pure decide functions (decide_status, may_stop) plus a CLI:

  python3 scripts/feature_status.py --evidence DIR [--candidate SHA] [--scope all|P0|P1|P2]
                                    [--ids DF-001,DF-002] [--budget-exhausted] [--owner-stop] [--json]

Reads spec/features.yaml and every *.json receipt under DIR (recursively). Prints each in-scope
feature's status and the run verdict. Exit 0 only when the run may stop (every in-scope feature
is Done or Blocked, or the owner stopped it); exit 1 otherwise (continue, or pause with report).

Receipt files are untrusted data. Only these shapes count; anything else is ignored:
  {"kind": "journey", "feature": "DF-001", "journey": "J-...", "sha": "<sha>",
   "real_device": true, "device": "<serial or name>", "device_observed": true, "result": "pass" | "fail"}
  {"kind": "preview", "feature": "DF-001", "sha": "<sha>", "delivered": true}
  {"kind": "blocker", "feature": "DF-001", "by": "owner", "reason": "<text>", "owner_ref": "<owner message id>"}
  {"kind": "blocker", "feature": "DF-001", "by": "external", "reason": "<text>"}
A journey receipt counts only for the feature's own ledger journey, from a real device
(real_device true and a device name), and a pass counts only when the feature was judged by at least
one check that observed the device UI (device_observed true; host-only checks such as "the file
exists" or "spec/check.py passes" never make a feature Done). Unit tests, emulators and other
journeys never count. An owner blocker needs owner_ref (the owner message that set it); without it,
it is a blocker without a reason.
Evidence for another sha is stale: a pass there is JPassOtherSha, never Done.
A preview counts only for the candidate sha. A blocker without a non-empty reason is no blocker.
spec_linked: the feature is in the ledger with a requirement and a defined journey.
code_present: the ledger says status_from_code "implemented" with at least one surface_ref.
"""
from __future__ import annotations

import argparse
from enum import Enum
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


class Journey(Enum):
    NONE = 'JNone'
    FAIL = 'JFail'
    PASS_OTHER_SHA = 'JPassOtherSha'
    PASS_CANDIDATE = 'JPassCandidate'


class Preview(Enum):
    NONE = 'PNone'
    DELIVERED = 'PDelivered'


class Blocker(Enum):
    NONE = 'BNone'
    NO_REASON = 'BNoReason'
    OWNER = 'BOwner'
    EXTERNAL = 'BExternal'


class Status(Enum):
    OPEN = 0
    DONE = 1
    BLOCKED_OWNER = 2
    BLOCKED_EXTERNAL = 3


class Run(Enum):
    CONTINUE = 0
    PAUSE_REPORT = 1
    STOP_COMPLETE = 2
    STOP_OWNER = 3


def decide_status(blocked, spec_linked, code_present, journey, preview):
    """MODEL.decide: an explicit blocker wins; Done needs all four pieces of evidence."""
    if blocked is Blocker.OWNER:
        return Status.BLOCKED_OWNER
    if blocked is Blocker.EXTERNAL:
        return Status.BLOCKED_EXTERNAL
    if journey is not Journey.PASS_CANDIDATE:
        return Status.OPEN
    if preview is not Preview.DELIVERED:
        return Status.OPEN
    if not code_present:
        return Status.OPEN
    if not spec_linked:
        return Status.OPEN
    return Status.DONE


def may_stop(all_done_or_blocked, any_external_blocked, budget_exhausted, owner_stop):
    """MODEL.may_stop: budget exhaustion alone, or a scope settled only by external blockers,
    is a pause with report, never a stop."""
    if owner_stop:
        return Run.STOP_OWNER
    if all_done_or_blocked:
        return Run.PAUSE_REPORT if any_external_blocked else Run.STOP_COMPLETE
    if budget_exhausted:
        return Run.PAUSE_REPORT
    return Run.CONTINUE


def status_code(status):
    return status.value


def run_code(run):
    return run.value


# ---- observation (not proven; fails closed) ----

def _same_sha(a, b):
    a, b = str(a or '').lower(), str(b or '').lower()
    return len(a) >= 7 and len(b) >= 7 and (a.startswith(b) or b.startswith(a))


def load_receipts(evidence_dir):
    receipts = []
    for path in sorted(Path(evidence_dir).rglob('*.json')):
        try:
            value = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, dict) and isinstance(item.get('feature'), str):
                receipts.append(item)
    return receipts


def classify_journey(receipts, journey_id, candidate):
    real = [r for r in receipts if r.get('kind') == 'journey' and r.get('journey') == journey_id
            and r.get('real_device') is True and isinstance(r.get('device'), str) and r['device'].strip()
            and r.get('result') in ('pass', 'fail')]
    # A pass judged only by host-side checks is not device evidence: it counts as a failure.
    real = [dict(r, result='fail') if r['result'] == 'pass' and r.get('device_observed') is not True else r
            for r in real]
    here = [r for r in real if _same_sha(r.get('sha'), candidate)]
    if any(r['result'] == 'fail' for r in here):
        return Journey.FAIL
    if here:
        return Journey.PASS_CANDIDATE
    if any(r['result'] == 'pass' for r in real):
        return Journey.PASS_OTHER_SHA
    if real:
        return Journey.FAIL
    return Journey.NONE


def classify_preview(receipts, candidate):
    ok = any(r.get('kind') == 'preview' and r.get('delivered') is True and _same_sha(r.get('sha'), candidate)
             for r in receipts)
    return Preview.DELIVERED if ok else Preview.NONE


def classify_blocker(receipts):
    claims = [r for r in receipts if r.get('kind') == 'blocker']
    explained = [r for r in claims if isinstance(r.get('reason'), str) and r['reason'].strip()
                 and (r.get('by') != 'owner' or (isinstance(r.get('owner_ref'), str) and r['owner_ref'].strip()))]
    if any(r.get('by') == 'owner' for r in explained):
        return Blocker.OWNER, next(r['reason'] for r in explained if r.get('by') == 'owner')
    if any(r.get('by') == 'external' for r in explained):
        return Blocker.EXTERNAL, next(r['reason'] for r in explained if r.get('by') == 'external')
    return (Blocker.NO_REASON, None) if claims else (Blocker.NONE, None)


def load_ledger(path):
    sys.path.insert(0, str(ROOT / 'spec'))
    from check import load_yaml  # noqa: E402  (dependency-free YAML subset reader)
    return load_yaml(Path(path).read_text())


def evaluate(ledger, receipts, candidate, scope='all', ids=None):
    journeys = {j['id'] for j in ledger.get('journeys', [])}
    rows = []
    for feature in ledger['features']:
        if ids is not None and feature['id'] not in ids:
            continue
        if ids is None and scope != 'all' and feature.get('priority') != scope:
            continue
        mine = [r for r in receipts if r.get('feature') == feature['id']]
        spec_linked = bool(feature.get('requirement')) and feature.get('journey') in journeys
        code_present = feature.get('status_from_code') == 'implemented' and bool(feature.get('surface_refs'))
        journey = classify_journey(mine, feature.get('journey'), candidate)
        preview = classify_preview(mine, candidate)
        blocked, reason = classify_blocker(mine)
        status = decide_status(blocked, spec_linked, code_present, journey, preview)
        rows.append({'id': feature['id'], 'priority': feature.get('priority'), 'title': feature.get('title'),
                     'status': status.name.lower(), 'spec_linked': spec_linked, 'code_present': code_present,
                     'journey': journey.value, 'preview': preview.value, 'blocker': blocked.value,
                     'blocker_reason': reason})
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--ledger', default=str(ROOT / 'spec/features.yaml'))
    parser.add_argument('--evidence', required=True, help='directory of receipt *.json files')
    parser.add_argument('--candidate', help='candidate sha (default: git HEAD of this repo)')
    parser.add_argument('--scope', choices=('all', 'P0', 'P1', 'P2'), default='all')
    parser.add_argument('--ids', help='comma-separated DF ids; overrides --scope')
    parser.add_argument('--budget-exhausted', action='store_true')
    parser.add_argument('--owner-stop', action='store_true')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    candidate = args.candidate or subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], check=True,
                                                 capture_output=True, text=True).stdout.strip()
    evidence = Path(args.evidence)
    receipts = load_receipts(evidence) if evidence.is_dir() else []
    ids = {i.strip() for i in args.ids.split(',') if i.strip()} if args.ids else None
    rows = evaluate(load_ledger(args.ledger), receipts, candidate, args.scope, ids)
    if ids is not None and len(rows) != len(ids):
        print('unknown feature id in --ids', file=sys.stderr)
        return 2
    # An empty scope is never settled: selecting nothing must not let a run stop.
    settled = bool(rows) and all(r['status'] != 'open' for r in rows)
    external = any(r['status'] == 'blocked_external' for r in rows)
    run = may_stop(settled, external, args.budget_exhausted, args.owner_stop)
    counts = {s: sum(r['status'] == s for r in rows) for s in ('done', 'blocked_owner', 'blocked_external', 'open')}
    if args.json:
        print(json.dumps({'candidate': candidate, 'scope': sorted(ids) if ids else args.scope,
                          'counts': counts, 'run': run.name.lower(), 'may_stop': run.name.startswith('STOP'),
                          'features': rows}, indent=2))
    else:
        for r in rows:
            extra = f" ({r['blocker_reason']})" if r['blocker_reason'] else ''
            print(f"{r['id']} {r['priority']} {r['status']:<16} journey={r['journey']} preview={r['preview']} "
                  f"code={'y' if r['code_present'] else 'n'} spec={'y' if r['spec_linked'] else 'n'}{extra}")
        print(f"candidate={candidate} " + ' '.join(f'{k}={v}' for k, v in counts.items()) + f" run={run.name.lower()}")
    return 0 if run in (Run.STOP_COMPLETE, Run.STOP_OWNER) else 1


if __name__ == '__main__':
    sys.exit(main())
