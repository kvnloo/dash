import { expect, test } from "bun:test";
import { parseFrameMessage } from "./artifact-frame-message";

function frame(value: unknown, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "fx-intent", controlId: "vote-1", value, ...overrides });
}

test("valid fx-intent retains its value and uses native-controlled version and surface", () => {
  expect(parseFrameMessage(frame("approve", {
    artifactVersion: 999,
    surface: "untrusted-surface",
    label: "  Approve  ",
  }), 7)).toEqual({
    controlId: "vote-1",
    value: "approve",
    label: "Approve",
    artifactVersion: 7,
    surface: "dash-live-surface",
  });
});

test("supported numeric, boolean and string-array values are not coerced", () => {
  for (const value of [0, -12.5, true, false, ["first", "second"]]) {
    expect(parseFrameMessage(frame(value), 2)).toEqual({
      controlId: "vote-1",
      value,
      artifactVersion: 2,
      surface: "dash-live-surface",
    });
  }
});

test("type is optional for legacy frames, but every present type must be fx-intent", () => {
  expect(parseFrameMessage(JSON.stringify({ controlId: "vote-1", value: "legacy" }), 3)).toEqual({
    controlId: "vote-1",
    value: "legacy",
    artifactVersion: 3,
    surface: "dash-live-surface",
  });
  for (const type of ["fx-command", "live_intent", "", null, false, 1, {}]) {
    expect(parseFrameMessage(frame("go", { type }), 3)).toBeNull();
  }
});

test("static-only frames always reject messages", () => {
  expect(parseFrameMessage(frame("go"), 1, { staticOnly: true })).toBeNull();
  expect(parseFrameMessage(frame("go"), 1, { staticOnly: false })?.value).toBe("go");
});

test("invalid JSON, primitives, arrays and null cannot become intents", () => {
  for (const data of ["", "{", "not-json", "null", "false", "123", "\"text\"", "[]", "[{\"controlId\":\"vote-1\",\"value\":\"go\"}]"]) {
    expect(parseFrameMessage(data, 1)).toBeNull();
  }
});

test("4096 characters are allowed and 4097 characters are rejected", () => {
  const payload = frame("go");
  const atLimit = payload + " ".repeat(4096 - payload.length);
  expect(atLimit.length).toBe(4096);
  expect(parseFrameMessage(atLimit, 1)?.value).toBe("go");
  expect(parseFrameMessage(atLimit + " ", 1)).toBeNull();
});

test("objects, null and non-string arrays are rejected instead of stringified", () => {
  for (const value of [{ choice: "go" }, null, [], ["ok", 1], ["ok", null], [[ "nested" ]]]) {
    expect(parseFrameMessage(frame(value), 1)).toBeNull();
  }
  expect(parseFrameMessage(frame(["ok"]), 1)?.value).toEqual(["ok"]);
});

test("shared validator rejects malformed control identifiers without truncation", () => {
  for (const controlId of ["bad id", " leading", "", "-bad", "x".repeat(65), 42, null]) {
    expect(parseFrameMessage(frame("go", { controlId }), 4)).toBeNull();
  }
  expect(parseFrameMessage(frame("go", { controlId: "x".repeat(64) }), 4)?.controlId).toBe("x".repeat(64));
});

test("labels are trimmed, capped by shared validation and optional", () => {
  const padded = "  " + "x".repeat(150) + "  ";
  expect(parseFrameMessage(frame("go", { label: padded }), 1)?.label).toBe("x".repeat(120));
  expect(parseFrameMessage(frame("go", { label: "  " }), 1)).toEqual({
    controlId: "vote-1",
    value: "go",
    artifactVersion: 1,
    surface: "dash-live-surface",
  });
  expect(parseFrameMessage(frame("go"), 1)?.label).toBeUndefined();
  for (const label of [null, 12, false, { text: "go" }, ["go"]]) {
    expect(parseFrameMessage(frame("go", { label }), 1)).toBeNull();
  }
});

test("shared validator rejects invalid artifact versions and out-of-bounds values", () => {
  for (const version of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    expect(parseFrameMessage(frame("go"), version)).toBeNull();
  }
  for (const value of ["", "x".repeat(201), Array(9).fill("x"), ["x".repeat(201)]]) {
    expect(parseFrameMessage(frame(value), 1)).toBeNull();
  }
});
