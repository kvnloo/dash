#!/usr/bin/env node
// A scoped surface grant, never a vault/bridge execution token. No eval/ADB transport.
import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const args = process.argv.slice(2);
function flag(name) { const index=args.indexOf(name); if(index<0) return; const value=args[index+1]; args.splice(index,2); return value; }
const grantPath=flag('--grant'), client=flag('--client'), session=flag('--session');
if (!grantPath || !client || !session) throw new Error('Usage: node scripts/agent-surface.mjs --grant PRIVATE.json --client EXACT_CLIENT --session EXACT_SESSION state|demo|open|clear|navigate ROUTE');
const stat=statSync(grantPath);
if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('Grant must be an owner-only regular file');
const grant=JSON.parse(readFileSync(grantPath,'utf8'));
if (grant.scope!=='dash:surface' || grant.target?.client!==client || grant.target?.session!==session || grant.expiresAt<=Date.now()) throw new Error('Wrong client/session, scope, or expired grant');
const base=new URL(grant.url);
if (!['http:','https:'].includes(base.protocol) || base.username || base.password || base.pathname!=='/') throw new Error('Invalid bridge origin');
async function request(path, command) {
  const r=await fetch(`${base.origin}/agent-surface/${encodeURIComponent(client)}/${path}`, {method:command?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(7000),headers:{authorization:`Bearer ${grant.capability}`,...(command?{'content-type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
  const result=await r.json();
  if(!r.ok || result.status!=='rendered') throw new Error(JSON.stringify(result));
  if (JSON.stringify(result.snapshot.target)!==JSON.stringify(grant.target)) throw new Error('Readback attachment changed');
  return result;
}
async function command(op, extra={}) {
  const state=(await request('state')).snapshot;
  return request('command',{id:randomUUID(),target:grant.target,route:state.route,generation:state.generation,expiresAt:Date.now()+5000,op,...extra});
}
const verb=args.shift()??'state';
let result;
if(verb==='state') result=await request('state');
else if(verb==='open') result=await command('annotation.open');
else if(verb==='clear') result=await command('clear');
else if(verb==='navigate') result=await command('navigate',{destination:args[0]});
else if(verb==='demo') {
  const before=(await request('state')).snapshot;
  if(before.route!=='chat') throw new Error('Demo requires the existing foreground chat; it will not select/create one');
  const drawn=await command('draw',{ttlMs:8000,primitives:[{kind:'box',anchor:'chat.options'},{kind:'arrow',anchor:'chat.annotate'}]});
  console.log(JSON.stringify({phase:'highlight-rendered',receipt:drawn},null,2));
  await new Promise(resolve=>setTimeout(resolve,1500));
  result=await command('annotation.open');
} else throw new Error('Unknown verb');
console.log(JSON.stringify(result,null,2));
