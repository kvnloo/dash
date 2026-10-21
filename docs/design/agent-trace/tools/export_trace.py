#!/usr/bin/env python3
"""Export a public-safe trace dataset for the Dash agent-trace prototypes.

Reads (read-only):
  - Hermes delegation live logs  ~/.hermes/profiles/clean/cache/delegation/live/*/{manifest.json,task-*.log}
  - Hermes state.db (sessions: tokens/cost per subagent; messages: owner-turn timestamps only)
  - a read-only COPY of omp stats.db (per-model/tool aggregates)
  - burn-pace --json (lane quota pace)

Writes JSON with NO goal text, prompts, summaries, args or outputs. Labels are synthetic
(domain tag + letter); phases, stalls and needs-owner categories are keyword heuristics run
locally over private text whose words never leave this script.
"""
import collections, datetime as dt, glob, json, os, re, sqlite3, subprocess, sys

LIVE = os.path.expanduser("~/.hermes/profiles/clean/cache/delegation/live")
STATE = os.path.expanduser("~/.hermes/profiles/clean/state.db")
OMP = sys.argv[2] if len(sys.argv) > 2 else None
OUT = sys.argv[1]
DAY0 = dt.datetime(2026, 10, 20, 0, 0)
DAY1 = dt.datetime(2026, 10, 21, 6, 0)

DOMAINS = [
    ("video", r"fframe|video|film|comfy|render|cinetic"),
    ("health", r"noop|oura|hrv|health|breath|medit|sleep"),
    ("dash", r"\bdash\b|z0bridge|approval"),
    ("phone", r"phone|s25|s22|android|adb|lawnchair|omalauncher|apk"),
    ("proofs", r"\bbend\b|fsm|lean|statechart|laws?\b"),
    ("sim", r"\bace\b|badminton|pickleball|engine|physics"),
    ("research", r"research|survey|adaptive|study|benchmark|speed"),
    ("harness", r"hermes|tern|omp|harness|\bpi\b|acp"),
    ("infra", r"company os|k3s|fleet|mbp|build node|integration debt|oss factory|promot"),
    ("garden", r"garden"),
]
VERIFY = re.compile(r"\b(test|pytest|vitest|playwright|screenshot|proof\.py|verify|lint|typecheck|tsc|fleet-build|fleet run|smoke|qualif|bend .*--verdict|curl)\b", re.I)
PR = re.compile(r"gh pr (create|ready|edit)|git push", re.I)
IMPL = re.compile(r"git commit|apply_patch|sed -i", re.I)
NEEDS = [
    ("device", r"blocked by adb|on your s25|on the phone|handset|device check|put it on your|install"),
    ("review-pr", r"draft pr|pr #\d+|pull request"),
    ("approve", r"approv|merge|publish|post(ing)? anything"),
    ("credential", r"login|credential|2fa|oauth|sign in"),
    ("verify", r"not (been )?(checked|verified)|hasn't been|unverified|remains failing|still fail"),
    ("blocked", r"\bblocked\b"),
]


def domain(goal):
    g = goal.lower()
    for name, rx in DOMAINS:
        if re.search(rx, g):
            return name
    return "misc"


def ts(day, hms):
    h, m, s = map(int, hms.split(":"))
    return day.replace(hour=h, minute=m, second=s)


