#!/usr/bin/env python3
"""Turn branch-raw.json + open-prs.json into the committed consolidation lists.

Usage: classify.py <outdir-with-raw> <docs/consolidation dir> <staging-sha> <audit-utc>
Writes BRANCH-AUDIT.tsv, PR-AUDIT.tsv, STILL-UNIQUE.md, CONSOLIDATION.md, ARCHIVE-PARENTS.txt
and prints summary counts as JSON.
"""
import json, os, re, subprocess, sys
from collections import Counter, defaultdict

raw, docs, staging_sha, audit_utc, REPO = sys.argv[1:6]
BASE = "origin/staging"
BASE_TREE = subprocess.run(["git", "-C", REPO, "rev-parse", BASE + "^{tree}"], capture_output=True, text=True).stdout.strip()
rows = json.load(open(os.path.join(raw, "branch-raw.json")))
openprs = json.load(open(os.path.join(raw, "open-prs.json")))
by = {d["branch"]: d for d in rows}

REDACT = [
    (re.compile(r"(/(?:mnt|Users|home|opt|tmp|var|private)/[^\s)\]'\"`,;]+)"), "<path>"),
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"), "<ip>"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "<email>"),
]


def clean(s):
    for rx, rep in REDACT:
        s = rx.sub(rep, s)
    return s.replace("\t", " ").strip()


def protected(name):
    return (name in ("staging", "main", "master", "gh-pages", "z0/play-release")
            or name.startswith(("release/", "archive/")))


# ---- PR verdicts (manual evidence gathered during the audit; see REPORT) ----
PR_NOTES = {
    626: ("KEEP", "Kevin's title marks it '[draft, do not merge]'"),
    638: ("KEEP", "title marks it 'do not merge yet'; staging took a different host tree (#685, d54f065a)"),
    210: ("SUPERSEDED-BY 612582ac+d44713f8+a1c7db93",
          "#120 submenu feature is in staging (612582ac has the same subject as 2c35b61c; d44713f8, a1c7db93 wire it); "
          "only 3 Jest-mock test commits remain, and AGENTS.md no longer counts unit tests as the suite"),
    384: ("STILL-UNIQUE", "the ledger itself is in staging (c8416b40, same subject as a478f90b); "
          "4 follow-up commits from 11-15 (spec/preview fixes) are not"),
    612: ("STILL-UNIQUE", "linkify landed separately (#419, 4f9c4826) but this RC3 army coverage port + COV-G10 file preview are not in staging"),
    645: ("STILL-UNIQUE", "stacked on lane/compose-613-20261105; staging took desk mode via the #613 port (74893287, #751) but not these wheel fixes"),
    646: ("STILL-UNIQUE", "stacked on lane/compose-613-642-643-645-harness; close-race fix is not in staging"),
}
DEPENDABOT = {
    650: "staging uses actions/cache@v4 (3x); bump to v6 not applied",
    651: "staging uses ossf/scorecard-action@v2.4.2; bump to 2.5.0 not applied",
    652: "staging uses actions/labeler@v5; bump to v7 not applied",
    653: "staging uses actions/upload-artifact@v4 (4x); bump to v7 not applied",
    654: "staging uses actions/stale@v9; bump to v11 not applied",
}

pr_by_head = {p["head"]["ref"]: p for p in openprs}
open_bases = defaultdict(list)


def git_verdict(d):
    """Pure git verdict, ignoring PR/keep policy. Returns (verdict, evidence) or None."""
    if d["ancestor"]:
        return "MERGED-EQUIVALENT", "tip is an ancestor of staging"
    if d["cherry_plus"] == 0:
        what = (f"git cherry: all {d['cherry_minus']} patches already in staging ('-')" if d["cherry_minus"]
                else "only merge commits ahead; git cherry lists no unapplied patch")
        mt = subprocess.run(["git", "-C", REPO, "merge-tree", "--write-tree", "--no-messages", BASE, d["sha"]],
                            capture_output=True, text=True)
        tree = mt.stdout.split("\n")[0].strip()
        if mt.returncode == 0 and tree == BASE_TREE:
            return "MERGED-EQUIVALENT", what + "; merge-tree into staging is a no-op"
        ns = subprocess.run(["git", "-C", REPO, "diff", "--numstat", BASE, tree], capture_output=True, text=True).stdout
        ins = dels = 0
        for line in ns.splitlines():
            a, b, _ = line.split("\t", 2)
            ins += int(a) if a.isdigit() else 0
            dels += int(b) if b.isdigit() else 0
        if mt.returncode == 0 and dels == 0:
            return "MERGED-EQUIVALENT", what + f"; merging back would only re-add {ins} lines staging has since removed"
        if d["cherry_minus"]:  # every patch is in staging; staging has since rewritten that code
            return "MERGED-EQUIVALENT", what + ("; merging back now conflicts with later staging edits" if mt.returncode == 1
                                               else f"; merging back would revert later staging edits (+{ins}/-{dels})")
        return None
    if d["tree_noop"]:
        return "MERGED-EQUIVALENT", "merge-tree into staging leaves staging's tree unchanged"
    if not d["unique"] and d["superseded_by_subject"]:
        hits = sorted({x[2] for x in d["superseded_by_subject"]})
        return f"SUPERSEDED-BY {'+'.join(hits[:3])}", \
            f"all {len(d['superseded_by_subject'])} unapplied commits have a same-subject commit in staging"
    if d["unique"] and d.get("unique_adds", 1) == 0:
        return "MERGED-EQUIVALENT", f"each of {len(d['unique'])} unapplied commits replays onto staging with no change"
    if d.get("all_files_deleted"):
        c = d["deleted_by"][0].split(" ", 1)
        return f"SUPERSEDED-BY {c[0]}", f"every file it changes was deleted in staging ({clean(c[1])})"
    return None


