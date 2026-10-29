import { test, expect } from 'playwright/test';
import { parseConversation, type Conversation } from '../../app/src/model';
import type { HistoryPage } from '../../shared/protocol';
import { createChatsApi, type ApiSettings } from '../../app/src/net/chats-api';
import { configureHistoryPages, dropHistory, fillOlder, historyState, loadOlder, primeCursor, setHistoryCursor } from '../../app/src/store/history-pages';
import { historyToMessages, hydrateLiveConversation, mergeOlderHistory, mergeTranscriptMessages } from '../../app/src/lib/live-sessions';
import { redactTool } from '../../shared/tool-format';

// Deterministic consumer state transitions, not browser/native-device acceptance.
function chat(id: string): Conversation {
  return {
    id, harness: 'hermes', title: 'Owned history', createdAt: 100, updatedAt: 300,
    endpointAddress: 'owned-a:4747', targetHostId: 'paired', profileId: 'hermes:session:default:owned', sessionId: 'owned',
    messages: [{ id: 'shown', role: 'assistant', text: 'Shown reply', at: 101, state: 'done', turnId: 'history:owned:shown', seq: 0 }],
  };
}
function network() {
  const requests: { url: string; response: PromiseWithResolvers<HistoryPage> }[] = [];
  const api = createChatsApi({
    token: async () => 'synthetic-test-credential',
    fetch: async url => {
      const response = Promise.withResolvers<HistoryPage>();
      requests.push({ url, response });
      const value = await response.promise;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => value };
    },
  });
  return { api, requests };
}
const page = (id: string, text: string): HistoryPage => ({ messages: [{ id, role: 'user', text, at: 10 }], before: null });

test('history loader clears its flag after endpoint ABA and a newer cursor without admitting the stale page', async () => {
  const conversation = chat('history-loader-aba');
  let settings: ApiSettings = { address: 'owned-a:4747', token: 'fixture-a' };
  const transport = network();
  configureHistoryPages({ api: transport.api, settings: () => settings, conversation: id => id === conversation.id ? conversation : undefined });
  try {
    const pending = primeCursor(conversation);
    await expect.poll(() => transport.requests.length).toBe(1);
    settings = { address: 'other-b:4747', token: 'fixture-b' };
    settings = { address: 'owned-a:4747', token: 'fixture-a' };
    setHistoryCursor(conversation.id, 'new-head-cursor');
    transport.requests[0].response.resolve(page('stale', 'Old endpoint page'));
    await pending;
    expect(historyState(conversation.id).loading).toBe(false);
    expect(historyState(conversation.id).older).toEqual([]);
    expect(historyState(conversation.id).before).toBe('new-head-cursor');
    const more = loadOlder(conversation);
    await expect.poll(() => transport.requests.length).toBe(2);
    expect(new URL(transport.requests[1].url).searchParams.get('before')).toBe('new-head-cursor');
    transport.requests[1].response.resolve(page('fresh', 'Current owner older transcript'));
    await more;
    expect(historyState(conversation.id).older.map(message => message.text)).toEqual(['Current owner older transcript']);
    expect(historyState(conversation.id).loading).toBe(false);
  } finally { dropHistory(conversation.id); }
});

test('history loader from a closed visit cannot clear the replacement visit loading flag or supply its page', async () => {
  const conversation = chat('history-loader-visit');
  const settings: ApiSettings = { address: 'owned-a:4747', token: 'fixture-a' };
  const transport = network();
  configureHistoryPages({ api: transport.api, settings: () => settings, conversation: id => id === conversation.id ? conversation : undefined });
  try {
    const old = primeCursor(conversation);
    await expect.poll(() => transport.requests.length).toBe(1);
    dropHistory(conversation.id);
    const current = primeCursor(conversation);
    await expect.poll(() => transport.requests.length).toBe(2);
    transport.requests[0].response.resolve(page('old-visit', 'Closed visit page'));
    await old;
    expect(historyState(conversation.id).loading).toBe(true);
    expect(historyState(conversation.id).older).toEqual([]);
    transport.requests[1].response.resolve(page('current-visit', 'Replacement visit transcript'));
    await current;
    expect(historyState(conversation.id).loading).toBe(false);
    expect(historyState(conversation.id).older.map(message => message.text)).toEqual(['Replacement visit transcript']);
  } finally { dropHistory(conversation.id); }
});

