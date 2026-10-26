#!/usr/bin/env python3
"""Run Dash native journeys on the agent phone and write receipts for scripts/feature_status.py.

  run_journeys.py --sha SHA (--features DF-001,DF-002 | --all) [--display virtual|physical]
                  [--seed-archive N] [--start-stack] [--out DIR] [--journeys J-a,J-b]
  run_journeys.py --dry-run [--sha SHA] [--features ... | --all]     # no device: validate linkage, print plan

Runs on groot (uiautomator2 + adb over the tailnet) against the S22+ agent phone, with the candidate stack
(isolated bridge + Metro) on the MBP started by start-device-stack.sh <sha>. Never the owner's S25.
Holds /tmp/s22-ui.lock for the whole run; checks the owner guard before every journey and stops the run
(exit 3) when the owner is busy. Receipts land in <out>/<journey>/<feature>.json; default
<repo>/.acceptance-receipts/<sha12>-<UTC>/ which `bun run spec:status` reads.

Exit: 0 all executed journeys passed for all selected features; 1 some failed or were partial;
2 environment unavailable / linkage invalid; 3 stopped by the owner guard.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "spec"))

import journeys as _journeys  # noqa: E402,F401  (registers every journey)
from framework import CAPABILITIES, JOURNEYS  # noqa: E402


def load_ledger(path: Path = ROOT / "spec/features.yaml") -> dict:
    from check import load_yaml  # dependency-free YAML subset reader used by the spec checker
    return load_yaml(path.read_text())


def linkage(ledger: dict) -> tuple[list[str], dict]:
    """Errors in journey <-> spec linkage, plus coverage numbers.

    - every registered journey id is a spec journey, and declares exactly the spec features of that journey;
    - every P0 feature's journey is registered;
    - every capability a journey needs is known.
    """
    errors: list[str] = []
    spec_journeys = {j["id"] for j in ledger.get("journeys", [])}
    by_journey: dict[str, set[str]] = {}
    for f in ledger["features"]:
        by_journey.setdefault(f["journey"], set()).add(f["id"])
    for jid, j in sorted(JOURNEYS.items()):
        if jid not in spec_journeys:
            errors.append(f"{jid}: registered journey is not in spec/features.yaml journeys")
            continue
        declared, spec = set(j.features), by_journey.get(jid, set())
        if declared != spec:
            errors.append(f"{jid}: declares {sorted(declared)} but the spec maps {sorted(spec)}")
        for n in j.needs:
            if n not in CAPABILITIES:
                errors.append(f"{jid}: unknown capability {n}")
    covered = {"P0": [0, 0], "P1": [0, 0], "P2": [0, 0]}
    for f in ledger["features"]:
        pr = f.get("priority")
        if pr in covered:
            covered[pr][1] += 1
            if f["journey"] in JOURNEYS:
                covered[pr][0] += 1
            elif pr == "P0":
                errors.append(f"{f['id']} (P0): journey {f['journey']} has no device journey function")
    stats = {p: {"with_journey": a, "total": b} for p, (a, b) in covered.items()}
    stats["journeys_registered"] = len(JOURNEYS)
    stats["journeys_in_spec"] = len(spec_journeys)
    return errors, stats


def select(ledger: dict, features: list[str] | None, journeys_only: list[str] | None) -> dict[str, list[str]]:
    """journey id -> selected feature ids, in spec order."""
    known = {f["id"] for f in ledger["features"]}
    if features:
        bad = [f for f in features if f not in known]
        if bad:
            raise SystemExit(f"unknown feature ids: {bad}")
    plan: dict[str, list[str]] = {}
    for f in ledger["features"]:
        if features and f["id"] not in features:
            continue
        if journeys_only and f["journey"] not in journeys_only:
            continue
        if f["journey"] in JOURNEYS:
            plan.setdefault(f["journey"], []).append(f["id"])
    return plan


def env_capabilities(display: str, sha: str, extra: list[str]) -> set[str]:
    caps = set(extra)
    if os.environ.get("DASH_E2E_SECOND_HOST"):
        caps.add("second_host")
    for env, cap in (("DASH_E2E_REAL_AGENT", "real_agent"), ("DASH_E2E_TURBO", "turbo"), ("DASH_E2E_Z0LIVE", "z0live"),
                     ("DASH_E2E_WATCH_AGENT", "watch_agent"), ("DASH_E2E_HOST_REBOOT", "host_reboot"),
                     ("DASH_E2E_ARCHIVE_SEEDED", "archive_seed"), ("DASH_E2E_SPEN", "spen")):
        if os.environ.get(env) == "1":
            caps.add(cap)
    if display == "physical":
        caps.add("physical_display")
    head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head and sha and (head.startswith(sha) or sha.startswith(head[:12])):
        caps.add("repo_checks")
    unknown = caps - set(CAPABILITIES)
    if unknown:
        raise SystemExit(f"unknown capabilities: {sorted(unknown)}")
    return caps


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--sha", help="candidate sha the stack serves (required unless --dry-run)")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--features", help="comma-separated DF ids")
    group.add_argument("--all", action="store_true", help="every feature with a registered journey")
    ap.add_argument("--journeys", help="comma-separated journey ids to restrict to")
    ap.add_argument("--display", choices=("virtual", "physical"), default="virtual")
    ap.add_argument("--dry-run", action="store_true", help="validate journey/spec linkage and print the plan; no device")
    ap.add_argument("--out", help="receipt root (default .acceptance-receipts/<sha12>-<UTC>)")
    ap.add_argument("--seed-archive", type=int, metavar="N", help="seed N archived sessions per harness into the isolated bridge first")
    ap.add_argument("--start-stack", action="store_true", help="(re)start the MBP candidate stack for --sha first")
    ap.add_argument("--capability", action="append", default=[], help=f"declare an environment capability: {sorted(CAPABILITIES)}")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    ledger = load_ledger()
    errors, stats = linkage(ledger)
    feats = [x.strip() for x in args.features.split(",")] if args.features else None
    if not args.dry_run and not (feats or args.all):
        ap.error("pass --features or --all")
    plan = select(ledger, feats, [x.strip() for x in args.journeys.split(",")] if args.journeys else None)
    sha = args.sha or ""
    if sha and not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        ap.error("--sha must be a hex commit sha")

    if args.dry_run:
        caps = env_capabilities(args.display, sha, args.capability) | ({"archive_seed"} if args.seed_archive else set())
        rows = [{"journey": j, "features": fs, "missing_capabilities": [n for n in JOURNEYS[j].needs if n not in caps]}
                for j, fs in plan.items()]
        report = {"valid": not errors, "errors": errors, "coverage": stats, "plan": rows}
        if args.json:
            print(json.dumps(report, indent=1))
        else:
            for e in errors:
                print("LINK ERROR", e)
            print(json.dumps(stats))
            for r in rows:
                miss = f"  partial (missing: {', '.join(r['missing_capabilities'])})" if r["missing_capabilities"] else ""
                print(f"{r['journey']:<30} {','.join(r['features'])}{miss}")
            print("linkage OK" if not errors else f"{len(errors)} linkage errors")
        return 0 if not errors else 2

    if errors:
        print("\n".join("LINK ERROR " + e for e in errors), file=sys.stderr)
        return 2
    if not sha:
        ap.error("--sha is required")

    from device import STACK_BASE, Device, EnvironmentUnavailable, OwnerBusy, mbp, ui_lock
    from framework import Stack, run_one

    out_root = Path(args.out) if args.out else ROOT / ".acceptance-receipts" / f"{sha[:12]}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    out_root.mkdir(parents=True, exist_ok=True)
    caps = env_capabilities(args.display, sha, args.capability)
    results, stopped = [], None
    try:
        with ui_lock():
            if args.start_stack:
                print(mbp(f"bash {STACK_BASE}/start-device-stack.sh {sha}", timeout=180))
            if args.seed_archive:
                seeded = subprocess.run(["ssh", os.environ.get("DASH_E2E_MBP", "mbp"), "python3", "-", "--home",
                                         f"{STACK_BASE}/device-state", "--per-harness", str(args.seed_archive)],
                                        stdin=open(HERE / "seed_archive.py"), capture_output=True, text=True, timeout=600)
                print(seeded.stdout.strip() or seeded.stderr.strip())
                if seeded.returncode == 0:
                    caps.add("archive_seed")
            dev = Device(args.display, out_root).connect()
            try:
                if re.search(r"(?i)spen|stylus", dev.sh("pm", "list", "features")):
                    caps.add("spen")
                stack = Stack(sha=sha, capabilities=frozenset(caps), mbp=mbp, base=STACK_BASE)
                # run_one checks the owner guard before each journey and records a skip, then we stop.
                for jid, fs in plan.items():
                    res = run_one(JOURNEYS[jid], dev, stack, fs, out_root)
                    results.append(res)
                    print(json.dumps({k: res[k] for k in ("journey", "skip", "missing", "error", "results")}), flush=True)
                    if res["skip"]:
                        stopped = res["skip"]
                        break
            finally:
                dev.close()
                dev.hand_back()
    except OwnerBusy as e:
        stopped = f"owner guard: {e}"
    except EnvironmentUnavailable as e:
        print(f"environment unavailable: {e}", file=sys.stderr)
        return 2
    summary = {"sha": sha, "display": args.display, "capabilities": sorted(caps), "stopped": stopped,
               "journeys": results, "not_run": [j for j in plan if j not in {r["journey"] for r in results}]}
    (out_root / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(f"receipts: {out_root}")
    if stopped:
        return 3
    ok = all(not r["missing"] and not r["error"] and all(v[0] == "pass" for v in r["results"].values()) for r in results)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
