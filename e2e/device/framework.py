"""Journey registry, run context and receipts.

A journey is one function per spec journey id (spec/features.yaml `journeys`). It drives Dash like a
user and records checks. A check may be tagged with one feature id of that journey; the receipt for a
feature passes only when every untagged check and every check tagged with that feature passed.

Receipts (one per feature of the journey, JSON) carry both the device-run fields the owner asked for
and the fields scripts/feature_status.py reads:
  feature_id, journey_id, candidate_sha, device_serial, display, started_at, result, evidence, failure_reason
  kind="journey", feature, journey, sha, real_device, device
A check is device-observed unless it is marked host=True (it reads a host log, a file, git or a CLI).
A feature passes only when at least one passing check that judged it observed the device; a pass made
of host-side checks alone is a fail, so "the file exists" or "spec/check.py passes" never makes a
feature Done. A journey with more than one feature needs a check tagged with each feature.
A journey that lacks an environment capability (second host, real agent, S Pen ...) still runs what it
can, but writes kind="journey-partial": the CLI ignores that kind, so it can never make a feature Done.
A journey skipped by the owner guard writes kind="journey-skip" with the guard verdict.
"""
from __future__ import annotations

import json
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from device import Device, OwnerBusy

CAPABILITIES = {
    "second_host": "a second tailnet host runs a Dash bridge (DASH_E2E_SECOND_HOST)",
    "real_agent": "the candidate bridge runs a real Hermes/OMP, not the deterministic ACP fixture (DASH_E2E_REAL_AGENT=1)",
    "archive_seed": "archived Codex/Claude/Grok/OMP sessions are seeded into the isolated bridge HOME (--seed-archive)",
    "physical_display": "the journey needs the physical display (status bar, notification shade, S Pen)",
    "spen": "the device has an S Pen (the S22+ has none; S22 Ultra / S25 Ultra do)",
    "host_reboot": "the journey may reboot the bridge host (never the owner's PC from this harness)",
    "turbo": "the Turbo orchestrator and ChatGPT lane outside this repo are attached (DASH_E2E_TURBO=1)",
    "z0live": "the z0live service outside this repo is attached (DASH_E2E_Z0LIVE=1)",
    "watch_agent": "a watch agent outside this repo is attached (DASH_E2E_WATCH_AGENT=1)",
    "repo_checks": "this repo is checked out on the runner at the candidate sha",
}


@dataclass(frozen=True)
class Journey:
    id: str
    fn: Callable[["Ctx"], None]
    features: tuple[str, ...]   # feature ids whose checks this journey may tag (validated against the spec)
    needs: tuple[str, ...] = ()
    doc: str = ""


JOURNEYS: dict[str, Journey] = {}


def journey(jid: str, features: tuple[str, ...], needs: tuple[str, ...] = ()):
    for n in needs:
        if n not in CAPABILITIES:
            raise ValueError(f"{jid}: unknown capability {n}")

    def wrap(fn):
        if jid in JOURNEYS:
            raise ValueError(f"duplicate journey {jid}")
        JOURNEYS[jid] = Journey(jid, fn, tuple(features), tuple(needs), (fn.__doc__ or "").strip())
        return fn
    return wrap


class StepFailed(Exception):
    """A precondition step failed; the remaining checks of the journey cannot run."""


@dataclass
class Ctx:
    dev: Device
    sha: str
    journey: Journey
    stack: "Stack"
    checks: list[dict] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)

    def check(self, name: str, ok: bool, detail: object = "", feature: str | None = None, host: bool = False) -> bool:
        if feature is not None and feature not in self.journey.features:
            raise ValueError(f"{self.journey.id}: check {name!r} tagged {feature}, not one of its features")
        rec = {"check": name, "ok": bool(ok), "detail": detail if isinstance(detail, (int, float, dict, list)) else str(detail)[:600],
               "feature": feature, "observed": "host" if host else "device",
               "shot": None if host else self.dev.shot(name)}
        self.checks.append(rec)
        print(json.dumps({"journey": self.journey.id, **rec}), flush=True)
        return bool(ok)

    def require(self, name: str, ok: bool, detail: object = "", host: bool = False) -> None:
        if not self.check(name, ok, detail, host=host):
            raise StepFailed(name)

    def guard(self) -> None:
        self.dev.guard(midrun=True)


