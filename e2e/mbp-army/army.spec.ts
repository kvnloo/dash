import {test,expect,pair,openChat,composer,chooseHarness,send,act,web,chatRow} from './fixtures';
import {writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test.describe('Claude Code session model identity',()=>{
 test.use({bridgeOptions:{archiveClaude:true}});
 test('fixture Claude session model shows in the chat header',async({page,bridge})=>{
  await pair(page,bridge);
  const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY archived Claude Code chat'});
  await expect(row).toHaveCount(1,{timeout:30000});
  await row.click({noWaitAfter:true});
  const badge=page.getByTestId('chat-window-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('claude-opus-5-5');
  await expect(badge).toHaveAttribute('aria-label',/session 11111111-2222-4333-8444-555555555555, model claude-opus-5-5, reported by host/);
  await expect(badge).not.toContainText('model unknown');
  await expect(badge).not.toContainText('not-an-assistant-model');
  await expect(badge).not.toContainText('claude-older-model');
 });
});

test('pairing, Chats tab, open and close real chat window',async({page,bridge})=>{
 await openChat(page,bridge);
 await expect(page.getByTestId('chat-window-badge')).toContainText(hostname()); // the bridge host, on any machine
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await chatRow(page).click({noWaitAfter:true});
 await expect(composer(page)).toBeInViewport();
});

test('main input names the selected agent with default feedback enabled and after reload',async({page,bridge},info)=>{
 await openChat(page,bridge);
 await chooseHarness(page,'Hermes');
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 // Logical viewports at 3x scale for the reported 1080x2340 and 1440x3120 phones.
 for (const viewport of [{width:360,height:780},{width:480,height:1040}]) {
  await page.setViewportSize(viewport);
  await expect(composer(page)).toHaveAttribute('placeholder','Message Hermes');
  await expect(composer(page)).toBeInViewport();
  await page.screenshot({path:info.outputPath(`main-input-hermes-${viewport.width}.png`)});
 }
 await page.getByRole('button',{name:/^(Create new chat|New chat)$/}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await chooseHarness(page,'OMP');
 await page.getByRole('button',{name:'Back',exact:true}).click({noWaitAfter:true});
 await expect(composer(page)).toHaveAttribute('placeholder','Message OMP');
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(composer(page)).toHaveAttribute('placeholder','Message OMP',{timeout:25000});
 // Selecting an agent and editing placeholder copy must not submit feedback or start a turn.
 await expect(page.getByText('Dash feedback',{exact:true})).toHaveCount(0);
 expect(bridge.logs()).not.toContain('turn.start');
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

// Hold the gauge long enough for onLongPress (350 ms) and let go. The mouse stays where it went down.
async function holdGauge(page:any,gauge:any){
 const box=await gauge.boundingBox();if(!box)throw Error('Context gauge has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
 return box as {x:number;y:number;width:number;height:number};
}

test('context gauge long-press opens a small grid peek just above the gauge',async({page,bridge},info)=>{
 await page.setViewportSize({width:390,height:780});
 await openChat(page,bridge);await send(page,'context grid peek journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const gauge=page.getByRole('button',{name:/^Context window,/});
 const g=await holdGauge(page,gauge);
 const peek=page.getByLabel('Context grid peek',{exact:true});
 await expect(peek).toBeVisible();await expect(peek).toBeInViewport({ratio:1});
 // A long press is not a tap: the card did not open.
 await expect(page.getByLabel('Context window details',{exact:true})).toHaveCount(0);
 // Anchored: its bottom edge is a few pixels over the gauge's top edge and the gauge sits under it.
 const p=await peek.boundingBox();if(!p)throw Error('Context grid peek has no box');
 const gap=g.y-(p.y+p.height);
 expect(gap,'peek bottom edge to gauge top edge').toBeGreaterThanOrEqual(0);expect(gap).toBeLessThanOrEqual(24);
 expect(g.x+g.width/2).toBeGreaterThan(p.x);expect(g.x+g.width/2).toBeLessThan(p.x+p.width);
 // Small: 20 columns of 7 px cells, well under half the screen.
 expect(p.width).toBeLessThan(220);expect(p.height).toBeLessThan(170);
 // The fixture harness has no native snapshot: nothing is claimed, every cell is free.
 await expect(peek.getByText('Context unknown',{exact:true})).toBeVisible();
 const cells=peek.getByLabel('Context grid cells',{exact:true});
 await expect(cells.locator('rect')).toHaveCount(200);await expect(cells.locator('rect[fill="none"]')).toHaveCount(200);
 const cell=await cells.boundingBox();if(!cell)throw Error('grid has no box');
 expect(cell.width).toBeCloseTo(20*7+19,0);expect(cell.height).toBeCloseTo(10*7+9,0);
 await page.screenshot({path:info.outputPath('context-grid-peek-390.png')});
 // Tapping outside dismisses it and opens nothing.
 await page.getByRole('button',{name:'Dismiss context preview',exact:true}).click({noWaitAfter:true,position:{x:8,y:8}});
 await expect(peek).toHaveCount(0);await expect(page.getByLabel('Context window details',{exact:true})).toHaveCount(0);
 // Tapping the peek opens the full card.
 await holdGauge(page,gauge);await expect(peek).toBeVisible();
 await peek.click({noWaitAfter:true});
 const card=page.getByLabel('Context window details',{exact:true});
 await expect(card).toBeVisible();await expect(card).toBeInViewport({ratio:1});await expect(peek).toHaveCount(0);
 await closeContextCard(page,gauge);
 // A plain tap on the gauge is unchanged: the card, no peek.
 await gauge.click({noWaitAfter:true});await expect(card).toBeVisible();await expect(peek).toHaveCount(0);
 await closeContextCard(page,gauge);
});

test('context card shows the grid instead of the bar',async({page,bridge},info)=>{
 await page.setViewportSize({width:390,height:780});
 await openChat(page,bridge);await send(page,'context grid card journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const gauge=page.getByRole('button',{name:/^Context window,/});
 await gauge.click({noWaitAfter:true});
 const card=page.getByLabel('Context window details',{exact:true});
 await expect(card).toBeVisible();await expect(card).toBeInViewport({ratio:1});
 const grid=card.getByLabel('Context grid',{exact:true});
 await expect(grid).toBeVisible();
 // 20 x 10 cells, all free without a snapshot, as tall as a grid and not the old 8 px bar.
 await expect(grid.locator('rect')).toHaveCount(200);await expect(grid.locator('rect[fill="none"]')).toHaveCount(200);
 const c=await card.boundingBox();const b=await grid.boundingBox();if(!c||!b)throw Error('card or grid has no box');
 expect(b.width,'grid spans the card').toBeGreaterThan(c.width-40);expect(b.height).toBeGreaterThan(100);
 await expect(card.getByText(/This harness has no native context snapshot/)).toBeVisible();
 await page.screenshot({path:info.outputPath('context-card-grid-390.png')});
 await closeContextCard(page,gauge);
});

// RC3 defect: the card's "Dismiss usage details" backdrop covered the gauge, so the gauge could not be pressed again.
test('context gauge stays pressable while its card is open: pressing it closes the card',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'context gauge pressable journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const gauge=page.getByRole('button',{name:/^Context window,/});
 const card=page.getByLabel('Context window details',{exact:true});
 for(let i=0;i<2;i++){
  await gauge.click({noWaitAfter:true});await expect(card).toBeVisible();
  // The card is open and the gauge is still the thing under the pointer, not the backdrop.
  await gauge.click({noWaitAfter:true});await expect(card).toHaveCount(0);
 }
});

test('an agent-reported context reading fills the grid in the peek and the card',async({page,bridge},info)=>{
 await page.setViewportSize({width:390,height:780});
 await openChat(page,bridge);await send(page,'ARMY_USAGE grid fill');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 // The fixture agent reports 85000 of 200000 tokens (usage_update): 1000 tokens a cell, 85 of 200 cells.
 const gauge=page.getByRole('button',{name:/^Context window,/});
 await gauge.click({noWaitAfter:true});
 const card=page.getByLabel('Context window details',{exact:true});
 await expect(card).toBeVisible();
 await expect(card.getByText('Context ~43%',{exact:true})).toBeVisible({timeout:20000});
 const grid=card.getByLabel('Context grid',{exact:true});
 await expect(grid.locator('rect')).toHaveCount(200);
 await expect(grid.locator('rect[fill="none"]')).toHaveCount(115);
 // The legend: the one reported category, Free space and the Autocompact buffer with tokens and percent.
 await expect(card.getByLabel('Used, estimated 85.0k tokens, 43%',{exact:true})).toBeVisible();
 await expect(card.getByText('~85.0k tokens (43%)',{exact:true})).toBeVisible();
 await expect(card.getByLabel('Free space, 115.0k tokens, 57%',{exact:true})).toBeVisible();
 await expect(card.getByText('~115.0k tokens (57%)',{exact:true})).toBeVisible();
 // No compaction threshold was reported, so the buffer is unknown, not zero.
 await expect(card.getByLabel('Autocompact buffer, unknown',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('context-card-filled-390.png')});
 await closeContextCard(page,gauge);
 await expect(page.getByRole('button',{name:'Context window, approximately 43 percent',exact:true})).toBeVisible();
 await holdGauge(page,gauge);
 const peek=page.getByLabel('Context grid peek',{exact:true});
 await expect(peek).toBeVisible();await expect(peek).toBeInViewport({ratio:1});
 await expect(peek.getByText('~43% · 85k / 200k',{exact:true})).toBeVisible();
 const cells=peek.getByLabel('Context grid cells',{exact:true});
 await expect(cells.locator('rect')).toHaveCount(200);await expect(cells.locator('rect[fill="none"]')).toHaveCount(115);
 await page.screenshot({path:info.outputPath('context-grid-peek-filled-390.png')});
 await page.getByRole('button',{name:'Dismiss context preview',exact:true}).click({noWaitAfter:true,position:{x:8,y:8}});
 await expect(peek).toHaveCount(0);
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

test('prompt rail keeps the selected turn preview when a live reply completes',async({page,bridge})=>{
 await openChat(page,bridge);
 await send(page,'earlier prompt stays selected');
 await expect(page.getByText(/ARMY_REPLY: earlier prompt stays selected/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 await send(page,'ARMY_SLOW later reply finishes during preview');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).nth(1)).toBeVisible();
 const rail=page.getByLabel('Prompt navigator',{exact:true});
 const box=await rail.boundingBox();if(!box)throw Error('Prompt navigator has no box');
 await page.mouse.move(box.x+box.width/2,box.y+1);
 await page.mouse.down();await page.mouse.up();
 const preview=page.getByLabel('Turn preview',{exact:true});
 await expect(preview).toBeVisible();await expect(preview).toContainText('Prompt 1/2');
 await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW later reply finishes during preview/).first()).toBeVisible({timeout:18000});
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 await expect(preview).toBeVisible();await expect(preview).toContainText('earlier prompt stays selected');
 await page.screenshot({path:test.info().outputPath('retained-turn-preview.png')});
 await page.getByRole('button',{name:'Jump',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('transcript-viewport').getByText('earlier prompt stays selected',{exact:true}).first()).toBeInViewport();
 await page.getByRole('button',{name:'Close turn preview',exact:true}).click({noWaitAfter:true});
 await expect(preview).toHaveCount(0);
 await page.getByRole('button',{name:'Latest reply',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('transcript-viewport').getByText(/ARMY_REPLY: ARMY_SLOW later reply finishes during preview/).first()).toBeInViewport();
 expect(bridge.logs()).toContain('pair.claim');
 expect(bridge.logs()).toContain('ws.open');
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
 test('conditional roster polls finish while an ephemeral turn stays queueable and stoppable',async({page,bridge})=>{
  const failedPolls:string[]=[];
  page.on('requestfailed',request=>{
   if(new URL(request.url()).pathname==='/roster') failedPolls.push(request.failure()?.errorText??'unknown failure');
  });
  await openChat(page,bridge);await send(page,'ARMY_HANG conditional roster lifecycle');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  for(let poll=0;poll<2;poll++){
   const response=await page.waitForResponse(response=>new URL(response.url()).pathname==='/roster'&&response.status()===304,{timeout:25000});
   // A received header is not a completed poll: the browser must deliver its empty body too.
   let completed=false;
   void response.finished().then(error=>{completed=error===null;});
   await expect.poll(()=>completed,{timeout:5000,message:'conditional roster response must finish without an aborted cache load'}).toBe(true);
   await composer(page).fill('queued draft survives conditional roster '+poll);
   await expect(page.getByRole('button',{name:'Queue',exact:true})).toBeEnabled();
   await expect(page.getByText('This chat has ended on the host. Its saved history is still on this phone.',{exact:true})).toHaveCount(0);
  }
  expect(failedPolls).toEqual([]);
  // With a sendable draft the primary action is Queue; Stop is the running-and-empty action.
  await composer(page).fill('');
  await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true});
  // Stopped: a fresh draft is Send again, not Queue.
  await composer(page).fill('after stop');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 });
 test('a missing roster row must not terminate a bridge-owned running turn',async({page,bridge})=>{
  await openChat(page,bridge);await send(page,'ARMY_HANG ephemeral ACP regression');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  // A fixed 5.5 s sleep missed the real 10 s roster poll and could false-green.
  // Observe an actual authenticated response, then let its React update paint.
  // 304 counts: builds with the If-None-Match roster poll get Not Modified once hosts are current.
  await page.bringToFront();
  const roster=await page.waitForResponse(response=>response.url().startsWith(`http://127.0.0.1:${bridge.port}/roster`)&&[200,304].includes(response.status()),{timeout:45000});
  await roster.finished();
  await page.waitForTimeout(500);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await composer(page).fill('queue behind still-running bridge turn');
  await expect(page.getByRole('button',{name:'Queue',exact:true})).toBeEnabled();
  await expect(page.getByText('This chat has ended on the host. Its saved history is still on this phone.',{exact:true})).toHaveCount(0);
 });
});
