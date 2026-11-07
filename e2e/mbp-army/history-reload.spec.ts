// Real phone turns and native journal rows must survive an offline app restart together.
import {test,expect,pair,send,REMOTE_SESSION} from './fixtures';
import type {Page} from 'playwright/test';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const title='ARMY remote Claude Code chat';
const early='ARMY reload early native answer';
const anchor='ARMY reload native anchor';
const prompt='ARMY_TOOLS ARMY reload phone turn';
const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
const newer='ARMY reload newer native answer';
const row=(page:Page)=>page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:title});
const record=(id:string,text:string)=>JSON.stringify({
 type:'assistant',uuid:id,timestamp:new Date().toISOString(),
 message:{role:'assistant',content:[{type:'text',text}]},
})+'\n';

// Read-only observation of the app's real persisted files, never a store seed.
async function saved(page:Page,area:'durable'|'cache',texts:string[]):Promise<boolean>{
 return page.evaluate(({area,texts})=>{
  const prefix=`dash.${area}.files.v2/`;
  const normalized=(text:string)=>text.replace(/\s+/g,' ').trim();
  const expectedReply=texts.find(text=>text.startsWith('ARMY_STREAM_BEGIN'));
  return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).some(key=>{
   try {
    const chat: {messages?: {role?:string;text?:string;state?:string}[]}=JSON.parse(localStorage.getItem(key) || '{}');
    const messages=chat.messages ?? [];
    return texts.every(text=>text==='"state":"done"'
     ? expectedReply !== undefined && messages.some(message=>message.role==='assistant' && message.state==='done' && typeof message.text==='string' && normalized(message.text)===normalized(expectedReply))
     : messages.some(message=>typeof message.text==='string' && normalized(message.text)===normalized(text)));
   } catch { return false; }
  });
 },{area,texts});
}


async function durableReplyHasNoToolPayload(page:Page):Promise<boolean>{
 return page.evaluate(text=>Object.keys(localStorage).filter(key=>key.startsWith('dash.durable.files.v2/')).some(key=>{
  try {
   const chat: {messages?: {role?:string; text?:string; state?:string; parts?:unknown; activity?:unknown; summaries?:unknown}[]} = JSON.parse(localStorage.getItem(key) || '{}');
   return chat.messages?.some(message=>message.role==='assistant' && typeof message.text==='string' &&
    message.text.replace(/\s+/g,' ').trim()===text.replace(/\s+/g,' ').trim() && message.state==='done' &&
    message.parts===undefined && message.activity===undefined && message.summaries===undefined) ?? false;
  } catch { return false; }
 }),reply);
}
async function expectOrdered(page:Page){
 const transcript=page.getByTestId('transcript-viewport');
 for(const text of [early,anchor,prompt,reply,newer]){
  const message=transcript.getByText(text,{exact:true});
  await expect(message).toHaveCount(1,{timeout:30000});
  await expect(message).toBeVisible();
 }
 await expect.poll(async()=>{
  // The inverted transcript's DOM order is not its visual order.
  const positions=await Promise.all([early,anchor,prompt,reply,newer].map(text=>
   transcript.getByText(text,{exact:true}).evaluate(element=>element.getBoundingClientRect().top)));
  return positions.every((position,index)=>index===0 || position>positions[index-1]);
 },{timeout:30000,message:'native rows, phone turn and later native row stay in transcript order'}).toBe(true);
}

test.describe('offline cached native history after a phone turn',()=>{
 test.use({bridgeOptions:{remoteClaude:'route'}});
 for(const active of [true,false]){
  test(active
   ? 'active chat keeps native and phone rows in order after an offline reload'
   : 'reopened chat keeps native and phone rows in order after an offline reload',async({page,bridge})=>{
   const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
   await mkdir(project,{recursive:true});
   const journal=join(project,REMOTE_SESSION+'.jsonl');
   await writeFile(journal,record('army-reload-early',early)+record('army-reload-anchor',anchor));
   await pair(page,bridge);
   await expect(row(page)).toHaveCount(1,{timeout:30000});
   await row(page).click({noWaitAfter:true});
   const transcript=page.getByTestId('transcript-viewport');
   await expect(transcript.getByText(early,{exact:true})).toBeVisible({timeout:30000});
   await expect(transcript.getByText(anchor,{exact:true})).toBeVisible();
   await send(page,prompt);
   await expect(transcript.getByText(reply,{exact:true})).toBeVisible({timeout:20000});
   await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
   const turns=await readFile(join(bridge.dir,'army-acp-turns.jsonl'),'utf8');
   expect(turns).toContain('"event":"end"');
   expect(bridge.logs()).toMatch(/turn\.remote id=\S+ harness=claude machine=army-remote/);
   await appendFile(journal,record('army-reload-newer',newer));
   await expect(transcript.getByText(newer,{exact:true})).toBeVisible({timeout:30000});
   await expectOrdered(page);
   await expect.poll(()=>saved(page,'durable',[prompt,reply,'"state":"done"']),{timeout:30000}).toBe(true);
   await expect.poll(()=>saved(page,'cache',[early,anchor,prompt,reply,newer]),{timeout:30000}).toBe(true);
   if(!active){
    const nativeId=await page.evaluate(()=>localStorage.getItem('dash.activeId.v1'));
    await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
    await expect(page.getByTestId('chat-window')).toBeHidden();
    await page.getByRole('button',{name:'Create new chat',exact:true}).first().click();
    await expect(page.getByRole('heading',{name:'New chat',exact:true})).toBeVisible();
    await expect.poll(()=>page.evaluate(id=>{
     const active=localStorage.getItem('dash.activeId.v1');
     return Boolean(active && active!==id);
    },nativeId),{timeout:30000}).toBe(true);
    await page.getByRole('button',{name:'Back',exact:true}).click();
   }else{
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.activeId.v1')),{timeout:30000}).toBeTruthy();
   }
   // Stop only this test's isolated bridge before reload: no fresh history can mask cache loss.
   await bridge.stop();
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('tab').nth(1).waitFor({timeout:60000});
   await page.getByRole('tab').nth(1).click({noWaitAfter:true});
   if(await page.getByTestId('chat-window').count()===0){
    await expect(row(page)).toHaveCount(1,{timeout:30000});
    await row(page).click({noWaitAfter:true});
   }
   await expect(page.getByTestId('chat-window')).toBeVisible();
   await expectOrdered(page);
   await expect.poll(()=>durableReplyHasNoToolPayload(page),{timeout:30000}).toBe(true);
  });
 }
});

