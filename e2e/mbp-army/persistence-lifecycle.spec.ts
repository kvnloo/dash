import { test, expect } from 'playwright/test';
import type { Conversation } from '../../app/src/model';
import { ConversationPersistence, durableConversation, indexEntry, type ConversationFiles } from '../../app/src/store/conversation-persistence';

// Controlled real persistence consumers, not browser/device acceptance.
const chat = (id: string): Conversation => ({ id, harness:'hermes', sessionId:'native-owned', endpointAddress:'A:1', title:'Saved phone turn', createdAt:1, updatedAt:200, messages:[
  {id:'anchor',role:'assistant',text:'Native anchor',at:1,state:'done',turnId:`history:${id}:anchor`,seq:0},
  {id:'phone-user',role:'user',text:'Older phone prompt',at:2},
  {id:'phone-reply',role:'assistant',text:'Completed phone reply',at:2,state:'done',turnId:'phone-past',seq:1},
] });
function storage() {
  const values = new Map<string,string>();
  const files: ConversationFiles = {
    list: async area => [...values.keys()].filter(key => key.startsWith(area+'/')).map(key => key.slice(area.length+1)),
    read: async (area,name) => values.get(area+'/'+name) ?? null,
    write: async (area,name,value) => { values.set(area+'/'+name,value); },
    remove: async (area,name) => { values.delete(area+'/'+name); },
  };
  return {values,files};
}

test('durable phone turns stay before a disjoint bounded native cache suffix after reload', async () => {
  const saved = chat('cache-suffix');
  const suffix: Conversation = {...saved,messages:Array.from({length:80},(_,index)=>({id:`native-${index}`,role:'assistant',text:`Later native ${index}`,at:100+index,state:'done',turnId:`history:${saved.id}:native-${index}`,seq:0}))};
  const disk = storage();
  disk.values.set(`cache/${saved.id}.json`,JSON.stringify(suffix));
  const restored = await new ConversationPersistence(disk.files).cached(durableConversation(saved));
  expect(restored.messages.map(message=>message.id)).toEqual([...saved.messages.map(message=>message.id),...suffix.messages.map(message=>message.id)]);
});

test('cached reply disclosures enrich durable text without replacing a newer live or durable answer', async () => {
  const saved = chat('cache-details');
  const answer = saved.messages.at(-1)!;
  if (answer.role !== 'assistant') throw Error('Fixture requires a completed phone answer');
  answer.activity=['Read the owned source','Updated the requested file'];
  answer.summaries=[{blockId:'final-owned',kind:'final',text:'Completed requested change',model:'fixture-summary',durationMs:10}];
  const disk=storage();
  disk.values.set(`cache/${saved.id}.json`,JSON.stringify(saved));
  const consumer=new ConversationPersistence(disk.files);
  const restored=(await consumer.cached(durableConversation(saved))).messages.at(-1)!;
  expect(restored).toMatchObject({text:answer.text,activity:answer.activity,summaries:answer.summaries});
  const newer={...saved,messages:[...saved.messages.slice(0,-1),{...answer,text:'Newer completed answer',seq:2,activity:undefined,summaries:undefined}]};
  expect((await consumer.cached(newer)).messages.at(-1)).toMatchObject({text:'Newer completed answer',seq:2});
});

test('one unreadable unloaded transcript does not block durable saves and the index of another chat', async () => {
  const bad=chat('bad-file');
  const good:Conversation={...chat('good-file'),sessionId:undefined,messages:[{id:'old',role:'user',text:'Existing local draft',at:1}]};
  const disk=storage();
  const invalid='{unreadable durable input';
  disk.values.set('durable/bad-file.json',invalid);
  disk.values.set('durable/good-file.json',JSON.stringify(good));
  let index=`[${indexEntry(bad)},${indexEntry(good)}]`;
  const consumer=new ConversationPersistence(disk.files,{read:async()=>index,write:async value=>{index=value;},remove:async()=>{index='';}});
  const loaded=await consumer.loadIndex();
  const goodStub=loaded!.chats.find(value=>value.id===good.id)!;
  const goodFull=await consumer.loadOne(goodStub);
  consumer.markLoaded(good.id);
  const changedGood:Conversation={...goodFull,messages:[...goodFull.messages,{id:'new',role:'user',text:'Latest unrelated local work',at:2}]};
  const badStub=loaded!.chats.find(value=>value.id===bad.id)!;
  await expect(consumer.save([{...badStub,title:'Roster changed'},changedGood])).rejects.toThrow('Invalid durable conversation');
  expect(disk.values.get('durable/bad-file.json')).toBe(invalid);
  const written=JSON.parse(disk.values.get('durable/good-file.json')!);
  expect(written.messages.map((message:{text:string})=>message.text)).toEqual(['Existing local draft','Latest unrelated local work']);
  expect(JSON.parse(index).find((value:{id:string})=>value.id===good.id).preview).toBe('Latest unrelated local work');
});
