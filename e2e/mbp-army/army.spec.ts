import {test,expect,pair,openChat,composer,chooseHarness,send,act,web,chatRow} from './fixtures';
import {writeFile} from 'node:fs/promises';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test('pairing, Chats tab, open and close real chat window',async({page,bridge})=>{
 await openChat(page,bridge);
 await expect(page.getByTestId('chat-window-badge')).toContainText('mbp');
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await chatRow(page).click({noWaitAfter:true});
 await expect(composer(page)).toBeInViewport();
});

test('composer typing, Send and streamed ACP reply',async({page,bridge,metrics})=>{
 await openChat(page,bridge);
 await act(metrics,'Dash composer fill',()=>composer(page).fill('ARMY_SLOW hello streamed UI'));
 await act(metrics,'Dash Send click',()=>page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true}));
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible({timeout:18000});
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
});

test('Stop cancels an active ACP turn and restores composer',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'ARMY_HANG cancel this');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 await composer(page).fill('after cancel');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_REPLY: after cancel/).first()).toBeVisible();
});

test('Queue preserves next prompt and sends after running turn',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'ARMY_SLOW first queued journey');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await composer(page).fill('second queued journey');
 await page.getByRole('button',{name:'Queue',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/second queued journey/).first()).toBeVisible();
 await expect(page.getByText(/ARMY_REPLY: second queued journey/).first()).toBeVisible({timeout:24000});
});

test('Steer running Hermes turn surfaces unsupported ACP delivery honestly',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await send(page,'ARMY_HANG steer target');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await composer(page).fill('steer instruction');
 await expect(page.getByRole('button',{name:'Steer',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Steer',exact:true}).click({noWaitAfter:true});
 // This bridge does not promise an ACP steering transport. Must visibly reject, not silently lose.
 await expect(page.getByText(/Steering is|steer.*(unavailable|unsupported|not supported)|Steer.*(unavailable|unsupported)|Delivery failed|Could not steer|No native API|No live/i).first()).toBeVisible();
});

test('file chooser uploads real bytes to isolated bridge',async({page,bridge})=>{
 await openChat(page,bridge);
 await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Files',exact:true}).click({noWaitAfter:true});
 await (await chooser).setFiles({name:'army-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('ARMY_ATTACHMENT_BYTES\n')});
 await expect(page.getByText('army-evidence.txt',{exact:true})).toBeVisible();
 const chip=page.getByLabel(/^army-evidence\.txt,/);
 await expect(chip).not.toHaveAttribute('aria-label',/Uploading|Failed|failed|error|Upload failed/,{timeout:15000});
 await expect(chip).toHaveAttribute('aria-label',/B|bytes/);
 await composer(page).fill('read attachment fixture');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
});

// Turbo renders the context card as a native Modal whose backdrop covers the gauge, so the
// gauge cannot toggle it closed; the backdrop is the close affordance. Accept either design.
async function closeContextCard(page:any,gauge:any){
 const backdrop=page.getByRole('button',{name:'Dismiss usage details',exact:true});
 if(await backdrop.count())await backdrop.first().click({noWaitAfter:true,position:{x:8,y:8}});else await gauge.click({noWaitAfter:true});
 await expect(page.getByLabel('Context window details',{exact:true})).toHaveCount(0);
}

test('context gauge opens a readable card inside the viewport',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'context card journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const gauge=page.getByRole('button',{name:/^Context window,/});
 await gauge.click({noWaitAfter:true});
 const card=page.getByLabel('Context window details',{exact:true});
 await expect(card).toBeVisible();await expect(card).toBeInViewport({ratio:1});
 await expect(card.getByText(/This harness has no native context snapshot/)).toBeVisible();
 await closeContextCard(page,gauge);
});

test('prompt rail mouse scrub, Jump and Latest on real transcript',async({page,bridge})=>{
 await openChat(page,bridge);
 for(let i=0;i<4;i++) {await send(page,'prompt '+i+' '+('transcript text '.repeat(24)));await expect(page.getByText(/ARMY_REPLY:/).nth(i)).toBeVisible();}
 const rail=page.getByLabel('Prompt navigator',{exact:true});await expect(rail).toBeVisible();
 const box=await rail.boundingBox();if(!box)throw Error('Prompt navigator has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height*.8);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height*.08,{steps:8});await page.mouse.up();
 const preview=page.getByLabel('Turn preview',{exact:true});await expect(preview).toBeVisible();
 await expect(preview).toContainText('Prompt 1/4');
 await page.getByRole('button',{name:'Jump',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('transcript-viewport').getByText(/^prompt 0 /).first()).toBeInViewport();
 await page.getByRole('button',{name:'Close turn preview',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:'Latest reply',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('transcript-viewport').getByText(/^prompt 3 /).first()).toBeInViewport();
});

test('harness picker switches OMP to Hermes without sending',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await expect(page.getByTestId('chat-window-badge')).toContainText('Hermes');
 await expect(composer(page)).toHaveAttribute('placeholder',/Hermes/);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
});

test('approvals screen reads real dry-run outbox and persists rejection',async({page,bridge})=>{
 await pair(page,bridge);
 await page.getByRole('button',{name:/^(Upstream approvals|Approvals), 1 pending$/}).first().click({noWaitAfter:true});
 await expect(page.getByText('Dry run · Nothing will be posted',{exact:true})).toBeVisible();
 await expect(page.getByText(/ARMY_APPROVAL_FIXTURE:/)).toBeVisible();
 await page.getByRole('button',{name:'Reject',exact:true}).click({noWaitAfter:true});
 await page.getByRole('textbox',{name:'Rejection reason',exact:true}).fill('ARMY dry-run rejection proof');
 await page.getByRole('button',{name:'Confirm reject',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/No pending proposals/)).toBeVisible();
 await page.getByRole('button',{name:'Show history',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/rejected · ARMY dry-run rejection proof/)).toBeVisible();
 await expect.poll(async()=>await readGate(bridge.dir)).toContain('ARMY dry-run rejection proof');
});
async function readGate(dir:string){const {readFile}=await import('node:fs/promises');return readFile(dir+'/gate/events.jsonl','utf8');}

test('draft text survives close, reopen and real browser reload',async({page,bridge})=>{
 await openChat(page,bridge);const draft='unsent draft persists through real reload';await composer(page).fill(draft);
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await chatRow(page).click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue(draft);
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.composerDrafts.v1'))).toContain(draft);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('tab').nth(1).waitFor({timeout:60000});await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await chatRow(page).click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue(draft);
});

test('bridge process death disables Send and restart reconnects',async({page,bridge})=>{
 await openChat(page,bridge);await composer(page).fill('draft while offline');
 await bridge.stop();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled({timeout:15000});
 await expect(page.getByText(/tap to retry|Connecting to bridge|Offline|Disconnected/i).first()).toBeVisible();
 await expect(composer(page)).toHaveValue('draft while offline');
 await bridge.start();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled({timeout:30000});
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_REPLY: draft while offline/).first()).toBeVisible();
});

test('real ACP error is surfaced visibly and leaves composer usable',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'ARMY_ERROR expose expected agent failure');
 await expect(page.getByText(/ARMY_EXPECTED_AGENT_ERROR|Agent error|ACP.*error|failed/i).first()).toBeVisible();
 await composer(page).fill('retry after error');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_REPLY: retry after error/).first()).toBeVisible();
});