def parse_task(path, started):
    events, lines = [], open(path, errors="replace").read().splitlines()
    day = started.replace(hour=0, minute=0, second=0)
    last = started
    pending = collections.defaultdict(list)
    final = None
    goal = ""
    for line in lines:
        if line.startswith("goal: "):
            goal = line[6:]
        m = re.match(r"^(\d\d:\d\d:\d\d) (\w+)\s*\| ?(.*)", line)
        if not m:
            continue
        t = ts(day, m.group(1))
        if t < last - dt.timedelta(hours=12):  # crossed midnight
            day += dt.timedelta(days=1)
            t = ts(day, m.group(1))
        last = t
        kind, body = m.group(2), m.group(3)
        if kind == "tool":
            mm = re.match(r"-> ([\w.:-]+)\((.*)", body)
            if mm:
                name, args = mm.group(1), mm.group(2)
                if name in ("write_file", "patch") or IMPL.search(args):
                    ph = "implement"
                elif PR.search(args):
                    ph = "pr"
                elif VERIFY.search(args) or name in ("vision_analyze",) or name.startswith("browser") or name == "mcp__browser_exec":
                    ph = "verify"
                elif name in ("delegate_task",):
                    ph = "delegate"
                else:
                    ph = "explore"
                ev = {"t": t, "tool": name, "phase": ph, "dur": None, "ok": None}
                events.append(ev)
                pending[name].append(ev)
        elif kind == "result":
            mm = re.match(r"([\w.:-]+) (ok|ERROR) ([\d.]+)s", body)
            if mm and pending.get(mm.group(1)):
                ev = pending[mm.group(1)].pop(0)
                ev["dur"] = float(mm.group(3))
                ev["ok"] = mm.group(2) == "ok"
        elif kind in ("think", "assistant"):
            events.append({"t": t, "tool": None, "phase": "think", "dur": 0, "ok": True})
        elif kind == "final":
            mm = re.match(r"(?:end )?status=(\w+)(?: duration=([\d.]+)s)?(?: exit_reason=\w+)?(?: summary: (.*))?", body)
            if mm and (final is None or body.startswith("status=")):
                final = {"t": t, "status": mm.group(1), "duration": float(mm.group(2)) if mm.group(2) else None, "summary": mm.group(3) or (final or {}).get("summary", "")}
    return goal, events, final, last


