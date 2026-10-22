import { afterEach, expect, test } from "bun:test";
import { record } from "../../../shared/z0bridge-identity";
import { snapshotFixture, commandFixture } from "../../../shared/agent-surface.test";
import { annotate, commitStroke, enterAnnotation } from "../store/annotate";
import { allowSurface, clearSurface, receiveSurface, setSurfaceActions, setSurfaceTransport, snapshot, surface, updateSurface } from "./state";
afterEach(()=>{ clearSurface(); allowSurface(false); setSurfaceActions(undefined); setSurfaceTransport(undefined); });
function setup() {
  const fixture=snapshotFixture(); updateSurface({...fixture}); allowSurface(true);
  const output: unknown[]=[];setSurfaceTransport(x=>output.push(x));
  setSurfaceActions({navigate:route=>updateSurface({route}),openAnnotation:()=>{enterAnnotation();updateSurface({annotationOpen:true});},rendered:async()=>{}});
  return {output, fixture:snapshot() ?? fixture};
}
test("agent drawings/clear/dismiss never overwrite or send user ink",async()=>{
  const f=setup();
  commitStroke({tool:"pen",color:"accent",pointer:"stylus",points:[{x:.1,y:.2,p:.5,t:1},{x:.3,y:.4,p:.5,t:2}],targets:[]});
  const original=annotate.get().drawing;
  const command=commandFixture(f.fixture);await receiveSurface({type:"surface_command",command});expect(surface.get().drawings.length).toBe(1);
  const current=snapshot() ?? f.fixture;
  await receiveSurface({type:"surface_command",command:{id:"clear",target:current.target,route:current.route,generation:current.generation,expiresAt:Date.now()+3000,op:"clear"}});
  expect(surface.get().drawings.length).toBe(0);expect(annotate.get().drawing).toBe(original);
});
test("wrong generation cannot draw, repeated IDs do not repeat navigation",async()=>{
  const f=setup();let navigations=0;
  setSurfaceActions({navigate:()=>{navigations++;},openAnnotation:()=>{},rendered:async()=>{}});
  const c=commandFixture(f.fixture);
  await receiveSurface({type:"surface_command",command:{...c,generation:-1}});expect(surface.get().drawings).toEqual([]);
  const nav={id:"nav",target:c.target,route:c.route,generation:c.generation,expiresAt:Date.now()+3000,op:"navigate",destination:"chat"};
  await receiveSurface({type:"surface_command",command:nav});await receiveSurface({type:"surface_command",command:nav});expect(navigations).toBe(1);
});
test("target change disables control and expiry removes only agent drawings",async()=>{
  const f=setup(),c={...commandFixture(f.fixture),ttlMs:500};
  await receiveSurface({type:"surface_command",command:c});expect(surface.get().drawings.length).toBe(1);
  await new Promise(r=>setTimeout(r,550));expect(surface.get().drawings.length).toBe(0);
  updateSurface({target:{...c.target,session:"other"}});expect(surface.get().enabled).toBe(false);
});
test("annotation open preserves existing drawing and requires readback",async()=>{
  const f=setup(),original=annotate.get().drawing;
  await receiveSurface({type:"surface_command",command:{id:"open",target:f.fixture.target,route:f.fixture.route,generation:f.fixture.generation,expiresAt:Date.now()+3000,op:"annotation.open"}});
  const last=f.output.at(-1);expect(record(last) && record(last.receipt) && last.receipt.status).toBe("rendered");
  expect(annotate.get().drawing).toBe(original);expect(annotate.get().active).toBe(true);
});
