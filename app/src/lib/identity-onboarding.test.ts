import { expect, test } from "bun:test";
import { identityPrefill, createDeepLinkRouter } from "./deep-link";
const link = "dash://pair?v=2&url=http%3A%2F%2F100.113.138.100%3A4788&code=z0bp_"+"a".repeat(43)+"&kid="+"b".repeat(43)+"&app=dash&bridge=100.113.138.100%3A4747";
test("identity link prefills only; never claims or authorizes",()=>{ expect(identityPrefill(link)).toEqual({address:"100.113.138.100:4747",identityLink:link}); });
test("cold start retains enrollment until navigation ready",()=>{let ready=false;const opened:unknown[]=[];const r=createDeepLinkRouter({isReady:()=>ready,openPair:p=>opened.push(p)});expect(r.handle(link)).toBe(true);expect(opened).toHaveLength(0);ready=true;r.flush();expect(opened).toHaveLength(1);r.flush();expect(opened).toHaveLength(1);});
test("refuse missing endpoint, non-tailnet and invalid ports",()=>{expect(identityPrefill(link.split("&bridge")[0]!)).toBeNull();expect(identityPrefill(link.replace("bridge=100.113.138.100%3A4747","bridge=evil.example%3A4747"))).toBeNull();expect(identityPrefill(link.replace("%3A4747","%3A99999"))).toBeNull();});
