#!/usr/bin/env python3
"""Write CONSOLIDATION.md and DELETE-WAVES.txt from classified.json.

Usage: make_md.py <raw-dir> <docs/consolidation dir> <staging-sha> <audit-utc> <archive-sha>
"""
import json, os, sys
from collections import Counter

raw, docs, staging_sha, audit_utc, archive_sha = sys.argv[1:6]
c = json.load(open(os.path.join(raw, "classified.json")))
s = json.load(open(os.path.join(raw, "summary.json")))
rows, prs = c["rows"], c["prs"]
by = {d["branch"]: d for d in rows}

with open(os.path.join(docs, "DELETE-WAVES.txt"), "w") as f:
    f.write("# <wave> <full sha> <branch>  (waves 1 and 2 are safe now; wave 3 only after the archive ref is pushed)\n")
    for d in sorted(rows, key=lambda x: (x["wave"], x["branch"])):
        if d["wave"][:1] in "123":
            f.write(f"{d['wave'][:1]} {d['sha']} {d['branch']}\n")

bv = Counter(d["verdict"].split(" ")[0] for d in rows)
w = Counter(d["wave"][:1] for d in rows)
pv = Counter(r["verdict"].split(" ")[0] for r in prs)
L = []
a = L.append
a("# Dash branch and PR consolidation (DA-052)")
a("")
a(f"Audit of every remote branch and every open PR of kvnloo/dash against `origin/staging` "
  f"{staging_sha[:12]}, taken {audit_utc}. Nothing was closed or deleted by this audit; "
  "this file is the evidence list for whoever does it.")
a("")
a("Files: [PR-AUDIT.tsv](PR-AUDIT.tsv), [BRANCH-AUDIT.tsv](BRANCH-AUDIT.tsv), "
  "[STILL-UNIQUE.md](STILL-UNIQUE.md) (every unapplied commit, one line each), "
  "[DELETE-WAVES.txt](DELETE-WAVES.txt) (full SHAs for leased deletes), "
  "[ARCHIVE-PARENTS.txt](ARCHIVE-PARENTS.txt), scripts in [tools/](tools/).")
a("")
a("## Summary")
a("")
a("| | close / delete | keep | still unique (Kevin decides) | total |")
a("|---|---|---|---|---|")
pr_close = sum(1 for r in prs if r["action"].startswith("close"))
pr_keep = sum(1 for r in prs if r["action"] == "keep open")
pr_uni = sum(1 for r in prs if r["action"] == "Kevin decides")
a(f"| Open PRs | {pr_close} | {pr_keep} | {pr_uni} | {len(prs)} |")
a(f"| Remote branches | {w['1'] + w['2']} | {w['k']} | {w['3']} | {len(rows)} |")
a("")
a(f"Branch verdicts: MERGED-EQUIVALENT {bv['MERGED-EQUIVALENT']}, SUPERSEDED-BY {bv['SUPERSEDED-BY']}, "
  f"STILL-UNIQUE {bv['STILL-UNIQUE']}, KEEP {bv['KEEP']}.")
a("")
a("Remote branch count:")
a("")
a(f"- now: {len(rows)}")
a(f"- after waves 1 and 2 (provably safe): {s['after_wave12']}")
a(f"- after wave 3 (archive the {w['3']} STILL-UNIQUE tips into one ref, then delete them): "
  f"{s['after_wave3']}, which meets the goal of under 50")
a("")
a("Waves 1 and 2 alone cannot reach 50: most of what is left is `reaped/*` worktree snapshots and lane "
  "composites with real unmerged content. Wave 3 keeps every one of those commits reachable from a single "
  "`archive/` ref, so it loses nothing. It still needs Kevin's OK.")
a("")
a("## Method")
a("")
a("```")
a("git fetch origin '+refs/heads/*:refs/remotes/origin/*'")
a("curl -s 'https://api.github.com/repos/kvnloo/dash/pulls?state=open&per_page=100'   # + state=all for PR history")
a("python3 tools/audit.py  <repo> <out> allprs.json open-prs.json   # ancestry, ahead/behind, git cherry, merge-tree")
a("python3 tools/audit2.py <repo> <out>   # per unapplied commit: replay onto staging (adds/conflict/present)")
a("python3 tools/audit3.py <repo> <out>   # containment: which other branches hold this tip")
a("python3 tools/audit4.py <repo> <out>   # files touched that staging deleted")
a("python3 tools/classify.py ... && python3 tools/make_md.py ...")
a("```")
a("")
a("Verdict rules, in order:")
a("")
a("1. KEEP: `staging`, `main`, `release/*`, `archive/*`; the head of an open PR that is not being closed; "
  "the base of an open PR that is not being closed (GitHub closes a PR when its base is deleted).")
a("2. MERGED-EQUIVALENT: the tip is an ancestor of staging; or `git cherry origin/staging <tip>` shows only `-`; "
  "or `git merge-tree --write-tree origin/staging <tip>` returns staging's own tree; or every unapplied "
  "commit replays onto staging (`merge-tree --merge-base=<c>^`) with no change.")