for d in rows:
    d["verdict"], d["evidence"], d["wave"] = None, "", ""
    d["open_pr"] = pr_by_head.get(d["branch"], {}).get("number", "")
    gv = git_verdict(d)
    d["git_verdict"] = gv

# PR verdicts
pr_rows = []
for p in openprs:
    n, head = p["number"], p["head"]["ref"]
    d = by.get(head)
    gv = d["git_verdict"] if d else None
    if d and gv and gv[0] == "MERGED-EQUIVALENT":
        v, ev = gv[0], gv[1] + (" (GitHub draft flag set)" if p["draft"] else "")
    elif n in DEPENDABOT:
        v, ev = "STILL-UNIQUE", DEPENDABOT[n] + "; PR targets main, not staging"
    elif n in PR_NOTES:
        v, ev = PR_NOTES[n]
    elif gv:
        v, ev = gv
    else:
        v, ev = "STILL-UNIQUE", f"{d.get('unique_adds')} of {d['ahead']} commits not in staging"
    action = {"MERGED-EQUIVALENT": "close (wave 1)", "KEEP": "keep open"}.get(v, None)
    if action is None:
        action = "close (wave 2)" if v.startswith("SUPERSEDED-BY") else "Kevin decides"
    pr_rows.append(dict(pr=n, title=clean(p["title"]), draft=p["draft"], base=p["base"]["ref"], head=head,
                        sha=p["head"]["sha"][:12], date=d["date"][:10] if d else "", ahead=d["ahead"] if d else "",
                        behind=d["behind"] if d else "", verdict=v, evidence=ev, action=action))
    if not action.startswith("close"):
        open_bases[p["base"]["ref"]].append(n)
pr_final = {r["head"]: r for r in pr_rows}

# Branch verdicts, pass 1: policy + git
for d in rows:
    name = d["branch"]
    pr = pr_final.get(name)
    if protected(name):
        d["verdict"], d["evidence"] = "KEEP", "protected name (staging/main/release/archive)"
    elif pr and not pr["action"].startswith("close"):
        d["verdict"], d["evidence"] = "KEEP", f"head of open PR #{pr['pr']} ({pr['verdict']}; deleting it closes the PR)"
    elif name in open_bases:
        d["verdict"], d["evidence"] = "KEEP", "base of open PR " + ",".join(f"#{n}" for n in open_bases[name]) + " (deleting it closes the PR; retarget first)"
    elif pr:
        d["verdict"], d["evidence"] = pr["verdict"], f"head of PR #{pr['pr']}: {pr['evidence']}"
    elif d["git_verdict"]:
        d["verdict"], d["evidence"] = d["git_verdict"]

# pass 2: containment among remaining candidates
cand = [d for d in rows if d["verdict"] is None]
cand_names = {d["branch"] for d in cand}
kept_names = {d["branch"] for d in rows if d["verdict"] == "KEEP"}


def strict_containers(d):
    return [o for o in d.get("contained_in", []) if by[o]["sha"] != d["sha"] and (o in cand_names or o in kept_names)]


leaves = [d for d in cand if not strict_containers(d)]
# duplicate tips among leaves: one canonical per sha
by_sha = defaultdict(list)
for d in leaves:
    by_sha[d["sha"]].append(d)
canonical = {}
for sha, ds in by_sha.items():
    # if a KEEP branch has this exact tip, it is canonical
    keep_same = [k for k in kept_names if by[k]["sha"] == sha]
    if keep_same:
        canonical[sha] = sorted(keep_same)[0]
        continue
    ds.sort(key=lambda x: (x["branch"].startswith("reaped/"), x["branch"].startswith("wip/"), x["branch"]))
    canonical[sha] = ds[0]["branch"]
final_leaf = set()
for d in leaves:
    c = canonical[d["sha"]]
    if c == d["branch"]:
        d["verdict"] = "STILL-UNIQUE"
        d["evidence"] = (f"{d['unique_adds']} of {len(d['unique'])} unapplied commits change staging" if d["unique"]
                         else "patches applied, but its merge commits carry content staging lacks")
        final_leaf.add(d["branch"])
    else:
        d["verdict"] = f"SUPERSEDED-BY {c}"
        d["evidence"] = f"identical tip {d['sha'][:12]} is kept as {c}"
