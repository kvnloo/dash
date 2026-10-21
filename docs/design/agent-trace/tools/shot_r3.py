#!/usr/bin/env python3
"""Round 3 captures in a private headless Chromium (never the owner's screens).

    python3 -P tools/shot_r3.py [page ...]   # writes captures/r3/*.png and captures/r3/verification.json
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "captures/r3"
PAGES = sys.argv[1:] or ["index", "a-trace", "b-lanes", "c-stats", "d-pocket"]
SIZES = {"phone": (412, 915), "desktop": (1440, 900)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--force-color-profile=srgb"])
        for name in PAGES:
            for tag, (w, h) in SIZES.items():
                ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if tag == "phone" else 1,
                                    is_mobile=tag == "phone", has_touch=tag == "phone", timezone_id="America/Chicago")
                pg = ctx.new_page()
                errs = []
                pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
                pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
                pg.goto((ROOT / "out" / f"{name}.html").as_uri())
                time.sleep(0.8)
                pg.screenshot(path=str(OUT / f"{name}-{tag}-top.png"))
                metrics = pg.evaluate("""() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                    sh: document.documentElement.scrollHeight,
                    rowH: Math.min(...[...document.querySelectorAll('.lab[data-id]')].map(e => e.getBoundingClientRect().height).concat([999])),
                    labW: (document.querySelector('.tl .labs')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width,
                    plotScroll: (document.querySelector('.tl .scroll')||{}).scrollWidth || 0})""")
                pg.mouse.wheel(0, h - 120) if tag == "desktop" else pg.evaluate(f"window.scrollBy(0, {h - 120})")
                time.sleep(0.4)
                pg.screenshot(path=str(OUT / f"{name}-{tag}-scroll.png"))
                report[f"{name}-{tag}"] = {"errors": errs, **metrics, "overflow_x": metrics["sw"] > metrics["cw"]}
                ctx.close()
        b.close()
    (OUT / "verification.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
