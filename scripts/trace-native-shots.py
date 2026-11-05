#!/usr/bin/env python3
"""Headless touch run of the native Trace screen and Lab in an Expo web export.

    python3 scripts/trace-native-shots.py DIST_DIR OUT_DIR

Serves DIST_DIR (SPA fallback) on a free port and drives a private /usr/bin/chromium
at 412x915 with touch emulation. Scripts pinch, pan fling, long-press scrub, chip
swipes and row expand over CDP touch events, and saves numbered screenshots plus
results.json. It never attaches to an existing browser.
"""
import functools
import http.server
import json
import socket
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

DIST = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve()
OUT.mkdir(parents=True, exist_ok=True)


class SPA(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_head(self):
        path = Path(self.translate_path(self.path))
        if not path.exists():
            self.path = '/index.html'
        return super().send_head()


def serve():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(SPA, directory=str(DIST)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f'http://127.0.0.1:{port}'


results = {'steps': [], 'console_errors': []}
n = [0]


def shot(page, name):
    n[0] += 1
    p = OUT / f'{n[0]:02d}-{name}.png'
    page.screenshot(path=str(p))
    results['steps'].append({'shot': p.name})
    return p


def note(**kw):
    results['steps'].append(kw)
    print(json.dumps(kw))


def touch(cdp, kind, pts):
    cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})


def drag(cdp, a, b, steps=12, dt=0.016, hold=0.0, end=True):
    touch(cdp, 'touchStart', [a])
    if hold:
        time.sleep(hold)
    for k in range(1, steps + 1):
        f = k / steps
        touch(cdp, 'touchMove', [(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)])
        time.sleep(dt)
    if end:
        touch(cdp, 'touchEnd', [])


def box(page, testid):
    el = page.locator(f'[data-testid="{testid}"]').first
    el.scroll_into_view_if_needed()
    return el.bounding_box()


def content_tx(page):
    # translateX of the first animated content layer in the main timeline plot
    return page.evaluate("""() => {
      const plot = document.querySelector('[data-testid="trace-timeline-plot"]');
      const layer = plot && plot.firstElementChild;
      if (!layer) return null;
      const st = getComputedStyle(layer);
      const m = new DOMMatrixReadOnly(st.transform === 'none' ? undefined : st.transform);
      return { tx: m.m41, width: layer.getBoundingClientRect().width };
    }""")


