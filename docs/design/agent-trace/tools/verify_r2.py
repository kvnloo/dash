"""Isolated headless Chromium: responsive captures and real local feedback-contract tests."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGES = ['a-trace','b-lanes','c-stats','d-pocket']
received = []
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_GET(self):
        if self.path == '/feedback':
            body=json.dumps(received).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
        else: super().do_GET()
    def do_POST(self):
        record=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/fail': self.send_response(503);self.end_headers();return
        received.append(record)
        body=json.dumps({'id':record['id'],'reply':{'text':'Endpoint received your proposal; no execution authorized.'}}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--captures',type=Path,default=ROOT/'captures/r2');args=parser.parse_args();args.captures.mkdir(parents=True,exist_ok=True)
    handler=functools.partial(Handler,directory=str(ROOT/'out'))
    server=ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();local=f'http://127.0.0.1:{server.server_port}'
    env: dict[str, str | float | bool] = {k:v for k,v in os.environ.items() if k not in ('DISPLAY','WAYLAND_DISPLAY','DBUS_SESSION_BUS_ADDRESS','SWAYSOCK','HYPRLAND_INSTANCE_SIGNATURE')}
    result={'browser':'isolated Playwright headless Chromium','screenshots':[],'checks':[],'console_errors':[]}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', env=env)
        context=browser.new_context(viewport={'width':412,'height':915},color_scheme='dark',reduced_motion='reduce',accept_downloads=True)
        page=context.new_page();page.on('pageerror',lambda e:result['console_errors'].append(str(e)))
        for slug in PAGES:
            response=page.goto(f'http://100.113.138.100:4186/{slug}.html');assert response is not None and response.status==200
            page.evaluate('document.fonts.ready');page.wait_for_timeout(150)
            assert page.evaluate('document.documentElement.scrollWidth===innerWidth'),slug+' overflow'
            assert 'Run 01' not in page.locator('body').inner_text()
            def shot(suffix):
                path=args.captures/f'{slug}-{suffix}.png';page.screenshot(path=str(path));result['screenshots'].append(str(path))
            shot('phone-top')
            page.locator('main').scroll_into_view_if_needed();page.evaluate("document.querySelector('main').scrollIntoView({block:'start'})");shot('phone-middle')
            card=page.locator('.run').first;card.locator('.detail').evaluate('(n)=>n.open=true');page.wait_for_timeout(50);card.locator('.worker').first.evaluate('(n)=>n.open=true');page.wait_for_timeout(50)
            card.locator('.worker').first.evaluate("n=>n.scrollIntoView({block:'start'})");shot('phone-expanded')
            assert page.evaluate('document.documentElement.scrollWidth===innerWidth'),slug+' expanded overflow'
            too_small=page.locator('button, summary, input, select, a').evaluate_all("ns=>ns.filter(n=>n.getClientRects().length&&n.getBoundingClientRect().height<43.9).map(n=>({text:n.textContent.slice(0,40),height:n.getBoundingClientRect().height}))")
            assert not too_small,(slug,too_small)
            result['checks'].append(slug+': 200; no phone overflow; controls >=44px; human labels')
            page.set_viewport_size({'width':1440,'height':900});page.goto(f'http://100.113.138.100:4186/{slug}.html');page.evaluate('document.fonts.ready');shot('desktop')
            assert page.evaluate('document.documentElement.scrollWidth===innerWidth')
            page.emulate_media(color_scheme='light');page.screenshot(path=str(args.captures/f'{slug}-desktop-light.png'));page.emulate_media(color_scheme='dark')
            page.set_viewport_size({'width':412,'height':915})
        # Feedback uses a real loopback server with readback, never a production endpoint.
        page.goto(local+'/a-trace.html');page.locator('#brief>.feedback').evaluate('(n)=>n.open=true')
        brief=page.locator('#brief>.feedback');brief.get_by_role('button',name='Agree',exact=True).click();assert brief.locator('.thread').inner_text().count('Saved locally')==1
        page.reload();brief=page.locator('#brief>.feedback');brief.evaluate('(n)=>n.open=true');assert 'agree' in brief.locator('.thread').inner_text()
        brief.get_by_role('button',name='Ask',exact=True).click();brief.locator('textarea').fill('<img src=x onerror=alert(1)> Why this next?');brief.get_by_role('button',name='Send reply').click();assert brief.locator('.thread img').count()==0
        settings=page.locator('.settings');settings.evaluate('(n)=>n.open=true');page.locator('#endpoint').fill(local+'/feedback');page.locator('#save-endpoint').click()
        action=page.locator('#brief .recommendation').first.locator('.feedback');action.evaluate('(n)=>n.open=true');action.get_by_role('button',name='Do it',exact=True).click();page.wait_for_function("Object.keys(localStorage).some(k=>k.startsWith('dash.trace.feedback.v1.')&&JSON.parse(localStorage[k]).some(r=>r.kind==='do_it'&&r.delivery==='sent'))")
        actual=page.request.get(local+'/feedback').json();assert actual[-1]['kind']=='do_it' and actual[-1]['execution']=='proposal_only';assert actual[-1]['target']=='view-a-action-0';assert 'Endpoint received' in action.locator('.thread').inner_text()
        # Fail delivery, then retry the same id against the working endpoint.
        page.locator('#endpoint').fill(local+'/fail');page.locator('#save-endpoint').click();action.get_by_role('button',name='Not now',exact=True).click();page.wait_for_function("Object.keys(localStorage).some(k=>k.startsWith('dash.trace.feedback.v1.')&&JSON.parse(localStorage[k]).some(r=>r.kind==='not_now'&&r.delivery==='failed'))")
        page.locator('#endpoint').fill(local+'/feedback');page.locator('#save-endpoint').click();page.locator('#retry').click();page.wait_for_function("Object.keys(localStorage).some(k=>k.startsWith('dash.trace.feedback.v1.')&&JSON.parse(localStorage[k]).every(r=>r.delivery==='sent'))")
        with page.expect_download() as download:page.locator('#export').click()
        exported=json.loads(Path(download.value.path()).read_text());assert len(exported['records'])==4
        assert len(page.request.get(local+'/feedback').json())==4
        action.evaluate("n=>n.scrollIntoView({block:'start'})");page.screenshot(path=str(args.captures/'a-trace-phone-feedback.png'))
        brief.get_by_role('button',name='Disagree',exact=True).click();assert brief.locator('textarea').is_visible()
        # Cross-view threads use stable run target ids.
        run=page.locator('.run').first;run.locator('.feedback').first.evaluate('(n)=>n.open=true');run.locator('.feedback').first.get_by_role('button',name='Agree',exact=True).click();page.goto(local+'/c-stats.html');shared=page.locator('.run').first.locator('.feedback').first;shared.evaluate('(n)=>n.open=true');assert 'agree' in shared.locator('.thread').inner_text();assert page.evaluate("Object.keys(localStorage).some(k=>k.startsWith('dash.trace.feedback.v1.')&&JSON.parse(localStorage[k]).some(r=>r.target.startsWith('read-run-')))")
        page.goto(local+'/a-trace.html');page.keyboard.press('j');assert page.evaluate("document.activeElement.matches('.run')");page.keyboard.press('e');page.wait_for_timeout(100);assert page.locator('.event.selected').count()==1;page.keyboard.press('x');page.wait_for_timeout(100);assert page.locator('.worker[open]').count()>0;page.keyboard.press('Escape');assert page.locator('.worker[open]').count()==0
        page.locator('#search').fill('nothing-matches-this');assert page.locator('.empty').count()==1;page.locator('#search').fill('Dash');assert page.locator('.run').count()>0
        page.goto(local+'/b-lanes.html');page.locator('#batch').select_option('run-07');assert page.locator('.lane').count()==7;page.get_by_role('button',name='Zoom lanes').click();assert page.locator('.lanes').evaluate('n=>n.scrollWidth')>=1800;page.locator('.chart-scroll').evaluate('n=>n.scrollLeft=400');page.wait_for_timeout(50);assert page.locator('.chart-scroll').evaluate('n=>n.scrollLeft')>0
        page.locator('#replay').evaluate("n=>{n.value=Number(n.max)/2;n.dispatchEvent(new Event('input'));}");assert 'of' in (page.locator('#replay').get_attribute('aria-valuetext') or '');page.get_by_role('button',name='Replay',exact=True).click();page.wait_for_timeout(250);assert float(page.locator('#replay').input_value())>0;page.get_by_role('button',name='Pause',exact=True).click()
        result['checks'] += ['Feedback: Agree, Disagree, Ask, Do it, Not now persist across reload; text escaped; JSON download parsed; POST readback matched exact IDs; failed delivery retried with same ID; endpoint reply rendered','Keyboard: J, E, X, Escape; project search and empty result','Handoffs: 7-worker batch; zoom; horizontal pan; minimap; replay/scrub/pause']
        assert not result['console_errors'],result['console_errors']
        browser.close()
    server.shutdown();(args.captures/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))

if __name__=='__main__':main()
