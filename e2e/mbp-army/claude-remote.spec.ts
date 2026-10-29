// Continue a Claude Code chat recorded on another computer from the phone (DASH_REMOTE_HOSTS).
// Real Expo web UI -> isolated real bridge -> ssh stand-in -> the real bridge/bin/dash-acp of this
// checkout -> Claude-shaped ACP fixture, resumed by session id without a history replay.
import {test,expect,composer,send,pair,REMOTE_SESSION} from './fixtures';
import {appendFile,mkdir,readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseServerMessage,type ServerMessage} from '../../shared/protocol';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const visible=(page:import('playwright/test').Page,rx:RegExp)=>page.getByText(rx).filter({visible:true}).first();
const remoteRow=(page:import('playwright/test').Page)=>page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY remote Claude Code chat'});
const lines=async(path:string)=>(await readFile(path,'utf8').catch(()=>'')).split('\n').filter(Boolean);

test.describe('Claude Code chat recorded on another computer',()=>{
 test.use({bridgeOptions:{remoteClaude:'route'}});
 test('follows live remote JSONL in the open chat without reopening',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  const record=(text:string)=>JSON.stringify({type:'assistant',uuid:text,timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text}]}})+'\n';
  await writeFile(path,record('ARMY live remote initial answer'));
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(visible(page,/ARMY live remote initial answer/)).toBeVisible({timeout:15000});
  await appendFile(path,record('ARMY live remote appended answer'));
  await expect(visible(page,/ARMY live remote appended answer/)).toBeVisible({timeout:30000});
  await expect(visible(page,/ARMY live remote initial answer/)).toBeVisible();
  await page.screenshot({path:info.outputPath('remote-live-history.png')});
  const hops=await lines(join(bridge.dir,'army-ssh.log'));
  expect(hops.filter(hop=>hop.startsWith('army-remote\tpython3 ')).length).toBeGreaterThanOrEqual(2);
  expect(bridge.logs()).not.toMatch(/ws\.chat |turn\.remote/);
 });
 test('completed phone turns survive stale and partial remote journals and reconcile repeated prompts',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  const record=(id:string,role:'user'|'assistant',text:string)=>JSON.stringify({
   type:role,uuid:id,timestamp:new Date().toISOString(),
   message:{role,content:[{type:'text',text}]},
  })+'\n';
  const initial='ARMY journal before phone turns';
  let journal=record('army-history-initial','assistant',initial);
  await writeFile(path,journal);
  // Passive observation only: the app sends every history request and the real
  // bridge reads the owned remote JSONL through its normal SSH route.
  const histories:Extract<ServerMessage,{type:'history'}>[]=[];
  page.on('websocket',socket=>socket.on('framereceived',frame=>{
   try{
    const message=parseServerMessage(JSON.parse(String(frame.payload)));
    if(message?.type==='history'&&message.harness==='claude'&&message.sessionId===REMOTE_SESSION)histories.push(message);
   }catch{/* Ignore non-protocol socket frames. */}
  }));
  const refreshed=async(after:number,texts:string[])=>{
   await expect.poll(()=>histories.slice(after).some(message=>
    message.messages.map(item=>item.text).join('\n')===texts.join('\n')
   ),{timeout:30000}).toBe(true);
   // A received frame precedes React's paint; assert after its UI consumer runs.
   await page.evaluate(()=>{
    const {promise,resolve}=Promise.withResolvers<void>();
    requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()));
    return promise;
   });
  };
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(visible(page,/ARMY journal before phone turns/)).toBeVisible({timeout:15000});
  const prompt='ARMY_HOLD repeated remote history prompt';
  const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
  const transcript=page.getByTestId('transcript-viewport');
  const confirmed=[initial];
  for(let turn=1;turn<=2;turn++){
   if(turn===2)await unlink(join(bridge.dir,'army-release'));
   await send(page,prompt);
   await expect(transcript.getByText('ARMY_STREAM_BEGIN',{exact:true})).toBeVisible();
   await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
   await writeFile(join(bridge.dir,'army-release'),'release\n');
   await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
   await expect(transcript.getByText(reply,{exact:true})).toHaveCount(turn);
   // No journal write: a subsequent genuine refresh still returns the older
   // snapshot, after the streamed turn has completed.
   await refreshed(histories.length,confirmed);
   await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(turn);
   await expect(transcript.getByText(reply,{exact:true})).toHaveCount(turn);
   // Native writers may flush the user row before the assistant row. Identical
   // prompts on distinct source IDs must not consume the previous turn twice.
   journal+=record('army-phone-user-'+turn,'user',prompt);
   const partialAfter=histories.length;
   await writeFile(path,journal);
   await refreshed(partialAfter,[...confirmed,prompt]);
   await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(turn);
   await expect(transcript.getByText(reply,{exact:true})).toHaveCount(turn);
   const host='ARMY genuinely new host message '+turn;
   journal+=record('army-phone-assistant-'+turn,'assistant',reply)+record('army-host-'+turn,'assistant',host);
   const catchupAfter=histories.length;
   await writeFile(path,journal);
   confirmed.push(prompt,reply,host);
   await refreshed(catchupAfter,confirmed);
   await expect(transcript.getByText(host,{exact:true})).toBeVisible();
   await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(turn);
   await expect(transcript.getByText(reply,{exact:true})).toHaveCount(turn);
  }
  await page.screenshot({path:info.outputPath('remote-history-catchup.png')});
  const turns=(await lines(join(bridge.dir,'army-acp-turns.jsonl'))).map(line=>JSON.parse(line));
  expect(turns.filter(turn=>turn.event==='start')).toHaveLength(2);
  expect(turns.filter(turn=>turn.event==='end')).toHaveLength(2);
  const calls=(await lines(join(bridge.dir,'army-acp-calls.jsonl'))).map(line=>JSON.parse(line));
  expect(calls.map(call=>({method:call.method,sessionId:call.sessionId}))).toEqual([
   {method:'session/resume',sessionId:REMOTE_SESSION},
   {method:'session/resume',sessionId:REMOTE_SESSION},
  ]);
 });
 test('resumes on that computer and streams the reply, turn after turn',async({page,bridge},info)=>{
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/View only/)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:/cannot route|Pair with that computer|host is unavailable/})).toHaveCount(0);
  await expect(page.getByTestId('chat-window-badge')).toHaveAttribute('aria-label',/host army-remote, harness Claude Code/);
  await expect(composer(page)).toBeEditable();
  await send(page,'ARMY_SLOW remote claude resume ping');
  await expect(visible(page,/ARMY_STREAM_BEGIN/)).toBeVisible({timeout:15000});
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await expect(visible(page,/ARMY_CLAUDE_REPLY: ARMY_SLOW remote claude resume ping/)).toBeVisible({timeout:20000});
  await page.screenshot({path:info.outputPath('remote-claude-reply.png')});
  await send(page,'second remote turn');
  await expect(visible(page,/ARMY_CLAUDE_REPLY: second remote turn/)).toBeVisible({timeout:20000});
  const log=bridge.logs();
  expect(log).toMatch(new RegExp(`ws\\.chat id=\\S+ harness=claude hostId=machine:army-remote profileId=av:claude:${REMOTE_SESSION} session=resume`));
  expect(log.match(/turn\.remote id=\S+ harness=claude machine=army-remote/g)?.length).toBe(2);
  expect(log).not.toMatch(/turn\.rejected/);
  // The hop: the ssh stand-in got the machine and the launcher command for the session's directory.
  const hops=(await lines(join(bridge.dir,'army-ssh.log'))).filter(hop=>hop.includes('\tdash-acp '));
  expect(hops.length).toBe(2);
  for(const hop of hops) expect(hop).toBe(`army-remote\tdash-acp claude --cwd '${join(bridge.dir,'remote-home','project')}'`);
  // The other computer: session/resume (no history replay) of the native id, in the session's directory.
  const calls=(await lines(join(bridge.dir,'army-acp-calls.jsonl'))).map(l=>JSON.parse(l));
  expect(calls.map(c=>c.method)).toEqual(['session/resume','session/resume']);
  for(const c of calls){expect(c.sessionId).toBe(REMOTE_SESSION);expect(c.cwd).toBe(join(bridge.dir,'remote-home','project'));expect(c.pwd).toBe(join(bridge.dir,'remote-home','project'));}
 });
 // Owner's S25: a chat once marked ended (before the bridge's routes were known) stayed
 // "This chat has ended on the host" forever, although the bridge still continues it.
 test('a chat saved as ended comes back sendable once the bridge routes to its computer',async({page,bridge})=>{
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(composer(page)).toBeEditable();
  await expect.poll(()=>page.evaluate(()=>(localStorage.getItem('dash.conversations.index.v3')??'').includes('av:claude:'))).toBe(true);
  await page.evaluate(()=>{const key='dash.conversations.index.v3';const rows=JSON.parse(localStorage.getItem(key)||'[]');for(const c of rows)if(String(c.profileId).startsWith('av:claude:'))c.stale=true;localStorage.setItem(key,JSON.stringify(rows));});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('tab').nth(1).waitFor({timeout:60000});await page.getByRole('tab').nth(1).click({noWaitAfter:true});
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/has ended on the host/)).toHaveCount(0,{timeout:15000});
  await expect(composer(page)).toBeEditable();
  await send(page,'after ended flag');
  await expect(visible(page,/ARMY_CLAUDE_REPLY: after ended flag/)).toBeVisible({timeout:20000});
  expect(bridge.logs()).not.toMatch(/turn\.rejected/);
 });
});

