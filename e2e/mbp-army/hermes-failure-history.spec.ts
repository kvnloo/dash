import {test,expect,openChat,chooseHarness,send,composer} from './fixtures';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test('Hermes streamed failure remains visible after user-only native history catchup',async({page,bridge})=>{
 const prompt='ARMY_ERROR_AFTER_TEXT native history';
 const explanation='ARMY provider quota explanation before failure';
 let userOnlyHistory=false;
 page.on('websocket',socket=>socket.on('framereceived',event=>{
  if(typeof event.payload!=='string')return;
  let frame:unknown;
  try{frame=JSON.parse(event.payload);}catch{return;}
  if(typeof frame!=='object'||frame===null||!('type' in frame)||frame.type!=='history'||
   !('harness' in frame)||frame.harness!=='hermes'||!('sessionId' in frame)||frame.sessionId!=='army-fixture-session'||
   !('messages' in frame)||!Array.isArray(frame.messages))return;
  const row:unknown=frame.messages[0];
  if(frame.messages.length===1&&typeof row==='object'&&row!==null&&'role' in row&&row.role==='user'&&'text' in row&&row.text===prompt)userOnlyHistory=true;
 }));
 await openChat(page,bridge);
 await chooseHarness(page,'Hermes');
 await send(page,prompt);
 const transcript=page.getByTestId('transcript-viewport');
 await expect(transcript.getByText(explanation,{exact:true})).toBeVisible();
 await expect(transcript.getByText(/\(code -32603\)/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 // Reproduce the native persistence shape of the failed MBP Hermes turn:
 // its user row exists, but the provider-error reply was deliberately not saved.
 execFileSync('python3',['-c',[
  'import sqlite3,sys,time',
  'db=sqlite3.connect(sys.argv[1])',
  'db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, timestamp REAL, reasoning TEXT, reasoning_content TEXT, tool_calls TEXT, tool_call_id TEXT, is_error INTEGER, active INTEGER DEFAULT 1)")',
  'db.execute("INSERT INTO messages (session_id,role,content,timestamp) VALUES (?,?,?,?)",("army-fixture-session","user",sys.argv[2],time.time()))',
  'db.commit()',
  'db.close()',
 ].join('\n'),join(bridge.dir,'.hermes','state.db'),prompt]);
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 const failedRow=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:prompt});
 await expect(failedRow).toHaveCount(1);
 await failedRow.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await expect.poll(()=>userOnlyHistory,{timeout:30000,message:'actual user-only native history reaches the open chat'}).toBe(true);
 await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(1);
 await expect(transcript.getByText(explanation,{exact:true})).toBeVisible();
 await expect(transcript.getByText(/\(code -32603\)/)).toBeVisible();
 await composer(page).fill('next message stays available after the failed turn');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 expect(bridge.logs()).toMatch(/ws\.chat id=\S+ harness=hermes /);
});
