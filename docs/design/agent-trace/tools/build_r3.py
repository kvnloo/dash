#!/usr/bin/env python3
"""Round 3 build: inline fonts, CSS, JS, the relabelled cohort and the cached read into one file per view.

    python3 -P tools/prepare_r3.py   # once: relabel + facts (reads delegation logs)
    python3 -P tools/build_r3.py     # offline: writes out/{index,a-trace,b-lanes,c-stats,d-pocket}.html
The cached interpretation's numeric `checks` are recomputed here; a mismatch fails the build.
"""
import base64
import collections
import datetime as dt
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = {"a-trace": ("a", "Trace"), "b-lanes": ("b", "Lanes"), "c-stats": ("c", "Stats"), "d-pocket": ("d", "Pocket")}
FONTS = {"__FONT_HANKEN_400__": "hanken-grotesk-latin-400-normal.woff2", "__FONT_HANKEN_600__": "hanken-grotesk-latin-600-normal.woff2",
         "__FONT_PLEX_400__": "ibm-plex-mono-latin-400-normal.woff2", "__FONT_PLEX_500__": "ibm-plex-mono-latin-500-normal.woff2"}


def recompute(d):
    p = dt.datetime.fromisoformat
    T = d["tasks"]
    inter = sorted((t for t in T if t["status"] == "interrupted"), key=lambda t: t["end"])
    cuts = []
    for t in inter:
        e = p(t["end"])
        if cuts and (e - cuts[-1][0]).total_seconds() <= 600:
            cuts[-1][0] = e; cuts[-1][1] += 1
        else:
            cuts.append([e, 1])
    cut_at = {c[0].strftime("%H:%M"): c[1] for c in cuts}
    now = p(d["generated"])
    recent = [t for t in T if t["status"] != "running" and p(t["end"]) >= now - dt.timedelta(hours=3) and t["needs_owner"]]
    ev_err = collections.Counter(d["tool_names"][e[1]] for t in T for e in t["events"] if e[4] == 0)
    lanes = d["lanes"]
    return {
        "a": {"interrupted": len(inter), "interrupt_instants": len(cuts), "cut_14_58": cut_at.get("14:58"), "cut_21_31": cut_at.get("21:31"),
              "resumed": sum(1 for t in T if t["resume_of"]), "phone_interrupted": sum(1 for t in inter if t["project"] == "Phone"),
              "phone_workers": sum(1 for t in T if t["project"] == "Phone")},
        "c": {"claude_used": lanes["claude"]["weekly_used_pct"], "claude_reset_h": lanes["claude"]["hours_to_reset"], "claude_pace": lanes["claude"]["pace_ratio"],
              "codex_used": lanes["codex"]["weekly_used_pct"], "codex_reset_h": lanes["codex"]["hours_to_reset"], "codex_pace": lanes["codex"]["pace_ratio"],
              "terminal_errors": ev_err["terminal"], "errors": sum(t["errors"] for t in T)},
        "d": {"recent_asks": len(recent), "noop_device": sum(1 for t in recent if t["project"] == "NOOP" and "device" in t["needs_owner"]),
              "pr_reviews": sum(1 for t in recent if "review-pr" in t["needs_owner"]), "live": sum(1 for t in T if t["status"] == "running")},
    }


def main():
    raw = (ROOT / "data/trace-r3.json").read_bytes()
    data = json.loads(raw)
    cache_text = (ROOT / "data/interpretations-r3.json").read_text()
    cache = json.loads(cache_text)
    got = recompute(data)
    for view, checks in ((v, cache["views"][v].get("checks", {})) for v in "acd"):
        for k, want in checks.items():
            assert got[view][k] == want, f"view {view}: {k} is {got[view][k]} in data, {want} in the read"
    cache["source_sha256"] = hashlib.sha256(raw).hexdigest()
    cache["interpretation_sha256"] = hashlib.sha256(cache_text.encode()).hexdigest()
    css = (ROOT / "src/r3.css").read_text()
    for key, f in FONTS.items():
        css = css.replace(key, base64.b64encode((ROOT / "fonts" / f).read_bytes()).decode())
    js = (ROOT / "src/r3.js").read_text()
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "nogit"
    js = js.replace("__BUILD__", f"round 3 · build {sha} · data {data['generated']}")
    tpl = (ROOT / "src/r3.html").read_text()
    for slug, (view, title) in PAGES.items():
        out = (tpl.replace("/*__CSS__*/", css).replace("/*__JS__*/", js).replace("__VIEW__", view).replace("__TITLE__", title)
               .replace("__TRACE_DATA__", raw.decode().replace("</", "<\\/")).replace("__INSIGHTS__", json.dumps(cache).replace("</", "<\\/")))
        assert "__" + "FONT_" not in out and "__TRACE_DATA__" not in out
        (ROOT / "out" / f"{slug}.html").write_text(out)
        print(f"{slug}.html {len(out) // 1024} KB")
    css_nofont = (ROOT / "src/r3.css").read_text().split("@font-face")[0]
    rows = "".join(
        f'<div class="brow" style="--bl:160px;--br:220px"><div class="bl"><a href="{s}.html" style="color:var(--ink)">{t}</a></div>'
        f'<div class="c-2" style="font-size:13px">{q}</div><div class="bv"><a href="{s}-r1.html" class="c-3">round 1</a> · <a href="{s}-r2.html" class="c-3">round 2</a></div></div>'
        for s, (v, t), q in zip(PAGES, PAGES.values(), ["What happened, and what is still open", "Who did what, and who never came back", "Is the system healthy, and is the burn on pace", "Do I need to do anything right now"]))
    index = (f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dash agent trace · round 3</title>'
             f'<style>{css}</style><body><main class="shell"><div class="crumb">dash / agent trace</div><h1>Four views, round 3</h1>'
             f'<p class="desc">Round 1 visuals with one neutral palette and three accents: <span class="c-you">needs you</span>, <span class="c-fail">failing or cut</span>, <span class="c-live">live</span>. '
             f'Rows are labelled by project and goal. Each view carries one short read and up to three actions you can answer.</p><div class="bars" style="margin-top:28px">{rows}</div>'
             f'<p class="foot">Frozen cohort {data["window"][0][:10]}, generated {data["generated"]}. Round 1 and round 2 are kept for comparison.</p></main></body></html>')
    (ROOT / "out/index.html").write_text(index)
    del css_nofont
    print("index.html")


if __name__ == "__main__":
    main()
