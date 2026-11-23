#!/usr/bin/env python3
"""Fourth pass: exact "every touched file was deleted in staging" evidence.

Usage: audit4.py <repo> <outdir>. For each branch with unique commits, collect the
files those commits touch; a file counts as deleted only if staging history has a
commit that deleted it (new files the branch adds do not count). Records
all_files_deleted (bool) and deleted_by (top deleting staging commits).
"""
import json, subprocess, sys, os
from collections import Counter

repo, outdir = sys.argv[1:3]
BASE = "origin/staging"
p = os.path.join(outdir, "branch-raw.json")
rows = json.load(open(p))


def git(*a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True).stdout


staging_files = set(git("ls-tree", "-r", "--name-only", BASE).splitlines())
deleted = {}  # file -> newest deleting commit "<h> <subject>"
cur = None
for line in git("log", "--diff-filter=D", "--name-only", "--format=@@%h %s", BASE).splitlines():
    if line.startswith("@@"):
        cur = line[2:]
    elif line.strip() and line not in deleted:
        deleted[line] = cur

for d in rows:
    d["all_files_deleted"] = False
    d["deleted_by"] = []
    if not d["unique"] or not d.get("unique_adds"):
        continue
    files = set()
    for u in d["unique"]:
        files |= set(git("diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", u[0]).split())
    if not files:
        continue
    gone = [f for f in files if f not in staging_files and f in deleted]
    d["all_files_deleted"] = len(gone) == len(files)
    d["deleted_by"] = [k for k, _ in Counter(deleted[f] for f in gone).most_common(3)]
    d["files_touched"] = len(files)
    d["files_deleted"] = len(gone)

json.dump(rows, open(p, "w"), indent=1)
print("ok", sum(d["all_files_deleted"] for d in rows))
