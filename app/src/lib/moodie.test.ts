import { describe, expect, test } from "bun:test";
import { EXPRESSIONS, createEyePath, createBlobBodyPath, liveliness } from "../vendor/moodie";
import { botFaceIdentity, expressionForState, faceStateFromMessages, hermesProfileKey } from "./moodie-identity";

describe("real synergy Moodie faces", () => {
  test("preserves the original expression geometry instead of dotted-orb eyes", () => {
    expect(Object.keys(EXPRESSIONS)).toHaveLength(19);
    expect(EXPRESSIONS.thinking.left).toEqual({ x: 68, y: 91, width: 17, height: 30, rotation: -18, curve: .88, skew: 0, open: 1 });
    expect(EXPRESSIONS.focused.right.rotation).toBe(-14);
    expect(createEyePath(EXPRESSIONS.neutral.left).startsWith("M82.958,93.041C")).toBe(true);
    expect(createBlobBodyPath().endsWith("Z")).toBe(true);
  });
  test("profile identity is stable across host, session and display-name changes", () => {
    expect(hermesProfileKey({ id: "hermes:clean", kind: "hermes" })).toBe("clean");
    expect(hermesProfileKey({ id: "hermes:session:clean:s1", kind: "hermes", profileId: "clean" })).toBe("clean");
    expect(hermesProfileKey({ id: "hermes:session:clean:s1", kind: "hermes" })).toBeUndefined();
    expect(botFaceIdentity(" clean ")).toEqual(botFaceIdentity("clean"));
    expect(botFaceIdentity("clean").key).toBe("hermes:clean");
    expect(new Set(["clean", "default", "chiefstaff", "intake"].map(p => botFaceIdentity(p).rest))).toHaveProperty("size", 4);
    expect(botFaceIdentity("clean").rest).toBe("curious");
  });
  test("state maps to the upstream expression table without inventing activity", () => {
    expect(expressionForState("idle", "cheeky")).toBe("cheeky");
    expect(expressionForState("thinking", "cheeky")).toBe("thinking");
    expect(expressionForState("working", "cheeky")).toBe("focused");
    expect(expressionForState("done", "cheeky")).toBe("happy");
    expect(expressionForState("error", "cheeky")).toBe("worried");
    const msg = { id: "a", role: "assistant" as const, text: "", at: 1, state: "streaming" as const, status: "Thinking", turnId: "t1", seq: 0 };
    expect(faceStateFromMessages([])).toBe("idle");
    expect(expressionForState("waiting-approval", "cheeky")).toBe("alert");
    expect(faceStateFromMessages([msg])).toBe("thinking");
    expect(faceStateFromMessages([{ ...msg, status: "Running bash" }])).toBe("working");
    expect(faceStateFromMessages([{ ...msg, state: "done" }])).toBe("done");
    expect(faceStateFromMessages([{ ...msg, state: "error" }])).toBe("error");
    expect(faceStateFromMessages([msg], false)).toBe("idle");
  });
  test("bloub breath and gaze use deterministic time, with a fully still reduced mode", () => {
    expect(liveliness(2)).toEqual(liveliness(2));
    expect(liveliness(2).breath).not.toBe(liveliness(3).breath);
    expect(liveliness(1.4).lid).toBe(1);
    expect(liveliness(1.481).lid).toBeCloseTo(0, 6);
    expect(liveliness(2, { wander: 0, blink: false, float: false })).toEqual({ dYaw: 0, dPitch: 0, dRoll: 0, lid: 1, driftX: 0, driftY: 0, breath: 1 });
  });
});
