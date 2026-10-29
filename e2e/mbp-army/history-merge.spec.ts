// Real remote Claude history refreshes through the isolated bridge and owned JSONL journal.
import {test,expect,send,pair,REMOTE_SESSION} from './fixtures';
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseServerMessage,type ServerMessage} from '../../shared/protocol';
import type {Page} from 'playwright/test';

const row=(page:Page)=>page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY remote Claude Code chat'});
const record=(id:string,role:'user'|'assistant',text:string)=>JSON.stringify({type:role,uuid:id,timestamp:new Date().toISOString(),message:{role,content:[{type:'text',text}]}})+'\n';
const lines=async(path:string)=>(await readFile(path,'utf8').catch(()=>'')).split('\n').filter(Boolean);

function observeHistory(page:Page) {
 const frames:Extract<ServerMessage,{type:'history'}>[]=[];
 page.on('websocket',socket=>socket.on('framereceived',frame=>{
  try {
   const message=parseServerMessage(JSON.parse(String(frame.payload)));
   if(message?.type==='history'&&message.harness==='claude'&&message.sessionId===REMOTE_SESSION)frames.push(message);
  } catch {/* Ignore non-protocol socket frames. */}
 }));
 const refreshed=async(after:number,texts:string[])=>{
  await expect.poll(()=>frames.slice(after).some(frame=>frame.messages.map(message=>message.text).join('\n')===texts.join('\n')),{timeout:30000}).toBe(true);
  await page.evaluate(()=>{
   const {promise,resolve}=Promise.withResolvers<void>();
   requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()));
   return promise;
  });
 };
 return {frames,refreshed};
}

