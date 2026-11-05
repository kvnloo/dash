import { expect, test } from 'bun:test';
import type { Conversation } from '../model';
import type { HistoryMessage } from '../../../shared/protocol';
import { hydrateLiveConversation } from './live-sessions';
test('native snapshots replace Dash-completed calls instead of duplicating them; live route wins', () => {
  const conversation: Conversation = {id:'c',harness:'hermes',title:'Native',createdAt:0,updatedAt:0,messages:[{id:'dash-a',role:'assistant',text:'',state:'done',at:1,turnId:'dash-turn',seq:1,parts:[{kind:'tool_start',callId:'shared-id',name:'terminal',summary:'echo ok',args:'{}'}]}]};
  const history: HistoryMessage[] = [{id:'native-a',role:'assistant',at:1,text:'',parts:[{kind:'tool_start',callId:'shared-id',name:'terminal',summary:'echo ok',args:'{}'},{kind:'tool_output',callId:'shared-id',text:'ok',truncated:false}]}];
  const once = hydrateLiveConversation(conversation,history); const twice = hydrateLiveConversation(once,history);
  expect(twice.messages).toHaveLength(1);
  const assistant=twice.messages[0]; expect(assistant?.role==='assistant' && assistant.parts?.filter(p=>p.kind==='tool_start')).toHaveLength(1);
  const running: Conversation={...conversation,messages:conversation.messages.map(m=>m.role==='assistant'?{...m,state:'streaming'}:m)};
  expect(hydrateLiveConversation(running,history)).toBe(running);
});
