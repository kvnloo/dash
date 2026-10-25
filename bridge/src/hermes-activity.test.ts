import { expect, test } from "bun:test";
import { activityHttp } from "./hermes-activity";
import { parseHermesHistory } from "./hermes-sessions";

test('activity authenticates before DB read, validates identity and caches at most 1Hz', async () => {
  let calls = 0; let now = 0;
  const handle = activityHttp(() => { calls++; return []; }, () => now);
  const req = () => new Request('http://localhost/hermes/activity?profile=clean&session=s');
  expect(handle(req(), false)?.status).toBe(401); expect(calls).toBe(0);
  expect(handle(new Request('http://localhost/hermes/activity'),true)?.status).toBe(400);
  const first = handle(req(),true)!; expect(first.status).toBe(200); expect(calls).toBe(1);
  const repeat = new Request(req(),{headers:{'If-None-Match':first.headers.get('ETag')!}});
  now = 999; expect(handle(repeat,true)?.status).toBe(304); expect(calls).toBe(1);
  now = 1000; handle(req(),true); expect(calls).toBe(2);
});
test('native in-progress and completed calls use stable IDs and persisted timestamps', () => {
  const start = {id:1,role:'assistant',timestamp:100,tool_calls:JSON.stringify([{id:'call-1',function:{name:'terminal',arguments:'{"command":"bun test"}'}}]),reasoning:'Check tests.'};
  const partial = parseHermesHistory([start]);
  expect(partial[0]?.parts?.some(p=>p.kind==='tool_start' && p.callId==='call-1')).toBe(true);
  const rows = [start,{id:2,role:'tool',timestamp:102,tool_call_id:'call-1',content:'{"exit_code":0,"output":"passed"}'}];
  expect(parseHermesHistory(rows)).toEqual(parseHermesHistory(rows));
  expect(parseHermesHistory(rows)[0]?.parts?.at(-1)).toMatchObject({kind:'tool_finish',callId:'call-1',durationMs:2000,status:'ok'});
});
