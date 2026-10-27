import { describe, expect, test } from "bun:test";
import { MIC_IDLE, PICK_THRESHOLD, type MicEvent, type MicState, insertAtCursor, micStep, parseMicChoice, parseRecognizerResult } from "./mic-gesture";

function run(events: MicEvent[]) {
  let state: MicState = MIC_IDLE;
  let outcome = null as ReturnType<typeof micStep>["outcome"];
  for (const e of events) ({ state, outcome } = micStep(state, e));
  return { state, outcome };
}

describe("mic gesture", () => {
  test("tap", () => expect(run([{ type: "down" }, { type: "up" }]).outcome).toEqual({ kind: "tap" }));
  test("hold, slide up, release = live", () => {
    const r = run([{ type: "down" }, { type: "longPress" }, { type: "move", dy: -PICK_THRESHOLD - 1 }, { type: "up" }]);
    expect(r.outcome).toEqual({ kind: "choose", choice: "live" });
    expect(r.state).toEqual(MIC_IDLE);
  });
  test("hold, slide down, release = dictate", () =>
    expect(run([{ type: "down" }, { type: "longPress" }, { type: "move", dy: 60 }, { type: "up" }]).outcome).toEqual({ kind: "choose", choice: "dictate" }));
  test("release back on the button cancels", () =>
    expect(run([{ type: "down" }, { type: "longPress" }, { type: "move", dy: -60 }, { type: "move", dy: 4 }, { type: "up" }]).outcome).toEqual({ kind: "cancel" }));
  test("picker shows hover", () => expect(run([{ type: "down" }, { type: "longPress" }, { type: "move", dy: -40 }]).state).toEqual({ phase: "picker", hover: "live" }));
  test("moves before long press are ignored", () => expect(run([{ type: "down" }, { type: "move", dy: -90 }]).state).toEqual({ phase: "holding", hover: null }));
  test("system cancel", () => expect(run([{ type: "down" }, { type: "longPress" }, { type: "cancel" }]).outcome).toEqual({ kind: "cancel" }));
});

describe("default memory", () => {
  test("parses stored choice", () => {
    expect(parseMicChoice("live")).toBe("live");
    expect(parseMicChoice("dictate")).toBe("dictate");
    expect(parseMicChoice(null)).toBe("dictate");
    expect(parseMicChoice("junk")).toBe("dictate");
  });
});

describe("insertAtCursor", () => {
  test("empty field", () => expect(insertAtCursor("", null, " hello ")).toEqual({ text: "hello", cursor: 5 }));
  test("appends with a space when no selection", () => expect(insertAtCursor("fix the", undefined, "build")).toEqual({ text: "fix the build", cursor: 13 }));
  test("inserts mid-text with padding", () => expect(insertAtCursor("ab", { start: 1, end: 1 }, "X")).toEqual({ text: "a X b", cursor: 3 }));
  test("replaces selection", () => expect(insertAtCursor("one two three", { start: 4, end: 7 }, "2")).toEqual({ text: "one 2 three", cursor: 5 }));
  test("repeated dictation appends", () => {
    const a = insertAtCursor("", null, "first");
    const b = insertAtCursor(a.text, { start: a.cursor, end: a.cursor }, "second");
    expect(b).toEqual({ text: "first second", cursor: 12 });
  });
  test("blank transcript is a no-op", () => expect(insertAtCursor("hi", { start: 2, end: 2 }, "  ")).toEqual({ text: "hi", cursor: 2 }));
  test("clamps stale selection", () => expect(insertAtCursor("hi", { start: 9, end: 12 }, "there").text).toBe("hi there"));
});

describe("parseRecognizerResult", () => {
  test("success list", () => expect(parseRecognizerResult({ resultCode: -1, extra: { "android.speech.extra.RESULTS": ["hello world", "hollow world"] } })).toBe("hello world"));
  test("canceled", () => expect(parseRecognizerResult({ resultCode: 0 })).toBeNull());
  test("missing extras", () => expect(parseRecognizerResult({ resultCode: -1 })).toBeNull());
  test("skips blanks", () => expect(parseRecognizerResult({ resultCode: -1, extra: { "android.speech.extra.RESULTS": ["", " ok "] } })).toBe("ok"));
  test("garbage", () => expect(parseRecognizerResult("nope")).toBeNull());
});
