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
  // rc3-02-03 (chat chrome): a reply whose text opens with a <think> block, for Details Hide/Compact/Full.
  if (text.includes('ARMY_THINK')) { timer = setTimeout(() => { update('<think>ARMY_THOUGHT_DETAIL line one\nARMY_THOUGHT_DETAIL line two</think>\nARMY_REPLY_AFTER_THINK'); reply({stopReason:'end_turn'}); }, 350); return; }
  // rc3-02-03 (chat chrome): a running tool phase that never completes, for the window pill status slot.
  if (text.includes('ARMY_TOOLHANG')) { send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'tool_call',toolCallId:'army-tool',title:'armytool',kind:'execute',status:'in_progress'}}}); return; }
  update('ARMY_STREAM_BEGIN ');
  if (text.includes('ARMY_HANG')) return;
  const answer = () => { turnLog('end', text); update(replyTag + text.slice(0,220)); reply({stopReason:'end_turn'}); };
  // ARMY_HOLD: no answer until the spec creates $HOME/army-release, so overlap never races a clock.
  const hold = () => { if (existsSync(join(process.env.HOME || '.', 'army-release'))) answer(); else timer = setTimeout(hold, 100); };
  const finish = () => { if (text.includes('ARMY_HOLD')) hold(); else timer = setTimeout(answer, text.includes('ARMY_SLOW') ? 9000 : 350); };
  if (text.includes('ARMY_TOOLS')) toolTurn(finish, text.includes('ARMY_TOOLS_MANY')); else finish();
 } else if (r.method === 'session/cancel') {
  clearTimeout(timer); send({jsonrpc:'2.0',id:active,result:{stopReason:'cancelled'}});
 }
});

// --- rc3-05-06 delivery/queue lane (appended; does not change the handler above) ---
// 1. Every session/prompt is logged to <TMPDIR or HOME>/fixture-prompts.jsonl so a spec can
//    prove a message reached the agent exactly once (no duplicate turn after retry/restart).
// 2. A prompt holding both ARMY_HANG and ARMY_HOLD_<token> stays open (the handler above
//    returns after ARMY_STREAM_BEGIN) until the spec creates army-release-<token> in TMPDIR
//    or HOME; then it streams ARMY_REPLY and ends the turn. session/cancel drops the hold.
import {existsSync as armyExists} from 'node:fs';
{
 const logDir=process.env.TMPDIR||process.env.HOME||'.';
 const releaseDirs=[...new Set([process.env.TMPDIR,process.env.HOME].filter((d):d is string=>Boolean(d)))];
 const holds=new Map<string,ReturnType<typeof setInterval>>();
 createInterface({input:process.stdin}).on('line',line=>{
  let value:unknown;try{value=JSON.parse(line);}catch{return;}
  if(!isRecord(value))return;
  if(value.method==='session/prompt'){
   const id=value.id;
   const parts=isRecord(value.params)&&Array.isArray(value.params.prompt)?value.params.prompt:[];
   const text=parts.map((p:unknown)=>isRecord(p)&&typeof p.text==='string'?p.text:'').join('');
   appendFileSync(join(logDir,'fixture-prompts.jsonl'),JSON.stringify({at:Date.now(),pid:process.pid,id,text})+'\n');
   const hold=/ARMY_HOLD_([a-z0-9]+)/.exec(text);
   if(hold&&text.includes('ARMY_HANG')&&!text.includes('ARMY_ERROR')){
    const files=releaseDirs.map(d=>join(d,'army-release-'+hold[1]));
    const poll=setInterval(()=>{
     if(!files.some(f=>armyExists(f)))return;
     clearInterval(poll);holds.delete(String(id));
     update('ARMY_REPLY: '+text.slice(0,220));
     send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
    },100);
    holds.set(String(id),poll);
   }
  } else if(value.method==='session/cancel'){for(const poll of holds.values())clearInterval(poll);holds.clear();}
 });
}

