// Deterministic ACP peer derived from bridge/src/acp/fixtures/agent.ts.
// No LLM, provider, private files, network requests, or real tool execution.
import { createInterface } from 'node:readline';
import {appendFileSync} from 'node:fs';
import {join} from 'node:path';
process.on('uncaughtException',e=>{appendFileSync(join(process.env.HOME || '.', 'fixture-errors.log'),String(e.stack)+'\n');process.exit(1);});
function isRecord(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
const send = (v: unknown) => process.stdout.write(JSON.stringify(v) + '\n');
// `claude`: the Claude Code ACP adapter's shape (session/resume without history replay, its own reply tag).
const agent = process.argv[2] || 'fixture';
let sessionId = agent === 'claude' ? 'army-claude-session' : 'army-fixture-session';
const replyTag = agent === 'claude' ? 'ARMY_CLAUDE_REPLY: ' : 'ARMY_REPLY: ';
const update = (text: string) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
// Evidence for specs: which session method ran, for which id, in which directory.
const calls = (method: string, params: unknown) => {if(!isRecord(params))return;try{appendFileSync(join(process.env.HOME || '.', 'army-acp-calls.jsonl'),JSON.stringify({agent,method,sessionId:params.sessionId,cwd:params.cwd,pwd:process.cwd()})+'\n');}catch{/* evidence only */}};
let timer: ReturnType<typeof setTimeout> | undefined;
let active: unknown;
createInterface({input:process.stdin}).on('line', line => {
 const value:unknown = JSON.parse(line);
 if(!isRecord(value))throw Error('Invalid fixture RPC');
 const r:Record<string,unknown>=value;
 const reply = (result: unknown) => send({jsonrpc:'2.0', id:r.id, result});
 if (r.method === 'initialize') reply({protocolVersion:1,agentCapabilities:{loadSession:true,...(agent==='claude'?{sessionCapabilities:{resume:{}}}:{})},authMethods:[]});
 else if (r.method === 'session/new') {calls(r.method,r.params);reply({sessionId});}
 else if (r.method === 'session/load' || (r.method === 'session/resume' && agent === 'claude')) {calls(r.method,r.params);if(isRecord(r.params)&&typeof r.params.sessionId==='string')sessionId=r.params.sessionId;reply({});}
 else if (r.method === 'session/prompt') {
  active = r.id;
  const params=typeof r.params==='object'&&r.params!==null&&'prompt' in r.params?r.params.prompt:[];
  const text = Array.isArray(params)?params.map((p:unknown)=>typeof p==='object'&&p!==null&&'text' in p&&typeof p.text==='string'?p.text:'').join(''):'';
  if (text.includes('ARMY_ERROR')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'ARMY_EXPECTED_AGENT_ERROR'}}); return; }
  update('ARMY_STREAM_BEGIN ');
  if (text.includes('ARMY_HANG')) return;
  timer = setTimeout(() => { update(replyTag + text.slice(0,220)); reply({stopReason:'end_turn'}); }, text.includes('ARMY_SLOW') ? 9000 : 350);
 } else if (r.method === 'session/cancel') {
  clearTimeout(timer); send({jsonrpc:'2.0',id:active,result:{stopReason:'cancelled'}});
 }
});
