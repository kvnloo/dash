import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentSurfaceBroker } from "./agent-surface";
import { commandFixture, snapshotFixture } from "../../shared/agent-surface.test";
import { record } from "../../shared/z0bridge-identity";
const dirs: string[] = [];
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path,{recursive:true,force:true}); });
function fixture(ack = true) {
  const directory=mkdtempSync(join(process.env.TMPDIR ?? process.cwd(),"surface-test-")); dirs.push(directory);
  const broker=new AgentSurfaceBroker({directory,url:()=>"http://127.0.0.1:4799",timeoutMs:20});
  const state=snapshotFixture(); let sends=0;
  const peer={ key:{},subject:"device-fixture", send(value:unknown) { sends++; if(ack && record(value) && record(value.command)) queueMicrotask(()=>broker.receive(peer,{type:"surface_receipt",receipt:{id:record(value.command)?value.command.id:"",status:"rendered",snapshot:state}})); } };
  broker.receive(peer,{type:"surface_state",state});
  const file=join(directory,readdirSync(directory)[0] ?? "missing");
  const grant=JSON.parse(readFileSync(file,"utf8"));
  const request=(command:unknown,cap=grant.capability) => new Request(`http://127.0.0.1:4799/agent-surface/${state.target.client}/command`,{method:"POST",headers:{authorization:`Bearer ${cap}`,"content-type":"application/json"},body:JSON.stringify(command)});
  return {broker,state,peer,grant,request,directory,file,sends:()=>sends};
}
test("owner-private scoped grant and exact per-client auth; no fire-and-forget",async()=>{
  const f=fixture(); expect(statSync(f.file).mode & 0o777).toBe(0o600);
  expect((await f.broker.http(f.request(commandFixture(f.state),"wrong")))?.status).toBe(401);
  for (const key of ["client", "host", "profile", "session", "chat"] as const) expect((await f.broker.http(f.request({...commandFixture(f.state),target:{...f.state.target,[key]:"wrong"}})))?.status).toBe(403);
  const wrongClient = new Request(`http://127.0.0.1:4799/agent-surface/dash-other/state`, { headers: { authorization: `Bearer ${f.grant.capability}` } });
  expect((await f.broker.http(wrongClient))?.status).toBe(401);
  const response=await f.broker.http(f.request(commandFixture(f.state))); expect(response?.status).toBe(200);
  const body: unknown = await response?.json(); expect(record(body) && body.status).toBe("rendered"); expect(f.sends()).toBe(1);
});
test("receipt replay idempotent; conflicting ID and stale route/layout rejected",async()=>{
  const f=fixture(), c=commandFixture(f.state);
  await f.broker.http(f.request(c)); await f.broker.http(f.request(c)); expect(f.sends()).toBe(1);
  expect((await f.broker.http(f.request({...c,ttlMs:1000})))?.status).toBe(409);
  expect((await f.broker.http(f.request({...c,id:"stale",generation:0})))?.status).toBe(409);
  expect((await f.broker.http(f.request({...c,id:"route",route:"lab"})))?.status).toBe(409);
});
test("wrong socket cannot hijack binding or forge an ack",async()=>{
  const f=fixture(false), c=commandFixture(f.state);
  const other={...f.peer,key:{},subject:"different-device"};
  f.broker.receive(other,{type:"surface_state",state:{...f.state,route:"lab"}});
  const result=f.broker.http(f.request(c));
  f.broker.receive(other,{type:"surface_receipt",receipt:{id:c.id,status:"rendered",snapshot:f.state}});
  const body: unknown=await (await result)?.json(); expect(record(body) && body.reason).toBe("render-ack-timeout");
  expect((await f.broker.http(f.request(c)))?.status).toBe(409); expect(f.sends()).toBe(1);
});
test("disable/disconnect revokes files, tokens and pending commands immediately",async()=>{
  const f=fixture(false); const result=f.broker.http(f.request(commandFixture(f.state)));
  await new Promise(resolve=>setTimeout(resolve,1));
  f.broker.receive(f.peer,{type:"surface_state",state:{...f.state,enabled:false}});
  const body: unknown=await (await result)?.json(); expect(record(body) && body.reason).toBe("disconnected-or-disabled"); expect(readdirSync(f.directory)).toEqual([]);
  expect((await f.broker.http(f.request(commandFixture(f.state))))?.status).toBe(401);
  const second=fixture(); second.broker.disconnect(second.peer.key);
  expect((await second.broker.http(second.request(commandFixture(second.state))))?.status).toBe(401);
});
test("bounded payload, no unknown operations or route params",async()=>{
  const f=fixture();
  expect((await f.broker.http(f.request({data:"x".repeat(17000)})))?.status).toBe(413);
  expect((await f.broker.http(f.request({...commandFixture(f.state),op:"send"})))?.status).toBe(400);
  expect((await f.broker.http(f.request({...commandFixture(f.state),params:{model:"foo"}})))?.status).toBe(400);
});