for(const width of [390,800])test('safe exploratory controls and context hit target at '+width,async({page,bridge,errors})=>{
 await page.setViewportSize({width,height:780});await openChat(page,bridge);
 let seed=width;const next=()=>{seed=(seed*1664525+1013904223)>>>0;return seed%3;};
 for(let i=0;i<9;i++){
  const n=next();
  if(n===0){const g=page.getByRole('button',{name:/^Context window,/});await g.click({noWaitAfter:true});await expect(page.getByLabel('Context window details',{exact:true})).toBeInViewport({ratio:1});await closeContextCard(page,g);}
  else if(n===1){await page.getByTestId('chat-window-badge').click({noWaitAfter:true});await expect(page.getByTestId('chat-window-identity')).toBeVisible();await page.getByTestId('chat-window-badge').click({noWaitAfter:true});}
  else {await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});await chatRow(page).click({noWaitAfter:true});await expect(composer(page)).toBeInViewport();}
 }
 expect(errors.filter(e=>e.startsWith('PAGEERROR'))).toEqual([]);
});


test.describe('ephemeral ACP regression',()=>{
 test.use({persistSession:false});
 test('a missing roster row must not terminate a bridge-owned running turn',async({page,bridge})=>{
  await openChat(page,bridge);await send(page,'ARMY_HANG ephemeral ACP regression');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  // A fixed 5.5 s sleep missed the real 10 s roster poll and could false-green.
  // Observe an actual authenticated response, then let its React update paint.
  // 304 counts: builds with the If-None-Match roster poll get Not Modified once hosts are current.
  await page.bringToFront();
  const roster=await page.waitForResponse(response=>response.url().startsWith(`http://127.0.0.1:${bridge.port}/roster`)&&[200,304].includes(response.status()),{timeout:45000});
  // Chromium can satisfy a 304 from its HTTP cache without a requestfinished event, so
  // finished() never resolves for the conditional poll; bound it instead of hanging 180 s.
  await Promise.race([roster.finished(),page.waitForTimeout(2000)]);
  await page.waitForTimeout(500);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await composer(page).fill('queue behind still-running bridge turn');
  await expect(page.getByRole('button',{name:'Queue',exact:true})).toBeEnabled();
  await expect(page.getByText('This chat has ended on the host. Its saved history is still on this phone.',{exact:true})).toHaveCount(0);
 });
});
