import { describe, expect, test } from "bun:test";
import { commandRejection, parseSurfaceCommand, primitiveRect, SURFACE_ROUTES, type SurfaceCommand, type SurfaceSnapshot } from "./agent-surface";
export const snapshotFixture = (): SurfaceSnapshot => ({ target: { client: "dash-fixture-1", host: "fixture-host", profile: "fixture-profile", session: "fixture-session", chat: "fixture-chat" }, enabled: true, route: "chat", generation: 7, expiresAt: Date.now()+10000, viewport: { x:0,y:0,width:412,height:915 }, insets: { top:24,bottom:24,left:0,right:0,keyboard:300 }, anchors: { "chat.options": {x:12,y:150,width:80,height:44}, "chat.annotate":{x:200,y:150,width:90,height:44} }, annotationOpen: false });
export const commandFixture = (s = snapshotFixture()): SurfaceCommand => ({ id: "fixture-command", target: s.target, op: "draw", route:s.route,generation:s.generation,expiresAt:Date.now()+5000,ttlMs:8000,primitives:[{kind:"box",anchor:"chat.options"}] });
describe("agent surface boundary", () => {
  test("accepts bounded semantic draws and every allowlisted operation", () => {
    const draw = commandFixture(); expect(parseSurfaceCommand(draw)).toEqual(draw);
    const operations: SurfaceCommand["op"][] = ["snapshot","annotation.open","clear","dismiss"];
    for (const op of operations) { const c=commandFixture(); expect(parseSurfaceCommand({ id:c.id,target:c.target,route:c.route,generation:c.generation,expiresAt:c.expiresAt,op })?.op).toBe(op); }
    for (const destination of SURFACE_ROUTES) { const c=commandFixture(); expect(parseSurfaceCommand({ id:c.id,target:c.target,route:c.route,generation:c.generation,expiresAt:c.expiresAt,op:"navigate",destination })?.destination).toBe(destination); }
  });
  test("rejects unknown route, approval, send, eval, route params and oversized text/primitives", () => {
    const c=commandFixture();
    for (const destination of ["Pair","Approvals","Voice","javascript:alert(1)","delete"]) expect(parseSurfaceCommand({...c,op:"navigate",destination})).toBeUndefined();
    for (const op of ["send","approve","delete","eval"]) expect(parseSurfaceCommand({...c,op})).toBeUndefined();
    expect(parseSurfaceCommand({...c,js:"danger"})).toBeUndefined();
    expect(parseSurfaceCommand({...c,ttlMs:15001})).toBeUndefined();
    expect(parseSurfaceCommand({...c,primitives:Array(17).fill(c.primitives?.[0])})).toBeUndefined();
    expect(parseSurfaceCommand({...c,primitives:[{kind:"label",anchor:"chat.options",text:"x".repeat(121)}]})).toBeUndefined();
    expect(parseSurfaceCommand({...c,primitives:[{kind:"box",rect:{x:0,y:0,width:1.1,height:1}}]})).toBeUndefined();
  });
  test("rejects stale layout/route, expired, disabled and any wrong attachment dimension", () => {
    const s=snapshotFixture(), c=commandFixture(s);
    expect(commandRejection(c,s)).toBeUndefined();
    for(const key of ["client","host","profile","session","chat"] as const) expect(commandRejection({...c,target:{...c.target,[key]:"wrong"}},s)).toBe("wrong-target");
    expect(commandRejection({...c,generation:6},s)).toBe("stale-layout");
    expect(commandRejection({...c,route:"lab"},s)).toBe("stale-layout");
    expect(commandRejection({...c,expiresAt:0},s)).toBe("expired");
    expect(commandRejection(c,{...s,enabled:false})).toBe("control-disabled");
    expect(commandRejection({...c,primitives:[{kind:"box",anchor:"missing"}]},s)).toBe("unknown-anchor");
  });
  test("normalized geometry is clipped above keyboard and safe areas", () => {
    const s=snapshotFixture();
    expect(primitiveRect({kind:"box",rect:{x:0,y:0,width:1,height:1}},s)).toEqual({x:0,y:24,width:412,height:591});
    expect(primitiveRect({kind:"box",rect:{x:0,y:.8,width:.1,height:.1}},s)).toBeUndefined();
  });
});
