// RC3 area 06: delivery status, queue and outbox persistence across restart.
// App under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc) (web export) + that commit's bridge.
// Same harness as army.spec.ts: isolated real bridge per test, scripted ACP fixture agent,
// private headless Sway only. Assertions follow the RC3 feature spec literally; when RC3 does
// not ship a behavior the test fails with a message naming the missing behavior.
//
// Source facts at 2c948dc (re-check when triaging):
// - components/DeliveryStatus.tsx (testID delivery-status / delivery-retry) has no runtime importer.
// - store/outbox.ts and lib/outbox-storage.ts have no runtime importer; queued sends persist only
//   through store/conversation-persistence.ts (pending assistant rows).
// - lib/storage-row-budget.ts (#414) has no runtime importer.
// - The bridge has bridge/src/delivery-ledger.ts but bridge/index.ts does not import it.
import {test,expect,openChat,composer,chooseHarness,send,chatRow,type Bridge} from './fixtures';
import type {Page} from 'playwright/test';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const OFFLINE=/tap to retry|Connecting to bridge|Offline|Disconnected/i;
const token=()=>Math.random().toString(36).slice(2,10).replace(/[^a-z0-9]/g,'x');
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Every prompt the fixture agent received (see the rc3-05-06 section of fixture-agent.ts). */
async function prompts(b:Bridge):Promise<string[]>{
 const out:string[]=[];
 for(const file of [join(b.dir,'tmp','fixture-prompts.jsonl'),join(b.dir,'fixture-prompts.jsonl')]){
  let raw='';try{raw=await readFile(file,'utf8');}catch{continue;}
  for(const line of raw.split('\n')){
   if(!line)continue;
   const value:unknown=JSON.parse(line);
   if(typeof value==='object'&&value!==null&&'text' in value&&typeof value.text==='string')out.push(value.text);
  }
 }
 return out;
}
const promptCount=async(b:Bridge,needle:string)=>(await prompts(b)).filter(text=>text.includes(needle)).length;
/** Ends a fixture turn sent with ARMY_HANG ARMY_HOLD_<tok>. */
async function release(b:Bridge,tok:string){for(const dir of [join(b.dir,'tmp'),b.dir])await writeFile(join(dir,'army-release-'+tok),'release\n');}
const holder=(tok:string,label:string)=>`ARMY_HANG ARMY_HOLD_${tok} ${label}`;

/** Host PIDs of this test's own bridge (bwrap PID namespace), found by its private HOME. */
async function bridgePids(dir:string):Promise<number[]>{
 const pids:number[]=[];
 for(const entry of await readdir('/proc')){
  if(!/^\d+$/.test(entry))continue;
  try{
   const cmd=(await readFile(`/proc/${entry}/cmdline`,'utf8')).split('\0');
   if(!cmd.some(arg=>arg.endsWith('bridge/index.ts')))continue;
   const env=(await readFile(`/proc/${entry}/environ`,'utf8')).split('\0');
   if(env.includes('HOME='+dir))pids.push(Number(entry));
  }catch{/* process exited or is not ours */}
 }
 return pids;
}

/** Records each distinct "status text|retry aria-label" of the newest delivery-status node. */
async function recordDelivery(page:Page){
 await page.evaluate(()=>{
  const w=window as unknown as {__armyDelivery?:string[]};
  const seen:string[]=[];w.__armyDelivery=seen;
  const snap=()=>{
   const nodes=document.querySelectorAll('[data-testid="delivery-status"]');
   const last=nodes.item(nodes.length-1);if(!last)return;
   const retry=last.querySelector('[data-testid="delivery-retry"]');
   const row=(last.textContent??'')+'|'+(retry?.getAttribute('aria-label')??'');
   if(seen[seen.length-1]!==row)seen.push(row);
  };
  new MutationObserver(snap).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});snap();
 });
}
const deliveryLog=(page:Page)=>page.evaluate(()=>(window as unknown as {__armyDelivery?:string[]}).__armyDelivery??[]);
const firstAt=(log:string[],label:string)=>log.findIndex(row=>row.startsWith(label));