test('background history from a closed visit cannot populate a reopened chat with the same cursor', async () => {
  const conversation = chat('history-fill-visit');
  const settings: ApiSettings = { address: 'owned-a:4747', token: 'fixture-a' };
  const transport = network();
  configureHistoryPages({ api: transport.api, settings: () => settings, conversation: id => id === conversation.id ? conversation : undefined });
  let oldOpen = true;
  let currentOpen = true;
  let oldFill: Promise<void> | undefined;
  let currentFill: Promise<void> | undefined;
  try {
    setHistoryCursor(conversation.id, 'same-cursor');
    oldFill = fillOlder(conversation, () => oldOpen);
    await expect.poll(() => transport.requests.length).toBe(1);
    oldOpen = false;
    dropHistory(conversation.id);
    setHistoryCursor(conversation.id, 'same-cursor');
    currentFill = fillOlder(conversation, () => currentOpen);
    await expect.poll(() => transport.requests.length).toBe(2);
    transport.requests[0]!.response.resolve(page('old-visit', 'Closed visit page'));
    await oldFill;
    expect(historyState(conversation.id).unlisted).toEqual([]);
    expect(historyState(conversation.id).before).toBe('same-cursor');
    transport.requests[1]!.response.resolve(page('current-visit', 'Replacement visit page'));
    await currentFill;
    expect(historyState(conversation.id).unlisted.map(message => message.text)).toEqual(['Replacement visit page']);
    expect(historyState(conversation.id).before).toBe(null);
  } finally {
    oldOpen = false;
    currentOpen = false;
    for (const request of transport.requests) request.response.resolve({ messages: [], before: null });
    await Promise.allSettled([oldFill, currentFill].filter((pending): pending is Promise<void> => pending !== undefined));
    dropHistory(conversation.id);
  }
});

test('a scroll waiting on a closed visit cannot consume the replacement visit background page', async () => {
  const conversation = chat('history-fill-scroll-visit');
  const settings: ApiSettings = { address: 'owned-a:4747', token: 'fixture-a' };
  const transport = network();
  configureHistoryPages({ api: transport.api, settings: () => settings, conversation: id => id === conversation.id ? conversation : undefined });
  let open = true;
  const pending: Promise<void>[] = [];
  try {
    setHistoryCursor(conversation.id, 'same-cursor');
    const oldFill = fillOlder(conversation, () => open);
    pending.push(oldFill);
    await expect.poll(() => transport.requests.length).toBe(1);
    const oldScroll = loadOlder(conversation);
    pending.push(oldScroll);
    dropHistory(conversation.id);
    setHistoryCursor(conversation.id, 'same-cursor');
    const currentFill = fillOlder(conversation, () => open);
    pending.push(currentFill);
    await expect.poll(() => transport.requests.length).toBe(2);
    transport.requests[1]!.response.resolve(page('current-visit', 'Replacement visit page'));
    await currentFill;
    transport.requests[0]!.response.resolve(page('old-visit', 'Closed visit page'));
    await Promise.all([oldFill, oldScroll]);
    expect(historyState(conversation.id).older).toEqual([]);
    expect(historyState(conversation.id).unlisted.map(message => message.text)).toEqual(['Replacement visit page']);
    await loadOlder(conversation);
    expect(historyState(conversation.id).older.map(message => message.text)).toEqual(['Replacement visit page']);
    expect(historyState(conversation.id).unlisted).toEqual([]);
  } finally {
    open = false;
    for (const request of transport.requests) request.response.resolve({ messages: [], before: null });
    await Promise.allSettled(pending);
    dropHistory(conversation.id);
  }
});