def bands(events, t0, t_end, bucket=180):
    """Majority phase per bucket (verify/pr outrank explore), merged into bands."""
    if not events:
        return []
    rank = {"pr": 4, "verify": 3, "implement": 2, "delegate": 2, "explore": 1, "think": 0}
    n = int((t_end - t0).total_seconds() // bucket) + 1
    out = []
    for i in range(n):
        a = t0 + dt.timedelta(seconds=i * bucket)
        b = a + dt.timedelta(seconds=bucket)
        c = collections.Counter(e["phase"] for e in events if a <= e["t"] < b and e["phase"] != "think")
        if not c:
            ph = None
        else:
            ph = max(c, key=lambda k: (c[k] * (1 + rank[k] * 0.35)))
        out.append(ph)
    merged = []
    for i, ph in enumerate(out):
        s = i * bucket
        if merged and merged[-1]["phase"] == ph:
            merged[-1]["e"] = s + bucket
        else:
            merged.append({"phase": ph, "s": s, "e": s + bucket})
    total = (t_end - t0).total_seconds()
    for m in merged:
        m["e"] = min(m["e"], total)
    return [m for m in merged if m["phase"] and m["e"] > m["s"]]


def main():
    st = sqlite3.connect(f"file:{STATE}?mode=ro", uri=True)
    sess = st.execute("select id, parent_session_id, started_at, ended_at, end_reason, tool_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, estimated_cost_usd, title from sessions where source='subagent' and started_at between ? and ?",
                      (DAY0.timestamp(), DAY1.timestamp())).fetchall()
    used_sess = set()
    parents = {}
    runs = []
    tasks = []
    letters = "ABCDEFGHIJKLMNOP"
    mans = []
    for d in sorted(glob.glob(f"{LIVE}/deleg_*/manifest.json")):
        m = json.load(open(d))
        started = dt.datetime.strptime(m["started"], "%Y-%m-%d %H:%M:%S")
        if not (DAY0 <= started < DAY1):
            continue
        mans.append((started, os.path.dirname(d), m))
    mans.sort()
    deleg = {r[0]: r for r in st.execute("select delegation_id, parent_session_id, state, dispatched_at, completed_at from async_delegations").fetchall()}
    for ri, (started, ddir, m) in enumerate(mans):
        did = m["delegation_id"]
        parent = deleg.get(did, (None, None))[1] or "unknown"
        pid = parents.setdefault(parent, f"orch-{len(parents) + 1}")
        run = {"id": f"run-{ri + 1:02d}", "orchestrator": pid, "dispatched": started.isoformat(), "tasks": [], "model": m.get("model")}
        for t in m["tasks"]:
            lp = os.path.join(ddir, f"task-{t['index']}.log")
            if not os.path.exists(lp):
                continue
            goal, events, final, last = parse_task(lp, started)
            if not goal:
                goal = t.get("goal", "")
            dom = domain(goal)
            status = (final or {}).get("status") or t.get("status") or "unknown"
            if status == "running" and (final is None):
                status = "running" if (dt.datetime(2026, 10, 21, 0, 25) - last).total_seconds() < 1800 else "interrupted"
            if t.get("status") == "interrupted":
                status = "interrupted"
            end = final["t"] if final else last
            # session match: subagent session starting within 3 s whose title starts with the goal prefix
            match = None
            for s in sess:
                if s[0] in used_sess:
                    continue
                if abs(s[2] - started.timestamp()) < 120 and (s[11] or "").replace("Subagent: ", "")[:24].lower() == goal[:24].lower():
                    match = s
                    break
            if match:
                used_sess.add(match[0])
            tok = {"input": match[6], "output": match[7], "cache_read": match[8], "cache_write": match[9]} if match else None
            cost = round(match[10], 2) if match and match[10] else None  # 0 with tokens = not priced, not free
            # stalls: gaps > 150 s between consecutive events while running
            evs = sorted(events, key=lambda e: e["t"])
            stalls = []
            prev = started
            for e in evs + [{"t": end, "dur": 0}]:
                gap = (e["t"] - prev).total_seconds()
                if gap > 150:
                    stalls.append({"s": round((prev - started).total_seconds()), "e": round((e["t"] - started).total_seconds())})
                # a long-running tool call is work, not a stall: measure gaps from when it returned
                prev = max(prev, e["t"] + dt.timedelta(seconds=e.get("dur") or 0))
            summary = (final or {}).get("summary", "").lower()
            needs = sorted({k for k, rx in NEEDS if re.search(rx, summary)})
            tid = f"{run['id']}-{letters[t['index']]}"
            tool_events = [
                {"t": round((e["t"] - started).total_seconds()), "tool": e["tool"], "phase": e["phase"], "dur": e["dur"], "ok": e["ok"]}
                for e in evs if e["tool"]
            ]
            think = [round((e["t"] - started).total_seconds(), 1) for e in evs if not e["tool"]]
            task = {
                "id": tid, "run": run["id"], "label": f"{dom} {letters[t['index']].lower()}", "domain": dom,
                "role": ("opus" if "opus" in (m.get("model") or "") else "sol" if "sol" in (m.get("model") or "") else (m.get("model") or "unknown")), "model": m.get("model"), "status": status,
                "start": started.isoformat(), "end": end.isoformat(), "dur_s": round((end - started).total_seconds()),
                "resume_of": None, "is_resume": goal.lower().startswith("resume"),
                "tokens": tok, "cost_usd": cost, "tool_calls": len(tool_events),
                "errors": sum(1 for e in tool_events if e["ok"] is False),
                "events": tool_events, "think": think, "stalls": stalls,
                "bands": bands(evs, started, end), "needs_owner": needs,
                "_goal": goal,
            }
            run["tasks"].append(tid)
            tasks.append(task)
        runs.append(run)
    # resume links: a resume task -> latest earlier interrupted task with the best word overlap
    words = lambda g: set(re.findall(r"[a-z0-9]{4,}", g.lower())) - {"resume", "continue", "from", "with", "that", "this", "your"}
    for t in tasks:
        if not t["is_resume"]:
            continue
        cands = [u for u in tasks if u["status"] == "interrupted" and u["start"] < t["start"]]
        if cands:
            best = max(cands, key=lambda u: (len(words(u["_goal"]) & words(t["_goal"])), u["start"]))
            if words(best["_goal"]) & words(t["_goal"]):
                t["resume_of"] = best["id"]
    tools_ix, phases = {}, ["explore", "implement", "verify", "pr", "delegate"]
    for t in tasks:
        del t["_goal"]
        t["events"] = [[e["t"], tools_ix.setdefault(e["tool"], len(tools_ix)), phases.index(e["phase"]), e["dur"], 1 if e["ok"] else (0 if e["ok"] is False else None)] for e in t["events"]]
        t["think"] = [round(x) for x in t["think"]]
    # owner turns in orchestrator sessions (timestamps + coarse class only)
    owner = []
    for parent, pid in parents.items():
        for role, content, tstamp in st.execute("select role, substr(content,1,200), timestamp from messages where session_id=? and role='user' and timestamp between ? and ?", (parent, DAY0.timestamp(), DAY1.timestamp())):
            c = (content or "").lower()
            kind = "delivery" if ("delegation" in c[:120] or c.startswith("[") or "subagent" in c[:120]) else "owner"
            owner.append({"orch": pid, "t": dt.datetime.fromtimestamp(tstamp).isoformat(), "kind": kind})
    # omp lane (read-only copy)
    omp = None
    if OMP:
        o = sqlite3.connect(f"file:{OMP}?mode=ro", uri=True)
        since = int((DAY1 - dt.timedelta(days=7)).timestamp() * 1000)
        models = [dict(zip(["model", "requests", "tokens", "cost", "errors", "avg_ms"], r)) for r in o.execute(
            "select model, count(*), sum(total_tokens), round(sum(cost_total),2), sum(case when stop_reason='error' then 1 else 0 end), round(avg(duration)) from messages where timestamp>? group by model order by 2 desc limit 8", (since,))]
        tools = [dict(zip(["tool", "calls", "errors"], r)) for r in o.execute(
            "select tool_name, count(*), sum(coalesce(is_error,0)) from tool_calls where timestamp>? group by tool_name order by 2 desc limit 15", (since,))]
        omp = {"window": "7d", "models": models, "tools": tools}
    try:
        bp = json.loads(subprocess.run(["burn-pace", "--json"], capture_output=True, text=True, timeout=60).stdout)
        lanes = {k: {kk: v[kk] for kk in ("weekly_used_pct", "hours_to_reset", "pace_ratio", "band", "sustainable_pct_per_h", "observed_pct_per_h")} for k, v in bp["lanes"].items()}
        lanes_at = bp["at"]
    except Exception as e:  # noqa
        lanes, lanes_at = None, None
    data = {
        "schema": "dash.agent-trace.proto/v0",
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "window": [DAY0.isoformat(), DAY1.isoformat()],
        "privacy": "counts, durations, tool names and synthetic labels only; no goals, prompts, args, outputs or summaries",
        "heuristics": {
            "phase": "per tool call from tool name + args keywords (explore/implement/verify/pr/delegate); bands = weighted majority per 3-minute bucket",
            "stall": "gap > 150 s between consecutive transcript events while the worker was alive",
            "needs_owner": "keyword classes over the worker's final summary (device, review-pr, approve, credential, verify, blocked)",
            "resume_of": "a task whose goal starts with Resume, linked to the latest earlier interrupted task sharing goal words",
            "status": "manifest/final line; a task with no final line and no event for 30 min is shown as interrupted",
        },
        "event_fields": ["t_s", "tool", "phase", "dur_s", "ok"], "tool_names": list(tools_ix), "phase_names": phases,
        "orchestrators": sorted(set(parents.values())), "runs": runs, "tasks": tasks, "owner_turns": owner,
        "omp": omp, "lanes": lanes, "lanes_at": lanes_at,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w"), separators=(",", ":"))
    c = collections.Counter(t["status"] for t in tasks)
    print(f"runs={len(runs)} tasks={len(tasks)} status={dict(c)} matched_sessions={len(used_sess)} owner_turns={len(owner)} resumes={sum(1 for t in tasks if t['resume_of'])} bytes={os.path.getsize(OUT)}")


main()
