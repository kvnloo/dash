#!/usr/bin/env node
// Real Expo components + the real bridge entry point, isolated credentials/data.
// Fixture session only. No model turns, daily phone control or production bridge changes.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('.surface-receipts'), port=8195, bridgePort=4799;
await mkdir(out,{recursive:true});
const scratch=await mkdtemp(path.join(process.env.TMPDIR??process.cwd(),'dash-surface-proof-'));
const credentials=path.join(scratch,'credentials'); await mkdir(credentials,{mode:0o700});
const token=randomBytes(32).toString('hex');
await writeFile(path.join(credentials,'token'),token,{mode:0o600});
const processes=[], logs={}, result={scope:'Actual Expo Web components, real authenticated bridge entry point, fixture data; not Android or a model turn',revision:process.env.DASH_PROOF_REVISION,cases:[],errors:[]};
const surfaceFrames=[];
function run(name,command,args,env,cwd=process.cwd()) {
  const proc=spawn(command,args,{cwd,env:{...process.env,...env},detached:true,stdio:['ignore','pipe','pipe']});processes.push(proc);logs[name]='';proc.stdout.on('data',d=>logs[name]+=d);proc.stderr.on('data',d=>logs[name]+=d);return proc;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,description) { for(let i=0;i<180;i++){try{const value=await fn();if(value)return value;}catch{}await sleep(500);}throw new Error(`Timeout: ${description}`); }
