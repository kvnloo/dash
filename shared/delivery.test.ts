import { describe, expect, test } from "bun:test";
import {
  MAX_DELIVERY_ID_LENGTH,
  helloSupportsDeliveryReceipts,
  isDeliveryId,
  parseDeliveryChatExtension,
  parseDeliveryReceipt,
  type DeliveryReceipt,
  type DeliveryStage,
} from "./delivery";
import { PROTOCOL_VERSION, parseClientMessage, parseServerMessage } from "./protocol";

const receipt: DeliveryReceipt = {
  type: "delivery_receipt",
  clientId: "send-123",
  turnId: "turn-456",
  stage: "acked-by-bridge",
  at: 1_761_386_400_000,
};

const legacyChat = {
  type: "chat",
  id: "turn-456",
  harness: "omp",
  text: "hello",
};

const legacyHello = {
  type: "hello",
  version: 1,
  host: "laptop",
  cwd: "/repo",
  harnesses: [{ id: "omp", name: "OMP", available: true }],
};

describe("delivery receipt wire contract", () => {
  test("round-trips both validated receipt stages without changing identities", () => {
    const stages: DeliveryStage[] = ["acked-by-bridge", "started"];
    for (const stage of stages) {
      const source = { ...receipt, stage };
      const parsed = parseDeliveryReceipt(JSON.parse(JSON.stringify(source)));
      expect(parsed).toEqual(source);
      expect(parsed?.clientId).toBe("send-123");
      expect(parsed?.turnId).toBe("turn-456");
    }
  });

  test("accepts finite nonnegative timestamps, including zero and fractions", () => {
    for (const at of [0, 0.25, 1, Number.MAX_SAFE_INTEGER]) {
      expect(parseDeliveryReceipt({ ...receipt, at })?.at).toBe(at);
    }
  });

  test("rejects missing, wrong-type, and unsupported receipt discriminants", () => {
    for (const bad of [
      null,
      undefined,
      [],
      [receipt],
      0,
      "delivery_receipt",
      {},
      { ...receipt, type: "status" },
      { ...receipt, type: undefined },
      { ...receipt, type: null },
      { ...receipt, stage: "sent" },
      { ...receipt, stage: "queued" },
      { ...receipt, stage: "acked" },
      { ...receipt, stage: "" },
      { ...receipt, stage: 2 },
      { ...receipt, stage: undefined },
      { ...receipt, stage: null },
      { ...receipt, at: undefined },
    ]) {
      expect(parseDeliveryReceipt(bad)).toBeNull();
    }
  });

  test("rejects NaN, infinities, negative, nonnumeric, and missing timestamps", () => {
    for (const at of [Number.NaN, Infinity, -Infinity, -1, "-1", "0", null, undefined]) {
      expect(parseDeliveryReceipt({ ...receipt, at })).toBeNull();
    }
  });

  test("requires bounded, nonempty, whitespace-free opaque identifiers", () => {
    expect(isDeliveryId("x")).toBe(true);
    expect(isDeliveryId("a".repeat(MAX_DELIVERY_ID_LENGTH))).toBe(true);
    for (const bad of [
      undefined,
      null,
      13,
      "",
      " ",
      "\t",
      "\n",
      " a",
      "a ",
      "a b",
      "a\nb",
      "a\u0000b",
      "a\u007fb",
      "a".repeat(MAX_DELIVERY_ID_LENGTH + 1),
    ]) {
      expect(isDeliveryId(bad)).toBe(false);
      expect(parseDeliveryReceipt({ ...receipt, clientId: bad })).toBeNull();
      expect(parseDeliveryReceipt({ ...receipt, turnId: bad })).toBeNull();
    }
  });

  test("normalizes untrusted frames without leaking extra fields", () => {
    expect(parseDeliveryReceipt({ ...receipt, extra: "untrusted" })).toEqual(receipt);
  });
});