/** Real browser reload = app restart on web. Reopens this test's own chat row. */
async function restartApp(page:Page){
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('tab').nth(1).waitFor({timeout:60000});
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await chatRow(page).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}

/** Composer submit while a turn runs: Queue (OMP), or pick Queue first when Steer is offered (Hermes). */
async function queue(page:Page,text:string){
 await composer(page).fill(text);
 const choose=page.getByRole('button',{name:'Choose Queue for next turn',exact:true});
 if(await choose.isVisible())await choose.click({noWaitAfter:true});
 await page.getByRole('button',{name:'Queue',exact:true}).click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue('');
}
const header=(page:Page,n:number)=>page.getByRole('button',{name:`${n} queued`,exact:true});
const anyHeader=(page:Page)=>page.getByRole('button',{name:/^\d+ queued$/});
const item=(page:Page,i:number)=>page.getByRole('textbox',{name:`Queued message ${i}`,exact:true});
async function expand(page:Page,n:number){
 await expect(header(page,n)).toBeVisible();
 if(!(await item(page,1).isVisible()))await header(page,n).click({noWaitAfter:true});
 await expect(item(page,1)).toBeVisible();
}
/** Starts a held OMP turn so later composer submits are queued. */
async function holdTurn(page:Page,b:Bridge,tok:string,label='queue holder'){
 await openChat(page,b);
 await send(page,holder(tok,label));
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
}

test.describe('RC3 06 delivery status',()=>{
 test('send shows Sending, then Received by bridge on delivery_receipt, then Started',async({page,bridge})=>{
  await openChat(page,bridge);await recordDelivery(page);
  const tok=token();
  await send(page,holder(tok,'delivery status'));
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  const status=page.getByTestId('delivery-status').last();
  await expect(status,'RC3 must mount DeliveryStatus (testID delivery-status) on the sent user bubble').toBeVisible();
  await expect(status).toContainText('Started',{timeout:20000});
  await expect(status).toContainText('The bridge reported that execution started; completion is not implied.');
  const log=await deliveryLog(page);
  expect(firstAt(log,'Sending'),'Sending shown before any receipt: '+JSON.stringify(log)).toBeGreaterThanOrEqual(0);
  expect(firstAt(log,'Received by bridge'),'Received by bridge after Sending: '+JSON.stringify(log)).toBeGreaterThan(firstAt(log,'Sending'));
  expect(firstAt(log,'Started'),'Started after Received by bridge: '+JSON.stringify(log)).toBeGreaterThan(firstAt(log,'Received by bridge'));
  await release(bridge,tok);
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(holder(tok,'delivery status')))).first()).toBeVisible();
  expect(await promptCount(bridge,tok)).toBe(1);
 });

 test('send while bridge is down is Queued in the local outbox, then delivered after restart',async({page,bridge})=>{
  await openChat(page,bridge);await recordDelivery(page);
  const text='offline outbox '+token();
  await bridge.stop();
  await expect(page.getByText(OFFLINE).filter({visible:true}).first()).toBeVisible({timeout:15000});
  await composer(page).fill(text);
  const sendButton=page.getByRole('button',{name:'Send',exact:true});
  await expect(sendButton,'RC3 outbox: Send must accept a message while the bridge is down').toBeEnabled();
  await sendButton.click({noWaitAfter:true});
  const status=page.getByTestId('delivery-status').last();
  await expect(status).toContainText('Queued');
  await expect(status).toContainText('Waiting in the local outbox to be sent to the bridge.');
  await bridge.start();
  await expect(status).toContainText(/Received by bridge|Started/,{timeout:30000});
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text))).first()).toBeVisible();
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text)))).toHaveCount(1);
  await expect.poll(()=>promptCount(bridge,text)).toBe(1);
 });

 test('bridge drop before receipt shows Not sent · Retry, and Retry resends exactly once',async({page,bridge})=>{
  await openChat(page,bridge);await recordDelivery(page);
  const text='retry delivery '+token();
  await composer(page).fill(text);
  const pids=await bridgePids(bridge.dir);
  expect(pids.length,'own bridge process found by private HOME').toBeGreaterThan(0);
  // Freeze (not kill) the bridge: the socket stays open, so no receipt and no clean close.
  for(const pid of pids)process.kill(pid,'SIGSTOP');
  try{
   await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
   const status=page.getByTestId('delivery-status').last();
   await expect(status,'RC3 must mount DeliveryStatus on the sent user bubble').toBeVisible();
   await expect(status).toContainText('Not sent · Retry',{timeout:60000});
   await expect(status).toContainText('Delivery is unconfirmed.');
  }finally{for(const pid of pids){try{process.kill(pid,'SIGCONT');}catch{/* exited */}}}
  const retry=page.getByTestId('delivery-retry').last();
  await expect(page.getByRole('button',{name:'Retry message delivery',exact:true})).toBeVisible({timeout:30000});
  await retry.click({noWaitAfter:true});
  await expect.poll(async()=>(await deliveryLog(page)).some(row=>row.endsWith('|Retrying message delivery')),{message:'Retry label becomes Retrying message delivery'}).toBe(true);
  await expect(page.getByTestId('delivery-status').last()).toContainText(/Received by bridge|Started/,{timeout:30000});
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text))).first()).toBeVisible();
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text)))).toHaveCount(1);
  await expect.poll(()=>promptCount(bridge,text)).toBe(1);
  // A duplicate turn would land within the fixture's 350 ms reply window; observe a little longer.
  await page.waitForTimeout(3000);
  expect(await promptCount(bridge,text),'no duplicate turn on the bridge').toBe(1);
 });
});

