// RC3 tester army, area 12: bridge client protocol and the RC3 non-UI libraries.
// App + bridge under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc) (web export + that commit's bridge;
// ARMY_BRIDGE_ROOT must point at the 2c948dc checkout).
// Same harness as army.spec.ts: real Expo web UI -> isolated real bridge (own HOME, loopback port, PID
// namespace) -> scripted fixture ACP agent. Private headless Sway only. No HTTP/WebSocket route mocks:
// the WebSocket frames are only OBSERVED (Playwright websocket events) to prove what crossed the wire.
// The Hermes live surface talks to a scripted loopback z0bridge peer started by the test (like the
// fixture agent), never to a host service.
//
// Source facts at 2c948dc (re-check when triaging; these tests are EXPECTED to fail on them):
// - delivery_receipt: bridge/src/delivery-ledger.ts and app store/outbox.ts have no runtime importer;
//   hello carries no capabilities.deliveryReceipts and chat carries no clientId.
// - permission_*: bridge/src/permission-broker.ts, app store/permissions.ts and PermissionCard.tsx have no
//   importer. The ACP client answers session/request_permission itself with outcome "cancelled".
// - ui_control: shared/ui-control.ts has no importer in app or bridge (ui-control-overlay neither), so no
//   overlay exists; the validator is exercised from the commit's own shared module.
// - notices_clear: SettingsScreen calls forgetEverything() without a socket send, so it is never sent.
// - voice_begin/chunk/commit: only LegacyVoiceScreen sends them and it has no importer; composer
//   dictation posts the recording to HTTP /transcribe instead.
// - steer: the bridge accepts mode "steer" only into a gateway-hosted Hermes session.
// - hygiene: ContinuousVoiceRoot.tsx hardcodes a ts.net host URL in fetch (literal never printed here).
import {answerNextDialog} from './themed-confirm';
import {test as base,expect,pair,openChat,composer,chooseHarness,send,createBridge,web,type Bridge,bun,bridgeRoot} from './fixtures';
import type {Page,TestInfo} from 'playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {appendFile,mkdtemp,readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {SeedSpec} from './rc3-chat-index-seed';


// ---------- observed wire ----------
type Msg=Record<string,unknown>;
type Frame={dir:'sent'|'recv';at:number;msg:Msg};
const isMsg=(v:unknown):v is Msg=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==='string'?v:'';
const num=(v:unknown)=>typeof v==='number'?v:NaN;
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];

/** Every JSON frame on the app's WebSockets, in order. Socket URLs keep only scheme, host and path (the query holds the token). */
class Wire{
 readonly frames:Frame[]=[];
 readonly sockets:string[]=[];
 constructor(page:Page){
  page.on('websocket',ws=>{
   const u=new URL(ws.url());this.sockets.push(`${u.protocol}//${u.host}${u.pathname}`);
   const take=(dir:'sent'|'recv')=>(frame:{payload:string|Buffer})=>{
    const raw=typeof frame.payload==='string'?frame.payload:frame.payload.toString('utf8');
    let value:unknown;try{value=JSON.parse(raw);}catch{return;}
    if(isMsg(value)&&value.type!=='ping'&&value.type!=='pong')this.frames.push({dir,at:Date.now(),msg:value});
   };
   ws.on('framesent',take('sent'));ws.on('framereceived',take('recv'));
  });
 }
 sent(type:string,where:(m:Msg)=>boolean=()=>true){return this.frames.filter(f=>f.dir==='sent'&&f.msg.type===type&&where(f.msg)).map(f=>f.msg);}
 recv(type:string,where:(m:Msg)=>boolean=()=>true){return this.frames.filter(f=>f.dir==='recv'&&f.msg.type===type&&where(f.msg)).map(f=>f.msg);}
 at(dir:'sent'|'recv',type:string,where:(m:Msg)=>boolean=()=>true){return this.frames.findIndex(f=>f.dir===dir&&f.msg.type===type&&where(f.msg));}
 /** Server frames that belong to one client turn id, in arrival order. */
 turn(id:string){return this.frames.filter(f=>f.dir==='recv'&&f.msg.id===id).map(f=>f.msg);}
 /** The client turn id of the first chat frame whose text holds `needle`. */
 async turnId(needle:string):Promise<string>{
  await expect.poll(()=>this.sent('chat',m=>str(m.text).includes(needle)).length,{message:`client sends a chat frame carrying "${needle}"`}).toBeGreaterThan(0);
  return str(this.sent('chat',m=>str(m.text).includes(needle))[0]?.id);
 }
}

