"""Render R2 from a validated model cache; build is offline unless explicitly regenerating insights."""
import base64
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = {'a-trace':('a','Timeline, with a next move'), 'b-lanes':('b','Handoffs, without the noise'), 'c-stats':('c','Capacity, tied to outcomes'), 'd-pocket':('d','What needs you next')}

def main():
    data = (ROOT / 'data/trace-r2.json').read_bytes()
    cache = json.loads((ROOT / 'data/interpretations-r2.json').read_text())
    assert cache['source_sha256'] == hashlib.sha256(data).hexdigest(), 'Stale interpretation cache: regenerate with interpret_r2.py'
    cohort = json.loads(data)
    assert set(cache['insights']['runs']) == {r['id'] for r in cohort['runs']}
    css = (ROOT / 'src/r2.css').read_text()
    for key, file in {'__FONT_HANKEN_400__':'hanken-grotesk-latin-400-normal.woff2','__FONT_HANKEN_600__':'hanken-grotesk-latin-600-normal.woff2','__FONT_PLEX_400__':'ibm-plex-mono-latin-400-normal.woff2'}.items():
        css = css.replace(key,base64.b64encode((ROOT/'fonts'/file).read_bytes()).decode())
    template = (ROOT / 'src/r2.html').read_text()
    js = (ROOT / 'src/r2.js').read_text()
    for slug,(view,title) in PAGES.items():
        html = template.replace('/*__SHARED_CSS__*/',css).replace('/*__SHARED_JS__*/',js).replace('__VIEW__',view).replace('__TITLE__',title).replace('__R1__',slug+'-r1.html').replace('__TRACE_DATA__',data.decode().replace('</','<\\/')).replace('__INSIGHTS__',json.dumps(cache).replace('</','<\\/'))
        assert not any(k in html for k in ('__TRACE_DATA__','__INSIGHTS__','__FONT_'))
        (ROOT / 'out' / (slug+'.html')).write_text(html)
        print(slug+'.html',len(html),'bytes')
    index = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dash trace / round 2</title><style>'+css+'</style><body><main class="shell"><div class="intro"><div class="brand">dash / agent trace</div><h1>Four ways to work together.</h1><p>Round 2. Historical data, real cached model reads, and a local conversation attached to every interpretation.</p></div>'
    for slug,(_,title) in PAGES.items():
        index += f'<article class="run"><h2>{title}</h2><p><a class="button" style="display:inline-block;min-height:44px" href="{slug}.html">Open view</a> <a class="button" style="display:inline-block;min-height:44px" href="{slug}-r1.html">Round 1</a></p></article>'
    index += '<p class="muted">No live worker or phone controls. Feedback is local until an endpoint is configured.</p></main></body></html>'
    (ROOT/'out/index.html').write_text(index)

if __name__ == '__main__':
    main()
