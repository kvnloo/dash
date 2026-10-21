#!/usr/bin/env python3
"""Inline fonts, shared CSS/JS and the public-safe trace export into self-contained HTML.

Each prototype must be a single file: artifact-stage frames it in a cross-site iframe where
sub-resources would not carry the review token.
    python3 build.py            # writes out/*.html
"""
import base64, hashlib, json, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT, FONTS = ROOT / "src", ROOT / "out", ROOT / "fonts"
DATA = ROOT / "data" / "trace-20261020.json"
FONT_KEYS = {
    "__FONT_HANKEN_400__": "hanken-grotesk-latin-400-normal.woff2",
    "__FONT_HANKEN_600__": "hanken-grotesk-latin-600-normal.woff2",
    "__FONT_PLEX_400__": "ibm-plex-mono-latin-400-normal.woff2",
    "__FONT_PLEX_500__": "ibm-plex-mono-latin-500-normal.woff2",
    "__FONT_CORMORANT_500__": "cormorant-garamond-latin-500-normal.woff2",
}
PAGES = ["index.html", "a-trace.html", "b-lanes.html", "c-stats.html", "d-pocket.html"]


def main():
    css = (SRC / "shared.css").read_text()
    for k, f in FONT_KEYS.items():
        css = css.replace(k, base64.b64encode((FONTS / f).read_bytes()).decode())
    js = (SRC / "shared.js").read_text()
    data = DATA.read_text()
    json.loads(data)
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or "nogit"
    except FileNotFoundError:
        sha = "nogit"
    gen = json.loads(data)["generated"]
    OUT.mkdir(exist_ok=True)
    for p in PAGES:
        if not (SRC / p).exists():
            continue
        src = (SRC / p).read_text()
        html = (src.replace("/*__SHARED_CSS__*/", css)
                .replace("/*__SHARED_JS__*/", js)
                .replace("__TRACE_DATA__", data.replace("</", "<\\/"))
                .replace("__BUILD__", f"build {sha} · data {gen}"))
        (OUT / p).write_text(html)
        print(f"{p}: {len(html) // 1024} KB sha256={hashlib.sha256(html.encode()).hexdigest()[:12]}")


main()