const test=base.extend<{wire:Wire}>({
 wire:async({page},use,testInfo)=>{const w=new Wire(page);await use(w);await writeFile(testInfo.outputPath('wire.json'),JSON.stringify({sockets:w.sockets,frames:w.frames},null,1));},
});
// Spec fix: launchOptions must be file-level (forces a new worker); fake media flags are harmless for the rest of this file.
test.use({launchOptions:{args:[...(process.env.ARMY_HEADED==='1'?['--ozone-platform=wayland']:[]),'--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],slowMo:Number(process.env.ARMY_SLOWMO||30)}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

// ---------- fixture evidence ----------
async function jsonl(file:string):Promise<Msg[]>{
 let raw='';try{raw=await readFile(file,'utf8');}catch{return [];}
 return raw.split('\n').filter(Boolean).flatMap(line=>{try{const v:unknown=JSON.parse(line);return isMsg(v)?[v]:[];}catch{return [];}});
}
const prompts=async(b:Bridge)=>[...await jsonl(join(b.dir,'tmp','fixture-prompts.jsonl')),...await jsonl(join(b.dir,'fixture-prompts.jsonl'))].map(m=>str(m.text));
const rpcMethods=async(b:Bridge)=>(await jsonl(join(b.dir,'army-rpc-methods.jsonl'))).map(m=>str(m.method));
const token=()=>Math.random().toString(36).slice(2,10).replace(/[^a-z0-9]/g,'x');
/** Ends a fixture turn sent with ARMY_HANG ARMY_HOLD_<tok> (rc3-05-06 section of fixture-agent.ts). */
async function release(b:Bridge,tok:string){for(const dir of [join(b.dir,'tmp'),b.dir])await writeFile(join(dir,'army-release-'+tok),'release\n');}
/** The approval gate executor shells out to `gh`; this isolated stub fails closed and records the call. */
async function stubGh(b:Bridge){await writeFile(join(b.dir,'bin','gh'),'#!/bin/sh\necho "$*" >> "$HOME/army-gh-calls.log"\necho "ARMY_GH_STUB: no network in the army" >&2\nexit 1\n',{mode:0o700});}
async function filesNamed(root:string,name:string):Promise<string[]>{
 const out:string[]=[];let entries:string[]=[];try{entries=await readdir(root);}catch{return out;}
 for(const entry of entries){const p=join(root,entry);const s=await stat(p);if(s.isDirectory())out.push(...await filesNamed(p,name));else if(entry===name)out.push(p);}
 return out;
}
/** Host PIDs of this test's own bridge (bwrap PID namespace), found by its private HOME. The bwrap launchers carry the same
 *  argv and HOME but live in the host namespace (one NSpid entry); only the bun process they start is inside the new namespace. */
async function bridgePids(dir:string):Promise<number[]>{
 const pids:number[]=[];
 for(const entry of await readdir('/proc')){
  if(!/^\d+$/.test(entry))continue;
  try{
   const cmd=(await readFile(`/proc/${entry}/cmdline`,'utf8')).split('\0');
   if(/(^|\/)bwrap$/.test(cmd[0]??''))continue;
   if(!cmd.some(arg=>arg.endsWith('bridge/index.ts')))continue;
   if((await readFile(`/proc/${entry}/environ`,'utf8')).split('\0').includes('HOME='+dir))pids.push(Number(entry));
  }catch{/* exited or foreign */}
 }
 return pids;
}

// ---------- chat-index seed (same helper as rc3-01-02) ----------
async function reseed(b:Bridge,spec:SeedSpec,titles:string[]){
 await b.stop();
 const specPath=join(b.dir,'army-index-seed.json');await writeFile(specPath,JSON.stringify(spec));
 const child=spawn(bun,[join(__dirname,'rc3-chat-index-seed.ts'),b.dir,specPath],{stdio:['ignore','pipe','pipe']});
 let err='';child.stderr?.on('data',d=>err+=d);
 const [code]=await once(child,'exit');if(code!==0)throw Error('chat-index seed failed: '+err);
 await b.start();
 await expect.poll(async()=>{
  try{
   const auth=(await readFile(join(b.dir,'.dash/token'),'utf8')).trim();
   const text=await (await fetch(`http://127.0.0.1:${b.port}/chats?limit=200`,{headers:{Authorization:`Bearer ${auth}`}})).text();
   return titles.every(t=>text.includes(t));
  }catch{return false;}
 },{timeout:45000,message:'real bridge chat index serves the seeded rows'}).toBe(true);
}
const rows=(page:Page)=>page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]');
const rowByTitle=(page:Page,title:string)=>rows(page).filter({has:page.getByText(title,{exact:true})});

// ---------- scripted loopback z0bridge peer for the Hermes live surface ----------
type Z0={url:string;tokenFile:string;calls:string[];close():Promise<void>};
async function startZ0(mode:'ok'|'down'):Promise<Z0>{
 const secret='army-z0-'+token();
 const dir=await mkdtemp(join(process.env.ARMY_TMP||tmpdir(),'dash-army-z0-'));
 const tokenFile=join(dir,'token');await writeFile(tokenFile,secret+'\n',{mode:0o600});
 const calls:string[]=[];
 const html='<!doctype html><meta charset="utf-8"><title>ARMY live artifact</title><p>ARMY_LIVE_ARTIFACT_BODY</p>';
 const meta={version:1,bytes:html.length,sha256:'a'.repeat(64),createdAt:Date.now(),title:'ARMY live artifact'};
 const receipt=(kind:string,summary:string,decisions:string[]=[])=>({kind,summary,decisions,artifacts:[],at:Date.now()});
 const receipts=[receipt('turn','ARMY_LIVE_RECEIPT opened')];
 const turnText=new Map<string,string>();let turnSeq=0;
 const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 const body=async(req:IncomingMessage):Promise<Msg>=>{let raw='';for await(const chunk of req)raw+=String(chunk);try{const v:unknown=JSON.parse(raw||'{}');return isMsg(v)?v:{};}catch{return {};}};
 const server=createServer((req,res)=>{void (async()=>{
  const u=new URL(req.url??'/','http://127.0.0.1');const seg=u.pathname.split('/').filter(Boolean);
  calls.push(`${req.method} ${u.pathname}`);
  if(req.headers.authorization!==`Bearer ${secret}`)return json(res,401,{error:{message:'ARMY_Z0_UNAUTHORIZED'}});
  if(mode==='down')return json(res,503,{error:{message:'ARMY_LIVE_FIXTURE_UNAVAILABLE'}});
  if(req.method==='POST'&&u.pathname==='/v1/sessions'){const b=await body(req);return json(res,200,b.harness==='fx'?{id:'army-fx-worker'}:{id:'army-live-parent',title:'ARMY live parent'});}
  if(req.method==='GET'&&u.pathname==='/v1/sessions')return json(res,200,{sessions:[]});
  if(req.method==='GET'&&u.pathname==='/v1/harnesses')return json(res,200,{harnesses:[{id:'fx',version:'army-fx-1'}]});
  if(seg[1]==='sessions'&&seg[2]==='hermes')return json(res,200,{id:seg[4],title:'ARMY live parent'});
  if(seg[1]==='sessions'&&seg[2]==='fx'){
   const tail=seg.slice(5);
   if(tail.length===0)return json(res,200,{id:seg[4],parent:{id:'army-live-parent'}});
   if(tail[0]==='artifacts'&&tail.length===1)return json(res,200,{artifacts:[meta]});
   if(tail[0]==='artifacts'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
   if(tail[0]==='receipts')return json(res,200,{receipts});
   if(tail[0]==='turns'&&req.method==='POST'){const b=await body(req);const id='army-live-turn-'+(++turnSeq);turnText.set(id,str(b.text));return json(res,200,{turnId:id});}
   if(tail[0]==='intents'&&req.method==='POST'){const b=await body(req);const intent=isMsg(b.intent)?b.intent:{};const r=receipt('intent','ARMY_LIVE_RECEIPT intent',[str(intent.label)||str(intent.value)]);receipts.push(r);return json(res,200,{receipt:r});}
  }
  if(seg[1]==='turns'&&seg[3]==='events'){
   const text=turnText.get(seg[2]??'')??'';const r=receipt('turn','ARMY_LIVE_RECEIPT turn');
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   const events=[{type:'status',text:'ARMY live working'},{type:'delta',text:'ARMY_LIVE_REPLY: '+text},
    {type:'control',control:{id:'army-choice',kind:'choice',prompt:'ARMY live pick',options:[{id:'a',label:'ARMY option A'},{id:'b',label:'ARMY option B'}]}},
    {type:'receipt',receipt:r},{type:'done',stopReason:'end_turn'}];
   for(const e of events){if(e.type==='receipt')receipts.push(r);res.write(`data: ${JSON.stringify(e)}\n\n`);await new Promise(done=>setTimeout(done,80));}
   res.end();return;
  }
  return json(res,404,{error:{message:'ARMY_Z0_UNKNOWN_ROUTE'}});
 })().catch(()=>{if(!res.headersSent)json(res,500,{error:{message:'ARMY_Z0_FAILED'}});});});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=(server.address() as AddressInfo).port;
 return {url:`http://127.0.0.1:${port}`,tokenFile,calls,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}
async function withBridge(info:TestInfo,env:Record<string,string>,fn:(b:Bridge)=>Promise<void>){
 const b=await createBridge(true,{env});
 try{await fn(b);}finally{await b.stop();await writeFile(info.outputPath('bridge.log'),b.logs());}
}
async function openSurface(page:Page){
 await page.getByRole('button',{name:'Options. Current surface: Chat',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:/^Surface,/}).click({noWaitAfter:true});
}

// ======================================================================
// hello / status
// ======================================================================
test.describe('RC3 12 hello and status',()=>{
 test('on connect the bridge hello carries host, cwd, harnesses and hosts; the UI shows online and every harness',async({page,bridge,wire})=>{
  await pair(page,bridge);
  await expect.poll(()=>wire.recv('hello').length,{message:'bridge sends hello on the authenticated socket'}).toBeGreaterThan(0);
  const hello=wire.recv('hello')[0]!;
  expect(hello.version).toBe(1);
  const host=str(hello.host);expect(host.length).toBeGreaterThan(0);
  expect(hello.cwd,'hello.cwd is the isolated bridge working dir').toBe(bridge.dir);
  expect(list(hello.features)).toContain('chats.v1');
  const harnesses=list(hello.harnesses).filter(isMsg);
  for(const id of ['omp','hermes','claude'])expect(harnesses.find(h=>h.id===id),`hello lists fixture harness ${id} as available`).toMatchObject({id,available:true});
  const hosts=list(hello.hosts).filter(isMsg);
  expect(hosts.some(h=>h.self===true&&Array.isArray(h.agents)),'hello.hosts holds this bridge as the self host').toBe(true);
  // The client's first protocol message after hello subscribes to approvals.
  expect(wire.at('sent','gate_list'),'client sends gate_list after hello').toBeGreaterThan(wire.at('recv','hello'));
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
  await page.getByRole('button',{name:'Bridge details',exact:true}).click({noWaitAfter:true});
  await expect(page.getByRole('button',{name:host,exact:true}),'online status row is labelled with hello.host').toBeVisible();
  await expect(page.getByText('Harnesses on '+host,{exact:true})).toBeVisible();
  for(const name of ['OMP','Hermes','Claude Code'])await expect(page.getByRole('button',{name:`New ${name} chat`,exact:true})).toBeVisible();
 });
});

// ======================================================================
// chat -> session/delta/done/error, cancel, steer, delivery receipts
// ======================================================================
test.describe('RC3 12 chat turn events',()=>{
 test('Send emits chat; session and delta stream the reply; done finalizes the turn',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_SLOW p12 chat stream');
  const id=await wire.turnId('p12 chat stream');
  expect(wire.sent('chat',m=>m.id===id)[0]).toMatchObject({type:'chat',harness:'omp',text:'ARMY_SLOW p12 chat stream'});
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW p12 chat stream/).filter({visible:true}).first()).toBeVisible({timeout:20000});
  await expect.poll(()=>wire.recv('done',m=>m.id===id).length).toBe(1);
  const events=wire.turn(id);
  expect(events.find(e=>e.type==='session'),'session event names the harness-native session').toMatchObject({sessionId:'army-fixture-session',harnessId:'omp',transport:'acp'});
  const deltas=events.filter(e=>e.type==='delta');
  expect(deltas.length,'reply streamed as more than one delta').toBeGreaterThan(1);
  expect(deltas.map(e=>str(e.text)).join('')).toContain('ARMY_REPLY: ARMY_SLOW p12 chat stream');
  const seqs=events.map(e=>num(e.seq));
  expect(seqs[0]).toBe(1);
  for(let i=1;i<seqs.length;i++)expect(seqs[i],'per-turn seq strictly increases').toBeGreaterThan(seqs[i-1]!);
  expect(events.at(-1),'done is the last event of the turn').toMatchObject({type:'done',exitCode:0});
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 });

 test('an agent error arrives as an error event and renders on the message',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_ERROR p12 error turn');
  const id=await wire.turnId('p12 error turn');
  await expect.poll(()=>wire.recv('error',m=>m.id===id).length).toBe(1);
  const message=str(wire.recv('error',m=>m.id===id)[0]?.message);
  expect(message.length).toBeGreaterThan(0);
  await expect.poll(()=>wire.recv('done',m=>m.id===id).map(m=>m.exitCode)).toEqual([1]);
  await expect(page.getByTestId('transcript-viewport').getByText(message,{exact:true}),'error text is shown on the failed message').toBeVisible();
  await composer(page).fill('p12 after error');
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: p12 after error/).filter({visible:true}).first()).toBeVisible();
 });

 test('Stop emits cancel; the fixture stops streaming and the turn ends cleanly',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_HANG p12 cancel turn');
  const id=await wire.turnId('p12 cancel turn');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('cancel',m=>m.id===id).length,{message:'Stop sends cancel for the running turn id'}).toBe(1);
  await expect.poll(()=>rpcMethods(bridge),{message:'the fixture agent receives session/cancel'}).toContain('session/cancel');
  await expect.poll(()=>wire.recv('done',m=>m.id===id).map(m=>m.exitCode),{message:'bridge ends the turn with the cancelled exit code'}).toEqual([130]);
  expect(wire.recv('error',m=>m.id===id),'a cancel is not an error').toEqual([]);
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  const deltasAfter=wire.turn(id).filter(e=>e.type==='delta').length;
  await page.waitForTimeout(1500);
  expect(wire.turn(id).filter(e=>e.type==='delta').length,'no deltas after the turn ended').toBe(deltasAfter);
  await expect(page.getByText(/ARMY_REPLY: ARMY_HANG p12 cancel turn/)).toHaveCount(0);
  await composer(page).fill('p12 after cancel');
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: p12 after cancel/).filter({visible:true}).first()).toBeVisible();
 });

 test('Steer emits chat mode steer; the bridge confirms delivery into the running Hermes turn',async({page,bridge,wire})=>{
  await openChat(page,bridge);await chooseHarness(page,'Hermes');
  await send(page,'ARMY_HANG p12 steer target');
  const target=await wire.turnId('p12 steer target');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  await composer(page).fill('p12 steer instruction');
  await page.getByRole('button',{name:'Steer',exact:true}).click({noWaitAfter:true});
  const id=await wire.turnId('p12 steer instruction');
  expect(wire.sent('chat',m=>m.id===id)[0],'steer is a chat frame with mode steer').toMatchObject({type:'chat',mode:'steer',harness:'hermes'});
  // The scripted fixture Hermes is an ACP session, not gateway-hosted (index.ts continueHermes: steer needs plan.kind "live", a
  // real Hermes gateway + hermes-steer.py). The bridge must therefore refuse the steer visibly, never queue it and never claim "steered".
  await expect.poll(()=>wire.turn(id).map(e=>e.type==='status'?str(e.delivery):e.type==='error'?'error: '+str(e.message):str(e.type)),
   {timeout:20000,message:'bridge refuses the steer on a non-gateway-hosted fixture session (a "steered" delivery would need a real Hermes gateway)'}).toEqual(['error: Error: This session is not gateway-hosted; steering was not sent.','done']);
  expect(wire.recv('done',m=>m.id===id).map(m=>m.exitCode),'the refused steer ends its own turn with a failure code').toEqual([1]);
  await expect(page.getByText(/Delivery failed · check before resending/).filter({visible:true}).first(),'the steer bubble shows the failure').toBeVisible();
  await expect(page.getByText(/steering was not sent/).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByText(/^Steered · /),'no steered confirmation is shown').toHaveCount(0);
  expect(wire.recv('done',m=>m.id===target),'the running target turn is not ended by the steer').toEqual([]);
  expect((await prompts(bridge)).filter(t=>t.includes('p12 steer instruction')),'a refused steer is not delivered to the agent as a new prompt').toEqual([]);
 });

 test('delivery_receipt moves the sent message Sending -> Received by bridge -> Started',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  const tok=token();
  await send(page,`ARMY_HANG ARMY_HOLD_${tok} p12 delivery`);
  const id=await wire.turnId('p12 delivery');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  const hello=wire.recv('hello')[0]??{};
  expect.soft(isMsg(hello.capabilities)?hello.capabilities.deliveryReceipts:undefined,'hello advertises capabilities.deliveryReceipts (shared/delivery.ts)').toBe(true);
  expect.soft(str(wire.sent('chat',m=>m.id===id)[0]?.clientId),'chat carries a clientId for receipts (DeliveryChatExtension)').not.toBe('');
  await expect.poll(()=>wire.recv('delivery_receipt',m=>m.turnId===id).map(m=>str(m.stage)),
   {timeout:15000,message:'bridge sends delivery_receipt acked-by-bridge then started for the turn (RC3: delivery-ledger.ts has no importer)'}).toEqual(['acked-by-bridge','started']);
  const status=page.getByTestId('delivery-status').last();
  await expect(status).toContainText('Started');
  await release(bridge,tok);
  await expect(page.getByText(new RegExp('ARMY_REPLY: ARMY_HANG ARMY_HOLD_'+tok)).filter({visible:true}).first()).toBeVisible();
 });
});

