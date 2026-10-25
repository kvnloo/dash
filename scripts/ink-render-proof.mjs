// Actual Expo AnnotationRoot + Gesture Handler + Skia. No draw/store payload injection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const wasm=require.resolve('canvaskit-wasm/bin/full/canvaskit.wasm',{paths:[path.resolve('app')]});
import { chromium } from 'playwright';
const out=path.resolve('.repair-receipts'), port=8197;
await mkdir(out,{recursive:true});
const result={revision:process.env.DASH_PROOF_REVISION,wasm:'Pinned installed CanvasKit served locally instead of CDN (test infrastructure only)',scope:'Actual Expo Web raw pointer → gesture → store → Skia pixels, NOT Android/S Pen qualification',cases:[],errors:[]};
const expo=spawn('bun',['x','expo','start','--web','--port',String(port)],{cwd:path.resolve('app'),env:{...process.env,CI:'1',EXPO_PUBLIC_DEBUG:'0',EXPO_PUBLIC_DEMO:'0'},detached:true,stdio:['ignore','pipe','pipe']});
let log='',browser,page;
expo.stdout.on('data',d=>log+=d);expo.stderr.on('data',d=>log+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<600;i++){try{if(await fn())return;}catch{}await sleep(500);}throw new Error(`Timeout: ${label}`);}
async function pixels(png){
  return page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const {data:d}=ctx.getImageData(30,200,250,300);let red=0;
    for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<125&&d[i+2]<125)red++;
    return red;
  },`data:image/png;base64,${png.toString('base64')}`);
}
try{
  await wait(async()=>(await fetch(`http://127.0.0.1:${port}`)).ok,'Expo');
  browser=await chromium.launch({headless:true});
  for(const width of [390,412]){
    const context=await browser.newContext({viewport:{width,height:915},deviceScaleFactor:1});
    await context.route('https://unpkg.com/canvaskit-wasm@0.41.0/bin/full/canvaskit.wasm',route=>route.fulfill({path:wasm,contentType:'application/wasm'}));
    page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded',timeout:600000});
    await wait(()=>page.evaluate(()=>Boolean(window.__dashAnnotate)),'annotation mount');
    await page.evaluate(()=>window.__dashAnnotate.enterAnnotation());
    await page.getByLabel('Annotation mode on',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Pen mode: only the S Pen draws, fingers scroll',exact:true}).click();
    await page.getByRole('radio',{name:'Red ink',exact:true}).click();
    await wait(()=>page.locator('canvas').count(),'Skia canvas');await sleep(1500);
    const before=await page.screenshot({path:path.join(out,`${width}-before.png`)});
    const redBefore=await pixels(before);
    await page.mouse.move(60,280);await page.mouse.down();
    await page.mouse.move(210,380,{steps:30});
    await sleep(300);
    const live=await page.screenshot({path:path.join(out,`${width}-live.png`)});
    const redLive=await pixels(live);
    await page.mouse.up();await sleep(300);
    const committed=await page.screenshot({path:path.join(out,`${width}-committed.png`)});
    const redCommitted=await pixels(committed);
    const strokes=await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes);
    const canvases=await page.locator('canvas').evaluateAll(nodes=>nodes.map(n=>({width:n.width,height:n.height,bounds:n.getBoundingClientRect().toJSON()})));
    result.cases.push({width,redBefore,redLive,redCommitted,strokes,canvases});
    assert.equal(strokes.length,1,'raw mouse gesture commits one stroke');
    assert(redLive>redBefore+150,'live Skia stroke must produce visible pixels before pointer up');
    assert(redCommitted>redBefore+150,'committed Skia stroke remains visible');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes.length),0);
    await page.getByRole('button',{name:'Pen mode: only the S Pen draws, fingers scroll',exact:true}).click();
    const cdp=await context.newCDPSession(page);
    // Native button events are simulated here; actual pen contact remains a real browser input.
    await page.evaluate(()=>{const a=window.__dashAnnotate;a.stylusButton(true);a.stylusButton(false);});
    assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().active),false);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:65,y:285,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:215,y:385,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
    assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().active),false,'normal pen contact never enters marking');
    assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes.length),0);
    await page.evaluate(()=>{const a=window.__dashAnnotate;a.stylusButton(true);a.stylusButton(false);});
    await page.getByLabel('Annotation mode on',{exact:true}).waitFor();
    // Coalesced native-style stylus stroke: DOWN/UP can arrive with no Pan UPDATE.
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:65,y:285,button:'left',buttons:1,clickCount:1,pointerType:'pen',force:0.7});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:215,y:385,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
    await sleep(300);
    const quick=await page.screenshot({path:path.join(out,`${width}-quick-pen.png`)});
    const penStrokes=await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes);
    result.cases.at(-1).quickPen={strokes:penStrokes,red:await pixels(quick)};
    assert.equal(penStrokes.length,1,'stylus UP endpoint must survive even with no intermediate Pan update');
    assert.equal(penStrokes[0].pointer,'stylus');
    assert(result.cases.at(-1).quickPen.red>redBefore+150,'quick stylus stroke must paint after release');
    await context.close();
  }
  // An explicitly seeded, offline existing chat. No backend session is created or sent to.
  const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
  await context.route('https://unpkg.com/canvaskit-wasm@0.41.0/bin/full/canvaskit.wasm',route=>route.fulfill({path:wasm,contentType:'application/wasm'}));
  page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  let popups=0;page.on('popup',()=>popups++);
  const chat={id:'repair-existing-chat',title:'Existing attached conversation',harness:'hermes',sessionId:'repair-existing-session',profileId:'repair-existing-profile',createdAt:1,updatedAt:1,queueWaitForIdle:true,messages:[{id:'prior-answer',role:'assistant',text:'Circle this exact phrase',state:'done',turnId:'prior-turn',seq:1,at:0},{id:'held-user',role:'user',text:'Original queued request',delivery:'queued',at:1},{id:'held-answer',role:'assistant',text:'',state:'pending',turnId:'held-existing-turn',seq:0,at:2}]};
  await page.addInitScript(chat=>{
    if(sessionStorage.getItem('repair-seeded'))return;
    localStorage.setItem('dash.settings.v1',JSON.stringify({address:'127.0.0.1:18379',token:'offline-proof-only',harness:'hermes',inAppFeedback:false}));
    localStorage.setItem('dash.conversations.v1',JSON.stringify([chat]));localStorage.setItem('dash.activeId.v1',chat.id);sessionStorage.setItem('repair-seeded','yes');
  },chat);
  await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded',timeout:600000});
  await page.getByRole('tab').nth(1).click({timeout:120000});
  await page.getByText(chat.title,{exact:true}).first().click({timeout:60000});
  // Composition: the row opens a window over Main (whose search bar is also a 'Message' textbox); type only once the window is up.
  await page.getByTestId('chat-window').waitFor({state:'visible'});
  const input=page.getByRole('textbox',{name:'Message',exact:true});await input.fill('Original unsent draft\nKeep this exact text');
  await page.evaluate(()=>window.__dashAnnotate.enterAnnotation());await wait(()=>page.locator('canvas').count(),'chat canvas');
  await page.getByRole('button',{name:'Pen mode: only the S Pen draws, fingers scroll',exact:true}).click();
  await page.mouse.move(60,280);await page.mouse.down();await page.mouse.move(210,380,{steps:20});await page.mouse.up();await sleep(250);
  const originalInk=await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes);
  assert.equal(originalInk.length,1);
  // Pen mode lets ordinary touch/mouse navigation pass without discarding the root-owned ink.
  await page.getByRole('button',{name:'Pen mode: only the S Pen draws, fingers scroll',exact:true}).click();
  await page.getByTestId('pen-mode-label').getByText('Annotate',{exact:true}).waitFor();
  const pillBox=await page.getByTestId('chat-window-pill').boundingBox(), trayBox=await page.getByRole('button',{name:'Pen',exact:true}).boundingBox();
  assert(pillBox&&trayBox&&trayBox.y>=pillBox.y+pillBox.height,'annotation tray must leave the mode pill visible');
  const uploads=[];
  await context.route('http://127.0.0.1:18379/attachments?*',async route=>{
    const request=route.request(), bytes=request.postDataBuffer(), name=new URL(request.url()).searchParams.get('name');
    uploads.push({name,size:bytes?.length??0});
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'1234567890abcdef1234567890abcdef',name,mime:'image/png',size:bytes?.length??0})});
  });
  const phrase=page.getByTestId('transcript-viewport').getByText('Circle this exact phrase',{exact:true});const box=await phrase.boundingBox();assert(box);
  const pen=await context.newCDPSession(page), cx=box.x+box.width/2, cy=box.y+box.height/2, rx=box.width/2+10, ry=box.height/2+12;
  await pen.send('Input.dispatchMouseEvent',{type:'mousePressed',x:cx+rx,y:cy,button:'left',buttons:1,clickCount:1,pointerType:'pen',force:0.7});
  for(let i=1;i<=64;i++){const a=i*Math.PI/32;await pen.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a),button:'left',buttons:1,pointerType:'pen',force:0.7});}
  await pen.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:cx+rx,y:cy,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  await wait(async()=>uploads.length===1,'circled-region image upload');
  assert((await input.inputValue()).includes('> Circle this exact phrase'),'painted circled text is quoted in the existing draft');
  assert(uploads[0].size>100,'region contains actual PNG bytes');
  await page.screenshot({path:path.join(out,'412-circle-attached.png')});
  result.circle={scope:'Real Web pen loop/capture/quote; isolated HTTP upload fixture, no send or model turn',uploads};
  const expectedDraft=await input.inputValue();
  const expectedInk=await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes);
  // Composition: Chats rows open the chat as a full-screen window; its X (not a header Back) returns to the list.
  await page.getByRole('button',{name:'Close chat window',exact:true}).click();await page.getByTestId('chat-window').waitFor({state:'detached'});
  await page.getByRole('tab').nth(1).click();await page.getByText(chat.title,{exact:true}).first().click();await page.getByTestId('chat-window').waitFor({state:'visible'});
  const reopenDiag=await page.evaluate(()=>({boxes:[...document.querySelectorAll('textarea,input')].map(e=>[e.getAttribute('aria-label'),e.value.slice(0,40)]),windows:document.querySelectorAll('[data-testid="chat-window"]').length,title:document.querySelector('[data-testid="chat-window-pill-title"]')?.textContent??null}));
  assert.equal(await input.inputValue(),expectedDraft,JSON.stringify(reopenDiag));
  assert.deepEqual(await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes),expectedInk);
  // Keep the annotation open, but use its existing tray relocation so it cannot cover the mic.
  // Tray defaults to the top to leave the dock reachable.
  const mic=page.getByRole('button',{name:'Dictate',exact:true});const bounds=await mic.boundingBox();assert(bounds);
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await sleep(350);
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2-48,{steps:8});await page.mouse.up();
  await page.getByRole('button',{name:'Live voice',exact:true}).click();
  await page.getByRole('button',{name:'Retry Live voice',exact:true}).waitFor();
  assert.equal(await page.getByText('Dash voice',{exact:true}).count(),0,'composer stays in this chat, not a Voice route');
  assert.equal(await input.inputValue(),expectedDraft);assert.equal(popups,0);
  const persisted=await page.evaluate(()=>({active:localStorage.getItem('dash.activeId.v1'),chats:JSON.parse(localStorage.getItem('dash.conversations.v1')??'[]')}));
  assert.equal(persisted.active,chat.id);assert.equal(persisted.chats.length,1);
  assert.equal(persisted.chats[0].messages.find(m=>m.id==='held-answer')?.state,'pending');
  await page.screenshot({path:path.join(out,'412-returned-chat-voice-unavailable.png')});
  result.navigation={scope:'Offline existing-chat fixture; real raw ink and navigation, no backend turn or mic capture',draftPreserved:true,inkPreserved:true,queuePreserved:true,popups,noNewConversation:true};
  await context.close();
  assert.deepEqual(result.errors,[]);result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error.stack??error);if(page){result.body=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}throw error;}
finally{await browser?.close();try{process.kill(-expo.pid,'SIGTERM');}catch{}await writeFile(path.join(out,'expo.log'),log);await writeFile(path.join(out,'rendered-result.json'),JSON.stringify(result,null,2));}
