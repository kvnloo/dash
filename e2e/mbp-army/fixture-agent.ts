// Deterministic ACP peer derived from bridge/src/acp/fixtures/agent.ts.
// No LLM, provider, private files, network requests, or real tool execution.
import { createInterface } from 'node:readline';
import {appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
process.on('uncaughtException',e=>{appendFileSync(join(process.env.HOME || '.', 'fixture-errors.log'),String(e.stack)+'\n');process.exit(1);});
function isRecord(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
const send = (v: unknown) => process.stdout.write(JSON.stringify(v) + '\n');
// `claude`: the Claude Code ACP adapter's shape (session/resume without history replay, its own reply tag).
const agent = process.argv[2] || 'fixture';
let sessionId = agent === 'claude' ? 'army-claude-session' : 'army-fixture-session';
const replyTag = agent === 'claude' ? 'ARMY_CLAUDE_REPLY: ' : 'ARMY_REPLY: ';
const update = (text: string) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
// Evidence for specs: which session method ran, for which id, in which directory.
const calls = (method: string, params: unknown) => {if(!isRecord(params))return;try{appendFileSync(join(process.env.HOME || '.', 'army-acp-calls.jsonl'),JSON.stringify({agent,method,sessionId:params.sessionId,modelId:params.modelId,cwd:params.cwd,pwd:process.cwd()})+'\n');}catch{/* evidence only */}};
// Evidence for concurrency specs: when each prompt started and finished, in which fixture process.
const turnLog = (event: string, text: string) => {try{appendFileSync(join(process.env.HOME || '.', 'army-acp-turns.jsonl'),JSON.stringify({agent,pid:process.pid,event,at:Date.now(),text:text.slice(0,80)})+'\n');}catch{/* evidence only */}};
let timer: ReturnType<typeof setTimeout> | undefined;
let pendingPermission: { rpcId: string; settle: (outcome: unknown) => void } | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
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
// Learn surface (DA-010): the app's own Learn prompts get the answer shape a real model writes
// for them, including the Mermaid a model really emits (shapes, subgraph, styles, -- text --> edges).
function learnReply(prompt: string, links: string[]): string | null {
 const learn = /^\[Dash · Learn mode · (explain|quiz|map|sketch)\] Topic: ([^\n]*)/.exec(prompt);
 if (!learn) return null;
 const [, intent, topic] = learn;
 if (intent === 'map') return 'Here is the map.\n\n```mermaid\nflowchart TD\n  subgraph L[Light reactions]\n    S((Sunlight)) --> C([Chlorophyll])\n    W["Water (H2O)"] -- split by light --> O[Oxygen]\n  end\n  C -->|excites| E[ATP & NADPH]\n  E & K[CO2] --> V[[Calvin cycle]]\n  V --> G{{Glucose}}\n  classDef hot fill:#f5a524\n  class S hot\n  style G stroke:#22c55e\n```\n\n```genui\n{"version":1,"components":[{"type":"table","title":"ARMY map parts: ' + topic + '","columns":["Part","Role"],"rows":[["Chlorophyll","catches light"],["Calvin cycle","builds sugar"]]}]}\n```';
 if (intent === 'sketch') {
  const seen = links.length ? links.join(', ') : 'no attachments';
  return '```genui\n{"version":1,"components":[{"type":"card","title":"ARMY saw your sketch","text":"ARMY sketch files: ' + seen + '"},{"type":"card","title":"ARMY sketch topic","text":"' + (topic ?? '') + '"}]}\n```';
 }
 return '```genui\n{"version":1,"components":[{"type":"card","title":"ARMY Learn card","text":"ARMY explains ' + (topic ?? '') + '"},{"type":"choices","id":"check","title":"Check yourself","items":[{"id":"a","label":"ARMY answer A"},{"id":"b","label":"ARMY answer B"}]}]}\n```';
}
function generatedReply(prompt: string, links: string[] = []): string | null {
 if (process.env.ARMY_GENERATED_UI !== '1') return null;
 const learn = learnReply(prompt, links);
 if (learn) return learn;
 const prototypePort = /ARMY_PROTOTYPE_LINK=(\d+)/.exec(prompt)?.[1];
 if (prototypePort) return `Try http://localhost:${prototypePort}/previews/counter#t=0123456789abcdef for review.`;
 if (prompt.includes('ARMY_HTML_PROTOTYPE')) return '```html\n<button onclick="this.nextElementSibling.textContent=\'Updated\'">Try control</button><p>Ready</p>\n```';
 if (prompt.includes('ARMY_CODE_MORE')) return '```go\nfunc main() { // entry\n}\n```\n\n```rust\nfn main() { // entry\n}\n```\n\n```sql\nSELECT id FROM chats; -- entry\n```\n\n```yml\nname: dash # entry\n```';
 if (prompt.includes('ARMY_CODE_TSX')) return '```tsx\nconst card = <Panel title="Dash" />;\n```\n\n```jsx\nconst badge = <Badge label="Ready" />;\n```';
 // kvnloo/ephemeral-ui kit kinds through the openui-lang catalog (#ephemeral-ui cards).
 const eui = /ARMY_EPHEMERAL_BATCH_(\d)/.exec(prompt);
 if (eui) { const kinds = String(process.env.ARMY_EPHEMERAL_KINDS ?? '').split(',').filter(Boolean).slice(Number(eui[1]) * 10, Number(eui[1]) * 10 + 10); return '```openui-lang\nroot = Stack([' + kinds.map(k => `EphemeralCard("${k}")`).join(', ') + ']);\n```'; }
 if (prompt.includes('ARMY_EPHEMERAL_INBOX')) return 'Here is your inbox.\n\n```openui-lang\nroot = EphemeralCard("inbox", "gmail");\n```';
 if (prompt.includes('ARMY_EPHEMERAL_INVALID')) return '```openui-lang\nroot = EphemeralCard("inbox", "uber");\n```';
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
 const responseId = typeof r.id === 'string' ? r.id : undefined;
 if (!r.method && pendingPermission && responseId === pendingPermission.rpcId) {
  const pending = pendingPermission;
  pendingPermission = undefined;
  try{appendFileSync(join(process.env.HOME || '.', 'army-acp-permissions.jsonl'),JSON.stringify({agent,sessionId,response:r.result})+'\n');}catch{/* evidence only */}
  pending.settle(r.result);
  return;
 }
 if (r.method === 'initialize') reply({protocolVersion:1,agentCapabilities:{loadSession:true,...(agent==='claude'?{sessionCapabilities:{resume:{}}}:{})},authMethods:[]});
 else if (r.method === 'session/new') {calls(r.method,r.params);reply({sessionId});}
 else if (r.method === 'session/load' || (r.method === 'session/resume' && agent === 'claude')) {calls(r.method,r.params);if(isRecord(r.params)&&typeof r.params.sessionId==='string')sessionId=r.params.sessionId;reply({});}
 else if (r.method === 'session/set_model') {
  calls(r.method,r.params);
  const modelId=isRecord(r.params)?r.params.modelId:undefined;
  if(typeof modelId !== 'string' || !modelId || modelId === 'army-unsupported')send({jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Fixture does not support this model'}});
  else {turnLog('model', modelId);reply({});}
 }
 else if (r.method === 'session/prompt') {
  active = r.id;
  const params=typeof r.params==='object'&&r.params!==null&&'prompt' in r.params?r.params.prompt:[];
  const text = Array.isArray(params)?params.map((p:unknown)=>typeof p==='object'&&p!==null&&'text' in p&&typeof p.text==='string'?p.text:'').join(''):'';
  // What the agent was handed besides text (an annotation's PNG and strokes JSON arrive as links or images).
  const blocks = Array.isArray(params)?params.flatMap((p:unknown)=>isRecord(p)&&(p.type==='resource_link'||p.type==='image')?[{type:String(p.type),name:String(p.name ?? ''),mimeType:String(p.mimeType ?? ''),uri:String(p.uri ?? '')}]:[]):[];
  const links = blocks.map(b=>`${b.name || b.uri} (${b.mimeType})`);
  if (blocks.length) {try{appendFileSync(join(process.env.HOME || '.', 'army-acp-prompts.jsonl'),JSON.stringify({agent,text:text.slice(0,400),blocks})+'\n');}catch{/* evidence only */}}
  turnLog('start', text);
  if (text.includes('ARMY Turbo make this label clearer') && Array.isArray(params)) {
   appendFileSync(join(process.env.HOME || '.', 'army-turbo-prompt.jsonl'), JSON.stringify({ agent, sessionId, text,
    attachments: params.filter(p => isRecord(p) && p.type !== 'text').map(p => ({ type: p.type, name: p.name, mimeType: p.mimeType })),
   }) + '\n');
  }
  // Provider failures as a real agent reports them: an HTTP status in the error data, provider text in details.
  if (text.includes('ARMY_402')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Internal error',data:{http_status:402,details:'ARMY_PROVIDER_DETAIL usage balance exhausted'}}}); return; }
  if (text.includes('ARMY_429')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'Internal error',data:{http_status:429,details:'ARMY_PROVIDER_DETAIL too many requests'}}}); return; }
  // An admitted Hermes turn can stream its provider explanation before failing.
  if (text.includes('ARMY_ERROR_AFTER_TEXT')) {
   update('ARMY provider quota explanation before failure');
   send({jsonrpc:'2.0',id:r.id,error:{code:-32603,message:'Internal error',data:{details:'admitted_turn_failed'}}});
   return;
  }
  if (text.includes('ARMY_ERROR')) { send({jsonrpc:'2.0',id:r.id,error:{code:-32000,message:'ARMY_EXPECTED_AGENT_ERROR'}}); return; }
  // What a real agent reports for context occupancy: the bridge turns this ACP usage_update into the gauge's snapshot.
  if (text.includes('ARMY_USAGE')) send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'usage_update',used:85000,size:200000}}});
  const longReply = text.includes('ARMY_LONG_REPLY') ? 'ARMY_LONG_REPLY_BEGIN ' + 'x'.repeat(17000) + ' ARMY_LONG_REPLY_END' : null;
  const linkUrl = /^ARMY_CHAT_LINKS (https?:\/\/\S+)$/.exec(text)?.[1];
  const chatLinks = linkUrl ? 'Visit ' + linkUrl + '.\n\nOpen Downloads/notes/army.md:2:3\n\n`Downloads/notes/army.md:1` stays code.' : null;
  const generated = longReply ?? chatLinks ?? generatedReply(text, links);
  const split = generated?.indexOf('\n');
  const prefix = longReply ? longReply.slice(0, 8500) : generated && split !== undefined ? generated.slice(0, split + 1) : 'ARMY_STREAM_BEGIN ';
  const answer = () => { clearInterval(ticker); ticker = undefined; turnLog('end', text); update(generated ? generated.slice(prefix.length) : replyTag + text.slice(0,220)); reply({stopReason:'end_turn'}); };
  if (text.includes('ARMY_PERMISSION')) {
   const rpcId = `army-permission-${process.pid}-${Date.now()}`;
   pendingPermission = {rpcId, settle: outcome => {
    update(prefix);
    const selected = isRecord(outcome) && isRecord(outcome.outcome) && outcome.outcome.outcome === 'selected';
    update(selected ? 'ARMY_PERMISSION_SELECTED ' : 'ARMY_PERMISSION_CANCELLED ');
    answer();
   }};
   send({jsonrpc:'2.0',id:rpcId,method:'session/request_permission',params:{sessionId,options:[
    {optionId:'army-allow-once',name:'Fixture allow once',kind:'allow_once'},
    {optionId:'army-reject-once',name:'Fixture reject once',kind:'reject_once'},
   ]}});
   return;
  }
  update(prefix);
  // ARMY_UI_CONTROL ["open","Chats > X > Annotate"]: drive the phone the way a real agent on this
  // computer does, by running the bridge's own dash-ui CLI with the environment the bridge gave it.
  const uiArgv = /ARMY_UI_CONTROL (\[[^\n]*\])/.exec(text)?.[1];
  if (uiArgv) {
   const argv: unknown = JSON.parse(uiArgv);
   const args = Array.isArray(argv) ? argv.filter((a): a is string => typeof a === 'string') : [];
   tool('army-ui','dash-ui',{argv:args});
   execFile(process.execPath,[join(process.env.ARMY_BRIDGE_ROOT || '.','bridge','bin','dash-ui'),...args],{env:process.env,timeout:15000},(error,stdout,stderr)=>{
    const out = (stdout || stderr || String(error)).trim().slice(0,400);
    toolDone('army-ui',out);
    update('ARMY_UI_RESULT '+out+' ');
    answer();
   });
   return;
  }
  if (text.includes('ARMY_HANG')) return;
  // ARMY_HOLD: no answer until the spec creates $HOME/army-release, so overlap never races a clock.
  const hold = () => { if (existsSync(join(process.env.HOME || '.', 'army-release'))) answer(); else timer = setTimeout(hold, 100); };
  // ARMY_MS=<n> delays completion; ARMY_TICK=<n> emits progress frames during the wait.
  const markerMs = Number(/\bARMY_MS=(\d+)\b/.exec(text)?.[1]);
  const markerTick = Number(/\bARMY_TICK=(\d+)\b/.exec(text)?.[1]);
  const waitMs = Number.isSafeInteger(markerMs) && markerMs >= 0 ? markerMs : text.includes('ARMY_SLOW') ? 9000 : 350;
  const tickMs = Number.isSafeInteger(markerTick) && markerTick > 0 ? markerTick : 0;
  // ARMY_TEXT_TICK=<n>: a long streaming reply, one numbered text delta every n ms until completion.
  const markerTextTick = Number(/\bARMY_TEXT_TICK=(\d+)\b/.exec(text)?.[1]);
  const textTickMs = Number.isSafeInteger(markerTextTick) && markerTextTick > 0 ? markerTextTick : 0;
  let textDeltas = 0;
  const finish = () => {
   if (tickMs > 0) ticker = setInterval(() => think('ARMY_TICK progress'), tickMs);
   else if (textTickMs > 0) ticker = setInterval(() => update(`ARMY_DELTA_${++textDeltas} streamed words for a long reply. ${textDeltas % 12 === 0 ? '\n\n' : ''}`), textTickMs);
   if (text.includes('ARMY_RATE_STREAM')) {
   // Real ACP streaming deltas separated in time; no direct app/network fixture injection.
   timer = setTimeout(() => { update('ARMY_RATE_FIRST ' + 'first '.repeat(24));
    timer = setTimeout(() => { update('ARMY_RATE_SECOND ' + 'second '.repeat(24)); timer = setTimeout(answer, 1500); }, 600);
   }, 600);
  } else if (text.includes('ARMY_HOLD')) hold(); else timer = setTimeout(answer, waitMs);
  };
  if (text.includes('ARMY_TOOL_DETAIL')) {
   // A real write payload can exceed the bridge's 8 KiB preview before its path.
   // The bridge still formats the action summary from the complete input.
   tool('army-detail','write_file',{content:'army detail line\n'.repeat(700)+'ARMY_CONTENT_END',path:'/project/release-notes.md'});
   toolDone('army-detail','ARMY_WRITE_RESULT: release notes saved');
   finish();
  } else if (text.includes('ARMY_TOOLS')) toolTurn(finish, text.includes('ARMY_TOOLS_MANY')); else finish();
 } else if (r.method === 'session/cancel') {
  clearTimeout(timer); clearInterval(ticker); ticker = undefined; send({jsonrpc:'2.0',id:active,result:{stopReason:'cancelled'}});
 }
});