test('unopened host chat keeps its durable phone turn through a roster update',async({page,bridge})=>{
 const nativeTitle='ARMY native fixture';
 const updatedTitle='ARMY native fixture roster updated';
 const phonePrompt='ARMY unopened roster durability';
 const phoneReply='ARMY_STREAM_BEGIN ARMY_REPLY: '+phonePrompt;
 await pair(page,bridge);
 const nativeRow=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:nativeTitle});
 await expect(nativeRow).toHaveCount(1,{timeout:30000});
 await nativeRow.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await send(page,phonePrompt);
 const transcript=page.getByTestId('transcript-viewport');
 await expect(transcript.getByText(phoneReply,{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
 expect(bridge.logs()).toMatch(/ws\.chat id=\S+ harness=hermes /);
 await expect.poll(()=>saved(page,'durable',[phonePrompt,phoneReply,'"state":"done"']),{timeout:30000}).toBe(true);
 await expect.poll(()=>page.evaluate(()=>{
  const rows: {harness:string;sessionId?:string;hasPending?:boolean}[]=JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
  return rows.some(row=>row.harness==='hermes' && row.sessionId==='army-fixture-session' && !row.hasPending);
 }),{timeout:30000}).toBe(true);
 const nativeId=await page.evaluate(()=>{
  const rows: {id:string;harness:string;sessionId?:string;hasPending?:boolean}[]=JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
  const chat=rows.find(row=>row.harness==='hermes' && row.sessionId==='army-fixture-session');
  if(!chat || chat.hasPending) throw Error('Native chat must be saved with no pending turn');
  return chat.id;
 });
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeHidden();
 await page.getByRole('button',{name:'Create new chat',exact:true}).first().click({noWaitAfter:true});
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await expect.poll(async()=>page.evaluate(id=>{
  const active=localStorage.getItem('dash.activeId.v1');
  return Boolean(active && active!==id);
 },nativeId),{timeout:30000}).toBe(true);
 // On startup only the other active chat is hydrated: the native chat remains an index stub.
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('tab').nth(1).waitFor({timeout:60000});
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 // Change the isolated host's native source, not app storage or an HTTP response. The bridge's
 // normal roster polling will discover the new source message and session metadata.
 execFileSync('python3',['-c',[
  'import sqlite3, sys, time',
  'db = sqlite3.connect(sys.argv[1])',
  'db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, timestamp REAL, reasoning TEXT, reasoning_content TEXT, tool_calls TEXT, tool_call_id TEXT, is_error INTEGER, active INTEGER DEFAULT 1)")',
  'db.execute("INSERT INTO messages (session_id,role,content,timestamp) VALUES (?,?,?,?)", ("army-fixture-session","assistant","ARMY native roster update",time.time()))',
  'db.execute("UPDATE sessions SET title=?, message_count=?, last_activity_at=? WHERE id=?", ("ARMY native fixture roster updated",1,time.time(),"army-fixture-session"))',
  'db.commit()',
  'db.close()',
 ].join('\n'),join(bridge.dir,'.hermes','state.db')]);
 // The index write follows the durable write, so seeing the changed roster metadata proves the
 // unopened stub's save has drained before we check its phone turn.
 await expect.poll(()=>page.evaluate(id=>{
  const rows: {id:string;title?:string;messageCount?:number}[]=JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
  const chat=rows.find(row=>row.id===id);
  return chat?.title==='ARMY native fixture roster updated' && chat.messageCount===1;
 },nativeId),{timeout:30000,message:'the native roster update reaches the unopened chat and is persisted'}).toBe(true);
 expect(await saved(page,'durable',[phonePrompt,phoneReply,'"state":"done"'])).toBe(true);
 await bridge.stop();
 if(await page.getByTestId('chat-window').isVisible()) await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 const updatedRow=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:updatedTitle});
 await expect(updatedRow).toHaveCount(1,{timeout:30000});
 await updatedRow.click({noWaitAfter:true});
 await expect(page.getByTestId('transcript-viewport').getByText(phonePrompt,{exact:true})).toBeVisible({timeout:30000});
 await expect(page.getByTestId('transcript-viewport').getByText(phoneReply,{exact:true})).toBeVisible();
});
