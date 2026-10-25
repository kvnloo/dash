import { describe, expect, test } from "bun:test";
import { chatLink, parseNotificationTarget, type DashNotice } from "./notification-policy";
import {
  createPermissionNoticeObserver,
  permissionNoticeKey,
  type PermissionNoticeEnvironment,
  type PermissionNoticeRequest,
} from "./permission-notification";

const background: PermissionNoticeEnvironment = {
  foreground: false, available: true, enabled: true, permission: "granted", now: 1_000,
};

function request(changes: Partial<PermissionNoticeRequest> = {}): PermissionNoticeRequest {
  return {
    chatId: "chat-1", turnId: "turn-1", requestId: "request-1",
    phase: "pending", deadlineAt: 2_000, ...changes,
  };
}

describe("Needs OK background notification observer", () => {
  test("foreground, disabled, denied, undetermined and unavailable never post or consume a pending request", async () => {
    const blocked: PermissionNoticeEnvironment[] = [
      { ...background, foreground: true },
      { ...background, enabled: false },
      { ...background, permission: "denied" },
      { ...background, permission: "undetermined" },
      { ...background, permission: "unavailable" },
      { ...background, available: false },
    ];
    for (const environment of blocked) {
      const sent: DashNotice[] = [];
      const observe = createPermissionNoticeObserver(notice => { sent.push(notice); });
      await observe([request()], environment);
      await observe([request()], environment);
      expect(sent).toHaveLength(0);
      await observe([request()], background);
      expect(sent).toHaveLength(1);
    }
  });

  test("reconnect replays notify once; fresh request, new turn and another chat stay independent", async () => {
    const sent: DashNotice[] = [];
    const observe = createPermissionNoticeObserver(notice => { sent.push(notice); });
    const first = request();
    await observe([first], background);
    await observe([first], background);
    await observe([first, first], background);
    expect(sent).toHaveLength(1);

    await observe([first, request({ requestId: "request-2" })], background);
    await observe([request({ turnId: "turn-2" })], background);
    await observe([request({ chatId: "chat-2" })], background);
    expect(sent).toHaveLength(4);
    expect(new Set(sent.map(notice => notice.key)).size).toBe(4);
    expect(sent.map(notice => notice.target)).toEqual([
      { kind: "chat", chatId: "chat-1" },
      { kind: "chat", chatId: "chat-1" },
      { kind: "chat", chatId: "chat-1" },
      { kind: "chat", chatId: "chat-2" },
    ]);
  });

  test("resolution, denial, timeout and expired deadline permanently suppress stale replay", async () => {
    const sent: DashNotice[] = [];
    const observe = createPermissionNoticeObserver(notice => { sent.push(notice); });
    await observe([request({ phase: "resolved", deadlineAt: undefined })], background);
    await observe([request()], background);
    await observe([request({ turnId: "denied" }), request({ turnId: "denied", phase: "denied" })], background);
    await observe([request({ turnId: "denied" })], background);
    await observe([request({ turnId: "timed-out", phase: "timeout" })], background);
    await observe([request({ turnId: "timed-out" })], background);
    await observe([request({ turnId: "expired", deadlineAt: 1_000 })], background);
    await observe([request({ turnId: "expired" })], background);
    await observe([request({ turnId: "explicitly-expired", phase: "expired" })], background);
    await observe([request({ turnId: "explicitly-expired" })], background);
    expect(sent).toHaveLength(0);

    // Tombstones must not affect other chats that happen to reuse protocol ids.
    await observe([request({ chatId: "chat-2" })], background);
    expect(sent).toHaveLength(1);
  });

  test("deciding is silent, and only a newly pending request can notify after a failed decision", async () => {
    const sent: DashNotice[] = [];
    const observe = createPermissionNoticeObserver(notice => { sent.push(notice); });
    await observe([request(), request({ phase: "deciding" })], background);
    expect(sent).toHaveLength(0);
    await observe([request({ phase: "deciding" })], background);
    expect(sent).toHaveLength(0);
    await observe([request()], background);
    expect(sent).toHaveLength(1);
    await observe([request({ phase: "allowed" })], background);
    await observe([request()], background);
    expect(sent).toHaveLength(1);
  });

  test("exact chat deep link and generic lockscreen copy never leak tool or message contents", async () => {
    const syntheticSecret = "SYNTHETIC_SECRET_TOKEN_459";
    const record = {
      ...request({ chatId: "chat with space%?" }),
      displayContext: syntheticSecret,
      toolInput: { password: syntheticSecret },
      message: syntheticSecret,
    };
    const sent: DashNotice[] = [];
    await createPermissionNoticeObserver(notice => { sent.push(notice); })([record], background);
    const notice = sent[0];
    expect(notice).toEqual({
      key: permissionNoticeKey(record),
      title: "Needs OK",
      body: "An agent needs a decision. Open Dash to review.",
      target: { kind: "chat", chatId: record.chatId },
    });
    expect(JSON.stringify(notice)).not.toContain(syntheticSecret);
    expect(chatLink(record.chatId)).toBe("dash://chat/chat%20with%20space%25%3F");
    expect(parseNotificationTarget({ url: chatLink(record.chatId) })).toEqual({ kind: "chat", chatId: record.chatId });
  });

  test("refuses missing, invalid or unrouteable identifiers and unsafe deadlines", async () => {
    const sent: DashNotice[] = [];
    const observe = createPermissionNoticeObserver(notice => { sent.push(notice); });
    const invalid = [
      request({ chatId: "" }),
      request({ chatId: "bad/chat" }),
      request({ chatId: "bad\nchat" }),
      request({ chatId: "x".repeat(201) }),
      request({ requestId: "" }),
      request({ turnId: " " }),
      request({ deadlineAt: undefined }),
      request({ deadlineAt: Number.NaN }),
      request({ deadlineAt: Infinity }),
    ];
    await observe(invalid, background);
    await observe([request()], { ...background, now: Number.NaN });
    expect(sent).toHaveLength(0);
    expect(permissionNoticeKey(request({ chatId: "bad/chat" }))).toBeNull();
    const first = permissionNoticeKey(request({ chatId: "a:b", turnId: "c", requestId: "d" }));
    const second = permissionNoticeKey(request({ chatId: "a", turnId: "b:c", requestId: "d" }));
    expect(first).not.toBe(second);
  });

  test("concurrent reconnect snapshots share one in-flight post; failed scheduler calls can retry", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>(resolve => { release = () => resolve(); });
    let calls = 0;
    const observe = createPermissionNoticeObserver(async () => { calls++; await hold; });
    const first = observe([request()], background);
    const second = observe([request()], background);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    await observe([request()], background);
    expect(calls).toBe(1);

    let attempts = 0;
    const sent: DashNotice[] = [];
    const retry = createPermissionNoticeObserver(async notice => {
      attempts++;
      if (attempts === 1) throw new Error("native notifications temporarily unavailable");
      sent.push(notice);
    });
    await retry([request()], background);
    expect(sent).toHaveLength(0);
    await retry([request()], background);
    await retry([request()], background);
    expect(attempts).toBe(2);
    expect(sent).toHaveLength(1);
  });
});