test.describe('RC3 06 outbox persistence across restart',()=>{
 test('#222 queued send survives bridge loss and app restart and is delivered exactly once',async({page,bridge})=>{
  const tok=token();const text='outbox222 '+tok;
  await holdTurn(page,bridge,tok,'outbox holder');
  await queue(page,text);
  await expect(header(page,1)).toBeVisible();
  await bridge.stop();
  await expect(page.getByText(OFFLINE).filter({visible:true}).first()).toBeVisible({timeout:15000});
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).map(key=>localStorage.getItem(key)??'').join('\n')),
   {message:'queued send is written to device storage before restart'}).toContain(text);
  await restartApp(page);
  await expect(page.getByText(text,{exact:true}).first(),'queued message still in the transcript after restart').toBeVisible();
  await bridge.start();
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text))).first()).toBeVisible({timeout:30000});
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(text)))).toHaveCount(1);
  await expect.poll(()=>promptCount(bridge,text)).toBe(1);
  await page.waitForTimeout(3000);
  expect(await promptCount(bridge,text),'queued send delivered exactly once (not lost, not duplicated)').toBe(1);
  await expect(anyHeader(page)).toHaveCount(0);
 });

 test('#414 oversized draft over the UTF-8 row budget does not crash restart',async({page,bridge,errors})=>{
  await openChat(page,bridge);
  const ROW_BYTE_LIMIT=512*1024;
  const big='界'.repeat(200000)+' ARMY_OVERSIZE_END'; // about 600 KB of UTF-8
  await composer(page).fill(big);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.composerDrafts.v1')?.length??0),{message:'draft write attempted'}).toBeGreaterThan(0);
  await restartApp(page);
  await expect(composer(page)).toBeVisible();
  const restored=await composer(page).inputValue();
  const bytes=Buffer.byteLength(restored,'utf8');
  const note=page.getByText(/too large|truncated|exceeds|over the .*limit|could not be saved|not saved/i);
  if(bytes>ROW_BYTE_LIMIT)await expect(note.first(),`restored draft is ${bytes} B > ${ROW_BYTE_LIMIT} B row budget: it must be truncated or rejected with a visible note`).toBeVisible();
  expect(errors.filter(e=>e.startsWith('PAGEERROR')),'restart must not crash').toEqual([]);
  await composer(page).fill('after oversized draft');
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: after oversized draft/).filter({visible:true}).first()).toBeVisible();
 });

 test('reload mid-stream restores prior messages and never leaves a stuck spinner',async({page,bridge})=>{
  await openChat(page,bridge);
  await send(page,'restore prior message');
  await expect(page.getByText(/ARMY_REPLY: restore prior message/).filter({visible:true}).first()).toBeVisible();
  const tok=token();const running=holder(tok,'mid-stream reload');
  await send(page,running);
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).nth(1)).toBeVisible();
  await restartApp(page);
  await expect(page.getByText('restore prior message',{exact:true}).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByText(/ARMY_REPLY: restore prior message/).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByText(running,{exact:true}).filter({visible:true}).first()).toBeVisible();
  await release(bridge,tok);
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(running))).or(page.getByText(/interrupted|ended|lost|stopped|No response|did not finish/i)).first(),
   'streaming turn resumes or shows a lost/ended state').toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'Stop',exact:true}),'no stuck running turn').toHaveCount(0,{timeout:30000});
  await composer(page).fill('after mid-stream reload');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: after mid-stream reload/).filter({visible:true}).first()).toBeVisible();
  expect(await promptCount(bridge,tok),'reload does not resend the running prompt').toBe(1);
 });
});

