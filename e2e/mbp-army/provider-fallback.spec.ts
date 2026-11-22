// #501: a provider out of usage names the cause and the way on: another model for the next turn.
// The owner picks it in the composer and the same chat answers, with the model applied before the prompt.
import {test,expect,openChat,send} from './fixtures';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test('a provider out of usage offers another model and the chat answers with it',async({page,bridge})=>{
 await openChat(page,bridge);
 const transcript=page.getByTestId('transcript-viewport');
 await send(page,'ARMY_402 ask the exhausted provider');
 await expect(transcript.getByText(/out of usage or credits on this host; pick another model for the next turn/)).toBeVisible({timeout:20000});
 await expect(page.getByText(/ARMY_PROVIDER_DETAIL|balance exhausted/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 const model=page.getByTestId('composer-model-button');
 await model.click({noWaitAfter:true});
 await page.getByTestId('composer-model-input').fill('army/backup-model');
 await page.getByRole('button',{name:'Apply model'}).click({noWaitAfter:true});
 await expect(model).toContainText('army/backup-model');
 const prompt='ARMY ask again with the backup model';
 await send(page,prompt);
 const reply=transcript.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: '+prompt,{exact:true});
 await expect(reply).toBeVisible({timeout:20000});
 await expect(transcript.getByText(prompt,{exact:true})).toHaveCount(1);
 await expect(reply).toHaveCount(1);
 // The backup model is applied before the prompt, in the same chat.
 const turns=(await readFile(join(bridge.dir,'army-acp-turns.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const applied=turns.findIndex(row=>row.event==='model'&&row.text==='army/backup-model');
 const asked=turns.findIndex(row=>row.event==='start'&&row.text===prompt);
 expect(applied).toBeGreaterThan(-1);
 expect(asked).toBeGreaterThan(applied);
 expect(bridge.logs()).not.toMatch(/ARMY_PROVIDER_DETAIL/);
});
