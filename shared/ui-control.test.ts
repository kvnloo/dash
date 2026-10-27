import { expect, test } from "bun:test";
import {
  UI_CONTROL_LIMITS,
  UI_CONTROL_ROUTES,
  UI_CONTROL_SCHEMA,
  parseUiControl,
  type UiControlCommand,
  type UiControlRoute,
} from "./ui-control";
import type { AppRoute } from "../app/src/lib/app-route-link";

function frame(command: unknown): unknown {
  return { type: "ui_control", schema: UI_CONTROL_SCHEMA, command };
}

function rejects(command: unknown): void {
  const result = parseUiControl(frame(command));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
}

const point: UiControlCommand = { type: "point", id: "p1", target: { x: 0.25, y: 0.75 }, ttlMs: 250 };
const draw: UiControlCommand = { type: "draw", id: "d1", strokes: [{ points: [[0, 0], [0.5, 0.5], [1, 1]] }], ttlMs: 30_000 };
const highlight: UiControlCommand = { type: "highlight", id: "h1", testID: "trace_row-1", ttlMs: 400 };
const navigate: UiControlCommand = { type: "navigate", id: "n1", route: "Chat", conversationId: "chat:42" };

const cases: UiControlCommand[] = [
  point,
  { type: "point", id: "p2", target: { testID: "send_2" }, label: "Look here", ttlMs: 1_200 },
  { type: "draw", id: "d1", strokes: [{ points: [[0, 0], [0.5, 0.5], [1, 1]] }], color: "gold", ttlMs: 30_000 },
  { type: "draw", id: "d2", strokes: [{ points: [[1, 0]] }], color: "cream", ttlMs: 500 },
  { type: "navigate", id: "n1", route: "Chat", conversationId: "chat:42" },
  { type: "navigate", id: "n2", route: "Settings" },
  highlight,
  { type: "clear", id: "p1" },
  { type: "clear" },
];

for (const [index, command] of cases.entries()) {
  test("v1 command round-trips through JSON and parser: " + command.type + " " + index, () => {
    const wire = JSON.parse(JSON.stringify(frame(command)));
    expect(parseUiControl(wire)).toEqual({ ok: true, command });
  });
}

test("parser and spec use the explicit v1 limit constants", () => {
  expect(UI_CONTROL_SCHEMA).toBe("dash.ui_control/v1");
  expect(UI_CONTROL_LIMITS).toEqual({
    idMaxLength: 128,
    testIdMaxLength: 64,
    labelMaxLength: 120,
    strokeMaxCount: 16,
    pointMaxCountPerStroke: 512,
    ttlMinMs: 250,
    ttlMaxMs: 30_000,
  });
});

test("requires the versioned server envelope and known command type", () => {
  for (const raw of [
    null, [], undefined, {}, point,
    { type: "wrong", schema: UI_CONTROL_SCHEMA, command: point },
    { type: "ui_control", command: point },
    { type: "ui_control", schema: "dash.ui_control/v2", command: point },
    { type: "ui_control", schema: UI_CONTROL_SCHEMA, command: null },
    { type: "ui_control", schema: UI_CONTROL_SCHEMA, command: [] },
    frame({ type: "click", id: "click-1", target: { testID: "send" } }),
    frame({ type: 0, id: "bad" }),
  ]) {
    const result = parseUiControl(raw);
    expect(result.ok).toBe(false);
  }
});

test("all required commands reject missing, blank and oversized ids; clear's id is optional", () => {
  const withoutIds = [
    { ...point, id: undefined },
    { ...draw, id: undefined },
    { ...highlight, id: undefined },
    { ...navigate, id: undefined },
  ];
  for (const command of withoutIds) rejects(command);
  for (const id of [null, 3, "", "  \n  ", "x".repeat(UI_CONTROL_LIMITS.idMaxLength + 1)]) {
    rejects({ ...point, id });
    rejects({ type: "clear", id });
  }
  const longest = "i".repeat(UI_CONTROL_LIMITS.idMaxLength);
  expect(parseUiControl(frame({ ...point, id: longest })).ok).toBe(true);
  expect(parseUiControl(frame({ type: "clear" }))).toEqual({ ok: true, command: { type: "clear" } });
});

test("point targets are exactly one valid testID or a pair of normalized coordinates", () => {
  for (const target of [
    { x: 0, y: 1 }, { x: 1, y: 0 },
    { testID: "a" }, { testID: "t".repeat(UI_CONTROL_LIMITS.testIdMaxLength) },
  ]) expect(parseUiControl(frame({ ...point, target })).ok).toBe(true);

  for (const badID of [
    "", "t".repeat(UI_CONTROL_LIMITS.testIdMaxLength + 1), "with space", "with.dot",
    "/path", "#item", "é", 12, null,
  ]) {
    rejects({ ...point, target: { testID: badID } });
    rejects({ ...highlight, testID: badID });
  }
  for (const target of [
    null, [], {}, { x: 0.5 }, { y: 0.5 },
    { x: 0.5, y: 0.5, testID: "other" },
    { testID: "other", y: 0.5 },
  ]) rejects({ ...point, target });
});

