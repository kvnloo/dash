import { describe, expect, test } from "bun:test";
import { chatLink, parseChatLink, parseNotificationTarget } from "./notification-policy";

const CHAT = "DASH2-183-Chat-A";
const OTHER_CHAT = "DASH2-183-chat-a";

describe("DASH2-183: notification chat deep-link identity", () => {
  test("round-trips exact encoded identifiers without trimming, case folding or double decoding", () => {
    const ids = [
      CHAT,
      OTHER_CHAT,
      "DASH2-183:session=ZX%2F +?&#",
      "DASH2-183-\u00e9-e\u0301",
      "DASH2-183-\u2615\ud83e\udd47",
      "%2e%2e",
      "x".repeat(200),
      "\ud83e\udd47".repeat(100),
    ];

    for (const id of ids) {
      const url = chatLink(id);
      expect(url).toBe("dash://chat/" + encodeURIComponent(id));
      expect(parseChatLink(url)).toBe(id);
      expect(parseNotificationTarget({ url })).toEqual({ kind: "chat", chatId: id });
    }
    expect(parseChatLink(chatLink(CHAT))).not.toBe(parseChatLink(chatLink(OTHER_CHAT)));
    expect(parseChatLink(chatLink("\u00e9"))).not.toBe(parseChatLink(chatLink("e\u0301")));
  });

  test("rejects unrouteable identifiers rather than fabricating a chat", () => {
    const invalidIds = [
      "",
      "x".repeat(201),
      "\ud83e\udd47".repeat(101),
      "DASH2-183/child",
      "DASH2-183\\child",
      "DASH2-183\u0000secret",
      "DASH2-183\u0009secret",
      "DASH2-183\u001fsecret",
    ];
    for (const id of invalidIds) {
      expect(parseChatLink(chatLink(id))).toBeNull();
      expect(parseNotificationTarget({ url: chatLink(id) })).toBeNull();
    }
    expect(parseChatLink(null)).toBeNull();
    expect(parseChatLink("")).toBeNull();
  });

  test("rejects foreign schemes, host lookalikes and non-chat routes", () => {
    const urls = [
      "https://chat/" + CHAT,
      "exp://chat/" + CHAT,
      "dash://chat.example/" + CHAT,
      "dash://chats/" + CHAT,
      "dash://connect/" + CHAT,
      "dash:///chat/" + CHAT,
      "dash://chat//" + CHAT,
      "dash://approvals/" + CHAT,
    ];
    for (const url of urls) {
      expect(parseChatLink(url)).toBeNull();
      expect(parseNotificationTarget({ url })).toBeNull();
    }
  });

  test("rejects query and fragment smuggling even when values resemble chat ids", () => {
    const urls = [
      chatLink(CHAT) + "?next=" + encodeURIComponent(chatLink(OTHER_CHAT)),
      chatLink(CHAT) + "?sessionId=synthetic-session&optionId=synthetic-option",
      chatLink(CHAT) + "#approval",
      chatLink(CHAT) + "#/chat/" + OTHER_CHAT,
    ];
    for (const url of urls) {
      expect(parseChatLink(url)).toBeNull();
      expect(parseNotificationTarget({ url, chatId: CHAT })).toBeNull();
    }
  });

  test("rejects malformed percent escapes, encoded separators and control bytes", () => {
    const urls = [
      "dash://chat/%E0%A4%A",
      "dash://chat/%C3%28",
      "dash://chat/%ED%A0%80",
      "dash://chat/DASH2-183%2Fchild",
      "dash://chat/DASH2-183%5Cchild",
      "dash://chat/DASH2-183%0Achild",
      "dash://chat/DASH2-183%7Fchild",
    ];
    for (const url of urls) {
      expect(parseChatLink(url)).toBeNull();
      expect(parseNotificationTarget({ url })).toBeNull();
    }
  });

  test("rejects traversal that URL pathname normalization would conceal", () => {
    const urls = [
      "dash://chat/folder/../" + CHAT,
      "dash://chat/%2e%2e/" + CHAT,
      "dash://chat/%2E/" + CHAT,
      "dash://chat/folder/%2e%2e/" + CHAT,
    ];
    for (const url of urls) {
      expect(parseChatLink(url)).toBeNull();
      expect(parseNotificationTarget({ url })).toBeNull();
    }
    // A literal encoded-percent id remains valid, not a second decoding pass.
    expect(parseChatLink(chatLink("%2e%2e"))).toBe("%2e%2e");
  });

  test("rejects authority aliases and empty query/fragment delimiters", () => {
    const urls = [
      "dash://untrusted@chat/" + CHAT,
      "dash://chat:4747/" + CHAT,
      chatLink(CHAT) + "?",
      chatLink(CHAT) + "#",
    ];
    for (const url of urls) {
      expect(parseChatLink(url)).toBeNull();
      expect(parseNotificationTarget({ url })).toBeNull();
    }
  });

  test("rejects blank identifiers even when encoded and otherwise well formed", () => {
    for (const id of [" ", "\t", "\n", "  \u2003  "]) {
      expect(parseChatLink(chatLink(id))).toBeNull();
      expect(parseNotificationTarget({ url: chatLink(id) })).toBeNull();
    }
  });
});