describe("additive delivery chat extension", () => {
  test("preserves legacy chat.id as the turn id, separate from optional send identity", () => {
    expect(parseClientMessage(legacyChat)).toMatchObject(legacyChat);
    expect(parseDeliveryChatExtension(legacyChat)).toEqual({});
    const extended = { ...legacyChat, clientId: "send-123" };
    expect(parseClientMessage(extended)).toMatchObject(legacyChat);
    expect(parseDeliveryChatExtension(extended)).toEqual({ clientId: "send-123" });
    expect(extended.id).toBe(receipt.turnId);
  });

  test("retries reuse both stable identities and do not allocate a new turn", () => {
    const send = { ...legacyChat, clientId: receipt.clientId, mode: "queue" };
    const retry = { ...send };
    expect(parseClientMessage(send)).toMatchObject({ id: receipt.turnId, mode: "queue" });
    expect(parseClientMessage(retry)).toMatchObject({ id: receipt.turnId, mode: "queue" });
    expect(parseDeliveryChatExtension(send)).toEqual(parseDeliveryChatExtension(retry));
    expect(parseDeliveryChatExtension(retry)).toEqual({ clientId: receipt.clientId });
  });

  test("the old parser remains unchanged while an invalid present id fails closed", () => {
    const oldChat = { ...legacyChat, id: "" };
    expect(parseClientMessage(oldChat)).toMatchObject(oldChat);
    expect(parseDeliveryChatExtension(oldChat)).toBeNull();
    expect(parseDeliveryChatExtension({ ...oldChat, clientId: "send-123" })).toBeNull();
    const absentId = { ...legacyChat, id: undefined };
    expect(parseClientMessage(absentId)).toBeNull();
    expect(parseDeliveryChatExtension(absentId)).toEqual({});
  });

  test("invalid optional identities fail closed rather than disappearing", () => {
    for (const clientId of [null, 0, "", " ", "with space", "\n", "x".repeat(MAX_DELIVERY_ID_LENGTH + 1)]) {
      expect(parseDeliveryChatExtension({ ...legacyChat, clientId })).toBeNull();
    }
    for (const id of [null, false, 0, "", " ", "\t", "\n", "x".repeat(MAX_DELIVERY_ID_LENGTH + 1)]) {
      expect(parseDeliveryChatExtension({ ...legacyChat, id })).toBeNull();
    }
    expect(parseDeliveryChatExtension(null)).toBeNull();
    expect(parseDeliveryChatExtension([])).toBeNull();
    expect(parseDeliveryChatExtension({ ...legacyChat, type: "voice_begin" })).toBeNull();
  });

  test("the extension alone does not authorize malformed legacy chat content", () => {
    const missingHarness = { type: "chat", id: "turn-456", clientId: "send-123" };
    expect(parseDeliveryChatExtension(missingHarness)).toEqual({ clientId: "send-123" });
    expect(parseClientMessage(missingHarness)).toBeNull();
  });
});

describe("legacy hello and capability negotiation", () => {
  test("old hello and chat still parse at unchanged protocol version", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(parseClientMessage(legacyChat)).toMatchObject(legacyChat);
    expect(parseServerMessage(legacyHello)).toMatchObject(legacyHello);
    expect(helloSupportsDeliveryReceipts(legacyHello)).toBe(false);
  });

  test("explicit optional capability survives old hello acceptance without implying a receipt", () => {
    const enabled = { ...legacyHello, capabilities: { deliveryReceipts: true } };
    expect(parseServerMessage(enabled)).toMatchObject(legacyHello);
    expect(helloSupportsDeliveryReceipts(enabled)).toBe(true);
    expect(parseDeliveryReceipt(enabled)).toBeNull();
  });

  test("absent or malformed capability is not negotiated", () => {
    for (const capabilities of [
      undefined,
      null,
      [],
      {},
      { deliveryReceipts: false },
      { deliveryReceipts: "true" },
      { deliveryReceipts: 1 },
    ]) {
      expect(helloSupportsDeliveryReceipts({ ...legacyHello, capabilities })).toBe(false);
    }
    expect(helloSupportsDeliveryReceipts(null)).toBe(false);
    expect(helloSupportsDeliveryReceipts({ type: "chat", capabilities: { deliveryReceipts: true } })).toBe(false);
  });
});
