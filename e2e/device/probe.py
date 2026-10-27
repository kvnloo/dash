#!/usr/bin/env python3
"""Small S22 Dash probe: optional taps/typing, then dump the Dash tree and a screenshot.

  uv run -q --with uiautomator2 python probe.py [--tap LABEL] [--type TEXT] [--back] [--wait S] [--shot NAME] [--out DIR]

Same behaviour as the original probe: holds /tmp/s22-ui.lock, matches LABEL exactly against text,
content-desc or resource-id first and then as a substring. The owner guard is checked first; the probe
refuses to touch the phone while the owner is busy.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from device import Device, OwnerBusy, ui_lock  # noqa: E402

argv = sys.argv[1:]


def arg(k, default=None):
    return argv[argv.index(k) + 1] if k in argv else default


def main() -> int:
    out = Path(arg("--out", str(Path(__file__).resolve().parent / "results")))
    out.mkdir(parents=True, exist_ok=True)
    with ui_lock():
        d = Device("physical", out).connect()
        try:
            d.guard()
        except OwnerBusy as e:
            print("owner guard:", e)
            return 3
        i = 0
        while i < len(argv):
            k = argv[i]
            if k == "--tap":
                lab = argv[i + 1]
                nodes = d.nodes()
                hit = next((n for n in nodes if lab in (n.get("text"), n.get("content-desc"), n.get("resource-id"))), None)
                hit = hit or next((n for n in nodes if lab in (n.get("text") or "") or lab in (n.get("content-desc") or "")), None)
                if hit is None:
                    print("NOT FOUND", lab)
                else:
                    d.tap(hit)
                    print("tapped", lab, hit["bounds"])
                time.sleep(1.0)
                i += 2
            elif k == "--type":
                d.type_text(argv[i + 1], clear=False)
                time.sleep(0.6)
                i += 2
            elif k == "--back":
                d.press("back")
                time.sleep(0.8)
                i += 1
            elif k == "--wait":
                time.sleep(float(argv[i + 1]))
                i += 2
            else:
                i += 1
        print(d.shot(arg("--shot", "probe")))
        for a in d.nodes():
            rid = a.get("resource-id") or ""
            if a.get("text") or a.get("content-desc") or (rid and "android:" not in rid):
                print(repr(a.get("text"))[:70], "|", (a.get("content-desc") or "")[:80], "|", rid.replace("app.dash.mobile:id/", ""),
                      (a.get("class") or "").split(".")[-1], a.get("bounds"), "F" if a.get("focused") == "true" else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
