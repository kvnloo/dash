import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair, createBridge } from './fixtures';

test('Chats paired with groot lists mbp live and native finished chats and retains the last good peer roster', async ({page}, info) => {
 const peer = await createBridge(true,{rosterHost:'mbp',finishedSessions:true});
 try {
  const local = await createBridge(true,{rosterHost:'groot',rosterPeer:peer,finishedSessions:true});
  try {
   await pair(page,local);
   // Both computers deliberately use identical session IDs: neither row may overwrite the other.
   for (const id of ['live:omp:army-fixture-session','mbp:omp:army-fixture-session']) {
    const row=page.getByTestId('chat-row-'+id);
    await row.scrollIntoViewIfNeeded({timeout:20000});
    await expect(row).toBeVisible();
   }
   for (const host of ['groot','mbp']) for (const kind of ['codex','claude']) {
    const row=page.getByTestId(`chat-row-${host}:${kind}:army-finished-${kind}`);
    await row.scrollIntoViewIfNeeded({timeout:20000});
    await expect(row).toBeVisible();
    await expect(row).toContainText(`ARMY finished ${kind==='codex'?'Codex':'Claude'} native chat`);
   }
   await page.getByRole('tab',{name:'Hosts',exact:true}).click({noWaitAfter:true});
   await expect(page.getByTestId('tree-row-host:mbp')).toContainText('4 chats');
   await page.screenshot({path:info.outputPath('mbp-host-chats.png')});
   const token=(await readFile(join(local.dir,'.dash','token'),'utf8')).trim();
   const roster=async (localOnly=false) => {
    const response=await page.request.get(`http://127.0.0.1:${local.port}/roster${localOnly?'?local=1':''}`,{headers:{Authorization:`Bearer ${token}`}});
    expect(response.status()).toBe(200);
    const body:unknown=await response.json();
    return body;
   };
   const peerHost = (body:unknown): unknown => {
    if (typeof body !== 'object' || body === null || !('hosts' in body) || !Array.isArray(body.hosts)) throw Error('Missing roster hosts');
    return body.hosts.find((host:unknown) => typeof host === 'object' && host !== null && 'id' in host && host.id === 'mbp');
   };
   const snapshot=await roster();
   expect(snapshot).toEqual(expect.objectContaining({hosts:expect.arrayContaining([
    expect.objectContaining({id:'mbp',agents:expect.arrayContaining([
     expect.objectContaining({kind:'omp',sessionId:'army-fixture-session',hostId:'mbp'}),
     expect.objectContaining({kind:'codex',sessionId:'army-finished-codex',hostId:'mbp'}),
     expect.objectContaining({kind:'claude',sessionId:'army-finished-claude',hostId:'mbp'}),
    ])}),
   ])}));
   // The peer-facing endpoint must not fan out or return another computer's agents.
   expect(await roster(true)).toEqual(expect.objectContaining({hosts:expect.arrayContaining([
    expect.objectContaining({id:'mbp',agents:[]}),
   ])}));
   await peer.stop();
   // A real failed peer request must preserve the validated rows, not silently replace them with [].
   expect(peerHost(await roster())).toEqual(peerHost(snapshot));
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('tab',{name:'Chats',exact:true}).click({noWaitAfter:true});
   await page.getByTestId('chat-row-mbp:codex:army-finished-codex').scrollIntoViewIfNeeded({timeout:20000});
   await expect(page.getByTestId('chat-row-mbp:codex:army-finished-codex')).toBeVisible();
   await page.getByTestId('chat-row-mbp:omp:army-fixture-session').scrollIntoViewIfNeeded();
   await expect(page.getByTestId('chat-row-mbp:omp:army-fixture-session')).toBeVisible();
   expect(local.logs()).toContain('pair.claim');
   await writeFile(info.outputPath('mesh-roster.json'),JSON.stringify(snapshot,null,2));
   await page.screenshot({path:info.outputPath('mesh-chats-last-good.png')});
  } finally {
   await local.dispose();
   await writeFile(info.outputPath('bridge.log'),local.logs());
  }
 } finally {
  await peer.dispose();
  await writeFile(info.outputPath('peer-bridge.log'),peer.logs());
 }
});
