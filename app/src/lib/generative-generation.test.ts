import { expect, test } from "bun:test";
import { acceptsGeneration } from "./generative-stream";

test("L4: only the current, valid generation can paint", () => {
  expect(acceptsGeneration(2, 1)).toBe(false);
  expect(acceptsGeneration(2, 2)).toBe(true);
  expect(acceptsGeneration(2, 3)).toBe(false);
  for (const generation of [-1, NaN, Infinity, 1.5]) expect(acceptsGeneration(generation, generation)).toBe(false);
});

test("L4 real live store: correction immediately hides old artifacts; late old text/artifact/control cannot return", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    import {expect} from "bun:test";
    import {beginLiveTurn,applyLiveMessage,liveOf,liveStore,EMPTY_LIVE,beginOpen} from "./app/src/store/live";
    import {flowTrace} from "./app/src/lib/flow-trace";
    liveStore.set({c:{...EMPTY_LIVE, workerId:"w"}});
    const a=beginLiveTurn("c","first",false);
    const artifact={kind:"html",version:1,bytes:10,sha256:"hash",html:"<p>old</p>",createdAt:1};
    const event=(id,seq,event)=>applyLiveMessage({type:"live_event",id,seq,workerId:"w",event});
    event(a,1,{type:"artifact",artifact});
    expect(liveOf("c").shownVersion).toBe(1);
    const b=beginLiveTurn("c","correction",false);
    expect(liveOf("c").generation).toBe(2);
    expect(liveOf("c").shownVersion).toBeUndefined();
    expect(liveOf("c").controls).toEqual([]);
    event(b,1,{type:"artifact",artifact:{...artifact,version:2,html:"<p>new</p>"}});
    event(a,2,{type:"artifact",artifact:{...artifact,version:3}});
    event(a,3,{type:"delta",text:"stale fenced UI"});
    event(a,4,{type:"control",control:{id:"old",kind:"confirm",prompt:"old"}});
    expect(liveOf("c").shownVersion).toBe(2);
    expect(liveOf("c").lines.find(l=>l.id==="w_"+a)?.text).toBe("");
    expect(liveOf("c").controls).toEqual([]);
    event(a,5,{type:"done",stopReason:"done"});
    expect(liveOf("c").busy).toBe(true);
    event(b,2,{type:"done",stopReason:"done"});
    expect(liveOf("c").busy).toBe(false);
    expect(flowTrace.dump().marks.some(m=>m.stage==="genui.discard")).toBe(true);
    const slow=beginLiveTurn("c","slow",false);
    const fast=beginLiveTurn("c","fast",false);
    event(fast,1,{type:"done",stopReason:"done"});
    expect(liveOf("c").busy).toBe(false);
    event(slow,1,{type:"done",stopReason:"done"});
    expect(liveOf("c").busy).toBe(false);
    liveStore.set({d:{...EMPTY_LIVE}});
    expect(liveOf("d").generation ?? 0).toBe(0);
  `], { cwd: new URL("../../..", import.meta.url).pathname, env: { ...process.env, EXPO_PUBLIC_DASH_TURBO: "1", EXPO_PUBLIC_DASH_FLOW_MODE: "1" }, stdout: "pipe", stderr: "pipe" });
  const error = await new Response(child.stderr).text();
  expect(await child.exited, error).toBe(0);
});
