// Deterministic ACP peer derived from bridge/src/acp/fixtures/agent.ts.
// No LLM, provider, private files, network requests, or real tool execution.
import { createInterface } from 'node:readline';
import {appendFileSync,existsSync} from 'node:fs';
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
// Evidence for concurrency specs: when each prompt started and finished, in which fixture process.
const turnLog = (event: string, text: string) => {try{appendFileSync(join(process.env.HOME || '.', 'army-acp-turns.jsonl'),JSON.stringify({agent,pid:process.pid,event,at:Date.now(),text:text.slice(0,80)})+'\n');}catch{/* evidence only */}};
let timer: ReturnType<typeof setTimeout> | undefined;
const think = (text: string) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text}}}});
const tool = (toolCallId: string, title: string, rawInput: unknown) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'tool_call',toolCallId,title,kind:'other',status:'in_progress',rawInput}}});
const toolDone = (toolCallId: string, rawOutput: string) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'tool_call_update',toolCallId,status:'completed',rawOutput}}});
// ARMY_TOOLS: the shape of a real tool-heavy turn (the RC3 owner screenshots): thinking between
// every step, two parallel vision calls, then three terminal calls. Titles are bare tool names, as
// Hermes sends them. Five calls, no real execution. ARMY_TOOLS_MANY adds a read and one more
// terminal call: four unlike runs, past the stack's open-by-default length.
const toolTurn = (done: () => void, many: boolean) => {
 const steps: (() => void)[] = [
  () => think('Reading the owner screenshots before touching any code. '),
  () => {tool('army-v1','vision_analyze',{image_url:'/shots/first.png',question:'what floats?'});tool('army-v2','vision_analyze',{image_url:'/shots/second.png',question:'what overlaps?'});},
  () => {toolDone('army-v1','attach sheet floats mid-screen');toolDone('army-v2','prompt popover floats mid-screen');},
  () => think('Now checking the bridge log. '),
  () => tool('army-t1','terminal',{command:'tail bridge.log'}),
  () => toolDone('army-t1','voice unavailable'),
  () => think('Checking whether the model exists anywhere. '),
  () => tool('army-t2','terminal',{command:'find . -name model'}),
  () => toolDone('army-t2','no match'),
  () => think('Copying it over. '),
  () => tool('army-t3','terminal',{command:'cp model dest'}),
  () => toolDone('army-t3','copied'),
  ...(many ? [
   () => tool('army-r1','read_file',{path:'/shots/notes.txt'}),
   () => toolDone('army-r1','notes'),
   () => tool('army-t4','terminal',{command:'ls'}),
   () => toolDone('army-t4','shots'),
  ] : []),
 ];
 let i = 0;
 const next = () => { const step = steps[i++]; if (!step) {done();return;} step(); timer = setTimeout(next, 60); };
 next();
};
// Fenced payloads travel over real ACP and the real bridge, never through app debug state.
function generatedReply(prompt: string): string | null {
 if (process.env.ARMY_GENERATED_UI !== '1') return null;
 if (prompt.includes('ARMY_OPENUI_INVALID')) return '```openui-lang\nroot = Button("ARMY forbidden action");\n```';
 if (prompt.includes('ARMY_OPENUI_CATALOG')) return '```openui-lang\nroot = Stack([Card("ARMY native overview", [Text("ARMY selectable summary"), Stat("Completed", 7), Progress("Delivery", 0.75), List(["Review evidence"]), Table(["Task", "State"], [["Catalog wiring", "Ready"]]), Callout("success", "ARMY bounded catalog")])]);\n```';
 if (prompt.includes('ARMY_GENUI')) return '```genui\n{"version":1,"components":[{"type":"card","title":"ARMY legacy GenUI","text":"ARMY JSON cards still render"}]}\n```';
 if (prompt.includes('ARMY_OPENUI_JSON')) return '```openui\n{"version":1,"components":[{"type":"card","title":"ARMY legacy OpenUI","text":"ARMY JSON alias still renders"}]}\n```';
 return null;
}
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
  turnLog('start', text);
  // Provider failures as a real agent reports them: an HTTP status in the error data, provider text in details.
  if (text.includes('ARMY_402')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Internal error',data:{http_status:402,details:'ARMY_PROVIDER_DETAIL usage balance exhausted'}}}); return; }
  if (text.includes('ARMY_429')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Internal error',data:{http_status:429,details:'ARMY_PROVIDER_DETAIL too many requests'}}}); return; }
  if (text.includes('ARMY_ERROR')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'ARMY_EXPECTED_AGENT_ERROR'}}); return; }
  // What a real agent reports for context occupancy: the bridge turns this ACP usage_update into the gauge's snapshot.
  if (text.includes('ARMY_USAGE')) send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'usage_update',used:85000,size:200000}}});
  const generated = generatedReply(text);
  const split = generated?.indexOf('\n');
  const prefix = generated && split !== undefined ? generated.slice(0, split + 1) : 'ARMY_STREAM_BEGIN ';
  update(prefix);
  if (text.includes('ARMY_HANG')) return;
  const answer = () => { turnLog('end', text); update(generated ? generated.slice(prefix.length) : replyTag + text.slice(0,220)); reply({stopReason:'end_turn'}); };
  // ARMY_HOLD: no answer until the spec creates $HOME/army-release, so overlap never races a clock.
  const hold = () => { if (existsSync(join(process.env.HOME || '.', 'army-release'))) answer(); else timer = setTimeout(hold, 100); };
  const finish = () => { if (text.includes('ARMY_HOLD')) hold(); else timer = setTimeout(answer, text.includes('ARMY_SLOW') ? 9000 : 350); };
  if (text.includes('ARMY_TOOLS')) toolTurn(finish, text.includes('ARMY_TOOLS_MANY')); else finish();
 } else if (r.method === 'session/cancel') {
  clearTimeout(timer); send({jsonrpc:'2.0',id:active,result:{stopReason:'cancelled'}});
 }
});