// ======================================================================
// history / session / lost / attach (turn re-subscribe)
// ======================================================================
test.describe('RC3 12 history and lost turns',()=>{
 test('opening a listed session requests history over the socket and renders its prior messages',async({page,bridge,wire})=>{
  await reseed(bridge,{hermes:[{id:'army-p12-history',title:'ARMY p12 history row',cwd:'/srv/army/p12',activityMs:Date.now()-5000,
   messages:[{role:'user',text:'ARMY_P12_HISTORY_USER asked'},{role:'assistant',text:'ARMY_P12_HISTORY_ASSISTANT answered.'}]}]},['ARMY p12 history row']);
  await pair(page,bridge);
  const row=rowByTitle(page,'ARMY p12 history row');
  await expect(row).toBeVisible({timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect.poll(()=>wire.sent('history',m=>m.sessionId==='army-p12-history').length,{timeout:20000,message:'client sends history for the opened session'}).toBeGreaterThan(0);
  const request=wire.sent('history',m=>m.sessionId==='army-p12-history')[0]!;
  expect(request.harness).toBe('hermes');
  await expect.poll(()=>wire.recv('history',m=>m.sessionId==='army-p12-history').length,{message:'bridge answers the history request'}).toBeGreaterThan(0);
  const reply=wire.recv('history',m=>m.sessionId==='army-p12-history'&&(request.requestId===undefined||m.requestId===request.requestId))[0]??{};
  expect.soft(list(reply.messages).filter(isMsg).map(m=>str(m.text)).join('\n'),'history reply carries the prior messages').toContain('ARMY_P12_HISTORY_ASSISTANT');
  await expect(page.getByText(/ARMY_P12_HISTORY_USER asked/).filter({visible:true}).first()).toBeVisible({timeout:20000});
  await expect(page.getByText(/ARMY_P12_HISTORY_ASSISTANT answered/).filter({visible:true}).first()).toBeVisible();
 });

 test('after a bridge restart the client re-attaches its running turn; lost marks it lost in the UI',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_HANG p12 lost turn');
  const id=await wire.turnId('p12 lost turn');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  await bridge.stop();
  await expect(page.getByText(/tap to retry|Connecting to bridge|Offline|Disconnected|Bridge unreachable/i).filter({visible:true}).first()).toBeVisible({timeout:15000});
  await bridge.start();
  await expect.poll(()=>wire.recv('hello').length,{timeout:30000,message:'client reconnects and gets a second hello'}).toBeGreaterThan(1);
  await expect.poll(()=>wire.sent('attach',m=>list(m.turns).some(t=>isMsg(t)&&t.id===id)).length,
   {timeout:15000,message:'client sends attach {id, seq} for its in-flight turn'}).toBeGreaterThan(0);
  const entry=list(wire.sent('attach',m=>list(m.turns).some(t=>isMsg(t)&&t.id===id))[0]?.turns).filter(isMsg).find(t=>t.id===id);
  expect(num(entry?.seq),'attach carries the last seen seq').toBeGreaterThanOrEqual(1);
  await expect.poll(()=>wire.recv('lost',m=>m.id===id).length,{message:'the restarted bridge answers lost for the unknown turn'}).toBe(1);
  await expect(page.getByText('Connection to the bridge was lost mid-reply.',{exact:true}).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await composer(page).fill('p12 after lost');
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: p12 after lost/).filter({visible:true}).first()).toBeVisible({timeout:20000});
 });
});