test.describe('remote machine names with the same first 56 characters',()=>{
 const prefix='a'.repeat(56);
 const first=prefix+'11111111';
 const second=prefix+'22222222';
 test.use({bridgeOptions:{remoteClaude:'route',env:{
  ARMY_REMOTE_MACHINES:first+','+second,
  DASH_REMOTE_HOSTS:first+'=first-hop,'+second+'=second-hop',
 }}});
 test('each long-named host opens and sends to its own native session route',async({page,bridge})=>{
  await pair(page,bridge);
  for(const [machine,destination] of [[first,'first-hop'],[second,'second-hop']]){
   const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY remote Claude Code chat '+machine});
   await expect(row).toHaveCount(1,{timeout:30000});
   await row.click({noWaitAfter:true});
   await expect(page.getByTestId('chat-window')).toBeVisible();
   await expect(page.getByTestId('chat-window-badge')).toHaveAttribute('aria-label',new RegExp('host '+machine+', harness Claude Code'));
   await expect(composer(page)).toBeEditable();
   const prompt='route to '+destination;
   await send(page,prompt);
   await expect(visible(page,new RegExp('ARMY_CLAUDE_REPLY: '+prompt))).toBeVisible({timeout:20000});
   await page.getByRole('button',{name:/^(Back|Close chat window)$/}).first().click({noWaitAfter:true});
   await expect(page.getByTestId('chats-pane')).toBeVisible();
  }
  const hops=(await lines(join(bridge.dir,'army-ssh.log'))).filter(hop=>hop.includes('\tdash-acp '));
  expect(hops.map(hop=>hop.split('\t')[0])).toEqual(['first-hop','second-hop']);
  const calls=(await lines(join(bridge.dir,'army-acp-calls.jsonl'))).map((line):unknown=>JSON.parse(line));
  expect(calls).toEqual([
   expect.objectContaining({method:'session/resume',sessionId:REMOTE_SESSION}),
   expect.objectContaining({method:'session/resume',sessionId:REMOTE_SESSION}),
  ]);
 });
});

test.describe('the same chat without a route to its computer',()=>{
 test.use({bridgeOptions:{remoteClaude:'off'}});
 test('opens view only and sends nothing',async({page,bridge})=>{
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/View only/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  expect(bridge.logs()).not.toMatch(/ws\.chat |turn\.remote/);
 });
});
