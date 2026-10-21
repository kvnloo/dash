import { expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage, type TurnEvent } from "./protocol";
const chat = { type: "chat", id: "one", harness: "hermes", text: "change direction" };
test("send mode is optional for old clients, exact enum for new clients", () => {
  expect(parseClientMessage(chat)).not.toHaveProperty("mode");
  for (const mode of ["steer", "queue"]) expect(parseClientMessage({ ...chat, mode })).toMatchObject({ mode });
  for (const mode of [null, true, 1, "next_turn", "steer_or_next", "", {}, []]) expect(parseClientMessage({ ...chat, mode })).toBeNull();
});
test("delivery receipts survive parse, malformed or mixed payloads fail closed", () => {
  const status = { type: "status", id: "one", seq: 1, text: "receipt" } satisfies TurnEvent;
  expect(parseServerMessage(status)).toEqual(status);
  for (const delivery of ["steered", "queued", "started"] as const) {
    expect(parseServerMessage({ ...status, delivery })).toEqual({ ...status, delivery });
    expect(parseServerMessage({ ...status, delivery, deliveryAt: 42 })).toEqual({ ...status, delivery, deliveryAt: 42 });
    for (const deliveryAt of [null, "42", NaN, Infinity]) expect(parseServerMessage({ ...status, delivery, deliveryAt })).toBeNull();
    for (const extra of [{part:{}},{summary:{}},{acp:{}},{handoff:{}}]) expect(parseServerMessage({ ...status, delivery, ...extra })).toBeNull();
  }
  for (const delivery of ["sending", null, 1, {}, ["steered"]]) expect(parseServerMessage({ ...status, delivery })).toBeNull();
});