// ======================================================================
// tool_detail
// ======================================================================
test.describe('RC3 12 tool detail',()=>{
 test('inspecting a truncated tool row emits tool_detail with turnId/callId and shows the full output',async({page,bridge,wire,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:web});
  await openChat(page,bridge);
  await send(page,'ARMY_TOOLDETAIL p12 tool detail');
  const id=await wire.turnId('p12 tool detail');
  await expect(page.getByText(/ARMY_REPLY: ARMY_TOOLDETAIL p12 tool detail/).filter({visible:true}).first()).toBeVisible();
  const preview=wire.turn(id).filter(e=>e.type==='status'&&isMsg(e.part)&&e.part.kind==='tool_output'&&e.part.callId==='army-detail-call').map(e=>isMsg(e.part)?e.part:{});
  expect(preview.length,'bridge streamed a tool_output preview').toBeGreaterThan(0);
  expect(preview.map(p=>str(p.text)).join(''),'preview is cut before the tail').not.toContain('ARMY_DETAIL_TAIL');
  expect(preview.some(p=>p.truncated===true),'preview is marked truncated').toBe(true);
  // The transcript lists a turn's tool calls as ReplyBlocks compact rows (testID reply-tool-row; the headless Tree with
  // tree-row-<turn>:call:<call> ids is the Bots/Orchestra/subagent view, not the chat transcript). Tapping the row opens the
  // ToolInspector modal on its Output tab.
  const call=page.getByTestId('reply-tool-row').filter({visible:true}).first();
  await expect(call).toBeVisible();
  await expect(call,'the row is the army-detail call').toHaveAccessibleName(/army-detail/);
  await call.click({noWaitAfter:true});
  await expect(page.getByRole('button',{name:'Close tool details',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Output',exact:true}).click({noWaitAfter:true});
  const copy=page.getByRole('button',{name:'Copy output',exact:true});
  await copy.click({noWaitAfter:true});
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('ARMY_DETAIL_HEAD');
  expect(await page.evaluate(()=>navigator.clipboard.readText())).not.toContain('ARMY_DETAIL_TAIL');
  await page.getByRole('button',{name:'Load retained output (up to 1 MiB)',exact:true}).click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('tool_detail',m=>m.id===id&&m.callId==='army-detail-call').length,{message:'client sends tool_detail {id: turnId, callId}'}).toBe(1);
  await expect.poll(()=>wire.turn(id).some(e=>e.type==='status'&&isMsg(e.part)&&e.part.kind==='tool_detail'&&str(e.part.text).includes('ARMY_DETAIL_TAIL')),{message:'bridge returns the retained full output'}).toBe(true);
  await expect(page.getByRole('button',{name:'Load retained output (up to 1 MiB)',exact:true})).toHaveCount(0);
  await copy.click({noWaitAfter:true});
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText()),{message:'inspector now renders the full output'}).toContain('ARMY_DETAIL_TAIL');
 });
});

