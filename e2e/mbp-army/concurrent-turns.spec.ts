// Several agent replies at once, and a provider that has run out of usage (issues #498, #501).
// Real Expo web UI -> isolated real bridge -> one scripted ACP fixture process per turn. The fixture
// logs when each prompt started and ended (army-acp-turns.jsonl), so the specs can show overlap.
import {test,expect,pair,openChat,composer,send,chatRow} from './fixtures';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

type Turn={event:'start'|'end';at:number;text:string};
const turnLog=async(dir:string):Promise<Turn[]>=>(await readFile(join(dir,'army-acp-turns.jsonl'),'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>JSON.parse(l));
const when=(rows:Turn[],event:Turn['event'],text:string)=>{const row=rows.find(r=>r.event===event&&r.text.includes(text));if(!row)throw Error(`fixture never logged ${event} of "${text}"`);return row.at;};
// Leave the open chat for the Chats list: a new chat shows Back, an opened row shows Close chat window.
const toList=async(page:import('playwright/test').Page)=>{await page.getByRole('button',{name:/^(Back|Close chat window)$/}).first().click({noWaitAfter:true});await expect(page.getByTestId('chats-pane')).toBeVisible();};
// First match that is on screen: the Chats list keeps hidden previews ("Last reply · ...") of every chat.
const seen=(page:import('playwright/test').Page,rx:RegExp)=>page.getByText(rx).filter({visible:true}).first();
const stop=(page:import('playwright/test').Page)=>page.getByRole('button',{name:'Stop',exact:true});
// The bridge refuses a turn it cannot admit with this sentence; no spec run may ever show it.
const BUSY=/supervisor busy|concurrency is limited|already running \d+ agent turns/i;

test("a message in a second chat is answered while the first chat is still replying",async({page,bridge})=>{
 await openChat(page,bridge);
 // ARMY_HOLD: the first agent answers only when this spec releases it, so overlap is by construction.
 await send(page,'ARMY_HOLD first chat is held');
 await expect(seen(page,/ARMY_STREAM_BEGIN/)).toBeVisible();
 await expect(stop(page)).toBeVisible();

 // A second chat, while the first agent is still replying. Its answer must arrive with the first still held.
 await toList(page);
 await page.getByRole('button',{name:/^(Create new chat|New chat)$/}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await send(page,'second chat answers at once');
 await expect(seen(page,/ARMY_REPLY: second chat answers at once/)).toBeVisible({timeout:30000});
 await expect(page.getByText(BUSY)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();

 // The first chat is still mid-reply: its agent is held and has not answered.
 await toList(page);
 await chatRow(page).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await expect(stop(page)).toBeVisible();
 await expect(page.getByText(/ARMY_REPLY: ARMY_HOLD first chat is held/)).toHaveCount(0);
 expect((await turnLog(bridge.dir)).filter(r=>r.event==='end').map(r=>r.text)).toEqual([expect.stringContaining('second chat answers at once')]);

 // Release it: the first chat gets its own reply too.
 await writeFile(join(bridge.dir,'army-release'),'');
 await expect(seen(page,/ARMY_REPLY: ARMY_HOLD first chat is held/)).toBeVisible({timeout:30000});
 await expect(stop(page)).toHaveCount(0);
 await expect(page.getByText(BUSY)).toHaveCount(0);

 // On the host: two agent processes overlapped. The second prompt began and ended inside the first.
 const rows=await turnLog(bridge.dir);
 expect(rows.filter(r=>r.event==='start')).toHaveLength(2);
 const first={start:when(rows,'start','ARMY_HOLD first chat'),end:when(rows,'end','ARMY_HOLD first chat')};
 const second={start:when(rows,'start','second chat answers'),end:when(rows,'end','second chat answers')};
 expect(first.start).toBeLessThan(second.start);
 expect(second.end).toBeLessThan(first.end);
 const log=bridge.logs();
 expect(log.match(/ws\.chat /g)).toHaveLength(2);
 expect(log).not.toMatch(/turn\.rejected|supervisor busy/);
});

test("two messages to one chat, back to back, are both answered in order",async({page,bridge})=>{
 await openChat(page,bridge);
 await send(page,'ARMY_HOLD first message of two');
 await expect(seen(page,/ARMY_STREAM_BEGIN/)).toBeVisible();
 await composer(page).fill('second message right behind');
 await page.getByRole('button',{name:'Queue',exact:true}).click({noWaitAfter:true});
 await expect(seen(page,/1 queued/)).toBeVisible();
 // The second waits behind the first: still one agent turn on the host, and no answer yet.
 expect((await turnLog(bridge.dir)).filter(r=>r.event==='start')).toHaveLength(1);
 await expect(page.getByText(/ARMY_REPLY:/)).toHaveCount(0);

 await writeFile(join(bridge.dir,'army-release'),'');
 await expect(seen(page,/ARMY_REPLY: ARMY_HOLD first message of two/)).toBeVisible({timeout:30000});
 await expect(seen(page,/ARMY_REPLY: second message right behind/)).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 await expect(page.getByText(BUSY)).toHaveCount(0);
 // In order in the transcript: the first answer comes before the second.
 const transcript=await page.getByTestId('chat-window').innerText();
 expect(transcript.indexOf('ARMY_REPLY: ARMY_HOLD first message of two')).toBeGreaterThanOrEqual(0);
 expect(transcript.indexOf('ARMY_REPLY: ARMY_HOLD first message of two')).toBeLessThan(transcript.indexOf('ARMY_REPLY: second message right behind'));

 // On the host: two turns, one after the other, the second resuming the chat's session.
 const rows=await turnLog(bridge.dir);
 expect(rows.filter(r=>r.event==='start')).toHaveLength(2);
 expect(when(rows,'end','ARMY_HOLD first message')).toBeLessThanOrEqual(when(rows,'start','second message right'));
 const log=bridge.logs();
 expect(log.match(/ws\.chat [^\n]*session=new/g)).toHaveLength(1);
 expect(log.match(/ws\.chat [^\n]*session=resume/g)).toHaveLength(1);
 expect(log).not.toMatch(/turn\.rejected|supervisor busy/);
});

test("two windows sending into one chat at the same moment: the second waits and is answered after the first",async({page,bridge,browser},info)=>{
 // The host's live OMP session is one chat; the phone and a second window are two clients writing into it.
 const open=async(p:import('playwright/test').Page)=>{
  await pair(p,bridge);
  // The host's one live OMP row. Its title and id change with what the host has said about it, so pick it as the row that is not the Hermes fixture chat.
  const row=p.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasNotText:'ARMY native fixture'});
  await expect(row).toHaveCount(1,{timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(p.getByTestId('chat-window')).toBeVisible();
  await expect(composer(p)).toBeEditable();
 };
 await open(page);
 const other=await browser.newContext({viewport:{width:480,height:780},recordVideo:{dir:info.outputPath('window-b')}});
 try{
  const b=await other.newPage();
  await open(b);
  await composer(b).fill('window B message');
  // Window B queues its own send on the phone once its next roster poll (10 s apart) says the host session is busy.
  // Send in the second right after a poll, so both windows send before either has seen the other's turn.
  await b.waitForResponse(r=>r.url().startsWith(`http://127.0.0.1:${bridge.port}/roster`)&&[200,304].includes(r.status()),{timeout:45000});
  await send(page,'ARMY_HOLD window A message');
  await expect(seen(page,/ARMY_STREAM_BEGIN/)).toBeVisible();
  await expect(b.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await b.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  // The host got both messages for the same session, and the second agent has not started: it waits its turn.
  await expect.poll(()=>bridge.logs().match(/ws\.chat [^\n]*session=resume/g)?.length??0,{timeout:30000}).toBe(2);
  await b.waitForTimeout(1500);
  expect((await turnLog(bridge.dir)).filter(r=>r.event==='start')).toHaveLength(1);
  await expect(b.getByText(BUSY)).toHaveCount(0);
  await expect(b.getByText(/ARMY_REPLY:/)).toHaveCount(0);
  await b.screenshot({path:info.outputPath('window-b-waiting.png')});

  await writeFile(join(bridge.dir,'army-release'),'');
  await expect(seen(page,/ARMY_REPLY: ARMY_HOLD window A message/)).toBeVisible({timeout:30000});
  await expect(seen(b,/ARMY_REPLY: window B message/)).toBeVisible({timeout:30000});
  await expect(b.getByText(BUSY)).toHaveCount(0);
  await b.screenshot({path:info.outputPath('window-b-answered.png')});
 }finally{await other.close();}

 // On the host: one turn after the other, in the order the messages arrived.
 const rows=await turnLog(bridge.dir);
 expect(rows.filter(r=>r.event==='start')).toHaveLength(2);
 expect(when(rows,'end','ARMY_HOLD window A')).toBeLessThanOrEqual(when(rows,'start','window B message'));
 expect(bridge.logs()).not.toMatch(/turn\.rejected|supervisor busy/);
});

test("a provider 402 says the agent's account is out of usage, and the chat stays usable",async({page,bridge})=>{
 await openChat(page,bridge);
 await send(page,'ARMY_402 ping the broke provider');
 await expect(seen(page,/out of usage or credits/)).toBeVisible();
 // Fixed words only: never the generic hint, never the provider's own text.
 await expect(page.getByText(/check host authentication/i)).toHaveCount(0);
 await expect(page.getByText(/ARMY_PROVIDER_DETAIL|balance exhausted/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 await send(page,'ask again after the 402');
 await expect(seen(page,/ARMY_REPLY: ask again after the 402/)).toBeVisible();
 expect(bridge.logs()).not.toMatch(/ARMY_PROVIDER_DETAIL/);
});

test("a provider 429 says the host is being rate limited, and the chat stays usable",async({page,bridge})=>{
 await openChat(page,bridge);
 await send(page,'ARMY_429 ping the busy provider');
 await expect(seen(page,/rate limiting this host/)).toBeVisible();
 await expect(page.getByText(/check host authentication/i)).toHaveCount(0);
 await expect(page.getByText(/out of usage or credits/)).toHaveCount(0);
 await expect(page.getByText(/ARMY_PROVIDER_DETAIL|too many requests/i)).toHaveCount(0);
 await send(page,'ask again after the 429');
 await expect(seen(page,/ARMY_REPLY: ask again after the 429/)).toBeVisible();
});