let browser, activePage;
try {
  run('bridge','bun',['bridge/index.ts'],{DASH_HOST:'127.0.0.1',DASH_ALLOW_LOOPBACK:'1',DASH_PORT:String(bridgePort),DASH_CREDENTIAL_DIR:credentials,DASH_ALLOWED_ORIGINS:`http://127.0.0.1:${port}`,HERMES_HOME:path.join(scratch,'hermes'),DASH_IDENTITY:'0',DASH_GATE_ENABLED:'0',DASH_STT_BACKEND:'none',DASH_Z0BRIDGE:'0'});
  await wait(async()=>{const r=await fetch(`http://127.0.0.1:${bridgePort}/`);return r.status===401;},'bridge');
  console.log('isolated authenticated bridge ready');
  run('expo','bun',['x','expo','start','--web','--port',String(port)],{CI:'1',EXPO_PUBLIC_DEBUG:'0',EXPO_PUBLIC_DEMO:'0',EXPO_PUBLIC_DEBUG_AUTONAV:'0'},path.resolve('app'));
  await wait(async()=>(await fetch(`http://127.0.0.1:${port}`)).ok,'Expo');
  console.log('Expo ready');
  browser=await chromium.launch({headless:true});
  for (const width of [390,412,800]) {
    const context=await browser.newContext({viewport:{width,height:915},deviceScaleFactor:1});
    const page=await context.newPage(); activePage=page; page.on('pageerror',e=>result.errors.push(`${width}: ${e.message}`));
    page.on('websocket',ws=>ws.on('framesent',frame=>{try{const message=JSON.parse(String(frame.payload));if(message.type==='surface_state')surfaceFrames.push({width,message});}catch{}}));
    const chat={id:'surface-proof-chat',title:'Existing attached conversation',harness:'hermes',sessionId:'surface-proof-session',profileId:'surface-proof-profile',createdAt:1,updatedAt:1,queueWaitForIdle:true,messages:[{id:'proof-owner',role:'user',text:'Show me where Annotate is, then open it here. Keep this conversation.',at:1},{id:'proof-answer',role:'assistant',text:'A guide can highlight controls across the app without sending your draft.',at:2,state:'done',turnId:'fixture-completed',seq:1},{id:'held-user',role:'user',text:'Held queued message — never send in this proof',delivery:'queued',at:3},{id:'held-answer',role:'assistant',text:'',state:'pending',turnId:'held-fixture',seq:0,at:4}]};
    await page.addInitScript(({token,bridgePort,chat})=>{
      if(sessionStorage.getItem('surface-seeded'))return;
      localStorage.setItem('dash.settings.v1',JSON.stringify({address:`127.0.0.1:${bridgePort}`,token,harness:'hermes',inAppFeedback:false}));
      localStorage.setItem('dash.conversations.v1',JSON.stringify([chat]));localStorage.setItem('dash.activeId.v1',chat.id);sessionStorage.setItem('surface-seeded','yes');
    },{token,bridgePort,chat});
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded',timeout:180000});
    console.log(`${width}: mounted app`);
    await page.getByRole('tab').nth(1).click({timeout:120000});
    await page.getByText(chat.title,{exact:true}).first().click({timeout:120000});
    const input=page.getByRole('textbox',{name:'Message',exact:true});
    await input.waitFor({timeout:60000});
    await input.fill('My unsent draft stays here\nSecond line');
    await page.screenshot({path:path.join(out,`${width}-before.png`)});
    const control=page.getByRole('switch',{name:'Allow agent guide in this chat',exact:true});
    await control.click();
    console.log(`${width}: Guide checked=${await control.getAttribute('aria-checked')}`);
    const grantFile=await wait(async()=>{const files=await readdir(path.join(credentials,'agent-surface'));return files.length ? path.join(credentials,'agent-surface',files[0]) : undefined;},'scoped grant');
    const grant=JSON.parse(await readFile(grantFile,'utf8'));
    const call=async(endpoint,command)=>{
      const response=await fetch(`${grant.url}/agent-surface/${grant.target.client}/${endpoint}`,{method:command?'POST':'GET',headers:{authorization:`Bearer ${grant.capability}`,...(command?{'content-type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
      const receipt=await response.json();assert.equal(response.status,200,JSON.stringify(receipt));assert.equal(receipt.status,'rendered');return receipt;
    };
    const state=()=>call('state');
    const send=async(op,extra={})=>{const {snapshot:s}=await state();return call('command',{id:randomUUID(),target:grant.target,route:s.route,generation:s.generation,expiresAt:Date.now()+5000,op,...extra});};
    await sleep(250);
    const initial=(await state()).snapshot;
    assert.equal(initial.route,'chat');assert.equal(initial.target.chat,chat.id);assert.equal(initial.target.session,chat.sessionId);
    for(const anchor of ['chat.options','chat.annotate','chat.guide'])assert(initial.anchors[anchor]?.width>20,anchor);
    const draw=await send('draw',{ttlMs:8000,primitives:[{kind:'box',anchor:'chat.options'},{kind:'arrow',anchor:'chat.annotate'}]});
    assert.equal(await page.getByTestId('agent-guide-overlay').locator('svg rect').count(),1);
    assert.equal(await page.getByTestId('agent-guide-overlay').locator('svg path').count(),1);
    const pointer=await page.getByTestId('agent-guide-overlay').evaluate(el=>getComputedStyle(el).pointerEvents);assert.equal(pointer,'none');
    await page.screenshot({path:path.join(out,`${width}-highlight.png`)});
    const receipts=[draw];
    for(const destination of ['trace','lab','back','chat','bots','chat','settings','chat']) {
      receipts.push(await send('navigate',{destination}));
      if(destination!=='back')assert.equal(receipts.at(-1).snapshot.route,destination);
      assert.equal(receipts.at(-1).snapshot.target.chat,chat.id);
    }
    assert.equal(await input.inputValue(),'My unsent draft stays here\nSecond line');
    await page.screenshot({path:path.join(out,`${width}-returned.png`)});
    const cli=await promisify(execFile)(process.execPath,['scripts/agent-surface.mjs','--grant',grantFile,'--client',grant.target.client,'--session',grant.target.session,'demo']);
    assert(cli.stdout.includes('highlight-rendered'),'real agent-facing CLI receives rendered highlight ack');
    await writeFile(path.join(out,`${width}-cli-demo.json.log`),cli.stdout);
    const opened=await state();assert.equal(opened.snapshot.annotationOpen,true);
    await page.getByLabel('Annotation mode on',{exact:true}).waitFor();
    await sleep(1800);
    await page.mouse.move(60,300);await page.mouse.down();await page.mouse.move(150,335,{steps:20});await page.mouse.up();
    const strokes=await page.evaluate(()=>window.__dashAnnotate?.annotate.get().drawing.strokes.length??-1);
    assert(strokes>0,'real gesture creates user ink');
    await page.screenshot({path:path.join(out,`${width}-annotation.png`)});
    await send('draw',{ttlMs:700,primitives:[{kind:'circle',anchor:'chat.annotate'},{kind:'label',anchor:'chat.options',text:'Here'}]});
    await sleep(1000);assert.equal(await page.getByTestId('agent-guide-overlay').locator('svg').count(),0,'TTL removes guide');
    await send('clear');assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes.length),strokes,'agent clear preserves user ink');
    assert.equal(await input.inputValue(),'My unsent draft stays here\nSecond line');
    const persisted=await page.evaluate(()=>({active:localStorage.getItem('dash.activeId.v1'),chats:JSON.parse(localStorage.getItem('dash.conversations.v1')??'[]')}));
    assert.equal(persisted.active,chat.id);assert.equal(persisted.chats.length,1);assert.equal(persisted.chats[0].messages.find(m=>m.id==='held-answer')?.state,'pending');assert.equal(persisted.chats[0].messages.find(m=>m.id==='held-user')?.text,chat.messages.find(m=>m.id==='held-user').text);
    await page.getByRole('button',{name:'Disable agent control',exact:true}).click();
    const revoked=await fetch(`${grant.url}/agent-surface/${grant.target.client}/state`,{headers:{authorization:`Bearer ${grant.capability}`}});assert.equal(revoked.status,401);
    result.cases.push({width,initial,receipts,opened,userInkStrokes:strokes,draftPreserved:true,queuePreserved:true,noNewConversation:true,revoked:revoked.status,pointerEvents:pointer});
    console.log(`${width}: highlight, CLI, warp/back, ink, draft/queue, revocation PASS`);
    await context.close();
  }
  assert.deepEqual(result.errors,[]);result.status='PASS';
} catch(error) {result.status='FAIL';result.error=String(error.stack??error);result.surfaceFrames=surfaceFrames;if(activePage){await activePage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});result.pageText=await activePage.locator('body').innerText().catch(()=>'');}throw error;}
finally {
  await browser?.close();for(const p of processes){try{process.kill(-p.pid,'SIGTERM');}catch{}}
  for(const [name,log] of Object.entries(logs))await writeFile(path.join(out,`${name}.log`),log.replaceAll(token,'[redacted]'));
  await writeFile(path.join(out,'rendered-result.json'),JSON.stringify(result,null,2));
  await rm(scratch,{recursive:true,force:true});
}