// --- rc3-03-04 composer controls lane (appended; does not change the handlers above) ---
// 1. Opt-in command catalog: when <HOME>/army-commands.json exists, every session/new or
//    session/load is followed by an ACP available_commands_update with that list, so the
//    bridge /suggestions route returns real advertised commands. Absent file: no change.
// 2. Every RPC method name is logged to <HOME>/army-rpc-methods.jsonl (method only, plus the
//    prompt text for session/prompt), so a spec can prove a session/cancel reached the agent.
// 3. A prompt holding ARMY_TOKENS streams 60 short chunks (one per 100 ms) for the tok/s chip.
import {existsSync as armyCmdExists, readFileSync as armyCmdRead} from 'node:fs';
{
 const home=process.env.HOME||'.';
 const catalog=join(home,'army-commands.json');
 createInterface({input:process.stdin}).on('line',line=>{
  let value:unknown;try{value=JSON.parse(line);}catch{return;}
  if(!isRecord(value)||typeof value.method!=='string')return;
  const parts=isRecord(value.params)&&Array.isArray(value.params.prompt)?value.params.prompt:[];
  const text=parts.map((p:unknown)=>isRecord(p)&&typeof p.text==='string'?p.text:'').join('');
  try{appendFileSync(join(home,'army-rpc-methods.jsonl'),JSON.stringify({at:Date.now(),method:value.method,...(value.method==='session/prompt'?{text:text.slice(0,400)}:{})})+'\n');}catch{/* log is evidence only */}
  if((value.method==='session/new'||value.method==='session/load')&&armyCmdExists(catalog)){
   const sessionId=value.method==='session/load'&&isRecord(value.params)&&typeof value.params.sessionId==='string'?value.params.sessionId:'army-fixture-session';
   const availableCommands:unknown=JSON.parse(armyCmdRead(catalog,'utf8'));
   setTimeout(()=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'available_commands_update',availableCommands}}}),0);
  }
  if(value.method==='session/prompt'&&text.includes('ARMY_TOKENS')){
   let n=0;const burst=setInterval(()=>{if(++n>60){clearInterval(burst);return;}update('tok'+n+' ');},100);
  }
 });
}

// --- rc3-04-05 sending-to-every-harness lane (appended; does not change the handlers above) ---
// 1. The spec's per-test bin wrappers export ARMY_HARNESS=<bin name>. Every ACP session/new,
//    session/load and session/prompt is logged with that name and its sessionId to
//    <HOME>/army-harness-calls.jsonl, so a spec proves which harness binary got a turn and that a
//    resumed session was loaded by its own id. Without ARMY_HARNESS nothing is logged.
// 2. ARMY_FIXTURE_CLI=pi|fx emulates the bridge's legacy (non-ACP) CLI wire for harnesses with no
//    ACP adapter (bridge DASH_ENABLE_LEGACY_CLI=1): Pi `--mode json` NDJSON events (session, then
//    streamed text_delta), or one fx `ask --json` object. The prompt is the last argv element; the
//    resume flag (--session / --resume-id) is echoed back as the session id. ARMY_ERROR exits 1 with
//    a stderr line; ARMY_SLOW delays the final text 9 s like the ACP fixture. Stdin is ignored.
import {appendFileSync as armyHarnessAppend} from 'node:fs';
{
 const home=process.env.HOME||'.';
 const harness=process.env.ARMY_HARNESS||'';
 const record=(entry:Record<string,unknown>)=>{if(!harness)return;try{armyHarnessAppend(join(home,'army-harness-calls.jsonl'),JSON.stringify({at:Date.now(),pid:process.pid,harness,...entry})+'\n');}catch{/* evidence only */}};
 const cli=process.env.ARMY_FIXTURE_CLI;
 if(cli==='pi'||cli==='fx'){
  const argv=process.argv.slice(2);
  const text=argv[argv.length-1]??'';
  const flagAt=argv.indexOf(cli==='pi'?'--session':'--resume-id');
  const resumed=flagAt>=0?argv[flagAt+1]:undefined;
  const sessionId=resumed??'army-'+cli+'-session';
  record({cli,argv,resumed:resumed??null,sessionId,text:text.slice(0,400)});
  const out=(line:string)=>new Promise<void>(resolve=>{process.stdout.write(line+'\n',()=>resolve());});
  const delay=text.includes('ARMY_SLOW')?9000:350;
  if(text.includes('ARMY_ERROR')) process.stderr.write('ARMY_EXPECTED_CLI_ERROR\n',()=>process.exit(1));
  else if(cli==='pi'){
   const delta=(d:string)=>out(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:d}}));
   void out(JSON.stringify({type:'session',id:sessionId})).then(()=>delta('ARMY_STREAM_BEGIN ')).then(()=>{setTimeout(()=>{void delta('ARMY_REPLY: '+text.slice(0,220)).then(()=>process.exit(0));},delay);});
  } else {
   setTimeout(()=>{void out(JSON.stringify({session_id:sessionId,output:'ARMY_STREAM_BEGIN ARMY_REPLY: '+text.slice(0,220)})).then(()=>process.exit(0));},delay);
  }
 } else if(harness){
  createInterface({input:process.stdin}).on('line',line=>{
   let value:unknown;try{value=JSON.parse(line);}catch{return;}
   if(!isRecord(value)||typeof value.method!=='string')return;
   if(value.method!=='session/new'&&value.method!=='session/load'&&value.method!=='session/prompt')return;
   const params=isRecord(value.params)?value.params:{};
   const parts=Array.isArray(params.prompt)?params.prompt:[];
   const text=parts.map((p:unknown)=>isRecord(p)&&typeof p.text==='string'?p.text:'').join('');
   record({method:value.method,sessionId:typeof params.sessionId==='string'?params.sessionId:null,...(text?{text:text.slice(0,400)}:{})});
  });
 }
}

