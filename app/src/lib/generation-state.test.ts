import { expect, test } from "bun:test";
import { generationState } from "./generation-state";
import { parseGenUI } from "./genui";
test("every incomplete prefix stays a loader, never source code", () => {
 const payload = JSON.stringify({ version: 1, components: [{type:"progress",title:"Phone roadmap",value:75}] });
 for (let i=0;i<payload.length;i++) expect(generationState("genui",true,parseGenUI(payload.slice(0,i))!==null)).toBe("loading");
 expect(generationState("genui",true,parseGenUI(payload)!==null)).toBe("ready");
});
test("final malformed UI is an honest error; ordinary code stays code", () => {
 expect(generationState("openui",false,false)).toBe("invalid");
 expect(generationState("typescript",true,false)).toBe("code");
 expect(generationState("genui",false,true)).toBe("ready");
});