test.describe('RC3 06 queued stack',()=>{
 test('2+ queued shows "<n> queued" header that expands to editable, deletable, draggable items',async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  await queue(page,'stack item one');await queue(page,'stack item two');await queue(page,'stack item three');
  await expect(header(page,3)).toBeVisible();
  await header(page,3).click({noWaitAfter:true});
  for(const [i,text] of [[1,'stack item one'],[2,'stack item two'],[3,'stack item three']] as const){
   await expect(item(page,i)).toHaveValue(text);
   await expect(item(page,i)).toBeEditable();
   await expect(page.getByRole('button',{name:`Delete queued message ${i}`,exact:true})).toBeVisible();
   await expect(page.getByLabel(`Drag queued message ${i}`,{exact:true})).toBeVisible();
  }
  await header(page,3).click({noWaitAfter:true});
  await expect(item(page,1)).toHaveCount(0);
 });

 test('edit a queued item updates its payload, Delete removes it',async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  const a=`edit-${tok}-a`,b=`edit-${tok}-b`;
  await queue(page,a);await queue(page,b);await expand(page,2);
  await item(page,1).fill(a+' edited');
  await expect(item(page,1)).toHaveValue(a+' edited');
  await expect(page.getByTestId('transcript-viewport').getByText(a+' edited',{exact:true}),'transcript bubble shows the edited payload').toBeVisible();
  await page.getByRole('button',{name:'Delete queued message 1',exact:true}).click({noWaitAfter:true});
  await expect(header(page,1)).toBeVisible();
  await expect(item(page,1)).toHaveValue(b);
  await expect(item(page,2)).toHaveCount(0);
  await release(bridge,tok);
  await expect.poll(async()=>(await prompts(bridge)).filter(text=>text.includes(`edit-${tok}-`))).toEqual([b]);
 });

 test('dragging a queued item handle reorders the queue',async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  const a=`drag-${tok}-a`,b=`drag-${tok}-b`;
  await queue(page,a);await queue(page,b);await expand(page,2);
  const handle=page.getByLabel('Drag queued message 1',{exact:true});
  const box=await handle.boundingBox();if(!box)throw Error('Drag handle has no box');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2+100,{steps:12});await page.mouse.up();
  await expect(item(page,1)).toHaveValue(b);
  await expect(item(page,2)).toHaveValue(a);
  await page.getByRole('switch',{name:'Deliver queued as one message',exact:true}).click({noWaitAfter:true});
  await release(bridge,tok);
  await expect.poll(async()=>(await prompts(bridge)).filter(text=>text.includes(`drag-${tok}-`)),{timeout:20000}).toEqual([b,a]);
 });

 test('Merge previews in the composer; Cancel merge restores items; Save queued merge makes one',async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  const a=`merge-${tok}-a`,b=`merge-${tok}-b`;
  await queue(page,a);await queue(page,b);await expand(page,2);
  await page.getByRole('button',{name:'Merge',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText('Merge preview · edit below, then save',{exact:true})).toBeVisible();
  const preview=page.getByRole('textbox',{name:'Merged queue preview',exact:true});
  await expect(preview).toHaveValue(`${a}\n\n${b}`);
  await page.getByRole('button',{name:'Cancel merge',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText('Merge preview · edit below, then save',{exact:true})).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expand(page,2);
  await expect(item(page,2)).toHaveValue(b);
  await page.getByRole('button',{name:'Merge',exact:true}).click({noWaitAfter:true});
  await preview.fill(`merge-${tok}-saved one message`);
  await page.getByRole('button',{name:'Save queued merge',exact:true}).click({noWaitAfter:true});
  await expect(header(page,1)).toBeVisible();
  await expand(page,1);
  await expect(item(page,1)).toHaveValue(`merge-${tok}-saved one message`);
  await expect(composer(page)).toBeVisible();
  await release(bridge,tok);
  await expect.poll(async()=>(await prompts(bridge)).filter(text=>text.includes(`merge-${tok}-`))).toEqual([`merge-${tok}-saved one message`]);
 });

 test('Steer all now sends the queue as a steer into the running Hermes turn and empties the stack',async({page,bridge})=>{
  await openChat(page,bridge);await chooseHarness(page,'Hermes');
  const tok=token();
  await send(page,holder(tok,'steer target'));
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Steer',exact:true}).or(page.getByRole('button',{name:'Choose Queue for next turn',exact:true})).first(),'running Hermes turn is steerable').toBeVisible();
  const a=`steer-${tok}-a`,b=`steer-${tok}-b`;
  await queue(page,a);await queue(page,b);
  await expect(header(page,2)).toBeVisible();
  const steerAll=page.getByRole('button',{name:'Steer all now',exact:true});
  await expect(steerAll).toBeEnabled();
  await steerAll.click({noWaitAfter:true});
  await expect(anyHeader(page),'stack empties').toHaveCount(0);
  await expect(page.getByText(new RegExp(`${esc(a)}\\s+${esc(b)}`)).first(),'merged steer bubble').toBeVisible();
  // The fixture Hermes is not gateway-hosted, so the bridge must answer the steer visibly.
  await expect(page.getByText(/Steered ·|Sending steer…|steering was not sent|Steer requires|Delivery failed/i).filter({visible:true}).first()).toBeVisible();
  expect((await prompts(bridge)).filter(text=>text.includes(`steer-${tok}-`)),'a steer is not a new queued turn').toEqual([]);
 });

 test('Clear removes all queued items',async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  const a=`clear-${tok}-a`,b=`clear-${tok}-b`;
  await queue(page,a);await queue(page,b);
  await expect(header(page,2)).toBeVisible();
  await page.getByRole('button',{name:'Clear',exact:true}).click({noWaitAfter:true});
  await expect(anyHeader(page)).toHaveCount(0);
  await expect(page.getByText(a,{exact:true})).toHaveCount(0);
  await expect(page.getByText(b,{exact:true})).toHaveCount(0);
  await release(bridge,tok);
  await expect(page.getByText(new RegExp('ARMY_REPLY: '+esc(holder(tok,'queue holder')))).first()).toBeVisible();
  await page.waitForTimeout(2000);
  expect((await prompts(bridge)).filter(text=>text.includes(`clear-${tok}-`)),'cleared items are never sent').toEqual([]);
 });

 for(const asOne of [true,false])test(`Deliver queued as one message ${asOne?'on: one combined turn':'off: one turn per item'}`,async({page,bridge})=>{
  const tok=token();await holdTurn(page,bridge,tok);
  const a=`deliver-${tok}-a`,b=`deliver-${tok}-b`;
  await queue(page,a);await queue(page,b);await expand(page,2);
  const toggle=page.getByRole('switch',{name:'Deliver queued as one message',exact:true});
  await expect(toggle).toContainText('On'); // Spec fix: RN Web drops accessibilityState.checked
  if(!asOne){
   await toggle.click({noWaitAfter:true});
   await expect(toggle).toContainText('Off');
  }
  await release(bridge,tok);
  const expected=asOne?[`${a}\n\n${b}`]:[a,b];
  await expect.poll(async()=>(await prompts(bridge)).filter(text=>text.includes(`deliver-${tok}-`)),{timeout:20000}).toEqual(expected);
  await expect(anyHeader(page)).toHaveCount(0);
 });
});