// --- rc3-06-07 transcript-rendering lane (appended; does not change the handlers above) ---
// A prompt holding both ARMY_HANG and ARMY_R07_<SCENARIO> keeps the main handler open after
// ARMY_STREAM_BEGIN; this block then streams a deterministic scripted reply (markdown, links,
// code, ACP tool_call/tool_call_update, agent_thought_chunk) and ends the turn. No tool runs.
{
 const sid='army-fixture-session';
 const su=(u:Record<string,unknown>)=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId:sid,update:u}});
 const say=(t:string)=>su({sessionUpdate:'agent_message_chunk',content:{type:'text',text:t}});
 const think=(t:string)=>su({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:t}});
 const tool=(id:string,title:string,kind:string,rawInput:unknown,output?:string,status='completed')=>{
  su({sessionUpdate:'tool_call',toolCallId:id,title,kind,status:'in_progress',rawInput});
  if(output!==undefined)su({sessionUpdate:'tool_call_update',toolCallId:id,status,rawOutput:output});
 };
 type Step=[number,()=>void];
 const big=Array.from({length:700},(_,i)=>'army bulk output line '+String(i).padStart(4,'0')).join('\n')+'\nARMY_TOOL_TAIL retained end';
 const scripts:Record<string,Step[]>={
  MD:[[300,()=>say('\n\n# ARMY Heading One\n\nARMY_MD_PART1 streamed first.\n\n')],[700,()=>say('- ARMY list item one\n- ARMY list item two\n\nSome **ARMY_BOLD** text and `army_inline_code`.\n\n')],[700,()=>say('```ts\nconst armyValue = 42;\n```\n\nARMY_MD_DONE')]],
  LINKS:[[300,()=>say('\n\nOpen [ARMY web link](https://example.com/army-doc) or [ARMY mail link](mailto:army@example.invalid).\n\nBare https://example.com/army-bare and /srv/army/src/file.ts:12 outside code.\n\n```bash\necho https://example.com/army-in-code /srv/army/src/in-code.ts:3\n```\n\nARMY_LINKS_DONE')]],
  TOOLS:[[200,()=>think('ARMY_REASON one\nARMY_REASON two\nARMY_REASON three\nARMY_REASON four\nARMY_REASON_TAIL five')],
   [200,()=>{tool('r07-read-1','read','read',{path:'/srv/army/src/a.ts'},'alpha');tool('r07-read-2','read','read',{path:'/srv/army/src/b.ts'},'beta');tool('r07-read-3','read','read',{path:'/srv/army/src/c.ts'},'gamma');}],
   [200,()=>tool('r07-big','bash','execute',{command:'army-bulk-output'},big)],
   [300,()=>say('\n\nARMY_TOOLS_DONE')]],
  LIVETOOL:[[200,()=>tool('r07-live','bash','execute',{command:'army-never-finishes'})],[200,()=>say('\n\nARMY_LIVETOOL_STARTED')]],
  REASON:[[200,()=>think('ARMY_REASON planning the reply\n')],[400,()=>think('ARMY_REASON checking the file list\n')],[400,()=>tool('r07-sum','read','read',{path:'/srv/army/src/summary.ts'},'ok')],[400,()=>say('\n\nARMY_REASON_DONE')],[1800,()=>{}]],
  FILES:[[300,()=>say('\n\nWrote the report to /srv/army/out/army-report.md for review.\n\nARMY_FILES_DONE')]],
  MEDIA:[[300,()=>say('\n\n![ARMY chart](https://example.invalid/army-chart.png)\n\n```html\n<p>ARMY_HTML_BODY</p>\n```\n\nARMY_MEDIA_DONE')]],
  SLOW:Array.from({length:30},(_,i):Step=>[450,()=>say('\n\nARMY_SLOW_CHUNK_'+String(i).padStart(2,'0')+' '+'streamed transcript filler '.repeat(6))]).concat([[200,()=>say('\n\nARMY_SLOW_DONE')]]),
 };
 const timers=new Set<ReturnType<typeof setTimeout>>();
 createInterface({input:process.stdin}).on('line',line=>{
  let value:unknown;try{value=JSON.parse(line);}catch{return;}
  if(!isRecord(value))return;
  if(value.method==='session/cancel'){for(const t of timers)clearTimeout(t);timers.clear();return;}
  if(value.method!=='session/prompt')return;
  const id=value.id;
  const parts=isRecord(value.params)&&Array.isArray(value.params.prompt)?value.params.prompt:[];
  const text=parts.map((p:unknown)=>isRecord(p)&&typeof p.text==='string'?p.text:'').join('');
  const m=/ARMY_R07_([A-Z]+)/.exec(text);
  if(!m||!text.includes('ARMY_HANG')||text.includes('ARMY_ERROR')||/ARMY_HOLD_/.test(text))return;
  const steps=scripts[m[1]??''];if(!steps)return;
  let at=0;
  for(const [delay,run] of steps){at+=delay;const t=setTimeout(()=>{timers.delete(t);run();},at);timers.add(t);}
  if(m[1]==='LIVETOOL')return; // stays running until Stop (session/cancel)
  const end=setTimeout(()=>{timers.delete(end);send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});},at+150);timers.add(end);
 });
}

