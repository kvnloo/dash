import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { chromium } from 'playwright';

assert.equal(os.hostname().split('.')[0], 'mbp', 'render/timing workload must run on MBP');
const [site, out] = process.argv.slice(2);
assert(site && out, 'Usage: node scripts/orb-smooth-measure.mjs SITE OUTPUT');
fs.mkdirSync(out, { recursive: true });
const mode = path.basename(path.resolve(out));
assert(['baseline', 'after'].includes(mode), 'output directory must identify baseline or after');
const expectedSvgCount = mode === 'after' ? 2 : 1;
const maxDegreesPerMs = process.env.EXPO_PUBLIC_DASH_TURBO === '1' ? 720 / 3300 : 720 / 6000;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.resolve(site, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(path.resolve(site) + path.sep) && file !== path.resolve(site)) { res.writeHead(403).end(); return; }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(site, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
  fs.createReadStream(target).on('error', () => res.writeHead(404).end()).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const cases = [];
const duration = Number(process.env.ORB_SAMPLE_MS ?? 7200);
assert(duration >= 6500 && duration <= 15000, 'bounded duration must include a normal 6s loop');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_BIN ? { executablePath: process.env.CHROMIUM_BIN } : {}) });
const summary = { scope: 'Actual AgentOrb + OrbMotionProvider compiled by Expo/Metro for React Native Web. MBP headless Chromium; NOT Android UI-thread or hardware presentation FPS.', instrument: 'rAF intervals with per-frame real shared-clock and computed-transform sampling; CDP task/script/layout/style deltas. Screenshots outside timing windows.', browser: browser.version(), viewport: { width: 412, height: 915, deviceScaleFactor: 2 }, durationMs: duration, cases, errors, limitations: ['Headless Chromium scheduling is not native phone presentation timing.', 'Computed style reads add instrumentation overhead equally to before/after.', 'Production React Profiler callbacks are disabled; no React commit claims.', 'Offscreen test is display:none + real OrbActivity false; no OS background/thermal/battery claim.'] };
const save = () => fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(summary, null, 2));
Object.assign(summary, { mode, expectedSvgCount, phaseTransitions: [], transitionCaptures: [], angularBound: `${maxDegreesPerMs * 1000} deg/s (fastest phase, build cadence) * (current + previous frame interval) + 0.5 deg matrix/one-frame sampling allowance` });
const percent = (values, p) => values.length ? [...values].sort((a,b) => a-b)[Math.min(values.length-1, Math.floor((values.length-1)*p))] : null;
const difference = (a, b) => Math.abs(((b-a+540)%360)-180);
const angleBound = (samples, i) => maxDegreesPerMs * (samples[i].t - samples[i-1].t + (i > 1 ? samples[i-1].t - samples[i-2].t : 1000/60)) + .5;
const opened = [];
async function open(reduced = false) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__ORB_HARNESS__));
  await page.getByTestId('agent-orb').first().waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    window.__ORB_LONGTASKS__ = [];
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => window.__ORB_LONGTASKS__.push(...list.getEntries().map(e => ({ startTime:e.startTime, duration:e.duration })))).observe({ type:'longtask', buffered: true });
  });
  opened.push(context);
  return { page, cdp, context };
}
async function configure(page, config) {
  await page.evaluate(config => window.__ORB_HARNESS__.configure({ active: true, animated: true, hidden: false, ...config }), config);
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('agent-orb').count(), config.count);
}
async function measure(page, cdp, name, config, reduced = false) {
  await configure(page, config);
  const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name,m.value]));
  const raw = await page.evaluate(async ms => {
    const orb = document.querySelector('[data-testid="agent-orb"]');
    const el = orb?.firstElementChild;
    if (!el) throw Error('Actual AgentOrb transform element missing');
    const samples = [];
    const paths = () => [...orb.querySelectorAll('svg path')].map(p => p.getAttribute('d'));
    const pathsBefore = paths();
    const pathMutations = [];
    const observer = new MutationObserver(records => pathMutations.push(...records.filter(r => r.type === 'childList' || r.attributeName === 'd').map(r => ({type:r.type,attribute:r.attributeName}))));
    observer.observe(orb, { subtree:true, attributes:true, attributeFilter:['d'], childList:true });
    const begin = performance.now();
    await new Promise(resolve => {
      const sample = t => {
        const transform = getComputedStyle(el).transform;
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
        samples.push({ t, clock: window.__ORB_HARNESS__.clock(), angle: Math.atan2(matrix.m12,matrix.m11)*180/Math.PI, scale: Math.hypot(matrix.m11,matrix.m12), transform, visibility:document.visibilityState });
        if (t - begin < ms) requestAnimationFrame(sample); else resolve();
      };
      requestAnimationFrame(sample);
    });
    const end = performance.now();
    observer.disconnect();
    return { begin, end, samples, pathsBefore, pathsAfter:paths(), pathMutations, longtasks: window.__ORB_LONGTASKS__.filter(e => e.startTime >= begin && e.startTime < end) };
  }, duration);
  const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name,m.value]));
  const intervals = raw.samples.slice(1).map((s,i) => s.t - raw.samples[i].t);
  const seams = raw.samples.flatMap((s,i) => i && ((raw.samples[i-1].clock > .8 && s.clock < .2) || Math.floor(s.clock) > Math.floor(raw.samples[i-1].clock)) ? [{ before:raw.samples[i-1], after:s, gapMs:s.t-raw.samples[i-1].t, angleDeltaDeg:difference(raw.samples[i-1].angle,s.angle), angleBoundDeg:angleBound(raw.samples,i), scaleDelta:Math.abs(raw.samples[i-1].scale-s.scale) }] : []);
  const transforms = new Set(raw.samples.map(s=>s.transform)).size;
  const svg = await page.getByTestId('agent-orb').first().locator('svg').count();
  assert.equal(svg,expectedSvgCount,`${mode}: exact real SVG layer contract`);
  if (mode === 'after') {
    assert.deepEqual(raw.pathsBefore,raw.pathsAfter,`${name}: path d changed`);
    assert.deepEqual(raw.pathMutations,[],`${name}: SVG geometry mutated during animation`);
    assert.equal(raw.pathsBefore.length,8,'after has two static four-path SVGs');
    assert.deepEqual(raw.pathsBefore.slice(0,4),raw.pathsBefore.slice(4),'color layers must share geometry');
    for (const seam of seams) assert(seam.angleDeltaDeg <= seam.angleBoundDeg,`${name}: seam angular jump`);
  }
  const animated = !reduced && config.active !== false && config.animated !== false && !['idle','waiting-approval'].includes(config.phase);
  if (animated) assert(transforms > 2, `${name}: animated renderer did not move`);
  else assert.equal(transforms,1, `${name}: non-animated renderer moved`);
  if (animated) assert(seams.length > 0, `${name}: no former loop boundary observed`);
  const result = { name, config, reduced, svgCount:svg, staticPathsUnchanged:mode === 'after' ? raw.pathMutations.length === 0 : null, samples:raw.samples.length, distinctTransforms:transforms, elapsedMs:raw.end-raw.begin, frameIntervalMs:{ p50:percent(intervals,.5), p95:percent(intervals,.95), p99:percent(intervals,.99), max:Math.max(...intervals) }, intervalsOver25Ms:intervals.filter(x=>x>25).length, intervalsOver50Ms:intervals.filter(x=>x>50).length, longtasks:raw.longtasks, cdpDeltaSeconds:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k => [k,after[k]-before[k]])), seams, screenshot:`${name}.png`, raw:`${name}.json` };
  fs.writeFileSync(path.join(out, result.raw), JSON.stringify(raw));
  await page.screenshot({ path:path.join(out,result.screenshot) });
  cases.push(result); save();
  console.log(JSON.stringify({ name, p95:result.frameIntervalMs.p95, max:result.frameIntervalMs.max, over25:result.intervalsOver25Ms, transforms, seams:seams.map(s=>s.angleDeltaDeg) }));
}
async function transition(page, from, to, interrupt = null) {
  const name = `transition-${to}${interrupt ? '-interrupted' : ''}`;
  await configure(page,{phase:from,count:1,size:'hero'});
  const raw = await page.evaluate(async ({to,interrupt}) => {
    const orb = document.querySelector('[data-testid="agent-orb"]');
    const el = orb.firstElementChild;
    const samples = [], events = [];
    let begin, interrupted = false;
    const snapshot = t => {
      const style = getComputedStyle(el);
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      return {t,elapsed:begin === undefined ? 0 : t-begin,phase:orb.getAttribute('aria-label'),clock:window.__ORB_HARNESS__.clock(),transform:style.transform,angle:Math.atan2(matrix.m12,matrix.m11)*180/Math.PI,scale:Math.hypot(matrix.m11,matrix.m12),opacity:style.opacity,
        layers:[...orb.querySelectorAll('svg')].map(svg=>({opacity:getComputedStyle(svg.parentElement).opacity,fill:svg.querySelector('path')?.getAttribute('fill'),paths:[...svg.querySelectorAll('path')].map(p=>p.getAttribute('d'))}))};
    };
    await new Promise(resolve => requestAnimationFrame(function frame(t) {
      if (begin === undefined) {
        begin=t; samples.push(snapshot(t));
        window.__ORB_HARNESS__.configure({phase:to}); events.push({phase:to,at:performance.now(),elapsed:0});
      } else {
        samples.push(snapshot(t));
        if (interrupt && !interrupted && t-begin >= 80) {
          window.__ORB_HARNESS__.configure({phase:interrupt}); events.push({phase:interrupt,at:performance.now(),elapsed:t-begin}); interrupted=true;
        }
      }
      if (t-begin < 450) requestAnimationFrame(frame); else resolve();
    }));
    return {from:null,to,interrupt,events,samples};
  },{to,interrupt});
  raw.from=from;
  const paths = raw.samples[0].layers.map(l=>l.paths);
  const jumps = raw.samples.slice(1).map((s,j)=>({elapsed:s.elapsed,angleDeltaDeg:difference(raw.samples[j].angle,s.angle),boundDeg:angleBound(raw.samples,j+1)}));
  for (const [i,s] of raw.samples.entries()) {
    assert.equal(s.layers.length,expectedSvgCount,`${name} frame ${i}: exact SVG layer count`);
    if (mode === 'after') assert.deepEqual(s.layers.map(l=>l.paths),paths,`${name} frame ${i}: static path d changed`);
  }
  if (mode === 'after') for (const jump of jumps) assert(jump.angleDeltaDeg <= jump.boundDeg,`${name}: angular jump ${JSON.stringify(jump)}`);
  const checkpoints = {zero:raw.samples[0],early:raw.samples.find(s=>s.elapsed>=60),end:raw.samples.at(-1)};
  assert(raw.samples.length >= 12,`${name}: insufficient transition samples`);
  assert(checkpoints.early && checkpoints.early.elapsed <= 120 && checkpoints.end.elapsed >= 450 && checkpoints.end.elapsed <= 600,`${name}: transition checkpoints outside bounded windows`);
  assert.equal(checkpoints.zero.phase,from);
  assert.equal(checkpoints.early.phase,to,`${name}: destination phase did not render early`);
  assert.equal(checkpoints.end.phase,interrupt ?? to);
  if (interrupt) { assert.equal(raw.events.length,2); assert(raw.events[1].elapsed>=80 && raw.events[1].elapsed<=140); }
  const file=`${name}.json`;
  fs.writeFileSync(path.join(out,file),JSON.stringify({...raw,jumps,checkpoints}));
  summary.phaseTransitions.push({name,from,to,interrupt,raw:file,samples:raw.samples.length,events:raw.events,checkpoints,maxAngleDeltaDeg:Math.max(...jumps.map(j=>j.angleDeltaDeg)),maxBoundRatio:Math.max(...jumps.map(j=>j.angleDeltaDeg/j.boundDeg)),pathsUnchanged:raw.samples.every(s=>JSON.stringify(s.layers.map(l=>l.paths))===JSON.stringify(paths))});
  save();
  // Replay only for visual captures; screenshots never perturb the measured sequence.
  await configure(page,{phase:from,count:1,size:'hero'});
  await page.evaluate(({to,interrupt}) => {
    window.__ORB_CAPTURE__={begin:performance.now(),events:[{phase:to,elapsed:0}]};
    window.__ORB_HARNESS__.configure({phase:to});
    if (interrupt) setTimeout(()=>{window.__ORB_HARNESS__.configure({phase:interrupt});window.__ORB_CAPTURE__.events.push({phase:interrupt,elapsed:performance.now()-window.__ORB_CAPTURE__.begin});},80);
  },{to,interrupt});
  for (const [label,delay] of [['zero',0],['early',60],['end',450]]) {
    await page.waitForFunction(delay=>performance.now()-window.__ORB_CAPTURE__.begin>=delay,delay,{polling:'raf'});
    const before=await page.evaluate(()=>({elapsed:performance.now()-window.__ORB_CAPTURE__.begin,clock:window.__ORB_HARNESS__.clock(),events:window.__ORB_CAPTURE__.events}));
    const file=`${name}-${label}.png`;
    await page.screenshot({path:path.join(out,file)});
    const after=await page.evaluate(()=>({elapsed:performance.now()-window.__ORB_CAPTURE__.begin,clock:window.__ORB_HARNESS__.clock()}));
    summary.transitionCaptures.push({name,label,requestedMs:delay,file,before,after,note:'Separate replay; actual capture spans recorded, zero is earliest capture, not a frozen renderer.'});
  }
  save();
}
try {
  const normal = await open();
  const {page,cdp} = normal;
  const phases = ['idle','waiting-approval','thinking','tool','streaming','listening','speaking','connecting'];
  for (const phase of phases) for (const count of [1,20]) await measure(page,cdp,`${phase}-${count}`,{phase,count,size:count===1?'hero':64});
  await measure(page,cdp,'inactive-hidden-20',{phase:'speaking',count:20,size:64,active:false,hidden:true});
  await measure(page,cdp,'animated-false-1',{phase:'speaking',count:1,size:'hero',animated:false});
  {
    for (const [i,phase] of phases.entries()) {
      const from=phases[(i+phases.length-1)%phases.length];
      await transition(page,from,phase);
      await transition(page,from,phase,phases[(i+1)%phases.length]);
    }
    assert.equal(summary.phaseTransitions.length,16);
    assert.equal(summary.transitionCaptures.length,48);
  }
  // Seam screenshots are separate from frame-timing windows. Record clock around capture.
  summary.seamCaptures = [];
  for (const phase of ['listening','speaking','connecting']) {
    await configure(page,{phase,count:1,size:'hero'});
    for (const [label,low,high] of [['before',.94,.985],['after',.015,.07]]) {
      await page.waitForFunction(([low,high]) => { const p=((window.__ORB_HARNESS__.clock()%1)+1)%1; return p>=low && p<=high; },[low,high],{timeout:14000,polling:'raf'});
      const clockBefore = await page.evaluate(() => window.__ORB_HARNESS__.clock());
      const file = `seam-${phase}-${label}.png`;
      await page.screenshot({path:path.join(out,file)});
      const clockAfter = await page.evaluate(() => window.__ORB_HARNESS__.clock());
      summary.seamCaptures.push({phase,label,file,clockBefore,clockAfter,moduloBefore:((clockBefore%1)+1)%1,moduloAfter:((clockAfter%1)+1)%1});
    }
  }
  // Real navigator focus transition; no stubbing of useIsFocused.
  await page.evaluate(() => window.__ORB_HARNESS__.focus(false));
  await page.waitForTimeout(450);
  const unfocused = await page.evaluate(() => [...document.querySelectorAll('[data-testid="agent-orb"]')].map(el => getComputedStyle(el.firstElementChild).transform));
  await page.waitForTimeout(450);
  const unfocusedAfter = await page.evaluate(() => [...document.querySelectorAll('[data-testid="agent-orb"]')].map(el => getComputedStyle(el.firstElementChild).transform));
  summary.focusCheck = { transformCount:unfocused.length, transformsStable:JSON.stringify(unfocused)===JSON.stringify(unfocusedAfter), note:'Native-stack web may detach the inactive screen; empty transformCount means detachment, not sampled pause.' };
  assert(summary.focusCheck.transformsStable);
  await page.screenshot({path:path.join(out,'unfocused.png')});
  // Close the normal page: reduced-motion timings must not share its running clock.
  await normal.context.close();
  const reduced = await open(true);
  await measure(reduced.page,reduced.cdp,'reduced-speaking-20',{phase:'speaking',count:20,size:64},true);
  assert.deepEqual(errors,[]);
  assert.equal(cases.length,19);
  summary.complete = true;
} catch (error) {
  summary.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  save();
  for (const context of opened) await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({complete:summary.complete??false,cases:cases.length,errors,failure:summary.failure,out}));
