import { expect, test } from "bun:test";
import { finalVoiceReply } from "./voice-replies";
import type { Message } from "../model";
const reply: Message = { id:"reply", role:"assistant",text:"Verified final",state:"done",turnId:"original",seq:1,at:1 };
test("only the exact submitted composer's final speaks, never partial or unrelated latest text",()=>{
  expect(finalVoiceReply([reply],"other")).toBeUndefined();
  expect(finalVoiceReply([{...reply,state:"streaming"}],"original")).toBeUndefined();
  expect(finalVoiceReply([reply],"original")).toBe("Verified final");
  expect(finalVoiceReply([{...reply,state:"error"}],"original")).toBe("");
});