survivors = final_leaf | kept_names
for d in cand:
    if d["verdict"]:
        continue
    conts = [o for o in d["contained_in"] if o in survivors and o != d["branch"]]
    conts.sort(key=lambda o: (o not in kept_names, o.startswith("reaped/"), o))
    if not conts:  # all containers are themselves duplicates; map to their canonical
        conts = sorted({canonical.get(by[o]["sha"], o) for o in d["contained_in"]} & survivors)
    c = conts[0]
    d["verdict"] = f"SUPERSEDED-BY {c}"
    d["evidence"] = f"tip {d['sha'][:12]} is in the history of {c}, which stays (or is archived)"

# waves
for d in rows:
    v = d["verdict"]
    if v == "KEEP":
        d["wave"] = "keep"
    elif v == "MERGED-EQUIVALENT":
        d["wave"] = "1: delete now"
    elif v.startswith("SUPERSEDED-BY"):
        # container is staging, a KEEP ref, or a STILL-UNIQUE leaf that stays until it is archived
        d["wave"] = "2: delete now"
    elif v == "STILL-UNIQUE":
        d["wave"] = "3: Kevin decides (archive ref, then delete)"

# archive parents: every STILL-UNIQUE branch (non-KEEP) -- covers SUPERSEDED-BY <leaf> too
archive = sorted(d["branch"] for d in rows if d["verdict"] == "STILL-UNIQUE")
os.makedirs(docs, exist_ok=True)
with open(os.path.join(docs, "ARCHIVE-PARENTS.txt"), "w") as f:
    for b in archive:
        f.write(f"{by[b]['sha']} {b}\n")

# ---- write TSVs ----
with open(os.path.join(docs, "BRANCH-AUDIT.tsv"), "w") as f:
    f.write("branch\tsha\tlast_commit\tahead\tbehind\tverdict\tevidence\topen_pr\twave\n")
    for d in sorted(rows, key=lambda x: x["branch"]):
        f.write("\t".join(str(x) for x in [d["branch"], d["sha"][:12], d["date"][:10], d["ahead"], d["behind"],
                                           d["verdict"], clean(d["evidence"]), d["open_pr"], d["wave"]]) + "\n")
with open(os.path.join(docs, "PR-AUDIT.tsv"), "w") as f:
    cols = ["pr", "title", "draft", "base", "head", "sha", "date", "ahead", "behind", "verdict", "evidence", "action"]
    f.write("\t".join(cols) + "\n")
    for r in pr_rows:
        f.write("\t".join(clean(str(r[c])) for c in cols) + "\n")

# ---- STILL-UNIQUE.md: every unapplied commit, one line each ----
with open(os.path.join(docs, "STILL-UNIQUE.md"), "w") as f:
    f.write("# STILL-UNIQUE branches: commits not in staging\n\n")
    f.write(f"Against origin/staging {staging_sha[:12]} ({audit_utc}). One line per commit whose patch is not in staging.\n")
    f.write("State: `adds` = replays cleanly and changes staging; `conflict` = conflicts with staging; "
            "`present` = replays to no change. Shared commits repeat under each branch.\n")
    groups = [("Open PR heads kept or awaiting a decision", lambda d: d["verdict"] == "KEEP" and d["unique"]),
              ("STILL-UNIQUE branches", lambda d: d["verdict"] == "STILL-UNIQUE")]
    for title, pred in groups:
        f.write(f"\n## {title}\n")
        for d in sorted((x for x in rows if pred(x)), key=lambda x: x["branch"]):
            f.write(f"\n### {d['branch']} ({d['sha'][:12]}, {d['date'][:10]}, +{d['ahead']}/-{d['behind']})\n\n")
            for u in d["unique"]:
                f.write(f"- {u[0]} [{u[2] if len(u) > 2 else 'adds'}] {clean(u[1])}\n")

# ---- summary ----
bc = Counter(d["verdict"].split(" ")[0] for d in rows)
wc = Counter(d["wave"] for d in rows)
pc = Counter(r["verdict"].split(" ")[0] for r in pr_rows)
pa = Counter(r["action"] for r in pr_rows)
after12 = len(rows) - wc["1: delete now"] - wc["2: delete now"]
after_all = wc["keep"] + 1  # + one archive ref
summary = dict(branches=len(rows), branch_verdicts=bc, waves=wc, prs=len(pr_rows), pr_verdicts=pc, pr_actions=pa,
               after_wave12=after12, after_wave3=after_all, archive_parents=len(archive))
json.dump(summary, open(os.path.join(raw, "summary.json"), "w"), indent=1)
json.dump(dict(rows=rows, prs=pr_rows), open(os.path.join(raw, "classified.json"), "w"), indent=1)
print(json.dumps(summary, indent=1))