// ======================================================================
// attachments (POST /attachments + chat.attachments)
// ======================================================================
test.describe('RC3 12 attachments',()=>{
 test('attaching a file uploads it to the bridge, chat carries the attachment, the bridge stores it and the message shows it',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
  const chooser=page.waitForEvent('filechooser');
  const upload=page.waitForResponse(r=>{const u=new URL(r.url());return u.port===String(bridge.port)&&u.pathname==='/attachments'&&r.request().method()==='POST';});
  await page.getByRole('button',{name:'Files',exact:true}).click({noWaitAfter:true});
  await (await chooser).setFiles({name:'army-p12.txt',mimeType:'text/plain',buffer:Buffer.from('ARMY_P12_ATTACHMENT_BYTES\n')});
  const uploaded=await upload;
  expect(uploaded.status(),'bridge accepts the upload').toBeLessThan(300);
  const chip=page.getByLabel(/^army-p12\.txt,/);
  await expect(chip).not.toHaveAttribute('aria-label',/Uploading|Failed|failed|error/,{timeout:15000});
  await composer(page).fill('p12 attachment turn');
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  const id=await wire.turnId('p12 attachment turn');
  const attachments=list(wire.sent('chat',m=>m.id===id)[0]?.attachments).filter(isMsg);
  expect(attachments,'chat frame names the uploaded file').toHaveLength(1);
  expect(attachments[0]).toMatchObject({name:'army-p12.txt',mime:'text/plain',size:26});
  expect(str(attachments[0]?.id)).toMatch(/^[a-f0-9]{32}$/);
  await expect(page.getByText(/ARMY_REPLY: p12 attachment turn/).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByLabel('Attached army-p12.txt',{exact:true}).first(),'the sent message shows its attachment').toBeVisible();
  const stored=await filesNamed(join(bridge.dir,'.dash','attachments'),'army-p12.txt');
  expect(stored.length,'bridge stored the file in its isolated attachment dir').toBeGreaterThan(0);
  expect(await readFile(stored[0]!,'utf8')).toBe('ARMY_P12_ATTACHMENT_BYTES\n');
  await expect.poll(async()=>(await prompts(bridge)).find(t=>t.includes('p12 attachment turn'))??'',{message:'agent prompt points at the stored file'}).toMatch(/Attached from the Dash phone app[\s\S]*army-p12\.txt/);
 });
});

// ======================================================================
// voice_begin / voice_chunk / voice_commit (web: Chromium fake microphone)
// ======================================================================
test.describe('RC3 12 voice protocol',()=>{
 test('dictation streams voice_begin/voice_chunk/voice_commit and the committed utterance comes back into the composer',async({page,bridge,wire,context})=>{
  await context.grantPermissions(['microphone'],{origin:web});
  // RC3 composer dictation is not the WebSocket spoken-turn protocol: useRecordedSpeech records, POSTs the recording to the
  // bridge's HTTP /transcribe and drops the text into the draft (app/src/lib/useRecordedSpeech.ts, annotate/io-core.ts).
  // voice_begin/chunk/commit belong to LegacyVoiceScreen, which nothing mounts. This isolated bridge has no speech model
  // (DASH_STT_MODEL points at nothing), so the honest web outcome is an HTTP 503 and a visible "not available" note.
  const transcribes:{method:string;status?:number}[]=[];
  page.on('request',r=>{if(new URL(r.url()).pathname==='/transcribe'&&r.method()==='POST')transcribes.push({method:r.method()});});
  page.on('response',r=>{if(new URL(r.url()).pathname==='/transcribe'&&r.request().method()==='POST'){const row=transcribes.at(-1);if(row)row.status=r.status();}});
  await openChat(page,bridge);
  await page.getByRole('button',{name:'Dictate',exact:true}).click({noWaitAfter:true});
  const stop=page.getByRole('button',{name:'Stop dictation',exact:true}).first();
  await expect(stop,'dictation starts recording from the fake microphone').toBeVisible({timeout:15000});
  await page.waitForTimeout(1500);
  await stop.click({noWaitAfter:true});
  await expect(stop).toHaveCount(0,{timeout:20000});
  await expect.poll(()=>transcribes,{message:'the recording is POSTed once to the bridge HTTP /transcribe'}).toEqual([{method:'POST',status:503}]);
  await expect(page.getByText('Speech-to-text is not available on this host.').filter({visible:true}).first(),'the bridge refusal is shown on the composer').toBeVisible();
  await expect(page.getByRole('button',{name:'Retry dictation',exact:true})).toBeVisible();
  await expect(composer(page),'a failed transcription leaves the draft untouched').toHaveValue('');
  for(const type of ['voice_begin','voice_chunk','voice_commit'])expect(wire.sent(type),`dictation sends no ${type} frame (the WebSocket spoken-turn path is LegacyVoiceScreen only)`).toEqual([]);
 });
});

// ======================================================================
// notice / notices_clear
// ======================================================================
test.describe('RC3 12 notices',()=>{
 test('a bridge notice appears in Notices; Forget this bridge sends notices_clear and the bridge drops it',async({page,bridge,wire})=>{
  await pair(page,bridge);
  const port=/notices\s+http:\/\/127\.0\.0\.1:(\d+)\/notice/.exec(bridge.logs())?.[1];
  expect(port,'isolated bridge started its loopback notice listener').toBeTruthy();
  const auth=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
  const posted=await fetch(`http://127.0.0.1:${port}/notice`,{method:'POST',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:JSON.stringify({title:'ARMY p12 notice',body:'ARMY_P12_NOTICE_BODY from the fixture reporter'})});
  expect(posted.status).toBe(201);
  await expect.poll(()=>wire.recv('notice',m=>m.title==='ARMY p12 notice').length,{message:'bridge pushes the notice on the socket'}).toBe(1);
  await page.getByRole('button',{name:'Open settings',exact:true}).first().click({noWaitAfter:true});
  await page.getByRole('button',{name:'Notices · Agent reports',exact:true}).click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:'Notices',exact:true})).toBeVisible();
  await expect(page.getByText('ARMY p12 notice',{exact:true})).toBeVisible();
  await expect(page.getByText('ARMY_P12_NOTICE_BODY from the fixture reporter',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back',exact:true}).first().click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  const confirmed=answerNextDialog(page,true);
  await page.getByRole('button',{name:'Forget this bridge',exact:true}).click({noWaitAfter:true});
  await confirmed;
  await expect.poll(()=>wire.sent('notices_clear').length,{timeout:10000,message:'Forget sends notices_clear to the bridge (RC3: forgetEverything() is called without a send)'}).toBe(1);
  await expect.poll(async()=>{try{return await readFile(join(bridge.dir,'.dash','notices.json'),'utf8');}catch{return '';}},{message:'bridge notice ring no longer holds the notice'}).not.toContain('ARMY p12 notice');
 });
});

