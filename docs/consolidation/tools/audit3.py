#!/usr/bin/env python3
"""Third pass: cross-branch containment and file-deletion evidence.

Usage: audit3.py <repo> <outdir>. Rewrites <outdir>/branch-raw.json adding:
  contained_in:   other non-staging branches whose history contains this tip
                  (prefers live names over reaped/*, then newest)
  deleted_by:     staging commits that deleted the files this branch's unique commits touch
"""
import json, subprocess, sys, os
from collections import defaultdict

repo, outdir = sys.argv[1:3]
BASE = "origin/staging"
p = os.path.join(outdir, "branch-raw.json")
rows = json.load(open(p))
by = {d["branch"]: d for d in rows}


def git(*a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True)


open_cands = [d for d in rows if d["unique"]]
# containment: tip of X reachable from Y (Y != X), via for-each-ref --contains
for d in open_cands:
    out = git("for-each-ref", "--contains", d["sha"], "--format=%(refname:short)", "refs/remotes/origin").stdout.split()
    others = [o[len("origin/"):] for o in out if o not in ("origin/HEAD", "origin/" + d["branch"])]
    others = [o for o in others if o in by and o != d["branch"]]
    d["contained_in"] = sorted(set(others), key=lambda o: (o.startswith("reaped/"), o))

# deletion evidence for branches whose touched files are all gone
for d in open_cands:
    if d.get("unique_adds", 0) and d.get("files_gone_in_staging") == d.get("files_touched"):
        files = set()
        for u in d["unique"]:
            files |= set(git("diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", u[0]).stdout.split())
        dels = defaultdict(int)
        for f in sorted(files)[:40]:
            h = git("log", "--diff-filter=D", "-1", "--format=%h %s", BASE, "--", f).stdout.strip()
            if h:
                dels[h] += 1
        d["deleted_by"] = sorted(dels.items(), key=lambda kv: -kv[1])[:3]

json.dump(rows, open(p, "w"), indent=1)
print("ok")