// --- rc3-11-12 bridge client protocol lane (appended; does not change the handlers above) ---
// 1. ARMY_TOOLDETAIL: one completed execute tool call (callId army-detail-call, name armydetail) whose
//    output (about 12 KB) is larger than the bridge's 8 KB live preview, so the full output is only
//    reachable through the tool_detail request. The output opens with ARMY_DETAIL_HEAD and ends with
//    ARMY_DETAIL_TAIL. The handler above still streams ARMY_STREAM_BEGIN and the ARMY_REPLY.
// 2. ARMY_PERMISSION (send it with ARMY_HANG so the turn stays open): the agent asks the client
//    session/request_permission with two options (army-allow-once, army-reject-once). Whatever the
//    bridge answers is logged to <HOME>/army-permission.jsonl, echoed as
//    "ARMY_PERMISSION_OUTCOME: <outcome> <optionId>", and the turn ends.
{
 const home=process.env.HOME||'.';
 const waiting=new Map<string,unknown>();
 const textOf=(params:unknown)=>{const parts=isRecord(params)&&Array.isArray(params.prompt)?params.prompt:[];return parts.map((p:unknown)=>isRecord(p)&&typeof p.text==='string'?p.text:'').join('');};
 const toolUpdate=(update:Record<string,unknown>)=>send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update}});
 createInterface({input:process.stdin}).on('line',line=>{
  let value:unknown;try{value=JSON.parse(line);}catch{return;}
  if(!isRecord(value))return;
  if(value.method===undefined&&typeof value.id==='string'&&waiting.has(value.id)){
   const promptId=waiting.get(value.id);waiting.delete(value.id);
   const outcome=isRecord(value.result)&&isRecord(value.result.outcome)?value.result.outcome:{};
   const kind=typeof outcome.outcome==='string'?outcome.outcome:'none';
   const optionId=typeof outcome.optionId==='string'?outcome.optionId:'';
   try{appendFileSync(join(home,'army-permission.jsonl'),JSON.stringify({at:Date.now(),outcome:kind,optionId:optionId||null,error:value.error===undefined?null:value.error})+'\n');}catch{/* evidence only */}
   update(`ARMY_PERMISSION_OUTCOME: ${kind} ${optionId||'none'}`);
   send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}});
   return;
  }
  if(value.method!=='session/prompt')return;
  const text=textOf(value.params);
  if(text.includes('ARMY_TOOLDETAIL')){
   const lines=Array.from({length:140},(_,i)=>`ARMY_DETAIL_LINE ${String(i).padStart(3,'0')} the fixture tool printed this deterministic line of output text`);
   const output=['ARMY_DETAIL_HEAD',...lines,'ARMY_DETAIL_TAIL'].join('\n');
   toolUpdate({sessionUpdate:'tool_call',toolCallId:'army-detail-call',title:'armydetail: print fixture log',kind:'execute',status:'in_progress',rawInput:{command:'army-detail'}});
   toolUpdate({sessionUpdate:'tool_call_update',toolCallId:'army-detail-call',status:'completed',rawOutput:output});
  }
  if(text.includes('ARMY_PERMISSION')&&text.includes('ARMY_HANG')){
   const requestId='army-perm-'+Date.now().toString(36);
   waiting.set(requestId,value.id);
   send({jsonrpc:'2.0',id:requestId,method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'army-perm-call',title:'armyperm: write ARMY_PERMISSION_FILE',kind:'edit',status:'pending'},options:[{optionId:'army-allow-once',name:'Allow once',kind:'allow_once'},{optionId:'army-reject-once',name:'Reject',kind:'reject_once'}]}});
  }
 });
}
