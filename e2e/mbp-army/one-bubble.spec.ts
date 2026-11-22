// DA-020 (#498): a phone turn shows as exactly one user bubble and one reply bubble in every
// harness, also after the agent's own transcript (Hermes state.db, AgentsView for Claude Code and
// Codex, the OMP session file) records the same turn and the chat is reopened or the app reloads.
// The native rows are written the way each agent writes them; no app store or HTTP route is touched.
import {test,expect,pair,send,type Bridge} from './fixtures';
import type {Locator,Page} from 'playwright/test';
import {appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const transcript=(page:Page)=>page.getByTestId('transcript-viewport');
const chatRow=(page:Page,title:string|RegExp)=>typeof title==='string'
 ? page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:title})
 : page.getByTestId('chats-pane').getByRole('button',{name:title,includeHidden:true});

/** The count holds for two seconds: a late merge cannot pass by being sampled before it lands. */
async function steady(locator:Locator,count:number,message:string){
 await expect(locator).toHaveCount(count,{timeout:30000});
 const seen:number[]=[];
 for(let i=0;i<8;i++){seen.push(await locator.count());await locator.page().waitForTimeout(250);}
 expect(seen,message).toEqual(Array(8).fill(count));
}
async function onePair(page:Page,prompt:string,reply:string,when:string){
 await steady(transcript(page).getByText(prompt,{exact:true}),1,`one user bubble ${when}`);
 await steady(transcript(page).getByText(reply,{exact:true}),1,`one reply bubble ${when}`);
}
async function turnStarts(bridge:Bridge,prompt:string):Promise<number>{
 const rows=(await readFile(join(bridge.dir,'army-acp-turns.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 return rows.filter(row=>row.event==='start'&&row.text===prompt.slice(0,80)).length;
}
async function sendAndSettle(page:Page,prompt:string,reply:string){
 await send(page,prompt);
 await expect(transcript(page).getByText(reply,{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
 await onePair(page,prompt,reply,'once the reply streams');
}
async function reopen(page:Page,title:string|RegExp){
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(chatRow(page,title)).toHaveCount(1,{timeout:30000});
 await chatRow(page,title).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
async function reload(page:Page,title:string|RegExp){
 await page.reload({waitUntil:'domcontentloaded'});
 await page.getByRole('tab').nth(1).waitFor({timeout:60000});
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 if(await page.getByTestId('chat-window').count()===0){
  await expect(chatRow(page,title)).toHaveCount(1,{timeout:30000});
  await chatRow(page,title).click({noWaitAfter:true});
 }
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
const sqlite=(db:string,script:string,...args:string[])=>execFileSync('python3',['-c',script,db,...args],{encoding:'utf8'});

test('Hermes chat shows one user and one reply bubble after Hermes records the turn in state.db',async({page,bridge})=>{
 const prompt='ARMY_LEADING_BREAK ARMY one bubble Hermes';
 const reply='ARMY_STREAM_BEGIN ARMY_REPLY: '+prompt;
 const title='ARMY native fixture';
 // The bridge's own history frames for this session, to know when the native rows reached the app.
 let nativeFrames=0;
 page.on('websocket',socket=>socket.on('framereceived',event=>{
  if(typeof event.payload!=='string'||!event.payload.includes('"type":"history"'))return;
  if(event.payload.includes(JSON.stringify(reply)))nativeFrames++;
 }));
 await pair(page,bridge);
 await expect(chatRow(page,title)).toHaveCount(1,{timeout:30000});
 await chatRow(page,title).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await sendAndSettle(page,prompt,reply);
 // What Hermes writes after the turn: the stripped prompt and the stripped final response.
 const db=join(bridge.dir,'.hermes','state.db');
 sqlite(db,[
  'import sqlite3,sys,time',
  'db=sqlite3.connect(sys.argv[1])',
  'db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, timestamp REAL, reasoning TEXT, reasoning_content TEXT, tool_calls TEXT, tool_call_id TEXT, is_error INTEGER, active INTEGER DEFAULT 1)")',
  'now=time.time()',
  'db.execute("INSERT INTO messages (session_id,role,content,timestamp) VALUES (?,?,?,?)",("army-fixture-session","user",sys.argv[2],now-1))',
  'db.execute("INSERT INTO messages (session_id,role,content,timestamp) VALUES (?,?,?,?)",("army-fixture-session","assistant",sys.argv[3],now))',
  'db.execute("UPDATE sessions SET message_count=2, last_activity_at=? WHERE id=?",(now,"army-fixture-session"))',
  'db.commit()',
 ].join('\n'),prompt,reply);
 await expect.poll(()=>nativeFrames,{timeout:30000,message:'the native Hermes rows reach the open chat'}).toBeGreaterThan(0);
 await onePair(page,prompt,reply,'after the native history refresh');
 await reopen(page,title);
 await onePair(page,prompt,reply,'after reopening the chat');
 await reload(page,title);
 await onePair(page,prompt,reply,'after reloading the app');
 // One delivered turn, and one stored pair for it.
 expect(await turnStarts(bridge,prompt)).toBe(1);
 expect(sqlite(db,'import sqlite3,sys\nprint(sqlite3.connect(sys.argv[1]).execute("SELECT count(*) FROM messages WHERE session_id=?",("army-fixture-session",)).fetchone()[0])').trim()).toBe('2');
 expect(bridge.logs()).toMatch(/ws\.chat id=\S+ harness=hermes /);
});

for(const harness of [
 {name:'Claude Code',options:{archiveClaude:true},title:'ARMY archived Claude Code chat',session:'11111111-2222-4333-8444-555555555555',ordinal:5,tag:'ARMY_CLAUDE_REPLY: ',log:'claude'},
 {name:'Codex',options:{codex:true},title:'ARMY archived Codex chat',session:'codex:11111111-2222-4333-8444-5555555c0de5',ordinal:4,tag:'ARMY_CODEX_REPLY: ',log:'codex'},
] as const){
 test.describe(`${harness.name} one bubble per message`,()=>{
  test.use({bridgeOptions:harness.options});
  test(`${harness.name} chat shows one user and one reply bubble after AgentsView records the turn`,async({page,bridge})=>{
   const prompt=`ARMY one bubble ${harness.name}`;
   const reply='ARMY_STREAM_BEGIN '+harness.tag+prompt;
   await pair(page,bridge);
   await expect(chatRow(page,harness.title)).toHaveCount(1,{timeout:30000});
   await chatRow(page,harness.title).click({noWaitAfter:true});
   await expect(page.getByTestId('chat-window')).toBeVisible();
   await sendAndSettle(page,prompt,reply);
   // What AgentsView records from the agent's own transcript after the turn: two new ordinals.
   const db=join(bridge.dir,'.agentsview','sessions.db');
   sqlite(db,[
    'import sqlite3,sys,datetime',
    'db=sqlite3.connect(sys.argv[1])',
    'now=datetime.datetime.now(datetime.timezone.utc)',
    'stamp=lambda s: (now-datetime.timedelta(seconds=s)).isoformat().replace("+00:00","Z")',
    'o=int(sys.argv[4])',
    'db.execute("insert into messages (session_id, ordinal, role, content, timestamp, content_length) values (?,?,?,?,?,?)",(sys.argv[5],o,"user",sys.argv[2],stamp(2),len(sys.argv[2])))',
    'db.execute("insert into messages (session_id, ordinal, role, content, timestamp, content_length) values (?,?,?,?,?,?)",(sys.argv[5],o+1,"assistant",sys.argv[3],stamp(1),len(sys.argv[3])))',
    'db.execute("update sessions set message_count=message_count+2, ended_at=? where id=?",(stamp(0),sys.argv[5]))',
    'db.commit()',
   ].join('\n'),prompt,reply,String(harness.ordinal),harness.session);
   const history=page.waitForResponse(async response=>response.url().includes('/chats/history')&&response.status()===200&&(await response.text()).includes(reply),{timeout:30000});
   await reopen(page,harness.title);
   await history;
   await onePair(page,prompt,reply,'after reopening the chat over its native history');
   await reload(page,harness.title);
   await onePair(page,prompt,reply,'after reloading the app');
   expect(await turnStarts(bridge,prompt)).toBe(1);
   expect(bridge.logs()).toMatch(new RegExp(`ws\\.chat id=\\S+ harness=${harness.log} `));
  });
 });
}

test('OMP chat shows one user and one reply bubble after OMP records the turn in its session file',async({page,bridge})=>{
 const prompt='ARMY one bubble OMP';
 const reply='ARMY_STREAM_BEGIN ARMY_REPLY: '+prompt;
 const title=/^OMP ·/;
 await pair(page,bridge);
 await expect(chatRow(page,title)).toHaveCount(1,{timeout:30000});
 await chatRow(page,title).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await sendAndSettle(page,prompt,reply);
 // What OMP appends to the live session's transcript after the turn.
 const file=join(bridge.dir,'.omp','agent','sessions','army-fixture','fixture_army-fixture-session.jsonl');
 const now=Date.now();
 await appendFile(file,[
  {type:'message',id:'army-omp-user',timestamp:new Date(now-1000).toISOString(),message:{role:'user',content:[{type:'text',text:prompt}]}},
  {type:'message',id:'army-omp-reply',timestamp:new Date(now).toISOString(),message:{role:'assistant',content:[{type:'text',text:reply}]}},
 ].map(row=>JSON.stringify(row)).join('\n')+'\n');
 await reopen(page,title);
 await onePair(page,prompt,reply,'after reopening the chat');
 await reload(page,title);
 await onePair(page,prompt,reply,'after reloading the app');
 expect(await turnStarts(bridge,prompt)).toBe(1);
 expect(bridge.logs()).toMatch(/ws\.chat id=\S+ harness=omp /);
});
