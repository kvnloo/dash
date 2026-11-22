"""Retain bulky output for the three latest completed runs per headed army suite."""
import fcntl
import json
import re
import shutil
import time
from pathlib import Path

KEEP = 3


def reserve(base: Path, name: str) -> Path:
    # The runner's output and report paths share a flat namespace.
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name)
            or "." in name or name.startswith("stack-") or name.endswith("-html")
            or name in {"tmp", "virtual-runtime"}):
        raise ValueError(f"unsafe army run name: {name!r}")
    registry = base / ".run-retention"
    registry.mkdir(exist_ok=True)
    if registry.is_symlink():
        raise ValueError("army retention registry must not be a symlink")
    for path in (base / name, base / f"{name}-html", base / f"{name}.log", base / f"{name}.json"):
        if path.exists() or path.is_symlink():
            raise FileExistsError(f"army run already exists: {path}")
    scratch = registry / name / "tmp"
    scratch.parent.mkdir(mode=0o700)
    scratch.mkdir(mode=0o700)
    return scratch


def finish(base: Path, name: str, suite: str) -> None:
    registry = base / ".run-retention"
    with (registry / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = registry / name / "finished.json"
        temporary = marker.with_suffix(".tmp")
        temporary.write_text(json.dumps({"suite": suite, "finished_ns": time.time_ns()}))
        temporary.replace(marker)
        completed = []
        for record in registry.glob("*/finished.json"):
            if record.parent.is_symlink() or record.is_symlink():
                continue
            try:
                data = json.loads(record.read_text())
                if data["suite"] == suite and isinstance(data["finished_ns"], int):
                    completed.append((data["finished_ns"], record.parent.name))
            except (OSError, ValueError, TypeError, KeyError):
                continue
        for _, old in sorted(completed, reverse=True)[KEEP:]:
            # Leave compact reports, receipts and metadata; never touch a stack's
            # export here because its serve.py can still be running.
            for path in (base / old, base / f"{old}-html", registry / old / "tmp"):
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
            # Do not reconsider these paths on subsequent runs; some one-off tool
            # may reuse a path after pruning, and no further deletion is needed.
            (registry / old / "finished.json").unlink()