async function openRemote(page:Page,bridge:Parameters<typeof pair>[1]) {
 await pair(page,bridge);
 await expect(row(page)).toHaveCount(1,{timeout:30000});
 await row(page).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test.describe('remote Claude native history catchup',()=>{
 test.use({bridgeOptions:{remoteClaude:'route'}});

 test('native text catchup preserves the streamed tool card and its original retained output owner',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  const initial='ARMY tool native anchor';
  let journal=record('tool-anchor','assistant',initial);
  await writeFile(path,journal);
  const {frames,refreshed}=observeHistory(page);
  const wire:{type:string;id?:string}[]=[];
  page.on('websocket',socket=>socket.on('framesent',frame=>{
   const message=JSON.parse(String(frame.payload));
   wire.push({type:message.type,id:message.id});
  }));
  await openRemote(page,bridge);
  const transcript=page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(initial,{exact:true})).toBeVisible();
  const prompt='ARMY_TOOL_DETAIL keep native catchup details';
  const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
  await send(page,prompt);
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('reply-tool-row')).toHaveCount(1);
  const owner=wire.find(message=>message.type==='chat')?.id;
  expect(owner).toBeTruthy();
  const after=frames.length;
  journal+=record('tool-native-user','user',prompt)+record('tool-native-reply','assistant',reply);
  await writeFile(path,journal);
  await refreshed(after,[initial,prompt,reply]);
  await expect(page.getByTestId('reply-tool-row')).toHaveCount(1);
  await page.getByTestId('reply-tool-row').click();
  await page.getByRole('button',{name:'Load retained output (up to 1 MiB)',exact:true}).last().click();
  await expect.poll(()=>wire.filter(message=>message.type==='tool_detail').map(message=>message.id)).toEqual([owner]);
  await expect(page.getByText(/ARMY_WRITE_RESULT: release notes saved/).last()).toBeVisible();
  await page.screenshot({path:info.outputPath('native-catchup-retained-tool.png')});
 });

 test('multipart and cut native catchup keep the complete streamed phone reply',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  const initial='ARMY multipart initial host';
  let journal=record('initial','assistant',initial);
  await writeFile(path,journal);
  const {frames,refreshed}=observeHistory(page);
  await openRemote(page,bridge);
  const transcript=page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(initial,{exact:true})).toBeVisible({timeout:15000});
  const prompt='ARMY_HOLD multipart reply';
  const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
  await send(page,prompt);
  await expect(transcript.getByText('ARMY_STREAM_BEGIN',{exact:true})).toBeVisible();
  await writeFile(join(bridge.dir,'army-release'),'release\n');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  const first='ARMY_STREAM_BEGIN ';
  const second='ARMY_CLAUDE_REPLY: '+prompt;
  journal+=record('phone-user','user',prompt)+record('phone-assistant-part-one','assistant',first);
  let after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[initial,prompt,first]);
  await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  const host='ARMY host after multipart';
  journal+=record('phone-assistant-part-two','assistant',second)+record('host','assistant',host);
  after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[initial,prompt,first,second,host]);
  await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(host,{exact:true})).toBeVisible();

  await unlink(join(bridge.dir,'army-release'));
  const longPrompt='ARMY_HOLD ARMY_LONG_REPLY cut native history';
  const longReply='ARMY_LONG_REPLY_BEGIN '+'x'.repeat(17000)+' ARMY_LONG_REPLY_END';
  await send(page,longPrompt);
  await expect(transcript.getByText(/ARMY_LONG_REPLY_BEGIN/)).toHaveCount(1);
  await writeFile(join(bridge.dir,'army-release'),'release\n');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
  await expect(transcript.getByText(longReply,{exact:true})).toHaveCount(1);
  journal+=record('long-user','user',longPrompt)+record('long-assistant','assistant',longReply);
  after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[initial,prompt,first,second,host,longPrompt,longReply.slice(0,16000)]);
  const cut=frames.slice(after).flatMap(frame=>frame.messages).find(message=>message.text===longReply.slice(0,16000));
  expect(cut?.truncated).toBe(true);
  await expect(transcript.getByText(longPrompt,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(longReply,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(longReply.slice(0,16000),{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('multipart-cut-history.png')});
  const turns=(await lines(join(bridge.dir,'army-acp-turns.jsonl'))).map(line=>JSON.parse(line));
  expect(turns.filter(turn=>turn.event==='start')).toHaveLength(2);
  expect(turns.filter(turn=>turn.event==='end')).toHaveLength(2);
  expect((await lines(join(bridge.dir,'army-ssh.log'))).filter(hop=>hop.startsWith('army-remote\tpython3 ')).length).toBeGreaterThanOrEqual(2);
 });

 test('first completed phone turn reconciles without a native predecessor',async({page,bridge})=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  await writeFile(path,'');
  const {frames,refreshed}=observeHistory(page);
  await openRemote(page,bridge);
  const transcript=page.getByTestId('transcript-viewport');
  const prompt='ARMY_HOLD first unanchored phone turn';
  const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
  await send(page,prompt);
  await expect(transcript.getByText('ARMY_STREAM_BEGIN',{exact:true})).toBeVisible();
  await writeFile(join(bridge.dir,'army-release'),'release\n');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  const after=frames.length;
  await writeFile(path,record('first-user','user',prompt)+record('first-assistant','assistant',reply));
  await refreshed(after,[prompt,reply]);
  await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  const turns=(await lines(join(bridge.dir,'army-acp-turns.jsonl'))).map(line=>JSON.parse(line));
  expect(turns.filter(turn=>turn.event==='start')).toHaveLength(1);
  expect(turns.filter(turn=>turn.event==='end')).toHaveLength(1);
 });

 test('first stopped and failed phone turns survive catchup before a later ordered host and completed turn',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  await writeFile(path,'');
  const {frames,refreshed}=observeHistory(page);
  await openRemote(page,bridge);
  const transcript=page.getByTestId('transcript-viewport');
  const stopped='ARMY_HANG first phone turn';
  await send(page,stopped);
  await expect(transcript.getByText('ARMY_STREAM_BEGIN',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true});
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
  await expect(transcript.getByText('Stopped',{exact:true})).toBeVisible();
  const failed='ARMY_ERROR failed phone turn';
  await send(page,failed);
  const failure=transcript.getByText(/ACP request failed during session\/prompt \(code -32000\)/);
  await expect(failure).toBeVisible();
  const prompt='ARMY_HOLD next completed phone turn';
  const reply='ARMY_STREAM_BEGIN ARMY_CLAUDE_REPLY: '+prompt;
  await send(page,prompt);
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await writeFile(join(bridge.dir,'army-release'),'release\n');
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0,{timeout:20000});
  await expect(transcript.getByText(reply,{exact:true})).toHaveCount(1);
  const host='ARMY host between phone turns';
  const journal=record('stopped-user','user',stopped)+record('stopped-assistant','assistant','ARMY_STREAM_BEGIN ')+
   record('failed-user','user',failed)+record('host-between','assistant',host)+
   record('next-user','user',prompt)+record('next-assistant','assistant',reply);
  const after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[stopped,'ARMY_STREAM_BEGIN ',failed,host,prompt,reply]);
  for(const text of [stopped,failed,host,prompt,reply])await expect(transcript.getByText(text,{exact:true})).toHaveCount(1);
  await expect(transcript.getByText('Stopped',{exact:true})).toBeVisible();
  await expect(failure).toBeVisible();
  const hostBox=await transcript.getByText(host,{exact:true}).boundingBox();
  const promptBox=await transcript.getByText(prompt,{exact:true}).boundingBox();
  expect(hostBox).not.toBeNull();
  expect(promptBox).not.toBeNull();
  if (!hostBox || !promptBox) throw new Error('History rows have no visual bounds');
  expect(hostBox.y+hostBox.height).toBeLessThanOrEqual(promptBox.y);
  await page.screenshot({path:info.outputPath('stopped-and-later-turn.png')});
  const starts=(await lines(join(bridge.dir,'army-acp-turns.jsonl'))).map(line=>JSON.parse(line)).filter(turn=>turn.event==='start');
  expect(starts.map(turn=>turn.text)).toEqual([stopped,failed,prompt]);
  expect((await lines(join(bridge.dir,'army-ssh.log'))).some(hop=>hop.startsWith('army-remote\tpython3 '))).toBe(true);
 });

 test('retained stopped projection stays singular when newest native window drops its prompt',async({page,bridge},info)=>{
  const project=join(bridge.dir,'remote-home','.claude','projects','army-project');
  await mkdir(project,{recursive:true});
  const path=join(project,REMOTE_SESSION+'.jsonl');
  const anchor='ARMY source projection anchor';
  let journal=record('projection-anchor','assistant',anchor);
  await writeFile(path,journal);
  const {frames,refreshed}=observeHistory(page);
  await openRemote(page,bridge);
  const transcript=page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(anchor,{exact:true})).toBeVisible({timeout:15000});
  const prompt='ARMY_HANG stopped projection crosses native head';
  const partial='ARMY_STREAM_BEGIN ';
  await send(page,prompt);
  await expect(transcript.getByText(partial.trim(),{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect(transcript.getByText('Stopped',{exact:true})).toBeVisible();
  journal+=record('projection-user','user',prompt)+record('projection-reply','assistant',partial);
  let after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[anchor,prompt,partial]);
  const advancement=Array.from({length:49},(_,index)=>`ARMY source advancement ${index+1}`);
  for(const [index,text] of advancement.entries()) journal+=record(`projection-later-${index}`,'assistant',text);
  after=frames.length;
  await writeFile(path,journal);
  await refreshed(after,[partial,...advancement]);
  const newest=advancement.at(-1)!;
  await expect.poll(()=>page.evaluate(({session,prompt,partial,newest})=>{
   for(const key of Object.keys(localStorage)) {
    if(!key.startsWith('dash.cache.files.v2/')) continue;
    const record=JSON.parse(localStorage.getItem(key)!);
    if(record.sessionId!==session || !record.messages.some((row:{text:string})=>row.text===newest)) continue;
    return {
     newest:true,
     prompts:record.messages.filter((row:{role:string;text:string})=>row.role==='user'&&row.text===prompt).length,
     replies:record.messages.filter((row:{role:string;text:string})=>row.role==='assistant'&&row.text.trim()===partial.trim()).map((row:{state:string})=>row.state),
    };
   }
   return null;
  },{session:REMOTE_SESSION,prompt,partial,newest}),{timeout:20000}).toEqual({newest:true,prompts:1,replies:['interrupted']});
  const latest=page.getByRole('button',{name:'Latest reply',exact:true});
  if(await latest.isVisible()) await latest.click();
  await expect(transcript.getByText(newest,{exact:true})).toBeVisible();
  await writeFile(info.outputPath('moving-window-source-counts.json'),JSON.stringify({nativeWindow:50,advancement:advancement.length,frames:frames.length}));
 });
});