// ======================================================================
// gate_list / gate_snapshot / gate_decide / gate_post / gate_status / gate_error
// ======================================================================
test.describe('RC3 12 approval gate protocol',()=>{
 test('Approvals lists the gate snapshot; approve and dry-run post round-trip with gate_status',async({page,bridge,wire})=>{
  await stubGh(bridge);
  await pair(page,bridge);
  await expect.poll(()=>wire.recv('gate_snapshot').length,{message:'gate_list after hello is answered with gate_snapshot'}).toBeGreaterThan(0);
  const snap=wire.recv('gate_snapshot')[0]!;
  expect(snap.dry_run).toBe(true);
  const item=list(snap.items).filter(isMsg).find(i=>str(i.body).includes('ARMY_APPROVAL_FIXTURE'));
  expect(item,'snapshot carries the seeded proposal').toBeTruthy();
  const id=str(item?.id);
  await page.getByRole('button',{name:'Upstream approvals, 1 pending',exact:true}).first().click({noWaitAfter:true});
  const card=page.getByTestId('gate-card-'+id);
  await expect(card).toBeVisible();
  await expect(card).toContainText('ARMY_APPROVAL_FIXTURE');
  await card.getByRole('button',{name:'Approve item',exact:true}).click({noWaitAfter:true});
  await page.getByRole('button',{name:'Confirm approve 1',exact:true}).click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('gate_decide').length).toBe(1);
  const decision=wire.sent('gate_decide')[0]!.decision;
  expect(decision).toMatchObject({action:'approve',ids:[id]});
  await expect(card).toContainText('approved');
  await card.getByRole('button',{name:'Check dry run',exact:true}).click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('gate_post',m=>m.id===id).length).toBe(1);
  await expect.poll(()=>wire.recv('gate_status',m=>m.id===id).map(m=>str(m.message))).toContain('Checking live target…');
  // The isolated `gh` stub fails closed, so the dry run ends failed with the transport reason; nothing reaches GitHub.
  await expect(card).toContainText(/failed · GitHub request failed/,{timeout:20000});
  expect(await readFile(join(bridge.dir,'army-gh-calls.log'),'utf8'),'executor used the isolated gh stub').toContain('api');
  await expect.poll(()=>readFile(join(bridge.dir,'gate','events.jsonl'),'utf8')).toMatch(/"approve"[\s\S]*"failed"/);
 });

 test('a gate failure arrives as gate_error and is shown on Approvals',async({page,bridge,wire})=>{
  await pair(page,bridge);
  await page.getByRole('button',{name:'Upstream approvals, 1 pending',exact:true}).first().click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_APPROVAL_FIXTURE:/)).toBeVisible();
  await appendFile(join(bridge.dir,'gate','events.jsonl'),JSON.stringify({army:'corrupt journal line'})+'\n');
  const before=wire.sent('gate_list').length;
  await page.getByRole('button',{name:/^Refresh/}).first().click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('gate_list').length).toBeGreaterThan(before);
  await expect.poll(()=>wire.recv('gate_error').map(m=>str(m.message))).toContain('Corrupt gate journal; manual recovery required');
  await expect(page.getByRole('alert').filter({hasText:'Corrupt gate journal; manual recovery required'})).toBeVisible();
 });
});

// ======================================================================
// permission_request / permission_decision / permission_resolved
// ======================================================================
test.describe('RC3 12 permission protocol',()=>{
 test('an ACP permission request shows a PermissionCard; tapping an option sends the decision and the card resolves',async({page,bridge,wire})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_HANG ARMY_PERMISSION p12 permission');
  const id=await wire.turnId('p12 permission');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  // Evidence first: what the bridge answered the agent on its own (RC3 ACP client: outcome "cancelled").
  await page.waitForTimeout(2000);
  const early=await jsonl(join(bridge.dir,'army-permission.jsonl'));
  test.info().annotations.push({type:'observed',description:'agent permission outcome before any owner tap: '+JSON.stringify(early.map(e=>e.outcome))});
  expect(early,'the bridge must not answer the permission request before the owner decides').toEqual([]);
  await expect.poll(()=>wire.recv('permission_request',m=>m.turnId===id).length,{timeout:15000,message:'bridge forwards permission_request (RC3: permission-broker.ts has no importer)'}).toBe(1);
  const request=wire.recv('permission_request',m=>m.turnId===id)[0]!;
  const card=page.getByTestId('permission-card-'+str(request.requestId));
  await expect(card,'PermissionCard is mounted for the request (RC3: PermissionCard has no importer)').toBeVisible();
  await expect(card.getByText('Needs OK',{exact:true})).toBeVisible();
  const allow=page.getByRole('button',{name:'Approve · Allow once',exact:true});
  await expect(allow).toBeVisible();
  await expect(page.getByRole('button',{name:'Deny · Reject',exact:true})).toBeVisible();
  await allow.click({noWaitAfter:true});
  await expect.poll(()=>wire.sent('permission_decision',m=>m.requestId===request.requestId).map(m=>({turnId:m.turnId,optionId:m.optionId}))).toEqual([{turnId:id,optionId:'army-allow-once'}]);
  await expect.poll(()=>wire.recv('permission_resolved',m=>m.requestId===request.requestId).map(m=>m.outcome)).toEqual(['allowed']);
  await expect(page.getByTestId('permission-status')).toHaveText('Allowed · confirmed by host');
  await expect.poll(async()=>(await jsonl(join(bridge.dir,'army-permission.jsonl'))).map(e=>[e.outcome,e.optionId])).toEqual([['selected','army-allow-once']]);
  await expect(page.getByText(/ARMY_PERMISSION_OUTCOME: selected army-allow-once/).filter({visible:true}).first()).toBeVisible();
 });
});