describe("DASH2-183: notification target shape and approvals separation", () => {
  test("recognizes only the exact upstream approvals link, never a chat lookalike", () => {
    expect(parseNotificationTarget({ url: "dash://approvals" })).toEqual({ kind: "approvals" });
    expect(parseChatLink("dash://approvals")).toBeNull();
    expect(parseNotificationTarget({ url: chatLink("approvals") })).toEqual({
      kind: "chat", chatId: "approvals",
    });

    for (const url of [
      "dash://approvals/",
      "dash://approvals?chatId=" + CHAT,
      "dash://approvals#chat/" + CHAT,
      "dash://approvals/" + CHAT,
      "dash://approvals%2F",
      "DASH://approvals",
    ]) {
      expect(parseNotificationTarget({ url })).toBeNull();
    }
  });

  test("accepts a frozen native payload but never promotes option or session fields", () => {
    const payload = Object.freeze({
      url: chatLink(CHAT),
      chatId: OTHER_CHAT,
      target: { kind: "approvals" },
      sessionId: "DASH2-183-session:keep%case",
      optionId: "DASH2-183-option:KeepCase",
    });
    const parsed = parseNotificationTarget(payload);
    expect(parsed).toEqual({ kind: "chat", chatId: CHAT });
    expect(Object.keys(parsed ?? {}).sort()).toEqual(["chatId", "kind"]);

    const approvalPayload = Object.freeze({
      url: "dash://approvals",
      chatId: CHAT,
      sessionId: "DASH2-183-session",
      optionId: "DASH2-183-option",
    });
    expect(parseNotificationTarget(approvalPayload)).toEqual({ kind: "approvals" });
  });

  test("rejects absent, scalar, array, wrong-type and unrelated data", () => {
    const invalid: unknown[] = [
      undefined, null, false, true, 0, 1, NaN,
      "", chatLink(CHAT), [],
      [chatLink(CHAT)],
      {},
      { chatId: CHAT },
      { kind: "chat", chatId: CHAT },
      { target: { kind: "chat", chatId: CHAT } },
      { url: undefined },
      { url: null },
      { url: false },
      { url: 47 },
      { url: [chatLink(CHAT)] },
      { url: { toString: () => chatLink(CHAT) } },
      { url: "dash://approvals/" },
    ];
    for (const input of invalid) expect(parseNotificationTarget(input)).toBeNull();
  });

  test("rejects arrays even if they carry a forged url property", () => {
    const spoofed = Object.assign([], {
      url: chatLink(CHAT),
      sessionId: "DASH2-183-forged-session",
      optionId: "DASH2-183-forged-option",
    });
    expect(parseNotificationTarget(spoofed)).toBeNull();
  });
});