a("3. SUPERSEDED-BY <x>: <x> is a staging commit with the same subject, a staging commit that deleted "
  "every file the branch changes, a named PR's replacement, or another surviving branch whose history "
  "already contains this tip (deleting the duplicate loses nothing).")
a("4. STILL-UNIQUE: anything else. Commits are listed in STILL-UNIQUE.md.")
a("")
a("Choice made here: GitHub's draft flag alone is not read as Kevin's \"do not merge\". Only PR titles that say "
  "so (#626, #638) are KEEP. Drafts whose content is already in staging are on the close list.")
a("")
a("## PR close list")
a("")
for r in prs:
    if r["action"].startswith("close"):
        a(f"- #{r['pr']} {r['title']}: {r['verdict']}. {r['evidence']}. Head `{r['head']}` {r['sha']}.")
a("")
a("## PRs to keep open")
a("")
for r in prs:
    if r["action"] == "keep open":
        a(f"- #{r['pr']} {r['title']}: {r['evidence']}.")
a("")
a("## PRs that need Kevin's decision (STILL-UNIQUE)")
a("")
for r in prs:
    if r["action"] == "Kevin decides" and not r["head"].startswith("dependabot/"):
        a(f"- #{r['pr']} {r['title']} (base `{r['base']}`, +{r['ahead']}/-{r['behind']}, last {r['date']}): {r['evidence']}.")
a("")
a("### Dependabot #650-#654")
a("")
a("None of these bumps has landed. Every one of them targets `main`, while staging's workflows "
  "(`.github/workflows/*.yml` at the audited SHA) still pin the old versions:")
a("")
for r in prs:
    if r["head"].startswith("dependabot/"):
        a(f"- #{r['pr']} {r['title']}: {r['evidence']}.")
a("")
a("Suggested: take the bumps on staging in one `chore(ci)` PR, then close #650-#654. Closing them without that "
  "change only makes dependabot reopen them. upload-artifact v7 and cache v6 are major versions; check the runner "
  "and Node requirements before merging.")
a("")
a("## Branch delete list")
a("")
a("Before each delete, check that the branch still points at the audited SHA, e.g. "
  "`git push --force-with-lease=refs/heads/<b>:<sha> origin :refs/heads/<b>` with SHAs from DELETE-WAVES.txt. "
  "Close a PR before deleting its head.")
a("")
for wave, title in (("1", "Wave 1: MERGED-EQUIVALENT"), ("2", "Wave 2: SUPERSEDED-BY")):
    sel = sorted((d for d in rows if d["wave"][:1] == wave), key=lambda x: x["branch"])
    a(f"### {title} ({len(sel)})")
    a("")
    for d in sel:
        ev = d["evidence"] if wave == "2" or not d["evidence"].startswith("tip is an ancestor") else "ancestor of staging"
        extra = f" {d['verdict'].split(' ', 1)[1]}:" if wave == "2" else ""
        a(f"- `{d['branch']}` {d['sha'][:12]}{extra} {ev}")
    a("")
a(f"## STILL-UNIQUE branches needing a human decision ({w['3']})")
a("")
a("Each has commits whose patches are not in staging; the commits are listed one line each in STILL-UNIQUE.md. "
  "Counts are `unapplied commits that change staging / unapplied commits`.")
a("")
groups = Counter()
for d in rows:
    if d["wave"][:1] == "3":
        groups[d["branch"].split("/")[0]] += 1
a("By prefix: " + ", ".join(f"{k}/* {v}" for k, v in groups.most_common()) + ".")
a("")
for d in sorted((d for d in rows if d["wave"][:1] == "3"), key=lambda x: x["branch"]):
    first = d["unique"][0][1] if d["unique"] else d["tip_subject"]
    first = first if len(first) < 90 else first[:87] + "..."
    from_cls = d["evidence"]
    a(f"- `{d['branch']}` {d['sha'][:12]} {d['date'][:10]} +{d['ahead']}/-{d['behind']} "
      f"({d.get('unique_adds', 0)}/{len(d['unique'])}): {first}")
a("")
a("## Wave 3: archive, then delete")
a("")
a(f"`boat/dash-consolidate/archive-unique` ({archive_sha[:12]}) is one commit whose parents are the "
  f"{w['3']} STILL-UNIQUE tips listed in ARCHIVE-PARENTS.txt. Its tree holds only that list. "
  "Pushing it as `archive/dash-unique-20261123` keeps every one of those commits reachable after the branches are deleted:")
a("")
a("```")
a("git push origin boat/dash-consolidate/archive-unique:refs/heads/archive/dash-unique-20261123")
a("git merge-base --is-ancestor <sha> origin/archive/dash-unique-20261123   # per wave-3 line, then leased delete")
a("```")
a("")
a("Branches marked SUPERSEDED-BY a STILL-UNIQUE branch are in wave 2. Their tips are inside that branch, "
  "and also inside the archive ref once it exists.")
import re
text = "\n".join(L) + "\n"
text = re.sub(r"/(?:mnt|Users|home|opt|tmp|var|private)/[^\s)\]'\"`,;]+", "<path>", text)
text = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "<ip>", text)
open(os.path.join(docs, "CONSOLIDATION.md"), "w").write(text)
print("lines", len(L))