test('native user-only persistence preserves the phone reply while canonical catch-up and rewind remain authoritative', () => {
  const conversation: Conversation = {
    ...chat('native-partial'),
    messages: [
      { id: 'local-user', role: 'user', text: 'New prompt', at: 100 },
      { id: 'local-assistant', role: 'assistant', text: 'Completed reply', at: 100, endedAt: 300, state: 'done', turnId: 'phone-turn', seq: 5 },
    ],
  };
  const earlier: HistoryPage['messages'] = [
    { id: 'earlier-user', role: 'user', text: 'Earlier prompt', at: 10 },
    { id: 'earlier-assistant', role: 'assistant', text: 'Earlier reply', at: 20 },
  ];
  const partial = hydrateLiveConversation(conversation, [...earlier, { id: 'native-user', role: 'user', text: 'New pro', truncated: true, at: 150 }]);
  expect(partial.messages.map(message => message.text)).toEqual(['Earlier prompt', 'Earlier reply', 'New prompt', 'Completed reply']);
  expect(partial.messages.at(-1)?.id).toBe('local-assistant');
  const caughtUp = hydrateLiveConversation(partial, [
    ...earlier,
    { id: 'native-user', role: 'user', text: 'New prompt', at: 150 },
    { id: 'native-assistant', role: 'assistant', text: 'Completed reply', at: 200 },
  ]);
  expect(caughtUp.messages.map(message => message.id)).toEqual(['earlier-user', 'earlier-assistant', 'native-user', 'native-assistant']);
  expect(hydrateLiveConversation(caughtUp, earlier).messages.map(message => message.text)).toEqual(['Earlier prompt', 'Earlier reply']);
  const unrelated = hydrateLiveConversation(conversation, [...earlier, { id: 'other-user', role: 'user', text: 'Different native prompt', at: 150 }]);
  expect(unrelated.messages.filter(message => message.role === 'user').map(message => message.text).sort()).toEqual(['Different native prompt', 'Earlier prompt', 'New prompt']);
  expect(unrelated.messages.find(message => message.id === 'local-assistant')?.text).toBe('Completed reply');
});

test('native catch-up ignores clock skew and reconciles newly polled source rows with a loaded phone turn', () => {
  const conversation: Conversation = {
    ...chat('clock-owned'),
    messages: [
      { id: 'phone-user', role: 'user', text: 'Same prompt', at: 9000 },
      { id: 'phone-assistant', role: 'assistant', text: 'Completed reply', at: 9000, endedAt: 9500, state: 'done', turnId: 'phone-turn', seq: 1 },
    ],
  };
  const native: HistoryPage['messages'] = [
    { id: 'native-user', role: 'user', text: 'Same prompt', at: 100 },
    { id: 'native-assistant', role: 'assistant', text: 'Completed reply', at: 200 },
  ];
  const canonical = hydrateLiveConversation(conversation, native);
  expect(canonical.messages.map(message => message.id)).toEqual(['native-user', 'native-assistant']);
  expect(mergeTranscriptMessages(conversation.messages, canonical.messages).map(message => message.id)).toEqual(['native-user', 'native-assistant']);
});

test('an old stopped phone turn cannot take a repeated prompt from a disjoint newer native cache window', () => {
  const conversation: Conversation = {
    ...chat('old-stopped'),
    messages: [
      ...historyToMessages([{ id:'old-anchor', role:'assistant', text:'Earlier source anchor', at:1 }], 'old-stopped', true),
      { id:'old-phone-user', role:'user', text:'continue', at:2 },
      { id:'old-phone-answer', role:'assistant', text:'Stopped partial reply', at:2, state:'interrupted', turnId:'old-turn', seq:1 },
    ],
  };
  const source: HistoryPage['messages'] = Array.from({length:80},(_,index)=>({
    id:`later-${index}`,role:index===20?'user':'assistant',text:index===20?'continue':`Later source ${index}`,at:100+index,
  }));
  const result=mergeTranscriptMessages(conversation.messages,historyToMessages(source,conversation.id,true));
  const sourceIds=new Set(source.map(message=>message.id));
  expect(result.filter(message=>sourceIds.has(message.id)).map(message=>message.id)).toEqual(source.map(message=>message.id));
  expect(result.findIndex(message=>message.id==='old-phone-answer')).toBeLessThan(result.findIndex(message=>message.id==='later-0'));
});

