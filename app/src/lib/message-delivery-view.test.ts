import { describe, expect, test } from "bun:test";
import type { UserMessage } from "../model";
import type { OutboxRecord, OutboxStage } from "../store/outbox";
import type { DeliveryStage } from "./delivery-status";
import { messageDeliveryProps, retryKey } from "./message-delivery-view";

const message: UserMessage = {
  id: "client-1",
  role: "user",
  text: "Hello",
  at: 1_000,
};

const record: OutboxRecord = {
  clientId: "client-1",
  turnId: "turn-1",
  conversationId: "conversation-1",
  target: { harness: "hermes", mode: "send" },
  payload: { text: "Hello" },
  stage: "queued",
  attempts: 0,
  createdAt: 1_000,
  updatedAt: 1_000,
};

const options = { retryBusy: false, now: 1_500 };

describe("message delivery props", () => {
  const stages: ReadonlyArray<{ outbox: OutboxStage; view: DeliveryStage }> = [
    { outbox: "queued", view: "queued" },
    { outbox: "sent", view: "sending" },
    { outbox: "acked-by-bridge", view: "received" },
    { outbox: "started", view: "started" },
  ];

  for (const { outbox, view } of stages) {
    test(`persisted ${outbox} maps to ${view}`, () => {
      expect(messageDeliveryProps(message, { ...record, stage: outbox }, options)).toEqual({
        stage: view,
        retryNeeded: false,
        retryBusy: false,
        note: null,
      });
    });
  }

  test("outbox overrides a stale failed message, including the retry flag and note", () => {
    const failedMessage: UserMessage = { ...message, delivery: "failed", deliveryNote: "Stale failure" };
    expect(messageDeliveryProps(failedMessage, {
      ...record, stage: "acked-by-bridge", retryNeeded: false, error: "Bridge receipt",
    }, { now: 2_000, retryBusy: true })).toEqual({
      stage: "received",
      retryNeeded: false,
      retryBusy: true,
      note: "Bridge receipt",
    });
  });

  test("unconfirmed outbox retry preserves the persisted retry flag and controlled busy state", () => {
    expect(messageDeliveryProps(message, {
      ...record, stage: "sent", retryNeeded: true, error: "Socket dropped",
    }, { now: 2_000, retryBusy: true })).toEqual({
      stage: "sending",
      retryNeeded: true,
      retryBusy: true,
      note: "Socket dropped",
    });
    // A stale retry flag cannot turn an explicit receipt back into a 'sending' stage.
    expect(messageDeliveryProps(message, {
      ...record, stage: "started", retryNeeded: true,
    }, options)?.stage).toBe("started");
  });

  test("outbox error notes are trimmed, capped at 120 characters, and nullable", () => {
    const longError = `  ${"e".repeat(150)}  `;
    const projected = messageDeliveryProps(message, { ...record, error: longError }, options);
    expect(projected?.note).toBe("e".repeat(120));
    expect(projected?.note?.length).toBe(120);
    expect(messageDeliveryProps(message, { ...record, error: "   " }, options)?.note).toBeNull();
  });

  const legacy: ReadonlyArray<{
    delivery: NonNullable<UserMessage["delivery"]>;
    stage: DeliveryStage;
    retryNeeded: boolean;
  }> = [
    { delivery: "failed", stage: "sending", retryNeeded: true },
    { delivery: "started", stage: "started", retryNeeded: false },
    { delivery: "steered", stage: "started", retryNeeded: false },
    { delivery: "queued", stage: "queued", retryNeeded: false },
    { delivery: "steering", stage: "queued", retryNeeded: false },
  ];

  for (const { delivery, stage, retryNeeded } of legacy) {
    test(`legacy ${delivery} maps to ${stage}`, () => {
      expect(messageDeliveryProps(
        { ...message, delivery, deliveryNote: "Legacy note" },
        undefined,
        { now: 1_500, retryBusy: true },
      )).toEqual({ stage, retryNeeded, retryBusy: true, note: "Legacy note" });
    });
  }

  test("older user messages without delivery metadata stay quiet", () => {
    expect(messageDeliveryProps(message, undefined, options)).toBeNull();
    expect(messageDeliveryProps({ ...message, deliveryNote: "Old note" }, undefined, options)).toBeNull();
  });

  test("started outbox status stays visible through exactly 5s, then hides", () => {
    const started: OutboxRecord = {
      ...record, stage: "started", receiptAt: 2_000, updatedAt: 4_000,
    };
    expect(messageDeliveryProps(message, started, { now: 7_000, retryBusy: false })?.stage).toBe("started");
    // Use receiptAt, not the later updatedAt, for the five-second boundary.
    expect(messageDeliveryProps(message, started, { now: 7_001, retryBusy: false })).toBeNull();
    // Restarted older rows may lack receiptAt.
    expect(messageDeliveryProps(message, {
      ...record, stage: "started", updatedAt: 3_000,
    }, { now: 8_001, retryBusy: false })).toBeNull();
  });

  test("started and steered legacy statuses use deliveryAt, falling back to message.at", () => {
    for (const delivery of ["started", "steered"] satisfies NonNullable<UserMessage["delivery"]>[]) {
      const withDeliveryTime: UserMessage = { ...message, delivery, deliveryAt: 2_000 };
      expect(messageDeliveryProps(withDeliveryTime, undefined, { now: 7_000, retryBusy: false })?.stage).toBe("started");
      expect(messageDeliveryProps(withDeliveryTime, undefined, { now: 7_001, retryBusy: false })).toBeNull();
      expect(messageDeliveryProps({ ...message, delivery }, undefined, {
        now: 6_001, retryBusy: false,
      })).toBeNull();
    }
    // Non-started failures stay actionable regardless of age.
    expect(messageDeliveryProps({ ...message, delivery: "failed" }, undefined, {
      now: 100_000, retryBusy: false,
    })?.retryNeeded).toBe(true);
  });

  test("projection is pure: it leaves source identities and records unchanged", () => {
    const beforeMessage = { ...message };
    const beforeRecord = { ...record };
    messageDeliveryProps(message, record, options);
    expect(message).toEqual(beforeMessage);
    expect(record).toEqual(beforeRecord);
  });
});

describe("retry identity", () => {
  test("key uses both persisted ids and is unchanged by delivery attempts or stages", () => {
    expect(retryKey(record)).toBe("client-1:turn-1");
    expect(retryKey({
      ...record, stage: "sent", retryNeeded: true, attempts: 5, updatedAt: 9_000,
    })).toBe("client-1:turn-1");
    expect(retryKey({ ...record, turnId: "turn-2" })).toBe("client-1:turn-2");
    expect(retryKey({ ...record, clientId: "client-2" })).toBe("client-2:turn-1");
  });
});
