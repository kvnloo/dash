import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, createBridge, openChat, chatRow, send } from './fixtures';
import { parseServerMessage, type ServerMessage } from '../../shared/protocol';

test('a phone-created OMP ACP session resumes after reconnect when no native roster row exists', async ({ page }, info) => {
  const bridge = await createBridge(false);
  const hellos: Extract<ServerMessage,{type:'hello'}>[] = [];
  const sessions: Extract<ServerMessage,{type:'session'}>[] = [];
  const sent: {type:string; text?:string; sessionId?:string; hostId?:string}[] = [];
  page.on('websocket', socket => {
    socket.on('framereceived', frame => {
      const message=parseServerMessage(JSON.parse(String(frame.payload)));
      if(message?.type==='hello') hellos.push(message);
      if(message?.type==='session') sessions.push(message);
    });
    socket.on('framesent', frame => {
      const message=JSON.parse(String(frame.payload));
      if(message.type==='chat') sent.push({type:message.type,text:message.text,sessionId:message.sessionId,hostId:message.hostId});
    });
  });
  const first='ARMY paired OMP first turn without native roster';
  const second='ARMY paired OMP same-session continuation after reload';
  try {
    await openChat(page,bridge);
    const rowId=await chatRow(page).getAttribute('data-testid');
    if(!rowId) throw Error('The actual new chat must expose its persistent row identity');
    await send(page,first);
    await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${first}`,{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
    await expect.poll(()=>sessions.length).toBe(1);
    const session=sessions[0]!;
    expect(session.harnessId).toBe('omp');
    expect(session.hostId).toBeTruthy();
    await expect.poll(()=>page.evaluate(({session,text})=>Object.entries(localStorage).some(([key,value])=>{
      if(!key.startsWith('dash.cache.files.v2/')) return false;
      const record=JSON.parse(value);
      return record.sessionId===session && record.messages.some((message:{text:string})=>message.text===text);
    }),{session:session.sessionId,text:`ARMY_STREAM_BEGIN ARMY_REPLY: ${first}`})).toBe(true);
    const before=hellos.length;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.getByRole('tab').nth(1).click();
    await expect.poll(()=>hellos.length).toBeGreaterThan(before);
    expect(hellos.at(-1)!.hosts.flatMap(host=>host.agents).filter(agent=>agent.kind==='omp'&&agent.sessionId===session.sessionId)).toEqual([]);
    await page.getByTestId(rowId).click();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await send(page,second);
    await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${second}`,{exact:true})).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({sessionId:session.sessionId,hostId:session.hostId,text:second});
    const starts=(await readFile(join(bridge.dir,'army-acp-turns.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.event==='start');
    expect(starts.map(row=>row.text)).toEqual([first,second]);
    await writeFile(info.outputPath('paired-acp-session-ownership.json'),JSON.stringify({session,chatRequests:sent,nativeRosterMatches:0},null,2));
    await page.screenshot({path:info.outputPath('final.png')});
  } finally { await bridge.dispose(); }
});