test('a retained stopped projection survives reload and a native window losing its prompt without duplicating or hiding new text', () => {
  const id='moving-native-window';
  const anchor: HistoryPage['messages']=[{id:'anchor',role:'assistant',text:'Known source anchor',at:1}];
  const conversation: Conversation={...chat(id),messages:[
    ...historyToMessages(anchor,id,true),
    {id:'local-user',role:'user',text:'Stop this reply',at:2},
    {id:'local-reply',role:'assistant',text:'Partial native reply',at:2,state:'interrupted',turnId:'stopped-turn',seq:1},
  ]};
  const tail: HistoryPage['messages']=[
    {id:'native-reply',role:'assistant',text:'Partial native reply',at:3},
    {id:'later-anchor',role:'assistant',text:'Later source message',at:4},
  ];
  const aligned=hydrateLiveConversation(conversation,[...anchor,{id:'native-user',role:'user',text:'Stop this reply',at:2},...tail]);
  const restored=parseConversation(JSON.parse(JSON.stringify(aligned)));
  if(!restored) throw Error('Saved retained projection must remain a readable conversation');
  const moved=hydrateLiveConversation(restored,tail);
  expect(moved.messages.filter(message=>message.text==='Partial native reply').map(message=>message.id)).toEqual(['local-reply']);
  expect(moved.messages.find(message=>message.id==='local-reply')).toMatchObject({state:'interrupted'});
  const continued=hydrateLiveConversation(moved,[{...tail[0]!,text:'Partial native reply continued on the host'},tail[1]!]);
  expect(continued.messages.filter(message=>message.role==='assistant').map(message=>message.text)).toEqual([
    'Known source anchor','Partial native reply','Partial native reply continued on the host','Later source message',
  ]);
});

test('a failed same-text phone attempt does not consume the native prompt of its successful retry', () => {
  const id='failed-retry';
  const anchor: HistoryPage['messages']=[{id:'anchor',role:'assistant',text:'Known source anchor',at:1}];
  const conversation: Conversation={...chat(id),messages:[
    ...historyToMessages(anchor,id,true),
    {id:'failed-user',role:'user',text:'Same choice',at:2},
    {id:'failed-answer',role:'assistant',text:'',at:2,state:'error',error:'Choice was not sent',turnId:'failed-turn',seq:0},
    {id:'retry-user',role:'user',text:'Same choice',at:3},
    {id:'retry-answer',role:'assistant',text:'Successful retry',at:3,state:'done',turnId:'retry-turn',seq:1},
  ]};
  const result=hydrateLiveConversation(conversation,[...anchor,
    {id:'native-retry-user',role:'user',text:'Same choice',at:4},
    {id:'native-retry-answer',role:'assistant',text:'Successful retry',at:5},
  ]);
  expect(result.messages.map(message=>message.id)).toEqual(['anchor','failed-user','failed-answer','native-retry-user','native-retry-answer']);
});

test('redacted native prompt and reply projections reconcile the unredacted live phone turn once', () => {
  const prompt='Inspect Bearer synthetic-user-value';
  const reply='Used Bearer synthetic-answer-value';
  const conversation: Conversation={...chat('redacted-native'),messages:[
    {id:'local-user',role:'user',text:prompt,at:9000},
    {id:'local-answer',role:'assistant',text:reply,at:9000,state:'done',turnId:'redacted-turn',seq:1},
  ]};
  const result=hydrateLiveConversation(conversation,[
    {id:'native-user',role:'user',text:redactTool(prompt),at:1},
    {id:'native-answer',role:'assistant',text:redactTool(reply),at:2},
  ]);
  expect(result.messages.map(message=>message.id)).toEqual(['native-user','native-answer']);
  expect(result.messages.map(message=>message.text)).toEqual([redactTool(prompt),redactTool(reply)]);
});