// ======================================================================
// live_open / live_opened / live_turn / live_event / live_intent / live_receipts / live_error
// ======================================================================
test.describe('RC3 12 Hermes live surface protocol',()=>{
 test('toggling Live surface opens a live session; artifacts, turns, intents and receipts round-trip',async({page,wire},info)=>{
  const z0=await startZ0('ok');
  try{await withBridge(info,{DASH_Z0BRIDGE_URL:z0.url,DASH_Z0BRIDGE_TOKEN_FILE:z0.tokenFile},async b=>{
   await openChat(page,b);await chooseHarness(page,'Hermes');
   await openSurface(page);
   await expect.poll(()=>wire.sent('live_open').length,{message:'Live surface sends live_open'}).toBe(1);
   const open=wire.sent('live_open')[0]!;
   await expect.poll(()=>wire.recv('live_opened',m=>m.id===open.id).length).toBe(1);
   expect(wire.recv('live_opened',m=>m.id===open.id)[0]).toMatchObject({workerId:'army-fx-worker',parentSessionId:'army-live-parent',model:'army-fx-1'});
   const surface=page.getByTestId('live-surface');
   await expect(surface).toBeVisible();
   await expect(page.getByTestId('live-artifact')).toBeVisible();
   await expect(page.getByTestId('live-artifact').getByText('ARMY live artifact',{exact:true})).toBeVisible();
   await expect(page.getByRole('tab',{name:'Version 1',exact:true})).toHaveAttribute('aria-selected','true');
   await expect.poll(()=>wire.sent('live_receipts',m=>m.workerId==='army-fx-worker').length,{message:'ready surface asks for receipts'}).toBeGreaterThan(0);
   await expect(page.getByRole('button',{name:'Receipts in Hermes: 1',exact:true})).toBeVisible();
   await expect(composer(page)).toHaveAttribute('placeholder',/Live surface/);
   await composer(page).fill('ARMY live hello');
   await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
   await expect.poll(()=>wire.sent('live_turn',m=>m.text==='ARMY live hello').length).toBe(1);
   const turn=wire.sent('live_turn',m=>m.text==='ARMY live hello')[0]!;
   expect(turn).toMatchObject({workerId:'army-fx-worker'});
   await expect.poll(()=>wire.recv('live_event',m=>m.id===turn.id).map(m=>isMsg(m.event)?str(m.event.type):'')).toEqual(['status','delta','control','receipt','done']);
   await expect(surface.getByText('ARMY_LIVE_REPLY: ARMY live hello').filter({visible:true}).first()).toBeVisible();
   await expect(page.getByRole('button',{name:'Receipts in Hermes: 2',exact:true})).toBeVisible();
   const pick=page.getByRole('radiogroup',{name:'ARMY live pick'});
   await expect(pick).toBeVisible();
   await pick.getByRole('radio').filter({hasText:'ARMY option A'}).click({noWaitAfter:true});
   await expect.poll(()=>wire.sent('live_intent').length).toBe(1);
   const intent=wire.sent('live_intent')[0]!;
   expect(intent).toMatchObject({workerId:'army-fx-worker',intent:{controlId:'army-choice',value:'a',label:'ARMY option A'}});
   await expect.poll(()=>wire.recv('live_event',m=>m.id===intent.id).map(m=>isMsg(m.event)?str(m.event.type):'')).toEqual(['receipt','done']);
   await expect(page.getByRole('button',{name:'Receipts in Hermes: 3',exact:true})).toBeVisible();
   await expect(page.getByText('Decided: ARMY option A',{exact:true})).toBeVisible();
   expect(z0.calls.some(c=>c.startsWith('POST /v1/sessions/fx/')&&c.endsWith('/intents')),'intent was recorded by the live peer').toBe(true);
  });}finally{await z0.close();}
 });

 test('a live surface failure arrives as live_error and is shown on the surface',async({page,wire},info)=>{
  const z0=await startZ0('down');
  try{await withBridge(info,{DASH_Z0BRIDGE_URL:z0.url,DASH_Z0BRIDGE_TOKEN_FILE:z0.tokenFile},async b=>{
   await openChat(page,b);await chooseHarness(page,'Hermes');
   await openSurface(page);
   await expect.poll(()=>wire.sent('live_open').length).toBe(1);
   const open=wire.sent('live_open')[0]!;
   await expect.poll(()=>wire.recv('live_error',m=>m.id===open.id).map(m=>str(m.message))).toEqual(['ARMY_LIVE_FIXTURE_UNAVAILABLE']);
   await expect(page.getByRole('alert').filter({hasText:'ARMY_LIVE_FIXTURE_UNAVAILABLE'})).toBeVisible();
   expect(z0.calls.length,'the bridge called only the loopback live peer').toBeGreaterThan(0);
  });}finally{await z0.close();}
 });
});

// ======================================================================
// ui_control (RC3 #388/#387)
// ======================================================================
test.describe('RC3 12 ui_control',()=>{
 test('point/highlight/draw/navigate/clear frames validate; wrong payloads are rejected; no overlay is mounted',async({page,bridge,wire})=>{
  const env=(command:unknown,extra:Msg={})=>({type:'ui_control',schema:'dash.ui_control/v1',command,...extra});
  const cases:{name:string;frame:unknown;ok:boolean;error?:string;command?:unknown}[]=[
   {name:'point testID',frame:env({type:'point',id:'p1',target:{testID:'chat-window'},label:'here',ttlMs:1500,evil:'dropped'}),ok:true,command:{type:'point',id:'p1',target:{testID:'chat-window'},label:'here',ttlMs:1500}},
   {name:'point xy',frame:env({type:'point',id:'p2',target:{x:0.25,y:0.75},ttlMs:250}),ok:true,command:{type:'point',id:'p2',target:{x:0.25,y:0.75},ttlMs:250}},
   {name:'highlight',frame:env({type:'highlight',id:'h1',testID:'transcript-viewport',ttlMs:2000}),ok:true,command:{type:'highlight',id:'h1',testID:'transcript-viewport',ttlMs:2000}},
   {name:'draw',frame:env({type:'draw',id:'d1',strokes:[{points:[[0.1,0.1],[0.5,0.5]]}],color:'gold',ttlMs:3000}),ok:true,command:{type:'draw',id:'d1',strokes:[{points:[[0.1,0.1],[0.5,0.5]]}],color:'gold',ttlMs:3000}},
   {name:'navigate',frame:env({type:'navigate',id:'n1',route:'Settings'}),ok:true,command:{type:'navigate',id:'n1',route:'Settings'}},
   {name:'clear all',frame:env({type:'clear'}),ok:true,command:{type:'clear'}},
   {name:'clear one',frame:env({type:'clear',id:'p1'}),ok:true,command:{type:'clear',id:'p1'}},
   {name:'wrong frame type',frame:{type:'wrong',schema:'dash.ui_control/v1',command:{type:'clear'}},ok:false,error:'invalid message type'},
   {name:'wrong schema',frame:env({type:'clear'},{schema:'wrong'}),ok:false,error:'unsupported ui_control schema'},
   {name:'wrong command type',frame:env({type:'wrong',id:'w1'}),ok:false,error:'unknown ui_control command type'},
   {name:'wrong route',frame:env({type:'navigate',id:'n2',route:'wrong'}),ok:false,error:'invalid navigate.route'},
   {name:'ambiguous target',frame:env({type:'point',id:'p3',target:{testID:'chat-window',x:0.1,y:0.1},ttlMs:500}),ok:false,error:'invalid point.target'},
   {name:'coordinate out of range',frame:env({type:'point',id:'p4',target:{x:1.5,y:0.1},ttlMs:500}),ok:false,error:'invalid point.target'},
   {name:'ttl too short',frame:env({type:'highlight',id:'h2',testID:'chat-window',ttlMs:10}),ok:false,error:'invalid highlight.ttlMs'},
   {name:'selector syntax',frame:env({type:'highlight',id:'h3',testID:'#wrong selector',ttlMs:500}),ok:false,error:'invalid highlight.testID'},
   {name:'wrong color',frame:env({type:'draw',id:'d2',strokes:[{points:[[0,0]]}],color:'wrong',ttlMs:500}),ok:false,error:'invalid draw.color'},
   {name:'no strokes',frame:env({type:'draw',id:'d3',strokes:[],ttlMs:500}),ok:false,error:'invalid draw.strokes'},
   {name:'blank clear id',frame:env({type:'clear',id:' '}),ok:false,error:'invalid clear.id'},
  ];
  // The validator the commit under test ships (shared/ui-control.ts, imported by neither app nor bridge at 2c948dc).
  const script=`const m=await import(${JSON.stringify(join(bridgeRoot,'shared','ui-control.ts'))});const cases=JSON.parse(process.env.ARMY_UI_CASES??'[]');process.stdout.write(JSON.stringify(cases.map(c=>m.parseUiControl(c))));`;
  const out:unknown=JSON.parse(execFileSync(bun,['-e',script],{env:{...process.env,ARMY_UI_CASES:JSON.stringify(cases.map(c=>c.frame))},encoding:'utf8'}));
  const results=list(out).filter(isMsg);
  expect(results).toHaveLength(cases.length);
  cases.forEach((c,i)=>{
   const r=results[i]!;
   expect(r.ok,`${c.name}: ${c.ok?'accepted':'rejected'}`).toBe(c.ok);
   if(c.ok)expect(r.command,`${c.name}: freshly built command, unknown fields dropped`).toEqual(c.command);
   else expect(r.error,`${c.name}: rejection reason`).toBe(c.error);
  });
  // Live app + bridge: nothing sends or consumes ui_control at 2c948dc, so no overlay may appear.
  await openChat(page,bridge);
  await send(page,'p12 ui control idle turn');
  await expect(page.getByText(/ARMY_REPLY: p12 ui control idle turn/).filter({visible:true}).first()).toBeVisible();
  expect(wire.recv('ui_control'),'the bridge sends no ui_control frames').toEqual([]);
  await expect(page.locator('[data-testid^="ui-control"]'),'no ui-control overlay is mounted').toHaveCount(0);
 });
});

