import {expect,test} from "bun:test";
import {parseRoadmapLang} from "./openui-roadmap";
import {roadmapCounts,visibleItems} from "../vendor/ripple/native/roadmap";
test("real OpenUI parser accepts only the approved local snapshot handle",()=>{
 expect(parseRoadmapLang('root = Roadmap("dash-roadmap")',true)).toBe("ready");
 for(const s of ['root = Roadmap("other")','root = Roadmap("dash-roadmap"); bad = Query("steal")','root = Roadmap("dash-roadmap"); orphan = "x"','root = Roadmap("dash-roadmap", 1)','root = Roadmap(','root = Unknown("dash-roadmap")']) expect(parseRoadmapLang(s,true)).toBe("invalid");
});
test("streaming never exposes source or publishes a partial artifact",()=>{
 const source='root = Roadmap("dash-roadmap")';
 for(let i=0;i<=source.length;i++)expect(parseRoadmapLang(source.slice(0,i),false)).toBe("loading");
 expect(parseRoadmapLang('x'.repeat(513),false)).toBe("invalid");
});
test("Ripple filter counts preserve unknown and not-built states",()=>{
 const items=[{id:"a",title:"A",stage:"preview" as const,area:"a",detail:"d",evidence:"e",next:"n"},{id:"b",title:"B",stage:"planned" as const,area:"a",detail:"d",evidence:"e",next:"n"}];
 expect(roadmapCounts(items)).toEqual({total:2,preview:1,verified:0,remaining:1});
 expect(visibleItems(items,"needs-work").map(i=>i.id)).toEqual(["b"]);
});
