import { expect, test } from "bun:test";
import { penButton, quoteSelection, circleRegion, CircleSlots } from "./mode";
test("button toggles once per physical press, not hover/contact repetition or release", () => {
  let state = { active: false, buttonDown: false };
  state = penButton(state, false); expect(state.active).toBe(false);
  state = penButton(state, true); expect(state.active).toBe(true);
  for (let i=0;i<100;i++) state=penButton(state,true);
  expect(state.active).toBe(true); state=penButton(state,false); expect(state.active).toBe(true);
  state=penButton(state,true); expect(state.active).toBe(false);
});
test("selected text quotes into, never replaces or sends, the current draft", () => {
  expect(quoteSelection("keep draft", "first\nsecond")).toBe("keep draft\n\n> first\n> second\n\n");
  expect(quoteSelection("draft", " ")).toBe("draft");
});
test("closed circle encloses a region; open paths and jitter do not", () => {
  const circle = Array.from({length:65},(_,i)=>({x:100+60*Math.cos(i*Math.PI/32), y:200+30*Math.sin(i*Math.PI/32)}));
  expect(circleRegion(circle)).toEqual({x:40,y:170,width:120,height:60});
  expect(circleRegion(circle.slice(0,40))).toBe(null);
  expect(circleRegion(Array.from({length:20},(_,i)=>({x:i,y:2*i})))).toBe(null);
});

test("circle capacity reserves without a visible draft mutation and releases exactly once", () => {
  const slots = new CircleSlots(2);
  const release = slots.reserve("original", 1); expect(release).not.toBeNull();
  expect(slots.reserve("original", 1)).toBeNull();
  expect(slots.reserve("other", 0)).not.toBeNull();
  release?.(); release?.();
  expect(slots.reserve("original", 1)).not.toBeNull();
  expect(slots.reserve("original", 1)).toBeNull();
});
