import { expect, test } from "bun:test";
import { createRecognizerGate, recognizerOutcome } from "./dictation-result";
import { EXTRA_RESULTS } from "./mic-gesture";
test("successful system result returns its transcript; cancel alone is silent", () => {
  expect(recognizerOutcome({ resultCode: -1, extra: { [EXTRA_RESULTS]: ["hello"] } })).toEqual({ ok: true, text: "hello" });
  expect(recognizerOutcome({ resultCode: 0 })).toEqual({ ok: false, reason: "canceled" });
  expect(recognizerOutcome({ resultCode: -1 })).toMatchObject({ ok: false, reason: "error", message: expect.stringContaining("no transcript") });
  expect(recognizerOutcome({ resultCode: 5 })).toMatchObject({ ok: false, reason: "error", message: expect.stringContaining("code 5") });
});
test("only one native activity runs across composers, and success releases the slot", async () => {
  const gate = createRecognizerGate();
  let complete: ((value: string) => void) | undefined;
  const first = gate.run(() => new Promise<string>(resolve => { complete = resolve; }));
  let secondStarted = false;
  expect(await gate.run(async () => { secondStarted = true; return "second"; })).toEqual({ kind: "busy" });
  expect(secondStarted).toBe(false);
  complete?.("first");
  expect(await first).toEqual({ kind: "result", value: "first" });
  expect(await gate.run(async () => "next")).toEqual({ kind: "result", value: "next" });
});
test("native failure does not permanently lock dictation", async () => {
  const gate = createRecognizerGate();
  await expect(gate.run(async () => { throw new Error("No activity"); })).rejects.toThrow("No activity");
  expect(await gate.run(async () => "retry")).toEqual({ kind: "result", value: "retry" });
});