test("point, draw and highlight reject nonfinite and out-of-range coordinates", () => {
  for (const value of [NaN, Infinity, -Infinity, -0.01, 1.01, "0.5", null, undefined]) {
    rejects({ ...point, target: { x: value, y: 0.5 } });
    rejects({ ...point, target: { x: 0.5, y: value } });
    rejects({ ...draw, strokes: [{ points: [[value, 0.5]] }] });
    rejects({ ...draw, strokes: [{ points: [[0.5, value]] }] });
  }
  for (const malformed of [[], [0], [0, 0, 0], "0,0", { x: 0, y: 0 }]) {
    rejects({ ...draw, strokes: [{ points: [malformed] }] });
  }
});

test("strokes are nonempty, bounded at both levels, and contain only coordinate pairs", () => {
  const stroke = { points: [[0.5, 0.5]] };
  const manyStrokes = Array.from({ length: UI_CONTROL_LIMITS.strokeMaxCount }, () => stroke);
  const manyPoints = Array.from({ length: UI_CONTROL_LIMITS.pointMaxCountPerStroke }, () => [0.5, 0.5]);
  expect(parseUiControl(frame({ ...draw, strokes: manyStrokes })).ok).toBe(true);
  expect(parseUiControl(frame({ ...draw, strokes: [{ points: manyPoints }] })).ok).toBe(true);
  for (const strokes of [
    null, [], "not strokes", [null], [{}], [{ points: [] }],
    Array.from({ length: UI_CONTROL_LIMITS.strokeMaxCount + 1 }, () => stroke),
    [{ points: Array.from({ length: UI_CONTROL_LIMITS.pointMaxCountPerStroke + 1 }, () => [0, 0]) }],
  ]) rejects({ ...draw, strokes });
});

test("TTL is integral milliseconds, inclusive 250–30000, for ephemeral commands only", () => {
  for (const ttlMs of [UI_CONTROL_LIMITS.ttlMinMs, UI_CONTROL_LIMITS.ttlMaxMs]) {
    for (const command of [point, draw, highlight]) {
      expect(parseUiControl(frame({ ...command, ttlMs })).ok).toBe(true);
    }
  }
  for (const ttlMs of [
    UI_CONTROL_LIMITS.ttlMinMs - 1,
    UI_CONTROL_LIMITS.ttlMaxMs + 1,
    UI_CONTROL_LIMITS.ttlMinMs + 0.5,
    0, -1, NaN, Infinity, -Infinity, null, "250", undefined,
  ]) for (const command of [point, draw, highlight]) rejects({ ...command, ttlMs });
});

test("labels and palette colors are bounded and validated; optional fields may be omitted", () => {
  expect(parseUiControl(frame({ ...point, label: "L".repeat(UI_CONTROL_LIMITS.labelMaxLength) })).ok).toBe(true);
  for (const label of [null, 42, "L".repeat(UI_CONTROL_LIMITS.labelMaxLength + 1)]) {
    rejects({ ...point, label });
  }
  for (const color of ["gold", "cream"]) expect(parseUiControl(frame({ ...draw, color })).ok).toBe(true);
  for (const color of ["red", "", 5, null]) rejects({ ...draw, color });
});

test("navigate accepts only AppRoute names and Chat, with bounded optional conversationId", () => {
  // Compile-time drift check: every in-app AppRoute must remain assignable to UI control routes.
  const fromAppRoute = (route: AppRoute): UiControlRoute => route;
  expect(UI_CONTROL_ROUTES).toEqual(["Lab", "Trace", "Orchestra", "Settings", "Bots", "Chat"]);
  expect(UI_CONTROL_ROUTES).toContain(fromAppRoute("Lab"));
  for (const route of UI_CONTROL_ROUTES) expect(parseUiControl(frame({ ...navigate, route })).ok).toBe(true);
  for (const route of ["Home", "chat", "http://example.org", "", null, undefined, 5]) {
    rejects({ ...navigate, route });
  }
  expect(parseUiControl(frame({ ...navigate, conversationId: "c".repeat(UI_CONTROL_LIMITS.idMaxLength) })).ok).toBe(true);
  for (const conversationId of ["", " ", "c".repeat(UI_CONTROL_LIMITS.idMaxLength + 1), null, 42]) {
    rejects({ ...navigate, conversationId });
  }
});

test("ignores extra envelope, command, stroke and target fields without returning untrusted references", () => {
  const raw = {
    type: "ui_control",
    schema: UI_CONTROL_SCHEMA,
    ignored: { command: "click" },
    command: {
      ...point,
      extra: { run: "no" },
      target: { x: 0.25, y: 0.75, selector: "#unsafe" },
    },
  };
  expect(parseUiControl(raw)).toEqual({ ok: true, command: point });
  const parsed = parseUiControl(frame({ ...draw, strokes: [{ points: [[0, 1]], unexpected: "ignore" }], unexpected: true }));
  expect(parsed).toEqual({
    ok: true, command: { type: "draw", id: "d1", strokes: [{ points: [[0, 1]] }], ttlMs: 30_000 },
  });
  if (parsed.ok) {
    expect(parsed.command).not.toBe(draw);
    if (parsed.command.type === "draw") expect(parsed.command.strokes).not.toBe(draw.strokes);
  }
});