@dataclass
class Stack:
    """The isolated candidate stack on the MBP (bridge + Metro) and the environment capabilities."""
    sha: str
    capabilities: frozenset[str]
    mbp: Callable[[str], str] = lambda cmd: ""
    base: str = "~/dash-e2e-army-20261025"

    def restart_bridge(self) -> str:
        return self.mbp(f"bash {self.base}/start-device-stack.sh {self.sha} bridge >/dev/null 2>&1; echo restarted").strip()

    def stop_bridge(self) -> str:
        return self.mbp(f"p={self.base}/device-state/bridge.pid; [ -f $p ] && kill -- -$(cat $p) 2>/dev/null; echo stopped").strip()

    def bootstrap_token(self) -> str:
        return self.mbp(f"cat {self.base}/device-state/.dash/bootstrap-token").strip()

    def bridge_log(self, lines: int = 200) -> str:
        return self.mbp(f"tail -n {lines} {self.base}/device-state/bridge.log")


def _device_observed(c: dict) -> bool:
    return c.get("observed", "device") != "host"


def feature_results(checks: list[dict], features: list[str],
                    journey_features: tuple[str, ...] | list[str] | None = None) -> dict[str, tuple[str, str | None]]:
    """Per feature: pass iff no check failed among untagged checks and that feature's tagged checks,
    and at least one of those passing checks observed the device. Nothing proven is a fail: a journey
    with no checks, a feature judged only by host-side checks, or (when the journey tags checks at all,
    or has more than one feature even if only one was selected) a feature none of whose tagged checks
    ran, e.g. because an earlier step stopped the journey."""
    out = {}
    multi = any(c["feature"] for c in checks) or len(journey_features or features) > 1
    for f in features:
        mine = [c for c in checks if c["feature"] in (None, f)]
        bad = [c for c in mine if not c["ok"]]
        if not mine:
            out[f] = ("fail", "no checks ran")
        elif multi and not any(c["feature"] == f for c in checks) and not bad:
            out[f] = ("fail", "no check for this feature ran")
        elif bad:
            out[f] = ("fail", "; ".join(f"{c['check']}: {c['detail']}" for c in bad)[:1200])
        elif not any(_device_observed(c) for c in mine):
            out[f] = ("fail", "only host-side checks ran; no check observed the device")
        else:
            out[f] = ("pass", None)
    return out


def write_receipts(out_dir: Path, *, journey: Journey, features: list[str], sha: str, dev_serial: str,
                   real_device: bool, display: str, started_at: str, checks: list[dict], metrics: dict,
                   evidence: list[str], missing: list[str], error: str | None, skip: str | None) -> list[Path]:
    """One receipt per feature. kind tells feature_status.py whether it counts."""
    out_dir.mkdir(parents=True, exist_ok=True)
    results = feature_results(checks, features, journey.features)
    paths = []
    for f in features:
        result, reason = results[f]
        if error:
            result, reason = "fail", (reason + "; " if reason else "") + error
        kind = "journey-skip" if skip else ("journey-partial" if missing else "journey")
        rec = {
            "kind": kind, "feature": f, "journey": journey.id, "sha": sha, "real_device": real_device,
            "device": dev_serial, "result": None if skip else result,
            "device_observed": result == "pass" and any(_device_observed(c) for c in checks if c["feature"] in (None, f)),
            "feature_id": f, "journey_id": journey.id, "candidate_sha": sha, "device_serial": dev_serial,
            "display": display, "started_at": started_at,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "evidence": evidence, "failure_reason": skip or reason,
            "missing_capabilities": missing, "metrics": metrics,
            "checks": [c for c in checks if c["feature"] in (None, f)],
        }
        p = out_dir / f"{f}.json"
        p.write_text(json.dumps(rec, indent=1) + "\n")
        paths.append(p)
    return paths


def run_one(j: Journey, dev: Device, stack: Stack, features: list[str], out_root: Path) -> dict:
    out_dir = out_root / j.id
    out_dir.mkdir(parents=True, exist_ok=True)
    dev.out = out_dir
    dev.shots = []
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    missing = [n for n in j.needs if n not in stack.capabilities]
    ctx = Ctx(dev, stack.sha, j, stack)
    error = skip = None
    t0 = time.time()
    try:
        dev.guard(midrun=False)
        j.fn(ctx)
    except OwnerBusy as e:
        skip = f"owner guard: {e}"
    except StepFailed as e:
        error = f"stopped after failed step {e}"
    except Exception as e:  # noqa: BLE001 - a crashed journey is a failed journey, with the reason
        error = f"{type(e).__name__}: {e}"
        (out_dir / "traceback.txt").write_text(traceback.format_exc())
    ctx.metrics["duration_s"] = round(time.time() - t0, 1)
    paths = write_receipts(out_dir, journey=j, features=features, sha=stack.sha, dev_serial=dev.hardware_serial,
                           real_device=dev.real_device, display=dev.display, started_at=started, checks=ctx.checks,
                           metrics=ctx.metrics, evidence=list(dev.shots), missing=missing, error=error, skip=skip)
    return {"journey": j.id, "skip": skip, "missing": missing, "error": error,
            "results": feature_results(ctx.checks, features, j.features), "receipts": [str(p) for p in paths]}
