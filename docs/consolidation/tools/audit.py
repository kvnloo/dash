#!/usr/bin/env python3
"""Audit every remote branch of kvnloo/dash against origin/staging.

Usage: audit.py <repo> <outdir> <allprs.json> <openprs.json>
Writes <outdir>/branch-raw.json. Read-only on the repo.
"""
import json, subprocess, sys, os
from concurrent.futures import ThreadPoolExecutor

repo, outdir, allprs_p, openprs_p = sys.argv[1:5]
BASE = "origin/staging"


def git(*a):
    r = subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True)
    if r.returncode not in (0, 1):
        raise RuntimeError(f"git {a}: {r.stderr}")
    return r


allprs = json.load(open(allprs_p))
prs_by_ref = {}
for p in allprs:
    if p["head"]["repo"] and p["head"]["repo"]["full_name"] == "kvnloo/dash":
        prs_by_ref.setdefault(p["head"]["ref"], []).append(p)

base_tree = git("rev-parse", BASE + "^{tree}").stdout.strip()
staging_subjects = {}
for line in git("log", "--no-merges", "--format=%h\t%s", BASE).stdout.splitlines():
    h, s = line.split("\t", 1)
    staging_subjects.setdefault(s.strip(), h)
staging_shas = set(git("rev-list", BASE).stdout.split())

refs = [r for r in git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin").stdout.split()
        if r not in ("origin", "origin/HEAD")]


def audit(ref):
    name = ref[len("origin/"):]
    sha = git("rev-parse", ref).stdout.strip()
    date, subj = git("log", "-1", "--format=%cI\t%s", ref).stdout.strip().split("\t", 1)
    behind, ahead = map(int, git("rev-list", "--left-right", "--count", f"{BASE}...{ref}").stdout.split())
    d = dict(branch=name, sha=sha, date=date, ahead=ahead, behind=behind, tip_subject=subj,
             ancestor=sha in staging_shas, unique=[], superseded_by_subject=[], tree_noop=None,
             merge_conflict=None, cherry_plus=0, cherry_minus=0)
    if not d["ancestor"]:
        cherry = git("cherry", BASE, ref).stdout.splitlines()
        plus = [l[2:] for l in cherry if l.startswith("+ ")]
        d["cherry_plus"] = len(plus)
        d["cherry_minus"] = sum(1 for l in cherry if l.startswith("- "))
        for c in plus:
            s = git("log", "-1", "--format=%s", c).stdout.strip()
            hit = staging_subjects.get(s)
            if hit:
                d["superseded_by_subject"].append([c[:10], s, hit])
            else:
                d["unique"].append([c[:10], s])
        if plus:
            mt = git("merge-tree", "--write-tree", "--no-messages", BASE, ref)
            tree = mt.stdout.split("\n")[0].strip()
            d["merge_conflict"] = mt.returncode == 1
            d["tree_noop"] = mt.returncode == 0 and tree == base_tree
    return d


with ThreadPoolExecutor(8) as ex:
    rows = list(ex.map(audit, refs))

for d in rows:
    d["prs"] = [dict(number=p["number"], state=p["state"], merged=bool(p.get("merged_at")),
                     base=p["base"]["ref"], head_sha=p["head"]["sha"], draft=p.get("draft"),
                     merge_commit=p.get("merge_commit_sha"), title=p["title"])
                for p in prs_by_ref.get(d["branch"], [])]
    d["merged_pr_in_staging"] = [p["number"] for p in d["prs"]
                                 if p["merged"] and p["head_sha"] == d["sha"]
                                 and p["merge_commit"] in staging_shas]
json.dump(rows, open(os.path.join(outdir, "branch-raw.json"), "w"), indent=1)
print(len(rows), "branches audited")
