#!/usr/bin/env node
// Actual Expo web components and navigation. Not Android/device acceptance.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out = path.resolve('.workspace-ui-receipts');
await mkdir(out, { recursive:true });
const port = 8197;
const errors = [];
const cases = [];
let log = '', browser;
const expo = spawn('bun', ['x','expo','start','--web','--port',String(port)], { cwd:path.resolve('app'), detached:true, env:{...process.env, CI:'1', EXPO_PUBLIC_DEBUG:'1', EXPO_PUBLIC_DEBUG_AUTONAV:'0'}, stdio:['ignore','pipe','pipe'] });
expo.stdout.on('data', d => log += d); expo.stderr.on('data', d => log += d);
try {
  let ready = false;
  for (let i=0;i<180;i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready=true;break; } } catch {}
    await new Promise(r=>setTimeout(r,1000));
  }
  assert(ready,'Metro becomes ready');
  browser = await chromium.launch({headless:true});
  for (const width of [390,412]) {
    const context = await browser.newContext({viewport:{width,height:915},deviceScaleFactor:1});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${width}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}/?debug=1`,{waitUntil:'networkidle',timeout:180000});
    await page.waitForFunction(()=>window.__DASH_DEBUG__?.ready,undefined,{timeout:120000});
    await page.evaluate(()=>window.__DASH_DEBUG__.scenario('orchestra-motion'));
    const visited=[];
    const tabs = await page.getByRole('tab').all();
    assert.equal(tabs.length,3,'all three primary panes remain accessible');
    for (let i=0;i<3;i++) {
      const tab = page.getByRole('tab').nth(i);
      const label = await tab.getAttribute('aria-label');
      await tab.click();
      await page.waitForFunction(index=>document.querySelectorAll('[role="tab"]')[index]?.getAttribute('aria-selected')==='true',i);
      await page.screenshot({path:path.join(out,`${width}-pane-${i}.png`)});
      visited.push(label);
    }
    const trace = page.getByTestId('trace-entry');
    await trace.waitFor({state:'visible'});
    const bounds = await trace.boundingBox();
    assert(bounds && bounds.width>100 && bounds.x>=-1 && bounds.x+bounds.width<=width+1,'Trace card stays in viewport');
    for (let cycle=0;cycle<2;cycle++) {
      await page.getByTestId('trace-entry').click();
      await page.getByTestId('trace-scroll').waitFor({state:'visible'});
      await page.screenshot({path:path.join(out,`${width}-trace-${cycle}.png`)});
      await page.getByRole('button',{name:'Component lab',exact:true}).click();
      await page.getByTestId('lab-scroll').waitFor({state:'visible'});
      await page.screenshot({path:path.join(out,`${width}-component-lab-${cycle}.png`)});
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.getByTestId('trace-scroll').waitFor({state:'visible'});
      await page.getByRole('button',{name:'Back',exact:true}).click();
      await page.getByTestId('trace-entry').waitFor({state:'visible'});
    }
    await page.getByRole('button',{name:'Event trace',exact:true}).click();
    await page.getByTestId('trace-scroll').waitFor({state:'visible'});
    await page.getByRole('button',{name:'Back',exact:true}).click();
    cases.push({width,visited,traceBounds:bounds,traceLabRoundTrips:2,headerShortcut:true});
    await context.close();
  }
  assert.equal(errors.length,0,errors.join('\n'));
  await writeFile(path.join(out,'result.json'),JSON.stringify({status:'PASS',revision:process.env.DASH_PROOF_REVISION,cases,errors,scope:'Real Expo web UI + fixture data; not native-device acceptance'},null,2));
} catch(e) {
  await writeFile(path.join(out,'result.json'),JSON.stringify({status:'FAIL',error:String(e.stack??e),cases,errors},null,2));
  throw e;
} finally {
  await browser?.close();
  try { process.kill(-expo.pid,'SIGTERM'); } catch {}
  await writeFile(path.join(out,'expo.log'),log);
}
