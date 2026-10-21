"""Render a prototype in the isolated Sway Chromium (CDP :9333): console errors, overflow, screenshots.

usage: python3 -P shot.py OUT_DIR PAGE.html [phone|desktop|both] [js-actions...]
Each extra arg is a JS snippet run before an additional screenshot (named step1, step2...).
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

out, page_path = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
which = sys.argv[3] if len(sys.argv) > 3 else "both"
steps = sys.argv[4:]
os.makedirs(out, exist_ok=True)
name = os.path.splitext(os.path.basename(page_path))[0]
sizes = {"desktop": (1440, 900), "phone": (412, 915)}
report = {}
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
    ctx = b.contexts[0]
    for tag in (["desktop", "phone"] if which == "both" else [which]):
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        w, h = sizes[tag]
        pg.set_viewport_size({"width": w, "height": h})
        pg.evaluate("() => { try { localStorage.clear(); } catch {} }") if False else None
        pg.goto("file://" + page_path)
        pg.evaluate("() => { try { Object.keys(localStorage).filter(k => k.startsWith('dash-trace:')).forEach(k => localStorage.removeItem(k)); } catch {} }")
        pg.reload()
        time.sleep(1.2)
        pg.screenshot(path=f"{out}/{name}-{tag}.png")
        pg.screenshot(path=f"{out}/{name}-{tag}-full.png", full_page=True)
        sw = pg.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sh: document.documentElement.scrollHeight})")
        for i, js in enumerate(steps, 1):
            try:
                pg.evaluate(js)
            except Exception as e:  # noqa
                errs.append(f"step{i}: {e}")
            time.sleep(1.0)
            pg.screenshot(path=f"{out}/{name}-{tag}-step{i}.png")
        report[tag] = {"errors": errs, **sw}
        pg.close()
print(json.dumps(report, indent=1))