test('a retained old phone turn neither discards a server-keyset middle page nor moves it above the phone native anchor', async () => {
  const id='retained-paged';
  const conversation: Conversation={...chat(id),messages:[
    ...historyToMessages([{id:'old-native-anchor',role:'assistant',text:'Before the phone turn',at:1}],id,true),
    {id:'phone-user',role:'user',text:'Retained phone prompt',at:9000},
    {id:'phone-answer',role:'assistant',text:'Retained phone reply',at:9000,state:'interrupted',turnId:'retained-phone-turn',seq:1},
    ...historyToMessages([{id:'window-user',role:'user',text:'Newest native prompt',at:90},{id:'window-answer',role:'assistant',text:'Newest native reply',at:100}],id,true),
  ]};
  const settings:ApiSettings={address:'owned-a:4747',token:'synthetic-test-credential'};
  const transport=network();
  configureHistoryPages({api:transport.api,settings:()=>settings,conversation:key=>key===id?conversation:undefined});
  try {
    setHistoryCursor(id,'before-newest-native-window');
    const pending=loadOlder(conversation);
    await expect.poll(()=>transport.requests.length).toBe(1);
    expect(new URL(transport.requests[0]!.url).searchParams.get('before')).toBe('before-newest-native-window');
    transport.requests[0]!.response.resolve({before:null,messages:[
      {id:'middle-user',role:'user',text:'Middle native prompt',at:50},
      {id:'middle-answer',role:'assistant',text:'Middle native reply',at:51},
    ]});
    await pending;
    expect(historyState(id).older.map(message=>message.id)).toEqual(['middle-user','middle-answer']);
    expect(mergeOlderHistory(conversation.messages,historyState(id).older).map(message=>message.id)).toEqual([
      'old-native-anchor','phone-user','phone-answer','middle-user','middle-answer','window-user','window-answer',
    ]);
  } finally { dropHistory(id); }
});

test('older native rows precede a retained projection at its actual source ids, not the phone clock', () => {
  const id='projected-paging';
  const conversation:Conversation={...chat(id),messages:[
    ...historyToMessages([{id:'anchor-a',role:'assistant',text:'A',at:1}],id,true),
    {id:'phone-user',role:'user',text:'P',at:9000},
    {id:'phone-reply',role:'assistant',text:'R',at:9000,state:'interrupted',turnId:'phone-turn',seq:1,
      nativeProjection:{userId:'native-user',replyIds:['native-reply']}},
    ...historyToMessages([{id:'anchor-b',role:'assistant',text:'B',at:10}],id,true),
  ]};
  const older=historyToMessages([
    {id:'before-prompt',role:'assistant',text:'Before P',at:2},
    {id:'native-user',role:'user',text:'P',at:3},
    {id:'native-reply',role:'assistant',text:'R',at:4},
    {id:'after-reply',role:'assistant',text:'After R',at:5},
  ],id,true);
  expect(mergeOlderHistory(conversation.messages,older).map(message=>message.id)).toEqual([
    'anchor-a','before-prompt','phone-user','phone-reply','after-reply','anchor-b',
  ]);
});

test('text-only native catchup retains phone attachments, disclosures and completion time', () => {
  const conversation:Conversation={...chat('rich-native-catchup'),messages:[
    {id:'phone-user',role:'user',text:'Review this file',at:9000,
      attachments:[{id:'0123456789abcdef0123456789abcdef',name:'requested.txt',mime:'text/plain',size:12}]},
    {id:'phone-reply',role:'assistant',text:'Review complete',at:9000,endedAt:9500,state:'done',turnId:'original-tool-owner',seq:5,
      activity:['Read requested.txt'],summaries:[{blockId:'reviewed',kind:'final',text:'Reviewed the attached file',model:'fixture-summary',durationMs:10}]},
  ]};
  const native:HistoryPage['messages']=[
    {id:'native-user',role:'user',text:'Review this file',at:1},
    {id:'native-reply',role:'assistant',text:'Review complete',at:2},
  ];
  const caughtUp=hydrateLiveConversation(conversation,native);
  expect(caughtUp.messages).toMatchObject([
    {id:'phone-user',attachments:[{name:'requested.txt',size:12}]},
    {id:'phone-reply',endedAt:9500,turnId:'original-tool-owner',activity:['Read requested.txt'],
      summaries:[{text:'Reviewed the attached file'}],nativeProjection:{userId:'native-user',replyIds:['native-reply']}},
  ]);
  const refreshed=hydrateLiveConversation(caughtUp,native);
  expect(refreshed.messages.map(message=>message.text)).toEqual(['Review this file','Review complete']);
  expect(refreshed.messages.at(-1)).toMatchObject({endedAt:9500,activity:['Read requested.txt']});
});
