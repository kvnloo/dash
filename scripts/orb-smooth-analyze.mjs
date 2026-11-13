import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
assert.equal(os.hostname().split('.')[0], 'mbp', 'analysis must run on MBP');
const [input, output = input] = process.argv.slice(2);
assert(input, 'Usage: node scripts/orb-smooth-analyze.mjs RESULT_DIRECTORY [OUTPUT_DIRECTORY]');
const metrics = JSON.parse(fs.readFileSync(path.join(input,'metrics.json'),'utf8'));
assert.equal(metrics.complete,true,'refuse incomplete measurement');
assert.equal(metrics.cases.length,19);
const mode = metrics.mode ?? path.basename(path.resolve(input));
assert(['baseline','after'].includes(mode));
const transitions = (metrics.phaseTransitions ?? []).map(t => {
  const raw = JSON.parse(fs.readFileSync(path.join(input,t.raw),'utf8'));
  assert.equal(raw.to,t.to);
  assert(raw.checkpoints.zero && raw.checkpoints.early && raw.checkpoints.end);
  assert(raw.samples.length>=12);
  assert(raw.checkpoints.early.elapsed>=60 && raw.checkpoints.early.elapsed<=120);
  assert(raw.checkpoints.end.elapsed>=450 && raw.checkpoints.end.elapsed<=600);
  assert.equal(raw.checkpoints.zero.phase,t.from);
  assert.equal(raw.checkpoints.early.phase,t.to);
  assert.equal(raw.checkpoints.end.phase,t.interrupt??t.to);
  const paths=raw.samples[0].layers.map(l=>l.paths);
  for (const s of raw.samples) {
    assert.equal(s.layers.length,mode==='after'?2:1);
    if (mode==='after') assert.deepEqual(s.layers.map(l=>l.paths),paths);
  }
  if (mode==='after') for (const j of raw.jumps) assert(j.angleDeltaDeg<=j.boundDeg);
  return {name:t.name,from:t.from,to:t.to,interrupt:t.interrupt,samples:t.samples,maxAngleDeltaDeg:t.maxAngleDeltaDeg,maxBoundRatio:t.maxBoundRatio,pathsUnchanged:t.pathsUnchanged,checkpoints:Object.fromEntries(Object.entries(raw.checkpoints).map(([k,s])=>[k,{elapsedMs:s.elapsed,phase:s.phase,clock:s.clock,transform:s.transform,angle:s.angle,scale:s.scale,opacity:s.opacity,layerOpacities:s.layers.map(l=>l.opacity)}]))};
});
if (mode==='after') {
  assert.equal(transitions.length,16);
  assert.equal(new Set(transitions.filter(t=>!t.interrupt).map(t=>t.to)).size,8);
  assert.equal(new Set(transitions.filter(t=>t.interrupt).map(t=>t.to)).size,8);
  assert.equal(metrics.transitionCaptures.length,48);
}
fs.mkdirSync(output,{recursive:true});
const rows = metrics.cases.map(c => {
  const raw = JSON.parse(fs.readFileSync(path.join(input,c.raw),'utf8'));
  if (mode==='after') {
    assert.equal(c.svgCount,2);
    assert.equal(raw.pathsBefore.length,8);
    assert.deepEqual(raw.pathsBefore,raw.pathsAfter);
    assert.deepEqual(raw.pathMutations,[]);
    for (const seam of c.seams) assert(seam.angleDeltaDeg<=seam.angleBoundDeg);
  }
  const intervals = raw.samples.slice(1).map((s,i)=>s.t-raw.samples[i].t);
  const changed = raw.samples.slice(1).filter((s,i)=>s.transform!==raw.samples[i].transform).length;
  let run = 0, longest = 0;
  for (let i=1;i<raw.samples.length;i++) { run = raw.samples[i].transform===raw.samples[i-1].transform ? run+1 : 0; longest = Math.max(longest,run); }
  return {case:c.name,samples:c.samples,p50:c.frameIntervalMs.p50,p95:c.frameIntervalMs.p95,p99:c.frameIntervalMs.p99,max:c.frameIntervalMs.max,over25:c.intervalsOver25Ms,over50:c.intervalsOver50Ms,transformChanges:changed,unchangedAdjacentSamples:intervals.length-changed,maxUnchangedRun:longest,observedTransformChangesPerSecond:changed/(c.elapsedMs/1000),seamAngleDeg:c.seams.map(s=>s.angleDeltaDeg),seamScaleDelta:c.seams.map(s=>s.scaleDelta),taskMs:c.cdpDeltaSeconds.TaskDuration*1000,scriptMs:c.cdpDeltaSeconds.ScriptDuration*1000,longtaskCount:c.longtasks.length};
});
const rounded = n => Number(n.toFixed(3));
const md = ['# Actual AgentOrb measurement','',metrics.scope,'',`Browser: ${metrics.browser}; duration: ${metrics.durationMs} ms per case.`,`Completed cases: ${rows.length}; browser errors: ${metrics.errors.length}.`,'','| Case | rAF p95 ms | max ms | >25 ms | >50 ms | transform changes/s | seam angle Δ° |','|---|---:|---:|---:|---:|---:|---:|',...rows.map(r=>`| ${r.case} | ${rounded(r.p95)} | ${rounded(r.max)} | ${r.over25} | ${r.over50} | ${rounded(r.observedTransformChangesPerSecond)} | ${r.seamAngleDeg.map(rounded).join(', ')} |`),'','Transform changes/s is observed DOM transform cadence, NOT hardware presentation FPS.','Static cases intentionally have zero transform changes. Exact raw samples remain authoritative.','',`Focus: ${JSON.stringify(metrics.focusCheck)}`,'','## Limitations',...metrics.limitations.map(x=>'- '+x),''].join('\n');
const transitionMd = mode==='after' ? ['','## Measured phase transitions','',metrics.angularBound,'','All eight destination phases measured normally and with a retarget at the first frame ≥80ms. Clean rAF sequences last ≥450ms; zero/early/end actual transforms are in raw and summary JSON. SVG path d remained unchanged in every sample and steady-state MutationObserver checks. Screenshot replays are separate and their actual capture spans are recorded.','','| Destination | Interrupted to | max adjacent angle Δ° | max fraction of frame bound |','|---|---|---:|---:|',...transitions.map(t=>`| ${t.to} | ${t.interrupt??'—'} | ${rounded(t.maxAngleDeltaDeg)} | ${rounded(t.maxBoundRatio)} |`),''].join('\n') : '';
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({mode,browser:metrics.browser,rows,transitions,angularBound:metrics.angularBound,focusCheck:metrics.focusCheck},null,2));
fs.writeFileSync(path.join(output,'summary.md'),md+transitionMd);
console.log(md+transitionMd);
