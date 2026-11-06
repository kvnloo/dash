import { expect, test } from "bun:test";
import { ownRoutePopAction } from "./screen-back";

test("a late close pops its own route, not the newer focused chat", () => {
  const state = {
    key: "root-stack",
    routes: [{ key: "main" }, { key: "chat-old" }, { key: "chat-new" }],
  };
  expect(ownRoutePopAction(state, "chat-old")).toEqual({
    type: "POP",
    payload: { count: 1 },
    source: "chat-old",
    target: "root-stack",
  });
});

test("a completed or superseded close never pops another route", () => {
  const state = { key: "root-stack", routes: [{ key: "main" }, { key: "chat-new" }] };
  expect(ownRoutePopAction(state, "chat-old")).toBeNull();
});
