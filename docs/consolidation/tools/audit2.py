#!/usr/bin/env python3
"""Second pass: for each git-unique commit, does replaying it onto origin/staging change anything?

Usage: audit2.py <repo> <outdir>. Reads/rewrites <outdir>/branch-raw.json.
Per unique commit c: merge-tree --merge-base=c^ staging c.
  tree == staging tree  -> content already present ("present")
  conflict              -> "conflict"
  otherwise             -> "adds"
Also records files the branch's unique commits touch that staging no longer has.
"""
import json, subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor

repo, outdir = sys.argv[1:3]
BASE = "origin/staging"
p = os.path.join(outdir, "branch-raw.json")
rows = json.load(open(p))


def git(*a):
    r = subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True)
    return r


base_tree = git("rev-parse", BASE + "^{tree}").stdout.strip()
staging_files = set(git("ls-tree", "-r", "--name-only", BASE).stdout.splitlines())
cache = {}


def commit_state(c):
    if c in cache:
        return cache[c]
    parents = git("rev-list", "--parents", "-n1", c).stdout.split()[1:]
    if not parents:
        st = "adds"
    else:
        mt = git("merge-tree", "--write-tree", "--no-messages", f"--merge-base={parents[0]}", BASE, c)
        tree = mt.stdout.split("\n")[0].strip()
        st = "conflict" if mt.returncode == 1 else ("present" if tree == base_tree else "adds")
    files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", c).stdout.split()
    gone = sorted({f for f in files if f not in staging_files})
    cache[c] = (st, files, gone)
    return cache[c]


def one(d):
    if not d["unique"]:
        return d
    states = []
    allfiles, gone = set(), set()
    for u in d["unique"]:
        st, files, g = commit_state(u[0])
        u_full = u + [st] if len(u) == 2 else u
        states.append(u_full)
        allfiles |= set(files)
        gone |= set(g)
    d["unique"] = states
    d["unique_adds"] = sum(1 for u in states if u[2] != "present")
    d["files_touched"] = len(allfiles)
    d["files_gone_in_staging"] = len(gone & allfiles)
    return d


with ThreadPoolExecutor(8) as ex:
    rows = list(ex.map(one, rows))
json.dump(rows, open(p, "w"), indent=1)
print("ok", len(rows))