def main():
    base = serve()
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
        ctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and results['console_errors'].append(m.text[:300]))
        page.on('pageerror', lambda e: results['console_errors'].append(f'pageerror: {e}'[:300]))
        cdp = ctx.new_cdp_session(page)

        page.goto(f'{base}/trace', wait_until='networkidle')
        page.wait_for_selector('[data-testid="trace-timeline-plot"]', timeout=30000)
        time.sleep(0.25)
        shot(page, 'trace-read-strip-entering')
        time.sleep(1.2)
        shot(page, 'trace-top')

        # --- chip swipes ---
        b = box(page, 'chip-a-resume')
        y = b['y'] + b['height'] / 2
        drag(cdp, (b['x'] + 40, y), (b['x'] + b['width'] * 0.55, y), steps=10, end=False)
        time.sleep(0.05)
        shot(page, 'chip-swipe-right-mid')
        touch(cdp, 'touchEnd', [])
        time.sleep(0.8)
        shot(page, 'chip-do-committed')
        b = box(page, 'chip-a-triage')
        y = b['y'] + b['height'] / 2
        drag(cdp, (b['x'] + b['width'] - 40, y), (b['x'] + b['width'] * 0.3, y), steps=10, end=False)
        shot(page, 'chip-swipe-left-mid')
        touch(cdp, 'touchEnd', [])
        time.sleep(0.8)
        shot(page, 'chip-not-now-committed')
        b = box(page, 'chip-a-ring')
        y = b['y'] + b['height'] / 2
        drag(cdp, (b['x'] + 40, y), (b['x'] + 90, y), steps=6)
        time.sleep(0.6)
        stored = page.evaluate("() => localStorage.getItem('dash.trace.feedback/v1')")
        note(step='chip decisions stored', stored=json.loads(stored) if stored else None)

        # --- timeline: pan fling with momentum ---
        page.locator('[data-testid="trace-timeline"]').first.scroll_into_view_if_needed()
        page.evaluate("() => document.querySelector('[data-testid=\"trace-scroll\"]').scrollBy(0, 200)")
        time.sleep(0.3)
        pb = page.locator('[data-testid="trace-timeline-plot"]').first.bounding_box()
        cx, cy = pb['x'] + pb['width'] / 2, min(pb['y'] + 260, 700)
        shot(page, 'timeline-open-at-now')
        t_open = content_tx(page)
        drag(cdp, (cx + 80, cy), (cx - 80, cy), steps=5, dt=0.012)  # fast flick toward later time: hits the end, rubber bands
        time.sleep(0.05); t_a = content_tx(page)
        time.sleep(0.6); t_b = content_tx(page)
        note(step='flick at right end (rubber band + spring back)', open=t_open, during=t_a, settled=t_b)
        drag(cdp, (cx - 100, cy), (cx + 100, cy), steps=5, dt=0.012)  # flick back in time
        samples = []
        for _ in range(8):
            samples.append(content_tx(page)['tx'])
            time.sleep(0.08)
        note(step='flick back: momentum samples (tx keeps moving after release)', tx=samples)
        shot(page, 'timeline-after-fling')

        # --- pinch out (zoom in) around center, then pinch in past 1x ---
        z0 = content_tx(page)
        a1, a2 = (cx - 30, cy), (cx + 30, cy)
        touch(cdp, 'touchStart', [a1, a2])
        for k in range(1, 13):
            d = 30 + k * 8
            touch(cdp, 'touchMove', [(cx - d, cy), (cx + d, cy)])
            time.sleep(0.016)
        shot(page, 'pinch-out-mid')
        touch(cdp, 'touchEnd', [])
        time.sleep(0.6)
        z1 = content_tx(page)
        shot(page, 'pinch-out-settled')
        touch(cdp, 'touchStart', [(cx - 140, cy), (cx + 140, cy)])
        for k in range(1, 15):
            d = 140 - k * 9.5
            touch(cdp, 'touchMove', [(cx - d, cy), (cx + d, cy)])
            time.sleep(0.016)
        time.sleep(0.02)
        z2a = content_tx(page)
        touch(cdp, 'touchEnd', [])
        time.sleep(0.15); z2b = content_tx(page)
        time.sleep(0.6); z2c = content_tx(page)
        shot(page, 'pinch-in-settled')
        note(step='pinch', before=z0, after_out=z1, pinch_in_released=z2a, spring_150ms=z2b, settled=z2c, plot_w=pb['width'])

        # back to a readable zoom via the 3h control
        page.locator('[aria-label="Zoom 3h"]').first.click()
        time.sleep(0.7)

        # --- long-press scrub ---
        page.locator('[data-testid="row-NOOP · ring tap"]').first.scroll_into_view_if_needed()
        time.sleep(0.3)
        pb = page.locator('[data-testid="trace-timeline-plot"]').first.bounding_box()
        rb0 = page.locator('[data-testid="row-NOOP · ring tap"]').first.bounding_box()
        cy = rb0['y'] + rb0['height'] / 2
        sx = pb['x'] + pb['width'] * 0.3
        touch(cdp, 'touchStart', [(sx, cy)])
        time.sleep(0.5)
        held = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=\"scrub-playhead\"]')).opacity")
        note(step='scrub playhead opacity after 500 ms hold', opacity=held)
        reads = []
        for k in range(1, 9):
            touch(cdp, 'touchMove', [(sx + k * 18, cy)])
            time.sleep(0.05)
            txt = page.evaluate("() => (document.querySelector('[data-testid=\"scrub-float\"]')||{}).innerText || null")
            reads.append(txt)
            if k == 5:
                shot(page, 'scrub-mid')
        touch(cdp, 'touchEnd', [])
        time.sleep(0.4)
        gone = page.evaluate("() => !!document.querySelector('[data-testid=\"scrub-float\"]')")
        note(step='scrub readouts while dragging', reads=reads, float_visible_after_release=gone)

        # --- tap row -> expand ---
        rb = box(page, 'row-NOOP · ring tap')
        page.touchscreen.tap(rb['x'] + rb['width'] / 2, rb['y'] + rb['height'] / 2)
        t_tap = time.time()
        for ms in (40, 120, 260, 700):
            time.sleep(max(0, t_tap + ms / 1000 - time.time()))
            shot(page, f'expand-{ms}ms')
        ok = page.evaluate("() => !!document.querySelector('[data-testid=\"trace-detail\"]')")
        note(step='detail open', open=ok)
        page.locator('[aria-label="Close"]').first.click()
        time.sleep(0.7)
        note(step='detail closed', open=page.evaluate("() => !!document.querySelector('[data-testid=\"trace-detail\"]')"))

        # --- live pulse animates (normal motion) ---
        pulse = page.locator('[data-testid="live-pulse"]').first
        pulse.scroll_into_view_if_needed()
        o1 = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=\"live-pulse\"]').lastElementChild).opacity")
        time.sleep(0.37)
        o2 = page.evaluate("() => getComputedStyle(document.querySelector('[data-testid=\"live-pulse\"]').lastElementChild).opacity")
        note(step='live pulse normal', opacity=[o1, o2])

        # --- lab ---
        page.goto(f'{base}/lab', wait_until='networkidle')
        page.wait_for_selector('[data-testid="lab-timeline"]', timeout=30000)
        time.sleep(1.0)
        shot(page, 'lab-top')
        for sec in ('lab-lane-row', 'lab-read-strip', 'lab-action-chip', 'lab-stat-tile', 'lab-orb-states'):
            page.locator(f'[data-testid="{sec}"]').first.scroll_into_view_if_needed()
            time.sleep(0.9)
            shot(page, sec)
        page.locator('[aria-label="Pick shimmer"]').first.click()
        page.locator('[aria-label="Pick card"]').first.click()
        time.sleep(0.4)
        page.locator('[data-testid="lab-picks"]').first.scroll_into_view_if_needed()
        shot(page, 'lab-picks')
        note(step='lab picks', text=page.locator('[data-testid="lab-picks"]').first.inner_text())

        # --- reduced motion ---
        rctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, has_touch=True, is_mobile=True, reduced_motion='reduce')
        rp = rctx.new_page()
        rp.on('pageerror', lambda e: results['console_errors'].append(f'reduced pageerror: {e}'[:300]))
        rp.goto(f'{base}/trace', wait_until='networkidle')
        rp.wait_for_selector('[data-testid="live-pulse"]', timeout=30000)
        time.sleep(0.2)
        r1 = rp.evaluate("() => getComputedStyle(document.querySelector('[data-testid=\"live-pulse\"]').lastElementChild).opacity")
        time.sleep(0.37)
        r2 = rp.evaluate("() => getComputedStyle(document.querySelector('[data-testid=\"live-pulse\"]').lastElementChild).opacity")
        n[0] += 1
        rp.screenshot(path=str(OUT / f'{n[0]:02d}-reduced-motion-top.png'))
        note(step='live pulse reduced motion', opacity=[r1, r2])
        browser.close()
    (OUT / 'results.json').write_text(json.dumps(results, indent=1))
    print('console errors:', len(results['console_errors']))


if __name__ == '__main__':
    main()
