// Run only in an isolated fleet-build MBP snapshot. Never touches local orb sources.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
assert.equal(os.hostname().split('.')[0],'mbp');
const out='scripts/orb-smooth-validation-results';
fs.mkdirSync(out,{recursive:true});
const cache=process.env.DASH_ORB_DEPS ?? path.join(os.homedir(),'.cache/dash-native-notifications-share-build');
for (const dir of ['app/node_modules','bridge/node_modules','node_modules']) {
  if (!fs.existsSync(dir)) {
    assert(fs.existsSync(path.join(cache,dir)),`Missing cached ${dir}`);
    fs.symlinkSync(path.join(cache,dir),dir);
  }
}
// Fleet ships no .git; create a real snapshot index for workspaceFiles tests. No commit.
if (!fs.existsSync('.git')) {
  assert.equal(spawnSync('git',['init','--quiet']).status,0);
  assert.equal(spawnSync('git',['add','app','bridge','shared','scripts']).status,0);
}
const results=[];
function run(name,command,args,timeout=180000) {
  const started=Date.now();
  const p=spawnSync(command,args,{encoding:'utf8',timeout,maxBuffer:64*1024*1024,env:{...process.env,CI:'1'}});
  fs.writeFileSync(path.join(out,`${name}.log`),(p.stdout??'')+(p.stderr??'')+(p.error?`\n${p.error.stack}`:''));
  const row={name,command:[command,...args],exitCode:p.status,signal:p.signal,error:p.error?.message,elapsedMs:Date.now()-started,log:`${name}.log`};
  results.push(row);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({node:os.hostname(),results},null,2));
  console.log(JSON.stringify(row));return row;
}
// Copy the actual pinned dependency sources for review, not a reconstructed lookalike.
function copyDependencies() {
const depReport={};
for (const name of ['@kvnloo/aodl-views','thinking-orbs']) {
  try {
    const req=createRequire(path.resolve('app/package.json'));
    const roots=[path.join(cache,'app/node_modules',name),path.join(cache,'app/node_modules/@kvnloo/aodl-views/node_modules',name)];
    try { roots.push(path.dirname(req.resolve(name))); } catch {}
    const installed=roots.find(p=>fs.existsSync(path.join(p,'package.json')));
    if (!installed) throw Error('Not found among installed resolution candidates');
    const real=fs.realpathSync(installed), pkg=JSON.parse(fs.readFileSync(path.join(real,'package.json'),'utf8'));
    const dest=path.join(out,'dependencies',name.replaceAll('/','__'));
    fs.mkdirSync(dest,{recursive:true});
    const copied=[];
    function copy(dir,relative='',depth=0) {
      if (depth>5) return;
      for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
        if (['node_modules','.git'].includes(e.name)) continue;
        const r=path.join(relative,e.name),f=path.join(dir,e.name);
        if(e.isDirectory()) copy(f,r,depth+1);
        else if(e.isFile() && /\.(?:json|[cm]?js|jsx|tsx?|md|css)$/.test(e.name) && fs.statSync(f).size<2000000) {
          fs.mkdirSync(path.dirname(path.join(dest,r)),{recursive:true});fs.copyFileSync(f,path.join(dest,r));copied.push(r);
        }
      }
    }
    copy(real);depReport[name]={version:pkg.version,real,copied};
  } catch(e) { depReport[name]={error:e.message}; }
}
fs.writeFileSync(path.join(out,'dependencies.json'),JSON.stringify(depReport,null,2));
return depReport;
}
run('focused-orb','bun',['test','app/src/lib/orb-phase.test.ts','app/src/lib/orb-continuity.test.ts']);
const appType=run('typecheck-app','bun',['app/node_modules/typescript/bin/tsc','-p','app','--noEmit']);
run('typecheck-bridge','bun',['bridge/node_modules/typescript/bin/tsc','-p','bridge','--noEmit']);
run('typecheck-scripts','bun',['node_modules/typescript/bin/tsc','-p','tsconfig.scripts.json','--noEmit']);
const full=run('full-tests','bun',['run','test'],240000);
run('mutation','bun',['scripts/mutate.ts'],240000);
run('orb-stock-mutation','bun',['scripts/mutate.ts','--file','app/src/lib/orb-phase.ts'],60000);
run('orb-continuity-mutation','bun',['-e',`import { runMutation } from './scripts/mutate.ts'; const r=await runMutation({targets:[{file:'app/src/lib/orb-phase.ts',tests:['app/src/lib/orb-phase.test.ts','app/src/lib/orb-continuity.test.ts']}],max:200});console.log(JSON.stringify(r,null,2));process.exit(r.score<80?1:0);`],60000);
// Targeted semantic mutants supplement the stock scanner (which skips function-body arithmetic).
const orb='app/src/lib/orb-phase.ts',original=fs.readFileSync(orb,'utf8');
const mutants=[['orb-mutant-angle-offset','rotate + elapsed * spin','rotate + elapsed * spin + 1'],['orb-mutant-frozen-beat','beat + elapsed * beats','beat'],['orb-mutant-ignore-abs','cosine + (pulse - cosine) * abs','cosine']];
for(const [name,from,to] of mutants) {
  assert(original.includes(from));
  try {fs.writeFileSync(orb,original.replace(from,to));run(name,'bun',['test','app/src/lib/orb-phase.test.ts','app/src/lib/orb-continuity.test.ts']);}
  finally {fs.writeFileSync(orb,original);}
}
// Establish preexisting failures in the same dependency environment, without altering the shared checkout.
if (appType.exitCode!==0 || full.exitCode!==0) {
  const files=['app/src/components/AgentOrb.tsx','app/src/components/OrbMotion.tsx','app/src/lib/orb-phase.ts','app/src/motion-ambient.ts','app/src/theme.ts','app/src/turbo.ts'];
  const originals=files.map(f=>[f,fs.readFileSync(f)]);
  const continuity='app/src/lib/orb-continuity.test.ts',contents=fs.readFileSync(continuity);
  try {
    const tar=spawnSync('tar',['-xf','scripts/orb-smooth-baseline.tar']);assert.equal(tar.status,0);
    fs.unlinkSync(continuity);
    if (appType.exitCode!==0) run('baseline-typecheck-app','bun',['app/node_modules/typescript/bin/tsc','-p','app','--noEmit']);
    if (full.exitCode!==0) run('baseline-full-tests','bun',['run','test'],240000);
  } finally { for(const [f,b] of originals) fs.writeFileSync(f,b);fs.writeFileSync(continuity,contents); }
}
const depReport=copyDependencies();
console.log(JSON.stringify({out,results,dependencies:depReport}));
