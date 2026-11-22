// Notifications are not reachable by the web army (features.json not_yet_in_army: "notifications
// and deep links"). This covers the pure safety rules; the native path is a device check.
import { describe, expect, test } from "bun:test";
import { optionForAction, parseNoticeAction, permissionNotice, permissionNoticeKey, staleNoticeKeys, type PermissionLike } from "./notification-actions";
import { createReplyNoticeObserver } from "./notification-policy";

const rec = (over: Partial<PermissionLike> = {}): PermissionLike => ({
  conversationId: "c1", sessionId: "s1", turnId: "t1", requestId: "r1", phase: "pending", deadlineAt: 10_000,
  options: [{ optionId: "always", kind: "allow_always" }, { optionId: "once", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }],
  ...over,
});

describe("actionable permission notifications (#555)", () => {
  test("Allow maps only to allow_once (never allow_always); Deny to reject_once", () => {
    expect(optionForAction(rec(), "allow")).toBe("once");
    expect(optionForAction(rec(), "deny")).toBe("no");
    expect(optionForAction(rec({ options: [{ optionId: "always", kind: "allow_always" }] }), "allow")).toBeNull();
  });
  test("notice opens the exact chat, carries scope but no optionId, and offers only available buttons", () => {
    const n = permissionNotice(rec(), "Fix the build", 1);
    expect(n?.target).toEqual({ kind: "chat", chatId: "c1" });
    expect(n?.key).toBe("c1:t1:action");
    expect(n?.title).toBe("Needs OK · Fix the build");
    expect(n?.actions).toEqual(["allow", "deny"]);
    expect(JSON.stringify(n)).not.toContain("optionId");
    expect(JSON.stringify(n)).not.toContain('"always"');
    expect(permissionNotice(rec({ options: [{ optionId: "always", kind: "allow_always" }] }), undefined, 1)?.actions).toEqual([]);
    expect(permissionNotice(rec({ phase: "deciding" }), "x", 1)).toBeNull();
    expect(permissionNotice(rec(), "x", 10_000)).toBeNull();
  });
  test("button payloads are validated; unknown actions or malformed scope are ignored", () => {
    const data = { url: "dash://chat/c1", permission: { conversationId: "c1", sessionId: "s1", turnId: "t1", requestId: "r1" } };
    expect(parseNoticeAction("allow", data)).toEqual({ action: "allow", ref: data.permission });
    expect(parseNoticeAction("deny", data)?.action).toBe("deny");
    expect(parseNoticeAction("expo.modules.notifications.actions.DEFAULT", data)).toBeNull();
    expect(parseNoticeAction("allow", { permission: { ...data.permission, requestId: "" } })).toBeNull();
    expect(parseNoticeAction("allow", { permission: [] })).toBeNull();
    expect(parseNoticeAction("allow", null)).toBeNull();
  });
  test("settled, expired or vanished requests make their notice stale", () => {
    const key = permissionNoticeKey(rec());
    expect(staleNoticeKeys(new Set([key]), [rec()], 1)).toEqual([]);
    expect(staleNoticeKeys(new Set([key]), [rec({ phase: "allowed" })], 1)).toEqual([key]);
    expect(staleNoticeKeys(new Set([key]), [rec()], 10_000)).toEqual([key]);
    expect(staleNoticeKeys(new Set([key]), [], 1)).toEqual([key]);
  });
  test("reply observer lets the permission notice own the turn's 'Action needed'", () => {
    const run = (skip?: (c: string, t: string, kind: string) => boolean) => {
      const emitted: string[] = [];
      const observe = createReplyNoticeObserver(n => emitted.push(n.title), skip);
      const msg = (state: string, status?: string) => ({ role: "assistant", turnId: "t1", state, text: "", ...(status ? { status } : {}) });
      // The observer reads only the fields it needs; cast-free via JSON round-trip into the parameter type.
      const conv = (state: string, status?: string): Parameters<typeof observe>[0] => JSON.parse(JSON.stringify([{ id: "c1", title: "c", messages: [msg(state, status)] }]));
      observe(conv("streaming"));
      observe(conv("streaming", "Waiting for approval"));
      return emitted;
    };
    expect(run()).toEqual(["Action needed"]);
    expect(run((_c, _t, kind) => kind === "action")).toEqual([]);
  });
});
