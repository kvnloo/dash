import { describe, expect, test } from "bun:test";
import {
  ATTACHMENT_ID,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  isBotInfo,
  parseChatAttachment,
  parseChatAttachments,
  parseClientMessage,
  parseHosts,
  type BotInfo,
} from "./protocol";

const ID = "0123456789abcdef0123456789abcdef";
const png = { id: ID, name: "photo.png", mime: "image/png", size: 68 };

describe("attachment limits", () => {
  test("are 25 MB per file and 8 per turn", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(26_214_400);
    expect(MAX_ATTACHMENTS_PER_TURN).toBe(8);
  });
  test("ids are exactly 32 lowercase hex characters", () => {
    expect(ATTACHMENT_ID.test(ID)).toBe(true);
    expect(ATTACHMENT_ID.test(ID.toUpperCase())).toBe(false);
    expect(ATTACHMENT_ID.test(`${ID}0`)).toBe(false);
    expect(ATTACHMENT_ID.test(ID.slice(1))).toBe(false);
    expect(ATTACHMENT_ID.test(`../${ID.slice(3)}`)).toBe(false);
  });
});

describe("parseChatAttachment", () => {
  test("accepts a well-formed upload reference", () => {
    expect(parseChatAttachment(png)).toEqual(png);
    expect(parseChatAttachment({ ...png, size: 0 })).toEqual({ ...png, size: 0 });
    expect(parseChatAttachment({ ...png, size: MAX_ATTACHMENT_BYTES })).toEqual({ ...png, size: MAX_ATTACHMENT_BYTES });
  });
  test("rejects bad ids, names, sizes and types", () => {
    expect(parseChatAttachment(null)).toBeNull();
    expect(parseChatAttachment({ ...png, id: "/etc/passwd" })).toBeNull();
    expect(parseChatAttachment({ ...png, id: 7 })).toBeNull();
    expect(parseChatAttachment({ ...png, name: "" })).toBeNull();
    expect(parseChatAttachment({ ...png, name: "x".repeat(256) })).toBeNull();
    expect(parseChatAttachment({ ...png, name: "x".repeat(255) })).not.toBeNull();
    expect(parseChatAttachment({ ...png, name: 1 })).toBeNull();
    expect(parseChatAttachment({ ...png, mime: undefined })).toBeNull();
    expect(parseChatAttachment({ ...png, size: -1 })).toBeNull();
    expect(parseChatAttachment({ ...png, size: 1.5 })).toBeNull();
    expect(parseChatAttachment({ ...png, size: "68" })).toBeNull();
    expect(parseChatAttachment({ ...png, size: MAX_ATTACHMENT_BYTES + 1 })).toBeNull();
  });
});

describe("parseChatAttachments", () => {
  test("absent is undefined, malformed is null", () => {
    expect(parseChatAttachments(undefined)).toBeUndefined();
    expect(parseChatAttachments("x")).toBeNull();
    expect(parseChatAttachments([png, { ...png, id: "bad" }])).toBeNull();
    expect(parseChatAttachments([png, png])).toBeNull();
    expect(parseChatAttachments([])).toEqual([]);
  });
  test("caps the count per turn", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_TURN + 1 }, (_, i) => ({ ...png, id: i.toString(16).padStart(32, "0") }));
    expect(parseChatAttachments(many.slice(0, MAX_ATTACHMENTS_PER_TURN))).toHaveLength(MAX_ATTACHMENTS_PER_TURN);
    expect(parseChatAttachments(many)).toBeNull();
  });
});

describe("chat with attachments", () => {
  const base = { type: "chat", id: "t1", harness: "hermes", text: "what is this?" };
  test("old phones without the field still parse, with no attachments key", () => {
    const parsed = parseClientMessage(base);
    expect(parsed).not.toBeNull();
    expect(parsed && "attachments" in parsed).toBe(false);
  });
  test("carries valid attachments and drops an empty list", () => {
    expect(parseClientMessage({ ...base, attachments: [png] })).toMatchObject({ attachments: [png] });
    const empty = parseClientMessage({ ...base, attachments: [] });
    expect(empty && "attachments" in empty).toBe(false);
  });
  test("fails closed on a malformed attachment", () => {
    expect(parseClientMessage({ ...base, attachments: [{ ...png, id: "../../x" }] })).toBeNull();
    expect(parseClientMessage({ ...base, attachments: {} })).toBeNull();
  });
});

describe("bots on hosts", () => {
  const bot: BotInfo = { id: "hermes:clean", name: "clean", runtime: "hermes", status: "running", channels: [{ platform: "telegram", state: "connected" }], agentId: "hermes:clean" };
  const host = { id: "h", name: "h", hostname: "h", online: true, self: true, agents: [] };
  test("accepts a host with bots and one without", () => {
    expect(parseHosts([host])).toEqual([host]);
    expect(parseHosts([{ ...host, bots: [bot] }])?.[0]?.bots).toEqual([bot]);
  });
  test("validates every bot field", () => {
    expect(isBotInfo(bot)).toBe(true);
    expect(isBotInfo({ ...bot, agentId: undefined, detail: "x" })).toBe(true);
    expect(isBotInfo(null)).toBe(false);
    expect(isBotInfo({ ...bot, id: 1 })).toBe(false);
    expect(isBotInfo({ ...bot, name: undefined })).toBe(false);
    expect(isBotInfo({ ...bot, runtime: undefined })).toBe(false);
    expect(isBotInfo({ ...bot, status: "live" })).toBe(false);
    expect(isBotInfo({ ...bot, channels: "telegram" })).toBe(false);
    expect(isBotInfo({ ...bot, channels: [{ platform: "telegram", state: "up" }] })).toBe(false);
    expect(isBotInfo({ ...bot, channels: [{ platform: 1, state: "connected" }] })).toBe(false);
    expect(isBotInfo({ ...bot, channels: [null] })).toBe(false);
    for (const state of ["connected", "retrying", "disconnected", "configured"]) {
      expect(isBotInfo({ ...bot, channels: [{ platform: "discord", state }] })).toBe(true);
    }
    expect(isBotInfo({ ...bot, agentId: 3 })).toBe(false);
    expect(isBotInfo({ ...bot, detail: 3 })).toBe(false);
    expect(parseHosts([{ ...host, bots: [{ ...bot, status: "x" }] }])).toBeUndefined();
    expect(parseHosts([{ ...host, bots: "x" }])).toBeUndefined();
  });
});