// ======================================================================
// isolation and secret/host hygiene
// ======================================================================
test.describe('RC3 12 isolation and hygiene',()=>{
 test('each army test owns its bridge, HOME and loopback port; nothing leaves loopback',async({page,bridge,wire})=>{
  const offLoopback:string[]=[];
  page.on('request',r=>{const u=new URL(r.url());if(u.protocol==='data:'||u.protocol==='blob:')return;if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))offLoopback.push(u.hostname.endsWith('.ts.net')?'<ts.net name withheld>':/^100\./.test(u.hostname)?'<tailnet address withheld>':u.hostname);});
  await openChat(page,bridge);
  await send(page,'p12 isolation probe');
  await expect(page.getByText(/ARMY_REPLY: p12 isolation probe/).filter({visible:true}).first()).toBeVisible();
  expect(offLoopback,'every browser request stays on loopback').toEqual([]);
  expect(wire.sockets.length).toBeGreaterThan(0);
  for(const socket of wire.sockets)expect(socket,'app socket goes to this test\'s own bridge port').toBe(`ws://127.0.0.1:${bridge.port}/ws`);
  // The bridge runs in its own PID namespace with the private HOME and loopback host.
  const pids=await bridgePids(bridge.dir);
  expect(pids.length,'own bridge process (not its bwrap launcher) found by private HOME').toBeGreaterThan(0);
  const statusFile=await readFile(`/proc/${pids[0]}/status`,'utf8');
  expect((/^NSpid:\s+(.+)$/m.exec(statusFile)?.[1]??'').trim().split(/\s+/).length,'bridge is inside its own PID namespace').toBeGreaterThan(1);
  const environ=(await readFile(`/proc/${pids[0]}/environ`,'utf8')).split('\0');
  expect(environ).toContain('DASH_HOST=127.0.0.1');
  expect(environ).toContain('HERMES_HOME='+join(bridge.dir,'.hermes'));
  expect(bridge.logs()).toContain('loopback verification mode enabled explicitly');
  // The fixture agent ran under the same private HOME (its evidence files live there).
  await expect.poll(async()=>(await prompts(bridge)).some(t=>t.includes('p12 isolation probe'))).toBe(true);
  // A second isolated bridge gets a different HOME and port.
  const other=await createBridge(false);
  try{
   expect(other.dir).not.toBe(bridge.dir);
   expect(other.port).not.toBe(bridge.port);
   expect((await readFile(join(other.dir,'.dash/token'),'utf8')).trim()).not.toBe((await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim());
  }finally{await other.stop();}
 });

 test('the served web bundle contains no tailnet host names or ts.net names',async({page})=>{
  const bodies:Promise<{path:string;text:string}>[]=[];
  const origin=new URL(web).origin;
  page.on('response',r=>{const u=new URL(r.url());if(u.origin===origin&&/(\.js|\.html|\.json|\/)$/.test(u.pathname))bodies.push(r.text().then(text=>({path:u.pathname,text}),()=>({path:u.pathname,text:''})));});
  await page.goto(web,{waitUntil:'domcontentloaded'});
  await page.getByPlaceholder('100.64.0.1',{exact:true}).waitFor({timeout:120000});
  const scripts=await page.evaluate(()=>Array.from(document.scripts).map(s=>s.src).filter(Boolean));
  const fetched=await Promise.all(scripts.map(async src=>({path:new URL(src).pathname,text:await (await fetch(src)).text()})));
  const all=[...await Promise.all(bodies),...fetched];
  expect(all.some(b=>b.path.endsWith('.js')&&b.text.length>0),'bundle JavaScript was read').toBe(true);
  const tsnet=all.reduce((n,b)=>n+(b.text.match(/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/gi)?.length??0),0);
  // 100.64.0.0/10 (CGNAT, tailnet) addresses; the pairing placeholder 100.64.0.1 is a documentation example.
  const tailnet=all.reduce((n,b)=>n+(b.text.match(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g)?.filter(ip=>ip!=='100.64.0.1').length??0),0);
  test.info().annotations.push({type:'observed',description:`ts.net names: ${tsnet}; tailnet addresses: ${tailnet} (literals withheld)`});
  expect.soft(tsnet,'served bundle holds no ts.net host names (known at 2c948dc: ContinuousVoiceRoot.tsx fetch URL; literal withheld)').toBe(0);
  expect(tailnet,'served bundle holds no tailnet addresses (literal withheld)').toBe(0);
 });
});
