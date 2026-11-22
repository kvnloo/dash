#!/usr/bin/env python3
"""Local Dash error triage, with one durable task per incident."""
import argparse
import hashlib
import os
import re
import selectors
import signal
import sqlite3
import subprocess
import time
from pathlib import Path

PACKAGE = "app.dash.mobile"
MAX_LINE = 32768
PHONE_ERROR = re.compile(rb"^E/ReactNativeJS\(\s*\d+\):\s*")
BRIDGE_ERROR = re.compile(rb"(?:^\s*(?:error|fatal):|\[(?:error|fatal)\]|\b(?:unhandled rejection|uncaught exception)\b)", re.I)


class Lines:
    def __init__(self):
        self.pending = bytearray()
        self.oversized = False

    def feed(self, chunk):
        parts = chunk.split(b"\n")
        for part in parts[:-1]:
            if not self.oversized and len(self.pending) + len(part) <= MAX_LINE:
                yield bytes(self.pending) + part.rstrip(b"\r")
            self.pending.clear()
            self.oversized = False
        if not self.oversized and len(self.pending) + len(parts[-1]) <= MAX_LINE:
            self.pending.extend(parts[-1])
        else:
            self.pending.clear()
            self.oversized = True


class BridgeTail:
    def __init__(self, path):
        self.path = path
        self.file = None
        self.lines = Lines()
        self.open(at_end=True)

    def open(self, at_end=False):
        try:
            self.file = self.path.open("rb")
        except FileNotFoundError:
            return
        self.lines = Lines()
        if at_end:
            self.file.seek(0, os.SEEK_END)

    def poll(self):
        if self.file is None:
            self.open()
        if self.file is None:
            return
        stat = os.fstat(self.file.fileno())
        if stat.st_size < self.file.tell():
            self.file.seek(0)
            self.lines = Lines()
        chunk = self.file.read(65536)
        if chunk:
            yield from self.lines.feed(chunk)
            return
        try:
            current = self.path.stat()
        except FileNotFoundError:
            return
        if (stat.st_dev, stat.st_ino) != (current.st_dev, current.st_ino):
            self.file.close()
            self.file = None
            self.open()


class PhoneTail:
    def __init__(self, adb, serial):
        self.adb = [adb, "-s", serial]
        self.child = None
        self.pid = None
        self.lines = Lines()

    def scan(self, selector):
        try:
            found = subprocess.run(
                [*self.adb, "shell", "pidof", "-s", PACKAGE], timeout=3,
                capture_output=True, check=False,
            ).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            found = b""
        if self.child is not None and self.child.poll() is None and (not found or found == self.pid):
            return
        self.close(selector)
        if not found.isdigit():
            return
        self.child = subprocess.Popen(
            [*self.adb, "logcat", "--pid", found.decode("ascii"), "-T", "1",
             "-v", "brief", "ReactNativeJS:E", "*:S"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        self.pid = found
        self.lines = Lines()
        selector.register(self.child.stdout, selectors.EVENT_READ)
        print("logwatch: attached to Dash JS logcat", flush=True)

    def close(self, selector):
        if self.child is None:
            return
        selector.unregister(self.child.stdout)
        if self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()
        self.child.stdout.close()
        self.child = None


def file_task(db, source, line):
    now = int(time.time())
    # Keep a signature for recurrence, not user content, credentials or stack traces.
    digest = hashlib.sha256(line.strip()).hexdigest()
    with db:
        previous = db.execute(
            "SELECT id FROM incidents WHERE source=? AND signature=? AND last_seen>=? "
            "ORDER BY last_seen DESC, id DESC LIMIT 1", (source, digest, now - 300),
        ).fetchone()
        if previous:
            db.execute("UPDATE incidents SET occurrences=occurrences+1,last_seen=? WHERE id=?", (now, previous[0]))
            return
        row = db.execute(
            "INSERT INTO incidents(source,signature,first_seen,last_seen) VALUES (?,?,?,?)",
            (source, digest, now, now),
        )
        db.execute(
            "INSERT INTO tasks(incident_id,title) VALUES (?,?)",
            (row.lastrowid, "Investigate Dash " + ("Android JS error" if source == "android-js" else "bridge error")),
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--bridge-log", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    args.state.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.state / "logwatch.sqlite3")
    db.executescript("""
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS incidents(
            id INTEGER PRIMARY KEY, source TEXT NOT NULL, signature TEXT NOT NULL,
            first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
            occurrences INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX IF NOT EXISTS incident_recurrence ON incidents(source,signature,last_seen);
        CREATE TABLE IF NOT EXISTS tasks(
            incident_id INTEGER PRIMARY KEY REFERENCES incidents(id), title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open');
    """)
    phone = PhoneTail(args.adb, args.serial)
    bridge = BridgeTail(args.bridge_log)
    stop = False

    def shutdown(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    next_scan = 0
    print("logwatch: ready", flush=True)
    with selectors.DefaultSelector() as selector:
        try:
            while not stop:
                for line in bridge.poll():
                    if BRIDGE_ERROR.search(line):
                        # Keep logging timestamps out of the recurrence signature.
                        message = BRIDGE_ERROR.split(line, maxsplit=1)[-1].strip()
                        file_task(db, "bridge", message or line)
                if time.monotonic() >= next_scan:
                    phone.scan(selector)
                    next_scan = time.monotonic() + 2
                for key, _ in selector.select(timeout=0.25):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        phone.close(selector)
                        continue
                    for line in phone.lines.feed(chunk):
                        if PHONE_ERROR.match(line):
                            file_task(db, "android-js", PHONE_ERROR.sub(b"", line, count=1))
        finally:
            phone.close(selector)
            if bridge.file is not None:
                bridge.file.close()
            db.close()


if __name__ == "__main__":
    main()
